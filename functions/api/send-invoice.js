import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { getBillingAdapter } from './_adapters/billing/index.js';
import { getPaymentAdapter } from './_adapters/payment/index.js';
import { getTrustFirst, defaultAccountType } from './_firm-billing-settings.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { invoice_id } = body;
  if (!invoice_id) return json(400, { error: 'invoice_id required' });

  const admin = makeAdminClient(env);

  // DEMO_MODE: skip all external adapter calls, return a canned success
  if (env.DEMO_MODE === 'true') {
    const { data: inv } = await admin.from('invoices')
      .update({ status: 'sent', payment_adapter: 'confido', payment_link: 'https://pay.gravity-legal.com/demo/nexuslegal/live-preview' })
      .eq('id', invoice_id).select().single();
    return json(200, { invoice: inv });
  }

  const { data: invoice, error: fetchErr } = await admin
    .from('invoices')
    .select(`
      *,
      invoice_line_items(*),
      matters(id, case_number, clients(id, first_name, last_name, email))
    `)
    .eq('id', invoice_id)
    .single();

  if (fetchErr || !invoice) return json(404, { error: 'Invoice not found' });
  if (invoice.status !== 'draft') return json(400, { error: 'Only draft invoices can be sent' });

  const client  = invoice.matters?.clients;
  const updates = { status: 'sent' };

  // Step 1: Create invoice in billing system (FreshBooks / QB) if configured.
  // This gives us an externalId we'll need to update with the payment link.
  const billingAdapter = getBillingAdapter(env);
  if (billingAdapter) {
    try {
      const result = await billingAdapter.createInvoice(invoice, invoice.invoice_line_items, client);
      updates.external_id = result.externalId;
      updates.source      = env.BILLING_PROVIDER;
      updates.synced_at   = new Date().toISOString();
    } catch (err) {
      return json(502, { error: `Billing adapter error: ${err.message}` });
    }
  }

  // Step 2: Generate payment link (Confido) if configured.
  const paymentAdapter = getPaymentAdapter(env);
  if (paymentAdapter) {
    try {
      const result = await paymentAdapter.createPaymentRequest({
        invoiceId:   invoice.id,
        amount:      invoice.amount,
        clientEmail: client?.email,
        clientName:  client ? `${client.first_name} ${client.last_name}` : '',
        description: invoice.description,
        // The invoice's own account wins; the firm's trust_first setting only
        // decides the fallback (migration 1536, was hardcoded 'trust').
        accountType: invoice.account_type || defaultAccountType(await getTrustFirst(admin)),
      });
      updates.payment_link      = result.paymentLink;
      updates.payment_adapter   = env.PAYMENT_PROVIDER;
      updates.payment_reference = result.requestId;
    } catch (err) {
      return json(502, { error: `Payment adapter error: ${err.message}` });
    }
  }

  // Step 3: If a billing adapter is configured, have it EMAIL the invoice to
  // the client (FreshBooks: action_email + PDF attached) with the payment link
  // in the notes. Without a client email it can only mark the invoice sent.
  if (billingAdapter?.sendInvoiceWithPaymentLink && updates.external_id) {
    try {
      await billingAdapter.sendInvoiceWithPaymentLink(
        updates.external_id,
        updates.payment_link || null,
        client?.email || null,
      );
    } catch (err) {
      // Non-fatal: invoice is still created. Log and continue.
      console.error(`[send-invoice] Failed to send via billing adapter: ${err.message}`);
    }
  }

  const { data: updated, error: updateErr } = await admin
    .from('invoices')
    .update(updates)
    .eq('id', invoice_id)
    .select()
    .single();

  if (updateErr) return json(500, { error: updateErr.message });

  return json(200, { invoice: updated });
}
