// CF Worker: GET /api/form-filler/package?matter_id=<uuid>
//
// Returns the matter's ordered form list with each form's latest
// generated_forms status, plus the catalog of forms available to add.
//
// Since migration 1605 the list comes from matter_forms when it exists,
// falling back to the case-type package as a suggestion when it doesn't.
// This endpoint stays PURE — it never seeds. A read-only user (can_read
// without can_write on draft_forms) must be able to open the tab without
// creating data; the first mutating action materializes the list instead.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { loadPackageTemplates } from './_fill-context.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-package]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url      = new URL(request.url);
  const matterId = url.searchParams.get('matter_id');
  if (!matterId) return json(400, { error: 'matter_id is required' });

  const admin = makeAdminClient(env);

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, case_type_id')
    .eq('id', matterId)
    .single();
  if (matterErr || !matter) return json(404, { error: 'Matter not found' });

  const pkgResult = await loadPackageTemplates(admin, matter);
  if (pkgResult.error) return json(pkgResult.error.status, { error: pkgResult.error.message });
  const { pkg, seeded, activeTemplates } = pkgResult;

  const templateIds = activeTemplates.map(t => t.id);

  const { data: generated } = await admin
    .from('generated_forms')
    .select('id, template_id, status, version_num, fields_filled, fields_total, finalized_at, created_at')
    .eq('matter_id', matterId)
    .in('template_id', templateIds.length ? templateIds : ['00000000-0000-0000-0000-000000000000'])
    .order('version_num', { ascending: false });

  // Latest version per template_id (rows are already version_num desc).
  const latestByTemplate = {};
  for (const row of generated || []) {
    if (!latestByTemplate[row.template_id]) latestByTemplate[row.template_id] = row;
  }

  const forms = activeTemplates.map(tmpl => {
    const latest = latestByTemplate[tmpl.id] || null;
    return {
      template_id:       tmpl.id,
      form_key:          tmpl.form_key,
      label:             tmpl.label,
      template_ready:    !!tmpl.r2_key && tmpl.active,
      generated_form_id: latest?.id || null,
      status:            latest?.status || null,
      fields_filled:     latest?.fields_filled ?? null,
      fields_total:      latest?.fields_total ?? null,
      finalized_at:      latest?.finalized_at || null,
    };
  });

  // Catalog for the "Add form" picker: every ready template not already on the
  // matter. Templates without an r2_key aren't offered — they can't generate.
  const onMatter = new Set(templateIds);
  const { data: allTemplates } = await admin
    .from('form_templates')
    .select('id, form_key, label, r2_key, active')
    .eq('active', true)
    .order('form_key', { ascending: true });

  const available = (allTemplates || [])
    .filter(t => !onMatter.has(t.id) && !!t.r2_key)
    .map(t => ({ template_id: t.id, form_key: t.form_key, label: t.label }));

  return json(200, {
    package: pkg ? { id: pkg.id, name: pkg.name } : null,
    // false = the list shown is still the case type's suggestion, not yet
    // owned by the matter. The UI renders both identically.
    seeded,
    forms,
    available,
  });
}
