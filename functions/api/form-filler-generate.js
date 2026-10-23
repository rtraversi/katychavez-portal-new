// CF Worker: POST /api/form-filler/generate
// Body: { matter_id, row_ids?: [uuid], template_ids?: [uuid], force?: boolean }
//
// Drafter 1.0.4: a form can be on a case twice, so the unit is the
// matter_forms row. row_ids picks copies; template_ids (every copy of those
// forms) is kept for callers that work before a case's list is seeded.
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
import { loadPackageTemplates, seedMatterForms, buildFillContext, loadManualEdits, pickCopies, contextForCopy, editsForCopy } from './_fill-context.js';
import { formFileName } from './_form-file-name.js';

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

  const { matter_id, row_ids, template_ids, force = false } = body;
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

  const scoped = (Array.isArray(row_ids) && row_ids.length) || (Array.isArray(template_ids) && template_ids.length);
  const targets = pickCopies(activeTemplates, { row_ids, template_ids });
  if (scoped && !targets.length) return json(422, { error: 'Those forms are not on this matter.' });

  // ── Guard: refuse to version over a finalized row unless force ────────────
  if (!force) {
    const { data: finalized } = await admin
      .from('generated_forms')
      .select('id, template_id, matter_form_id')
      .eq('matter_id', matter_id)
      .eq('status', 'finalized')
      .in('matter_form_id', targets.map(t => t.row_id));
    if (finalized && finalized.length) {
      return json(409, {
        error: 'One or more of these forms is already finalized. Pass force:true to regenerate anyway.',
        finalized_template_ids: finalized.map(f => f.template_id),
        finalized_row_ids: finalized.map(f => f.matter_form_id),
      });
    }
  }

  // ── Build fill context + manual edits ───────────────────────────────────────
  const [fillContext, editsByRow] = await Promise.all([
    buildFillContext(admin, matter, pkg, activeTemplates),
    loadManualEdits(admin, matter_id),
  ]);

  const batchId = crypto.randomUUID();
  const results = [];

  for (const tmpl of targets) {
    const ids = { template_id: tmpl.id, row_id: tmpl.row_id, form_key: tmpl.form_key };
    try {
      if (!tmpl.r2_key) {
        results.push({ ...ids, status: 'skipped', error: 'Template not yet normalized/uploaded.' });
        continue;
      }

      const obj = await env.R2.get(tmpl.r2_key);
      if (!obj) {
        results.push({ ...ids, status: 'error', error: 'Template file missing in R2.' });
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
      const { filledCount, totalCount } = applyFieldMap(form, effectiveMap, contextForCopy(fillContext, tmpl), env);

      // Per-copy manual edits (form editor) win over autofill AND firm
      // defaults — this is what makes Regenerate non-destructive.
      const edits = editsForCopy(editsByRow, tmpl, activeTemplates);
      if (edits) applyManualEdits(form, edits);

      const outBytes = await pdfDoc.save();

      // Versions count per copy (1627: UNIQUE (matter_form_id, version_num)).
      const { data: existing } = await admin
        .from('generated_forms')
        .select('version_num')
        .eq('matter_form_id', tmpl.row_id)
        .order('version_num', { ascending: false })
        .limit(1)
        .maybeSingle();
      const versionNum = (existing?.version_num || 0) + 1;

      // Two copies of a form can be filled in one batch: the row id keeps
      // their files apart.
      const r2Key    = `generated-forms/${matter_id}/${batchId}/${tmpl.form_key}_${tmpl.row_id}_v${versionNum}.pdf`;
      const fileName = formFileName(tmpl.form_key, fillContext.client?.last_name, tmpl.fee_amount);

      await env.R2.put(r2Key, outBytes, { httpMetadata: { contentType: 'application/pdf' } });

      const { data: row, error: insertErr } = await admin
        .from('generated_forms')
        .insert({
          matter_id,
          package_id:    pkg?.id || null,   // null for manually-added forms (migration 1605)
          template_id:   tmpl.id,
          matter_form_id: tmpl.row_id,
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
        results.push({ ...ids, status: 'error', error: insertErr.message });
        continue;
      }

      results.push({
        ...ids,
        generated_form_id: row.id,
        status: 'ok',
        fields_filled: filledCount,
        fields_total: totalCount,
      });
    } catch (err) {
      console.error(`[form-filler-generate] ${tmpl.form_key}:`, err);
      results.push({ ...ids, status: 'error', error: err.message });
    }
  }

  return json(200, { batch_id: batchId, results });
}
