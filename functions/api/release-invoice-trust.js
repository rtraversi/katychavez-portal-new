// POST /api/release-invoice-trust
// Records the trust→operating release for an invoice: posts the trust ledger
// disbursement against the invoice and marks it paid (atomic RPC, migration 1526).
// The actual money movement is a bank-side transfer the firm makes — this only
// records it, so the ledger mirrors the real bank account.
// Body: { invoice_id, check_number?, note? }

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  // Writes a trust ledger entry — gate on trust write, not billing write.
  const auth = await verifyAuth(request, env, 'write', 'trust_accounting');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { invoice_id, check_number, note } = body;
  if (!invoice_id) return json(400, { error: 'invoice_id required' });

  const admin = makeAdminClient(env);

  const { data, error } = await admin.rpc('release_invoice_from_trust', {
    p_invoice_id:   invoice_id,
    p_actor:        auth.profile.id,
    p_check_number: check_number || null,
    p_note:         note || null,
  });

  // RPC raises for every refusal (wrong status, duplicate release, insufficient
  // matter trust balance, no trust account) — surface the message as a 400.
  if (error) return json(400, { error: error.message });

  return json(200, data);
}
