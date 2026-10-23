// CF Worker: POST /api/form-filler/row-fee
// Body: { matter_id, row_id, fee_amount }
//
// Drafter 1.0.4 (D-19, D-20): the amount one copy of a G-1450 pays, set from
// the case's USCIS Forms tab. Whole dollars ("520", "$520", "1,234"); empty
// clears it. Only the amount is stored, never which form it pays for. The
// caller autofills that copy again afterwards, so the new amount reaches its
// AuthorizedPaymentAmt box and its file name.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { hasFee, parseFeeAmount } from './_form-copies.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-row-fee]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, row_id } = body;
  if (!matter_id || !row_id) return json(400, { error: 'matter_id and row_id are required' });

  const parsed = parseFeeAmount(body.fee_amount);
  if (parsed.error) return json(400, { error: parsed.error });

  const admin = makeAdminClient(env);
  const { data: row } = await admin
    .from('matter_forms')
    .select('id, matter_id, template:form_templates(form_key)')
    .eq('id', row_id)
    .eq('matter_id', matter_id)
    .maybeSingle();
  if (!row) return json(404, { error: 'That form is not on this matter.' });
  if (!hasFee(row.template?.form_key)) return json(422, { error: 'Only a G-1450 carries a fee amount.' });

  const { error } = await admin.from('matter_forms').update({ fee_amount: parsed.value }).eq('id', row.id);
  if (error) return json(500, { error: 'Failed to save the amount.' });

  return json(200, { ok: true, row_id: row.id, fee_amount: parsed.value });
}
