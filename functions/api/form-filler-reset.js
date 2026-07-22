// CF Worker: POST /api/form-filler/reset
// Body: { matter_id, template_ids?: [uuid] }
//
// Resets USCIS forms back to defaults: deletes the generated_forms rows along
// with their draft and finalized PDFs in R2, plus the matching manual field
// edits (form_field_edits — these survive Regenerate but not Reset; Reset is
// the start-fresh escape hatch). Affected forms return to "Not Generated".
// Client data, templates, and firm template defaults are untouched.
//
// Without template_ids this resets the whole matter (the original behavior).
// With template_ids it resets ONLY those forms — staff shouldn't have to blow
// away six correct forms to redo the one that's wrong. The field-edit delete
// is scoped the same way; form_field_edits is already indexed on
// (matter_id, template_id).
//
// The matter's form list (matter_forms) is NOT touched either way: Reset
// clears generated output, it doesn't un-choose forms.

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

  const { matter_id, template_ids } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required' });

  // An explicit empty array is a caller bug — it would otherwise fall through
  // to "no scope" and reset the entire matter, which is the opposite of intent.
  if (template_ids !== undefined) {
    if (!Array.isArray(template_ids)) return json(400, { error: 'template_ids must be an array' });
    if (!template_ids.length)         return json(400, { error: 'template_ids cannot be empty' });
  }
  const scoped = Array.isArray(template_ids) && template_ids.length > 0;

  const admin = makeAdminClient(env);

  let genQuery = admin
    .from('generated_forms')
    .select('id, r2_key, finalized_r2_key')
    .eq('matter_id', matter_id);
  if (scoped) genQuery = genQuery.in('template_id', template_ids);

  const { data: rows, error } = await genQuery;
  if (error) return json(500, { error: 'Failed to load generated forms.' });

  let editQuery = admin.from('form_field_edits').delete().eq('matter_id', matter_id);
  if (scoped) editQuery = editQuery.in('template_id', template_ids);
  await editQuery;

  if (!rows || rows.length === 0) return json(200, { ok: true, deleted: 0 });

  // Remove PDFs first so a partial failure never leaves DB rows pointing at
  // deleted files without the rows themselves being gone too.
  const keys = rows.flatMap(r => [r.r2_key, r.finalized_r2_key]).filter(Boolean);
  if (keys.length) await env.R2.delete(keys);

  let delQuery = admin.from('generated_forms').delete().eq('matter_id', matter_id);
  if (scoped) delQuery = delQuery.in('template_id', template_ids);

  const { error: delErr } = await delQuery;
  if (delErr) return json(500, { error: 'Failed to delete generated form records.' });

  return json(200, { ok: true, deleted: rows.length });
}
