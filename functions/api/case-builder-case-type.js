// CF Worker: POST /api/case-builder/case-type
//
//   Create:  { name, practice_area_id }        -> slugified, collision-checked key
//   Update:  { id, name?, active?, sort_order? } -> display fields only
//
// The key is derived from the name on create and IMMUTABLE thereafter: field
// maps, doc templates and the intake flow reference case_types.key, and nothing
// would follow a rename. Update never touches it. Deactivate (active:false)
// rather than delete — the same reason.

import { verifyAuth, json } from './_helpers.js';
import { slugify, uniqueKey } from './_case-builder.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handle(request, env);
  } catch (err) {
    console.error('[case-builder-case-type]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handle(request, env) {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await verifyAuth(request, env, 'admin', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const admin = auth.admin;

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  if (request.method === 'DELETE') return deleteCaseType(admin, body.id);

  const { id, name, practice_area_id, active, sort_order } = body;

  // ── Update (display fields only; key stays put) ──────────────────────────────
  if (id) {
    const patch = {};
    if (typeof name === 'string' && name.trim()) patch.name = name.trim();
    if (typeof active === 'boolean')             patch.active = active;
    if (Number.isFinite(sort_order))             patch.sort_order = sort_order;
    if (!Object.keys(patch).length) return json(400, { error: 'Nothing to update.' });

    const { data, error } = await admin.from('case_types')
      .update(patch).eq('id', id)
      .select('id, key, name, active, practice_area_id, sort_order').maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data)  return json(404, { error: 'Case type not found.' });
    return json(200, { ok: true, case_type: data });
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  if (!name || !name.trim()) return json(400, { error: 'A name is required.' });

  // Case Builder is immigration-scoped for now: default new case types to the
  // immigration practice area when the caller doesn't specify one. (Explicit
  // practice_area_id is still honored for when we open it up.)
  let paId = practice_area_id;
  if (!paId) {
    const { data: imm } = await admin.from('practice_areas').select('id').eq('key', 'immigration').maybeSingle();
    if (!imm) return json(422, { error: 'Immigration practice area not found.' });
    paId = imm.id;
  } else {
    const { data: pa } = await admin.from('practice_areas').select('id').eq('id', paId).maybeSingle();
    if (!pa) return json(404, { error: 'Practice area not found.' });
  }

  const base = slugify(name);
  if (!base) return json(400, { error: 'Name must contain letters or numbers.' });

  const { data: siblings } = await admin.from('case_types').select('key').eq('practice_area_id', paId);
  const key = uniqueKey(base, (siblings || []).map(s => s.key));

  const { data: last } = await admin.from('case_types')
    .select('sort_order').eq('practice_area_id', paId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await admin.from('case_types').insert({
    practice_area_id: paId,
    key,
    name: name.trim(),
    sort_order: (last?.sort_order || 0) + 10,
    active: true,
  }).select('id, key, name, active, practice_area_id, sort_order').single();
  if (error) return json(500, { error: error.message });

  return json(200, { ok: true, created: true, case_type: data });
}

// Hard delete. matters and appointments reference case_types with a plain FK
// (no cascade), so deleting one they use would fail — pre-check and return a
// clear message instead. form_packages cascade-delete with the case type, which
// is the intended cleanup (its packages + their items go too). Anything still
// referencing the type should be deactivated, not deleted.
async function deleteCaseType(admin, id) {
  if (!id) return json(400, { error: 'id is required.' });

  const [mRes, aRes] = await Promise.all([
    admin.from('matters').select('id', { count: 'exact', head: true }).eq('case_type_id', id),
    admin.from('appointments').select('id', { count: 'exact', head: true }).eq('case_type_id', id),
  ]);
  const matterCount = mRes.count || 0;
  const apptCount   = aRes.count || 0;

  if (matterCount || apptCount) {
    const parts = [];
    if (matterCount) parts.push(`${matterCount} matter${matterCount === 1 ? '' : 's'}`);
    if (apptCount)   parts.push(`${apptCount} appointment${apptCount === 1 ? '' : 's'}`);
    return json(409, { error: `This case type is used by ${parts.join(' and ')}. Deactivate it instead of deleting.` });
  }

  const { error } = await admin.from('case_types').delete().eq('id', id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, deleted: id });
}
