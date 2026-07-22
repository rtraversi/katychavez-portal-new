import { makeAdminClient, json } from './_helpers.js';
import { getPaymentAdapter } from './_adapters/payment/index.js';
import { getBillingAdapter } from './_adapters/billing/index.js';
import { notifyRetainerPaid } from './_notifications.js';

// firm_settings.fb_auto_prepayment (migration 1535). Defensive like
// getBillingIncrementMinutes: missing row/column → false (feature dark).
async function getFbAutoPrepayment(admin) {
  try {
    const { data } = await admin
      .from('firm_settings')
      .select('fb_auto_prepayment')
      .limit(1)
      .maybeSingle();
    return data?.fb_auto_prepayment === true;
  } catch {
    return false;
  }
}

// Receives payment confirmation webhooks from Confido or Stripe.
// No auth required — signature verification happens inside the adapter.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const paymentAdapter = getPaymentAdapter(env);
  if (!paymentAdapter) return json(400, { error: 'No payment adapter configured' });

  // Confido/Stripe sign with a header. Payload sends NO signature header — its
  // credential is the shared token we embed in the registered webhook URL (?key=…),
  // and the adapter additionally verifies by reading the transaction back from the API.
  const signature = request.headers.get('x-payload-signature') ||
                    request.headers.get('x-confido-signature') ||
                    request.headers.get('stripe-signature') ||
                    new URL(request.url).searchParams.get('key');
  const rawBody = await request.text();

  let event;
  try {
    event = await paymentAdapter.handleWebhook(rawBody, signature, env);
  } catch (err) {
    return json(400, { error: `Webhook validation failed: ${err.message}` });
  }

  // Null means the event type is not one we act on — acknowledge and move on
  if (!event || event.status !== 'paid') return json(200, { received: true });

  let { invoiceId, paymentRequestId, transactionId, amount } = event;

  const admin = makeAdminClient(env);

  // If adapter couldn't extract invoiceId from the webhook payload, look up by payment_reference
  if (!invoiceId && paymentRequestId) {
    const { data } = await admin
      .from('invoices')
      .select('id')
      .eq('payment_reference', paymentRequestId)
      .single();
    invoiceId = data?.id;
  }

  // Not an invoice? It may be a retainer request (trust-routed pre-payment).
  // Post the trust deposit atomically via its own SECURITY DEFINER RPC.
  if (!invoiceId && paymentRequestId) {
    const { data: retainer } = await admin
      .from('retainer_requests')
      .select('id, amount, description, client_name, matters(case_number, clients(first_name, last_name, email))')
      .eq('payment_reference', paymentRequestId)
      .single();

    if (retainer?.id) {
      const { error: rErr } = await admin.rpc('process_retainer_payment', {
        p_retainer_id:     retainer.id,
        p_transaction_ref: transactionId || paymentRequestId || null,
        // Actual amount paid — required for open-amount retainers, and the
        // authoritative deposit for fixed ones. RPC falls back to the requested
        // amount when null.
        p_amount:          amount ?? null,
      });
      if (rErr) {
        console.error('[invoice-payment-webhook] process_retainer_payment RPC failed:', rErr.message);
        return json(500, { error: 'Retainer processing failed — webhook will be retried' });
      }

      // Best-effort: record the retainer in FreshBooks as a Prepayment credit
      // under the client — but ONLY when firm_settings.fb_auto_prepayment is
      // on (default off; the FB credit mechanism is unverified live). While
      // off or on failure, the staff email below carries a reminder to record
      // it in FreshBooks manually. fbHint: 'recorded' | 'manual' | null (null
      // = no FreshBooks configured, say nothing about FB in the email).
      let fbHint = null;
      const billingAdapter = getBillingAdapter(env);
      if (billingAdapter?.createPrepaymentCredit) {
        fbHint = 'manual';
        if (await getFbAutoPrepayment(admin)) {
          try {
            const fbClient = retainer.matters?.clients;
            await billingAdapter.createPrepaymentCredit({
              clientEmail: fbClient?.email || null,
              clientName:  fbClient || null,
              amount:      amount ?? retainer.amount,
              note:        retainer.description || 'Retainer payment received via portal',
            });
            fbHint = 'recorded';
          } catch (err) {
            console.error('[invoice-payment-webhook] FB prepayment credit failed (non-fatal):', err.message);
          }
        }
      }

      // Best-effort: tell the whole team, individually. Staff = every active
      // user whose role isn't Client — no hardcoded address list, so new hires
      // are included automatically. Never fails the webhook: the deposit is
      // already posted, and a 500 here would make the provider redeliver.
      try {
        const { data: staff } = await admin
          .from('users')
          .select('email, roles(name)')
          .eq('active', true);
        const team = (staff || []).filter(u => u.email && u.roles?.name !== 'Client');
        await Promise.all(team.map(u => notifyRetainerPaid(env, {
          toEmail:     u.email,
          clientName:  retainer.client_name,
          matterLabel: retainer.matters?.case_number,
          amount:      amount ?? retainer.amount,
          description: retainer.description,
          fbHint,
        }).catch(err => console.error(`[invoice-payment-webhook] retainer-paid email to ${u.email} failed:`, err.message))));
      } catch (err) {
        console.error('[invoice-payment-webhook] retainer-paid notifications failed (non-fatal):', err.message);
      }

      return json(200, { received: true });
    }
  }

  if (!invoiceId) return json(200, { received: true });

  // F4 (IOLTA): Mark the invoice paid AND insert the trust ledger deposit atomically
  // via a SECURITY DEFINER RPC. Both succeed or both roll back — no reconciliation gap.
  // If this errors, we return 500 so Confido retries the webhook; the FOR UPDATE lock
  // in the function prevents double-processing on a successful retry.
  const { error: rpcError } = await admin.rpc('process_invoice_payment', {
    p_invoice_id:      invoiceId,
    p_transaction_ref: transactionId || paymentRequestId || null,
  });

  if (rpcError) {
    console.error('[invoice-payment-webhook] process_invoice_payment RPC failed:', rpcError.message);
    return json(500, { error: 'Payment processing failed — webhook will be retried' });
  }

  return json(200, { received: true });
}
