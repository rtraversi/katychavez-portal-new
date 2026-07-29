// CF Worker: POST /api/case-builder/package
//
//   Create: { case_type_id, name, description?, is_default? }
//   Update: { id, name?, description?, is_default?, active? }
//
// A case type can have several named packages (e.g. "AOS" and "AOS -- I-130
// already filed") since migration 1620 dropped UNIQUE(case_type_id). Exactly one
// is the default, enforced by a partial unique index; promoting a package to
// default clears the previous one in the same request so the write never trips
// that index.
//
// Setting the ordered form LIST is a separate call (/api/case-builder/package-items).

import { verifyAuth, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handle(request, env);
  } catch (err) {
    console.error('[case-builder-package]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handle(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'admin', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const admin = auth.admin;

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { id, case_type_id, name, description, is_default, active } = body;

  // ── Update ───────────────────────────────────────────────────────────────────
  if (id) {
    const { data: pkg } = await admin.from('form_packages')
      .select('id, case_type_id, is_default').eq('id', id).maybeSingle();
    if (!pkg) return json(404, { error: 'Package not found.' });

    const patch = {};
    if (typeof name === 'string' && name.trim()) patch.name = name.trim();
    if (description !== undefined)               patch.description = (description || '').trim() || null;
    if (typeof active === 'boolean')             patch.active = active;

    // Promote to default: clear the current default for this case type first.
    if (is_default === true && !pkg.is_default) {
      await admin.from('form_packages')
        .update({ is_default: false })
        .eq('case_type_id', pkg.case_type_id).eq('is_default', true);
      patch.is_default = true;
    }
    // Deliberately ignore is_default:false — a case type should keep exactly one
    // default. To change it, promote a different package (which demotes this one).

    if (!Object.keys(patch).length) return json(400, { error: 'Nothing to update.' });

    const { data, error } = await admin.from('form_packages')
      .update(patch).eq('id', id)
      .select('id, case_type_id, name, description, is_default, active').single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, package: data });
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  if (!case_type_id)         return json(400, { error: 'case_type_id is required.' });
  if (!name || !name.trim()) return json(400, { error: 'A name is required.' });

  const { data: ct } = await admin.from('case_types').select('id').eq('id', case_type_id).maybeSingle();
  if (!ct) return json(404, { error: 'Case type not found.' });

  const { data: existingDefault } = await admin.from('form_packages')
    .select('id').eq('case_type_id', case_type_id).eq('is_default', true).maybeSingle();

  // First package for a case type is its default automatically; otherwise honor
  // the flag. Promoting clears the previous default so the partial index holds.
  const makeDefault = !!is_default || !existingDefault;
  if (makeDefault && existingDefault) {
    await admin.from('form_packages')
      .update({ is_default: false })
      .eq('case_type_id', case_type_id).eq('is_default', true);
  }

  const { data, error } = await admin.from('form_packages').insert({
    case_type_id,
    name: name.trim(),
    description: (description || '').trim() || null,
    is_default: makeDefault,
    active: true,
  }).select('id, case_type_id, name, description, is_default, active').single();
  if (error) return json(500, { error: error.message });

  return json(200, { ok: true, created: true, package: data });
}
