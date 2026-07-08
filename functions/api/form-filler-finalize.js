// CF Worker: POST /api/form-filler/finalize
// Body: { generated_form_id }
//
// Flattens a generated draft's form fields into static page content (via
// pdf-lib's form.flatten()) and stores the result under a separate R2 key.
// The original fillable draft is never overwritten — both stay retrievable.

import { PDFDocument } from 'pdf-lib';
import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-finalize]', err);
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

  const { generated_form_id } = body;
  if (!generated_form_id) return json(400, { error: 'generated_form_id is required' });

  const admin = makeAdminClient(env);

  const { data: row, error } = await admin
    .from('generated_forms')
    .select('id, r2_key, matter_id, batch_id, template:form_templates(form_key)')
    .eq('id', generated_form_id)
    .single();
  if (error || !row) return json(404, { error: 'Generated form not found' });

  const obj = await env.R2.get(row.r2_key);
  if (!obj) return json(404, { error: 'Draft file missing in storage.' });

  const bytes  = await obj.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes);
  pdfDoc.getForm().flatten();
  const flatBytes = await pdfDoc.save();

  const finalKey = `finalized-forms/${row.matter_id}/${row.batch_id}/${row.template.form_key}_final.pdf`;
  await env.R2.put(finalKey, flatBytes, { httpMetadata: { contentType: 'application/pdf' } });

  const { error: updateErr } = await admin
    .from('generated_forms')
    .update({
      status: 'finalized',
      finalized_at: new Date().toISOString(),
      finalized_by: auth.profile?.id || null,
      finalized_r2_key: finalKey,
    })
    .eq('id', generated_form_id);
  if (updateErr) return json(500, { error: 'Failed to record finalization.' });

  return json(200, { ok: true, finalized_r2_key: finalKey, status: 'finalized' });
}
