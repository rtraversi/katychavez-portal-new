// CF Worker: POST /api/case-builder/package-items
//
//   { package_id, items: [ { template_id, required? }, … ] }   // in display order
//
// Sets the package's WHOLE ordered form list in one authoritative write, rather
// than per-item add/remove. Reordering is the common edit, and a single write
// avoids the half-applied states per-item calls invite. sort_order is assigned
// from array position (10, 20, 30…).
//
// NOTE (materialize-on-edit — deferred): CASE-BUILDER-PLAN.md decision 1 wants a
// matter still reading through to this package to be materialized from the OLD
// list before it changes, so an in-flight filing doesn't silently gain/lose a
// form. Not implemented here yet — it's the piece most worth Max's flow feedback,
// and matters only once packages back live matters. Tracked as a follow-up.

import { verifyAuth, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handle(request, env);
  } catch (err) {
    console.error('[case-builder-package-items]', err);
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

  const { package_id, items } = body;
  if (!package_id)        return json(400, { error: 'package_id is required.' });
  if (!Array.isArray(items)) return json(400, { error: 'items must be an array.' });

  const { data: pkg } = await admin.from('form_packages').select('id').eq('id', package_id).maybeSingle();
  if (!pkg) return json(404, { error: 'Package not found.' });

  const ids = items.map(i => i && i.template_id).filter(Boolean);
  if (ids.length !== items.length) return json(400, { error: 'Every item needs a template_id.' });
  if (new Set(ids).size !== ids.length) return json(400, { error: 'The same form appears more than once in the list.' });

  // Every referenced template must exist (allow inactive here — an admin may be
  // curating a package for later; the per-matter add path is what blocks adding
  // an inactive/unuploaded form to a real filing).
  if (ids.length) {
    const { data: found, error: tErr } = await admin.from('form_templates').select('id').in('id', ids);
    if (tErr) return json(500, { error: tErr.message });
    if ((found || []).length !== ids.length) return json(422, { error: 'One or more forms in the list no longer exist.' });
  }

  // Replace the list. Delete-then-insert isn't a single transaction via the JS
  // client; on a rare insert failure the list would be left empty, so we return
  // 500 and the admin re-saves. Small, admin-only surface — acceptable for v1.
  const { error: delErr } = await admin.from('form_package_items').delete().eq('package_id', package_id);
  if (delErr) return json(500, { error: 'Failed to clear the existing list.' });

  if (ids.length) {
    const rows = items.map((it, i) => ({
      package_id,
      template_id: it.template_id,
      sort_order: (i + 1) * 10,
      required: it.required !== false, // default required = true
    }));
    const { error: insErr } = await admin.from('form_package_items').insert(rows);
    if (insErr) return json(500, { error: 'Failed to save the new list.' });
  }

  return json(200, { ok: true, package_id, count: ids.length });
}
