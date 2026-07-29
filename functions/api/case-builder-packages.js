// CF Worker: GET /api/case-builder/packages
//
// The whole Case Builder authoring view in one read: practice areas (for the
// category filter), every case type with its named packages and each package's
// ordered form list, plus the full form library for the picker.
//
// Admin on draft_forms — authoring the firm's reusable templates is more
// privileged than editing one matter's list (that's can_write, matter_forms).

import { verifyAuth, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handle(request, env);
  } catch (err) {
    console.error('[case-builder-packages]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handle(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'admin', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const admin = auth.admin;

  const [paRes, ctRes, pkgRes, itemRes, tmplRes] = await Promise.all([
    admin.from('practice_areas').select('id, key, name').order('sort_order'),
    admin.from('case_types').select('id, key, name, active, practice_area_id, sort_order').order('sort_order'),
    admin.from('form_packages').select('id, case_type_id, name, description, is_default, active').order('name'),
    admin.from('form_package_items').select('package_id, template_id, sort_order, required').order('sort_order'),
    admin.from('form_templates').select('id, form_key, label, agency, active, practice_area_id, r2_key').order('form_key'),
  ]);
  for (const r of [paRes, ctRes, pkgRes, itemRes, tmplRes]) {
    if (r.error) return json(500, { error: r.error.message });
  }

  const itemsByPkg = {};
  for (const it of itemRes.data || []) {
    (itemsByPkg[it.package_id] ||= []).push({
      template_id: it.template_id, sort_order: it.sort_order, required: it.required,
    });
  }

  const pkgsByCt = {};
  for (const p of pkgRes.data || []) {
    (pkgsByCt[p.case_type_id] ||= []).push({
      id: p.id, name: p.name, description: p.description,
      is_default: p.is_default, active: p.active,
      items: itemsByPkg[p.id] || [],
    });
  }

  // Case Builder is scoped to Immigration for now (the USCIS form filler is an
  // immigration tool, and mixing all four practice areas' case types in one list
  // is unreadable). Only immigration case types are returned; the form library
  // is returned in full, since every form_templates row IS a USCIS immigration
  // form.
  const immigration = (paRes.data || []).find(pa => pa.key === 'immigration');
  const immId = immigration?.id || null;

  const case_types = (ctRes.data || [])
    .filter(ct => !immId || ct.practice_area_id === immId)
    .map(ct => ({ ...ct, packages: pkgsByCt[ct.id] || [] }));

  // Surface whether each library form actually has its blank PDF in R2, so the
  // authoring UI can warn before a form is added to a package (a template row
  // can exist with r2_key set while the object was never uploaded — the exact
  // "file not found in R2" trap that bit us on the immigration forms).
  const templates = (tmplRes.data || []).map(t => ({
    id: t.id, form_key: t.form_key, label: t.label, agency: t.agency,
    active: t.active, practice_area_id: t.practice_area_id, uploaded: !!t.r2_key,
  }));

  return json(200, { practice_areas: immigration ? [immigration] : [], case_types, templates });
}
