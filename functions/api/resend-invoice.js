// POST /api/resend-invoice
// Regenerates the payment link for a sent invoice and resends via the billing adapter.
// Use when the original Payload link has expired (60-day TTL) or the client needs a fresh email.
// Body: { invoice_id }

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { getBillingAdapter }  from './_adapters/billing/index.js';
import { getPaymentAdapter }  from './_adapters/payment/index.js';
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

  const { data: invoice, error: fetchErr } = await admin
    .from('invoices')
    .select('*, invoice_line_items(*), matters(id, clients(id, first_name, last_name, email))')
    .eq('id', invoice_id)
    .single();

  if (fetchErr || !invoice) return json(404, { error: 'Invoice not found' });
  if (invoice.status !== 'sent') return json(400, { error: 'Only sent invoices can be resent' });

  const client  = invoice.matters?.clients;
  const updates = {};

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

  const billingAdapter = getBillingAdapter(env);
  if (billingAdapter?.sendInvoiceWithPaymentLink && invoice.external_id) {
    try {
      await billingAdapter.sendInvoiceWithPaymentLink(
        invoice.external_id,
        updates.payment_link || invoice.payment_link,
        client?.email || null,
      );
    } catch (err) {
      console.error('[resend-invoice] Billing adapter resend failed:', err.message);
    }
  }

  if (Object.keys(updates).length) {
    const { data: updated, error: updateErr } = await admin
      .from('invoices')
      .update(updates)
      .eq('id', invoice_id)
      .select()
      .single();
    if (updateErr) return json(500, { error: updateErr.message });
    return json(200, { invoice: updated });
  }

  return json(200, { invoice });
}
