// CF Worker: GET /api/form-filler/package?matter_id=<uuid>
// Resolves a matter's case type -> form package -> ordered form list, with
// each form's latest generated_forms status for this matter (if any).

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

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

  if (!matter.case_type_id) return json(200, { package: null, forms: [] });

  const { data: pkg } = await admin
    .from('form_packages')
    .select('id, name')
    .eq('case_type_id', matter.case_type_id)
    .eq('active', true)
    .maybeSingle();

  if (!pkg) return json(200, { package: null, forms: [] });

  const { data: items, error: itemsErr } = await admin
    .from('form_package_items')
    .select('sort_order, required, template:form_templates(id, form_key, label, r2_key, field_count, active)')
    .eq('package_id', pkg.id)
    .order('sort_order', { ascending: true });
  if (itemsErr) return json(500, { error: 'Failed to load form package items' });

  const templateIds = items.map(i => i.template.id);

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

  const forms = items.map(item => {
    const tmpl   = item.template;
    const latest = latestByTemplate[tmpl.id] || null;
    return {
      template_id:       tmpl.id,
      form_key:          tmpl.form_key,
      label:             tmpl.label,
      required:          item.required,
      template_ready:    !!tmpl.r2_key && tmpl.active,
      generated_form_id: latest?.id || null,
      status:            latest?.status || null,
      fields_filled:     latest?.fields_filled ?? null,
      fields_total:      latest?.fields_total ?? null,
      finalized_at:      latest?.finalized_at || null,
    };
  });

  return json(200, { package: { id: pkg.id, name: pkg.name }, forms });
}
