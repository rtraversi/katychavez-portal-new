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
import { applyFieldMap, applyManualEdits, stripRichText } from './_form-fill.js';
import { loadPackageTemplates, seedMatterForms, buildFillContext, loadManualEdits } from './_fill-context.js';

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

  // Generating is a write, so it also materializes the matter's form list if
  // this is the first mutating action on the tab (migration 1605).
  const seedResult = await seedMatterForms(admin, matter, auth.profile?.id || null);
  if (seedResult.error) return json(seedResult.error.status, { error: seedResult.error.message });

  const pkgResult = await loadPackageTemplates(admin, matter);
  if (pkgResult.error) return json(pkgResult.error.status, { error: pkgResult.error.message });
  const { pkg, activeTemplates } = pkgResult;

  if (!activeTemplates.length) {
    return json(422, { error: 'This matter has no forms yet. Add a form to get started.' });
  }

  let targets = activeTemplates;
  if (Array.isArray(template_ids) && template_ids.length) {
    const wanted = new Set(template_ids);
    targets = targets.filter(t => wanted.has(t.id));
    if (!targets.length) return json(422, { error: 'Those forms are not on this matter.' });
  }

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

  // ── Build fill context + manual edits ───────────────────────────────────────
  const [fillContext, editsByTemplate] = await Promise.all([
    buildFillContext(admin, matter, pkg, activeTemplates),
    loadManualEdits(admin, matter_id),
  ]);

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
      // Guard: a template uploaded before the rich-text normalize fix would
      // throw at save() below. Harmless no-op on already-clean templates.
      stripRichText(form);

      // Firm-edited standing defaults (see form-filler-template-defaults.js)
      // sit over the package field_map: attorneys can set/clear literals but
      // data-driven autofill entries are protected at upload time.
      const effectiveMap = { ...(tmpl.field_map || {}), ...(tmpl.firm_overrides || {}) };
      const { filledCount, totalCount } = applyFieldMap(form, effectiveMap, fillContext, env);

      // Per-matter manual edits (form editor) win over autofill AND firm
      // defaults — this is what makes Regenerate non-destructive.
      if (editsByTemplate[tmpl.id]) applyManualEdits(form, editsByTemplate[tmpl.id]);

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
          package_id:    pkg?.id || null,   // null for manually-added forms (migration 1605)
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
