// CF Worker: POST /api/form-filler/reset
// Body: { matter_id }
//
// Resets the matter's USCIS form package back to defaults: deletes every
// generated_forms row for the matter along with its draft and finalized PDFs
// in R2. Every form returns to "Not Generated". Client data, templates, and
// firm template defaults are untouched.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-reset]', err);
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

  const { matter_id } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required' });

  const admin = makeAdminClient(env);

  const { data: rows, error } = await admin
    .from('generated_forms')
    .select('id, r2_key, finalized_r2_key')
    .eq('matter_id', matter_id);
  if (error) return json(500, { error: 'Failed to load generated forms.' });

  if (!rows || rows.length === 0) return json(200, { ok: true, deleted: 0 });

  // Remove PDFs first so a partial failure never leaves DB rows pointing at
  // deleted files without the rows themselves being gone too.
  const keys = rows.flatMap(r => [r.r2_key, r.finalized_r2_key]).filter(Boolean);
  if (keys.length) await env.R2.delete(keys);

  const { error: delErr } = await admin
    .from('generated_forms')
    .delete()
    .eq('matter_id', matter_id);
  if (delErr) return json(500, { error: 'Failed to delete generated form records.' });

  return json(200, { ok: true, deleted: rows.length });
}
