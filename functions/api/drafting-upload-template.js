// POST /api/drafting/upload-template?template_id=<uuid>
// Content-Type: application/octet-stream  (raw .docx bytes)
// Stores the .docx template file in R2 and saves the R2 key on the template record.
// Requires write access on the doc_drafting module.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024; // 10MB

export async function onRequest({ request, env }) {
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[drafting-upload-template]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'doc_drafting');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url        = new URL(request.url);
  const templateId = url.searchParams.get('template_id');
  if (!templateId) return json(400, { error: 'template_id query param is required' });

  const admin = makeAdminClient(env);
  const { data: tmpl, error: tmplErr } = await admin
    .from('draft_templates')
    .select('id, name')
    .eq('id', templateId)
    .single();

  if (tmplErr || !tmpl) return json(404, { error: `Template not found: ${tmplErr?.message || templateId}` });

  const body = await request.arrayBuffer();
  if (!body || body.byteLength === 0) return json(400, { error: 'Empty body' });
  if (body.byteLength > MAX_TEMPLATE_BYTES) {
    return json(413, { error: `File exceeds ${MAX_TEMPLATE_BYTES / 1024 / 1024}MB limit` });
  }

  // Validate ZIP magic bytes (PK\x03\x04) — all .docx files are ZIP archives
  const magic = new Uint8Array(body.slice(0, 4));
  if (magic[0] !== 0x50 || magic[1] !== 0x4B || magic[2] !== 0x03 || magic[3] !== 0x04) {
    return json(400, { error: 'File does not appear to be a valid .docx (not a ZIP-based file)' });
  }

  const r2Key = `templates/${templateId}.docx`;
  await env.R2.put(r2Key, body, {
    httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  });

  const { error: updErr } = await admin
    .from('draft_templates')
    .update({ template_docx_r2_key: r2Key })
    .eq('id', templateId);

  if (updErr) {
    console.error('[drafting-upload-template] update error:', updErr.message);
    return json(500, { error: `Stored file but failed to update template record: ${updErr.message}` });
  }

  return json(200, { ok: true, r2_key: r2Key });
}
