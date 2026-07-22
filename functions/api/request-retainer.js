// POST /api/request-retainer
// Body: { matter_id, amount, description? }
// Staff (write on trust_accounting). Creates a Payload payment link routed to the
// TRUST (IOLTA) processing account, saves a pending retainer_requests row, and emails
// the client the link. On payment, invoice-payment-webhook posts the trust deposit.
//
// No invoice is involved — this is a client pre-funding their retainer. The gross
// amount lands in trust; Payload bills its fee to the firm's separate operating account.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { getPaymentAdapter } from './_adapters/payment/index.js';
import { getTrustFirst, defaultAccountType } from './_firm-billing-settings.js';
import { notifyRetainerRequest } from './_notifications.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'trust_accounting');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, description } = body;
  // Open-amount request: the client enters the amount at checkout (e.g. asked
  // $5,000, pays what they can). amount is left blank until they pay.
  const openAmount = body.open_amount === true;
  const amount     = Number(body.amount);

  if (!matter_id) return json(400, { error: 'matter_id is required' });
  if (!openAmount && (!Number.isFinite(amount) || amount <= 0)) {
    return json(400, { error: 'A retainer amount greater than zero is required' });
  }
  // Round to cents to match the numeric(10,2) column. null for an open amount.
  const amountCents = openAmount ? null : Math.round(amount * 100) / 100;

  const admin = makeAdminClient(env);

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, clients(id, first_name, last_name, email)')
    .eq('id', matter_id)
    .single();

  if (matterErr || !matter) return json(404, { error: 'Matter not found' });

  const client     = matter.clients;
  const clientName = client ? `${client.first_name || ''} ${client.last_name || ''}`.trim() : '';

  // Recipient: the client by default, or an "Other Person" (guarantor) chosen in
  // the modal. The snapshot columns record whoever the link was actually sent to.
  const recipientEmail = (body.recipient_email && String(body.recipient_email).trim()) || null;
  const recipientName  = (body.recipient_name  && String(body.recipient_name).trim())  || null;
  const toEmail = recipientEmail || client?.email;
  const toName  = recipientName  || clientName;
  if (!toEmail) return json(400, { error: 'No recipient email address on file' });

  const desc = (description && String(description).trim()) || 'Retainer';

  // DEMO_MODE: skip Payload + email, return a canned pending row.
  if (env.DEMO_MODE === 'true') {
    const { data: demoRow } = await admin.from('retainer_requests').insert({
      matter_id,
      amount:          amountCents,
      open_amount:     openAmount,
      description:     desc,
      payment_link:    'https://pay.payload.com/demo/retainer',
      payment_adapter: 'payload',
      client_email:    toEmail,
      client_name:     toName,
      requested_by:    auth.profile.id,
    }).select().single();
    return json(200, { retainer: demoRow });
  }

  // Require a payment adapter — a retainer link is the entire point of this endpoint.
  const paymentAdapter = getPaymentAdapter(env);
  if (!paymentAdapter) {
    return json(400, { error: 'No payment provider is configured. Set PAYMENT_PROVIDER to enable retainer links.' });
  }

  let link;
  try {
    const result = await paymentAdapter.createPaymentRequest({
      amount:      amountCents,   // null → open-amount link (payer enters it)
      clientEmail: toEmail,
      clientName:  toName,
      description: desc,
      // Trust-first firms route retainers to the IOLTA processing account.
      // NB this is a firm CONFIGURATION, not an ethics override: unearned client
      // funds generally must sit in trust, so only turn trust_first off for a
      // firm whose jurisdiction and fee agreements actually permit otherwise
      // (e.g. earned-on-receipt flat fees). Default is trust.
      accountType: defaultAccountType(await getTrustFirst(admin)),
    });
    link = result;
  } catch (err) {
    console.error('[request-retainer] payment adapter error:', err.message);
    return json(502, { error: `Payment provider error: ${err.message}` });
  }

  const { data: retainer, error: insErr } = await admin
    .from('retainer_requests')
    .insert({
      matter_id,
      amount:            amountCents,
      open_amount:       openAmount,
      description:       desc,
      payment_link:      link.paymentLink,
      payment_reference: link.requestId,
      payment_adapter:   env.PAYMENT_PROVIDER,
      client_email:      toEmail,
      client_name:       toName,
      requested_by:      auth.profile.id,
    })
    .select()
    .single();

  if (insErr) {
    console.error('[request-retainer] insert error:', insErr.message);
    return json(500, { error: 'Failed to save retainer request.' });
  }

  // Email is best-effort — the request is saved and the link is returned regardless.
  await notifyRetainerRequest(env, {
    toEmail:     toEmail,
    clientName:  toName,
    amount:      amountCents,
    description: desc === 'Retainer' ? null : desc,
    link:        link.paymentLink,
  }).catch(err => console.error('[request-retainer] notification error:', err.message));

  return json(200, { retainer });
}
