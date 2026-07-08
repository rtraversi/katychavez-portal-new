// CF Worker: POST /api/form-filler/generate
// Body: { matter_id, template_ids?: [uuid], force?: boolean }
//
// Fills every form in the matter's case-type package (or just the given
// template_ids) from client/matter/firm data using plain pdf-lib against the
// already-decrypted master templates in R2 (see scripts/normalize-form-template.js).
// Writes one fillable draft PDF per form to R2 and a generated_forms row per
// form, all sharing one batch_id. Per-form error isolation — one bad form
// doesn't block the rest.

import { PDFDocument } from 'pdf-lib';
import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { applyFieldMap } from './_form-fill.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-generate]', err);
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

  const { matter_id, template_ids, force = false } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required' });

  const admin = makeAdminClient(env);

  // ── Resolve matter -> case type -> package ─────────────────────────────────
  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, client_id, case_type_id, assigned_attorney_id')
    .eq('id', matter_id)
    .single();
  if (matterErr || !matter) return json(404, { error: 'Matter not found' });
  if (!matter.case_type_id) return json(422, { error: 'Matter has no case type set.' });

  const { data: pkg } = await admin
    .from('form_packages')
    .select('id, name')
    .eq('case_type_id', matter.case_type_id)
    .eq('active', true)
    .maybeSingle();
  if (!pkg) return json(422, { error: 'No form package is configured for this case type.' });

  let itemsQuery = admin
    .from('form_package_items')
    .select('sort_order, template:form_templates(id, form_key, label, r2_key, field_map, firm_overrides, active)')
    .eq('package_id', pkg.id)
    .order('sort_order', { ascending: true });
  const { data: items, error: itemsErr } = await itemsQuery;
  if (itemsErr) return json(500, { error: 'Failed to load form package items' });

  const activeTemplates = items.map(i => i.template).filter(t => t.active);

  // "This appearance relates to..." — G-28 Part 3 item 1.b wants the form
  // numbers the G-28 covers: every other form in the package (not the G-28
  // itself). Exposed to field maps as source "package.form_numbers".
  const packageFormNumbers = activeTemplates
    .filter(t => t.form_key !== 'g-28')
    .map(t => t.form_key.toUpperCase())
    .join(', ');

  let targets = activeTemplates;
  if (Array.isArray(template_ids) && template_ids.length) {
    const wanted = new Set(template_ids);
    targets = targets.filter(t => wanted.has(t.id));
  }
  if (!targets.length) return json(422, { error: 'No matching forms to generate.' });

  // ── Guard: refuse to version over a finalized row unless force ────────────
  if (!force) {
    const { data: finalized } = await admin
      .from('generated_forms')
      .select('id, template_id')
      .eq('matter_id', matter_id)
      .eq('status', 'finalized')
      .in('template_id', targets.map(t => t.id));
    if (finalized && finalized.length) {
      return json(409, {
        error: 'One or more of these forms is already finalized. Pass force:true to regenerate anyway.',
        finalized_template_ids: finalized.map(f => f.template_id),
      });
    }
  }

  // ── Build fill context ──────────────────────────────────────────────────────
  const [{ data: client }, { data: immigration }, { data: familyMembers }, { data: firm }, { data: attorney }] = await Promise.all([
    admin.from('clients').select('*').eq('id', matter.client_id).single(),
    admin.from('client_immigration').select('*').eq('matter_id', matter_id).maybeSingle(),
    admin.from('client_immigration_family_members').select('*').eq('matter_id', matter_id).order('created_at', { ascending: true }),
    admin.from('firm_settings').select('*').limit(1).maybeSingle(),
    matter.assigned_attorney_id
      ? admin.from('users').select('id, first_name, last_name, email, phone, bar_number, licensing_authority, uscis_account_number, fax').eq('id', matter.assigned_attorney_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const fillContext = {
    client:        client || {},
    matter,
    immigration:   immigration || {},
    familyMembers: familyMembers || [],
    firm:          firm || {},
    attorney:      attorney || {},
    package:       { name: pkg.name, form_numbers: packageFormNumbers },
  };

  const batchId = crypto.randomUUID();
  const results = [];

  for (const tmpl of targets) {
    try {
      if (!tmpl.r2_key) {
        results.push({ template_id: tmpl.id, form_key: tmpl.form_key, status: 'skipped', error: 'Template not yet normalized/uploaded.' });
        continue;
      }

      const obj = await env.R2.get(tmpl.r2_key);
      if (!obj) {
        results.push({ template_id: tmpl.id, form_key: tmpl.form_key, status: 'error', error: 'Template file missing in R2.' });
        continue;
      }

      const bytes  = await obj.arrayBuffer();
      const pdfDoc = await PDFDocument.load(bytes);
      const form   = pdfDoc.getForm();

      // Firm-edited standing defaults (see form-filler-template-defaults.js)
      // sit over the package field_map: attorneys can set/clear literals but
      // data-driven autofill entries are protected at upload time.
      const effectiveMap = { ...(tmpl.field_map || {}), ...(tmpl.firm_overrides || {}) };
      const { filledCount, totalCount } = applyFieldMap(form, effectiveMap, fillContext, env);

      const outBytes = await pdfDoc.save();

      const { data: existing } = await admin
        .from('generated_forms')
        .select('version_num')
        .eq('matter_id', matter_id)
        .eq('template_id', tmpl.id)
        .order('version_num', { ascending: false })
        .limit(1)
        .maybeSingle();
      const versionNum = (existing?.version_num || 0) + 1;

      const r2Key    = `generated-forms/${matter_id}/${batchId}/${tmpl.form_key}_v${versionNum}.pdf`;
      const fileName = `${tmpl.label} (v${versionNum}).pdf`;

      await env.R2.put(r2Key, outBytes, { httpMetadata: { contentType: 'application/pdf' } });

      const { data: row, error: insertErr } = await admin
        .from('generated_forms')
        .insert({
          matter_id,
          package_id:    pkg.id,
          template_id:   tmpl.id,
          batch_id:      batchId,
          version_num:   versionNum,
          r2_key:        r2Key,
          file_name:     fileName,
          status:        'draft',
          fields_filled: filledCount,
          fields_total:  totalCount,
          generated_by:  auth.profile?.id || null,
        })
        .select('id')
        .single();

      if (insertErr) {
        results.push({ template_id: tmpl.id, form_key: tmpl.form_key, status: 'error', error: insertErr.message });
        continue;
      }

      results.push({
        template_id: tmpl.id,
        form_key: tmpl.form_key,
        generated_form_id: row.id,
        status: 'ok',
        fields_filled: filledCount,
        fields_total: totalCount,
      });
    } catch (err) {
      console.error(`[form-filler-generate] ${tmpl.form_key}:`, err);
      results.push({ template_id: tmpl.id, form_key: tmpl.form_key, status: 'error', error: err.message });
    }
  }

  return json(200, { batch_id: batchId, results });
}
