// CF Worker: /api/form-filler/template-defaults
//
// The "edit template defaults" round-trip. Attorneys used to keep their own
// pre-filled copy of each USCIS PDF with the answers that never change; this
// endpoint makes that the portal's template layer instead:
//
//   GET                       -> list all templates + how many defaults each has
//   GET  ?template_id=<uuid>  -> the fillable template PDF, pre-filled with the
//                                current standing defaults (package literals +
//                                firm overrides). Attorney edits it in any PDF
//                                viewer, then uploads it back.
//   POST ?template_id=<uuid>  -> body = the edited PDF. Every value the attorney
//                                set is stored in form_templates.firm_overrides
//                                as a literal; replace semantics (what you upload
//                                is exactly the new set of defaults).
//
// Data-driven field_map entries (client./matter./immigration./firm./attorney.
// sources) are never converted to literals -- autofill always wins for those,
// and any values the attorney typed into them are reported back as ignored.

import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { applyFieldMap, stripRichText } from './_form-fill.js';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-template-defaults]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

const isDataDriven = (entry) =>
  entry && entry.source && entry.source !== 'blank' && !entry.source.startsWith('literal:');

// Reads every value the attorney set in an uploaded template PDF and turns it
// into a firm_overrides object (exported so tests can drive the real logic).
// Rules: data-driven map entries are never overridden (autofill wins);
// anything else with a value becomes a literal; a package literal the
// attorney explicitly cleared gets an explicit clearing override, since
// merely omitting it would let the field_map literal come back at generate.
export function extractOverrides(uploadedForm, fieldMap) {
  const overrides = {};
  const ignoredDataMapped = [];
  let unknownFields = 0;
  let coverage = 0;

  for (const field of uploadedForm.getFields()) {
    const name = field.getName();
    if (name.includes('PDF417BarCode')) continue;

    const mapEntry = fieldMap[name];
    // Only fields from this template's known inventory (field_map lists every
    // non-barcode field, blanks included) -- guards against uploading some
    // unrelated PDF or a different form edition.
    if (!mapEntry) { unknownFields++; continue; }
    coverage++;

    const type = field.constructor.name;
    let value = null;
    try {
      if (type === 'PDFTextField')     value = field.getText() || null;
      else if (type === 'PDFCheckBox') value = field.isChecked() ? 'true' : null;
      else if (type === 'PDFDropdown') value = (field.getSelected() || [])[0] || null;
      else continue;
    } catch { continue; }
    if (value != null && !String(value).trim()) value = null;

    if (value != null && isDataDriven(mapEntry)) {
      ignoredDataMapped.push(name);
      continue;
    }

    if (value != null) {
      overrides[name] = { type: mapEntry.type, source: `literal:${value}` };
    } else if (mapEntry.source && mapEntry.source.startsWith('literal:')) {
      overrides[name] = { type: mapEntry.type, source: mapEntry.type === 'checkbox' ? 'literal:false' : 'blank' };
    }
  }

  return { overrides, ignoredDataMapped, unknownFields, coverage };
}

async function handleRequest(request, env) {
  const auth = await verifyAuth(request, env, 'write', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url        = new URL(request.url);
  const templateId = url.searchParams.get('template_id');
  const admin      = makeAdminClient(env);

  if (request.method === 'GET' && !templateId) return listTemplates(admin);

  if (!templateId) return json(400, { error: 'template_id is required' });

  const { data: tmpl, error } = await admin
    .from('form_templates')
    .select('id, form_key, label, r2_key, field_map, firm_overrides')
    .eq('id', templateId)
    .single();
  if (error || !tmpl) return json(404, { error: 'Template not found' });
  if (!tmpl.r2_key)   return json(422, { error: 'Template has not been normalized/uploaded yet.' });

  if (request.method === 'GET')  return downloadForEditing(env, tmpl);
  if (request.method === 'POST') return saveDefaults(request, admin, env, tmpl);
  return json(405, { error: 'Method not allowed' });
}

async function listTemplates(admin) {
  const { data: rows, error } = await admin
    .from('form_templates')
    .select('id, form_key, label, r2_key, active, field_map, firm_overrides')
    .eq('active', true)
    .order('form_key');
  if (error) return json(500, { error: 'Failed to load templates' });

  const templates = rows.map(t => ({
    template_id:    t.id,
    form_key:       t.form_key,
    label:          t.label,
    template_ready: !!t.r2_key,
    data_mapped:    Object.values(t.field_map || {}).filter(isDataDriven).length,
    firm_defaults:  Object.keys(t.firm_overrides || {}).length,
  }));
  return json(200, { templates });
}

// The download the attorney edits: master template with the current standing
// defaults filled in (package literals from field_map, then firm overrides on
// top). Data-driven fields are left empty -- they fill per client at generate.
async function downloadForEditing(env, tmpl) {
  const obj = await env.R2.get(tmpl.r2_key);
  if (!obj) return json(404, { error: 'Template file missing in R2.' });

  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${tmpl.form_key}-template-defaults.pdf"`,
  };

  const standing = {};
  for (const [name, entry] of Object.entries(tmpl.field_map || {})) {
    if (entry.source && entry.source.startsWith('literal:')) standing[name] = entry;
  }
  Object.assign(standing, tmpl.firm_overrides || {});

  // Nothing standing to fill -> stream the master template straight through.
  // Parsing and re-saving one of the big forms burns seconds of Worker CPU to
  // hand back a byte-for-byte identical PDF; most templates start out here.
  if (!Object.keys(standing).length) {
    return new Response(obj.body, { status: 200, headers });
  }

  const pdfDoc = await PDFDocument.load(await obj.arrayBuffer());
  const form   = pdfDoc.getForm();
  stripRichText(form); // else save() below throws on rich-text fields (e.g. I-485 Part 14)
  applyFieldMap(form, standing, {}, env);

  // Rebuilding every field's appearance stream is the most expensive half of
  // save() (~1s of the I-485's ~4.5s) and buys nothing here: NeedAppearances
  // makes the viewer render the values, and the round trip back through
  // saveDefaults() reads /V, never the appearance. Together with the fast path
  // above this is what keeps the big forms under the CPU limit -- exceeding it
  // is a Cloudflare 1102, which reaches the browser as a bare 503.
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  return new Response(bytes, { status: 200, headers });
}

async function saveDefaults(request, admin, env, tmpl) {
  const body = await request.arrayBuffer();
  if (!body.byteLength)                  return json(400, { error: 'Request body must be the edited PDF.' });
  if (body.byteLength > MAX_UPLOAD_BYTES) return json(413, { error: 'PDF too large.' });

  let uploadedForm;
  try {
    uploadedForm = (await PDFDocument.load(body)).getForm();
  } catch {
    return json(422, { error: 'Could not read that file as a fillable PDF.' });
  }

  const { overrides, ignoredDataMapped, unknownFields, coverage } =
    extractOverrides(uploadedForm, tmpl.field_map || {});

  // Sanity: the upload must actually be this form (or at least this form's
  // edition) -- otherwise a wrong file would wipe the defaults to nothing.
  const uploadedFieldCount = uploadedForm.getFields().length;
  if (uploadedFieldCount === 0) {
    return json(422, { error: 'That PDF has no fillable fields at all — it was probably flattened. Use your PDF viewer\'s normal Save / Save As (NOT "Print to PDF", which burns in the values and destroys the form).' });
  }
  if (coverage < Object.keys(tmpl.field_map || {}).length * 0.5) {
    return json(422, { error: `That PDF does not look like ${tmpl.form_key.toUpperCase()} (${uploadedFieldCount} fields, only ${coverage} matching this template — possibly a different form or edition). Download the template from this page, edit it, and upload that same file.` });
  }

  const { error: updateErr } = await admin
    .from('form_templates')
    .update({ firm_overrides: overrides, updated_at: new Date().toISOString() })
    .eq('id', tmpl.id);
  if (updateErr) return json(500, { error: updateErr.message });

  return json(200, {
    form_key:      tmpl.form_key,
    saved:         Object.keys(overrides).length,
    ignored_data_mapped: ignoredDataMapped.length,
    unknown_fields: unknownFields,
  });
}
