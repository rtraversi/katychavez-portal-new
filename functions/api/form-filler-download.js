// CF Worker: GET /api/form-filler/download?id=<generated_form_id>&final=1
// Streams a generated (or finalized) form PDF back from R2 so it opens
// directly in the browser's native fillable PDF viewer — no frontend PDF
// library needed. Pass final=1 once a form has been finalized to fetch the
// flattened copy instead of the fillable draft, or signed=1 to fetch the
// Package Builder signed copy (the draft/finalized PDF with the client's
// scanned pages spliced in — see package-builder-apply.js).
//
// Drafter 1.0.2 (D-5) adds two options for the USCIS Forms tab:
//   dl=1       send the file as a download (Content-Disposition: attachment),
//              named by 1.0.1's rule, "G-28 - LASTNAME.pdf". Without it the
//              file opens inline, as before (Package Builder's Open signed).
//   flatten=1  flatten the fillable draft as it is sent. Nothing is stored and
//              the form's status does not change; only the draft flattens.

import { PDFDocument } from 'pdf-lib';
import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { contentDisposition, formFileName } from './_form-file-name.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-download]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url    = new URL(request.url);
  const id     = url.searchParams.get('id');
  const wantsFinal  = url.searchParams.get('final') === '1';
  const wantsSigned = url.searchParams.get('signed') === '1';
  const wantsFlat   = url.searchParams.get('flatten') === '1';
  const asDownload  = url.searchParams.get('dl') === '1';
  if (!id) return json(400, { error: 'id is required' });
  if (wantsFlat && (wantsFinal || wantsSigned)) return json(400, { error: 'flatten applies to the draft only' });

  const admin = makeAdminClient(env);
  const { data: row, error } = await admin
    .from('generated_forms')
    .select(asDownload
      ? 'r2_key, finalized_r2_key, signed_r2_key, file_name, status, template:form_templates(form_key), matter:matters(client:clients(last_name)), copy:matter_forms(fee_amount)'
      : 'r2_key, finalized_r2_key, signed_r2_key, file_name, status')
    .eq('id', id)
    .single();
  if (error || !row) return json(404, { error: 'Generated form not found' });

  const key = wantsSigned ? row.signed_r2_key : wantsFinal ? row.finalized_r2_key : row.r2_key;
  if (!key) return json(404, {
    error: wantsSigned ? 'No signed copy for this form yet.'
      : wantsFinal ? 'This form has not been finalized yet.'
      : 'File not found.',
  });

  const obj = await env.R2.get(key);
  if (!obj) return json(404, { error: 'File missing in storage.' });

  let body = obj.body;
  if (wantsFlat) {
    const pdfDoc = await PDFDocument.load(await obj.arrayBuffer());
    pdfDoc.getForm().flatten();
    body = await pdfDoc.save();
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': asDownload
        ? contentDisposition(downloadName(row), 'attachment')
        : contentDisposition(row.file_name),
    },
  });
}

// Rows generated before 1.0.1 stored "<label> (v3).pdf"; a download is always
// named by today's rule, from the form, the client card and (1.0.4) the
// G-1450 copy's amount: "G-1450 $520 - LASTNAME.pdf".
export function downloadName(row) {
  const formKey = row.template?.form_key;
  return formKey ? formFileName(formKey, row.matter?.client?.last_name, row.copy?.fee_amount ?? null) : row.file_name;
}
