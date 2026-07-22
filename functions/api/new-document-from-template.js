// CF Pages Function: new-document-from-template
// POST { matter_id, template_id, folder_path?, name?, doc_type? }
// Pure copy: duplicates a firm .docx template (draft_templates.template_docx_r2_key)
// into the matter's Files folder as a brand-new document — indistinguishable
// from an upload — so Edit-in-Word, version history and trash all apply. No
// merge-field filling and no wizard (that's a later, optional enhancement).
// Staff-only until explicitly published (client_visible = false).

import { verifyAuth, sanitizeFilename, deleteR2Object, json } from './_helpers.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALLOWED_DOC_TYPES = new Set(['pleading', 'agreement', 'correspondence', 'financial', 'id', 'court_order', 'other']);

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[new-document-from-template] Unhandled error:', err);
    return json(500, { error: 'An unexpected error occurred. Please try again.' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'uploads');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, template_id, folder_path, name, doc_type } = body;
  if (!matter_id)   return json(400, { error: 'matter_id is required' });
  if (!template_id) return json(400, { error: 'template_id is required' });

  const { admin, profile } = auth;

  const { data: matter, error: matterErr } = await admin
    .from('matters').select('id').eq('id', matter_id).single();
  if (matterErr || !matter) return json(404, { error: 'Matter not found' });

  const { data: tmpl, error: tmplErr } = await admin
    .from('draft_templates')
    .select('id, name, template_docx_r2_key, active')
    .eq('id', template_id)
    .single();
  if (tmplErr || !tmpl) return json(404, { error: 'Template not found' });
  if (!tmpl.template_docx_r2_key) {
    return json(422, { error: 'This template has no Word file uploaded yet.' });
  }

  // Copy the template bytes → a fresh per-document R2 key.
  const tmplObj = await env.R2.get(tmpl.template_docx_r2_key);
  if (!tmplObj) return json(422, { error: 'Template file not found in storage. Please re-upload it.' });
  const buf = await tmplObj.arrayBuffer();

  const documentId = crypto.randomUUID();
  const baseName   = (name && name.trim()) || tmpl.name || 'New document';
  const fileName   = /\.docx$/i.test(baseName) ? baseName : `${baseName}.docx`;
  const r2Key      = `matters/${matter_id}/${documentId}/${sanitizeFilename(fileName)}`;

  await env.R2.put(r2Key, buf, { httpMetadata: { contentType: DOCX_MIME } });

  const insertRow = {
    id:             documentId,
    matter_id,
    uploaded_by:    profile.id,
    name:           baseName,
    file_name:      fileName,
    file_size:      buf.byteLength,
    r2_key:         r2Key,
    content_type:   DOCX_MIME,
    doc_type:       ALLOWED_DOC_TYPES.has(doc_type) ? doc_type : 'other',
    status:         'received',
    source:         'portal',
    client_visible: false,      // staff-only draft until published
    scan_status:    'skipped',  // firm-authored template, not a client upload
  };
  if (folder_path) insertRow.folder_path = folder_path;

  const { error: insErr } = await admin.from('documents').insert(insertRow);
  if (insErr) {
    await deleteR2Object(env, r2Key).catch(() => {});
    return json(500, { error: insErr.message });
  }

  // v1 version row so history / cap-20 pruning / purge cleanup all apply.
  const { error: verErr } = await admin.from('document_versions').insert({
    document_id: documentId,
    version_no:  1,
    r2_key:      r2Key,
    file_size:   buf.byteLength,
    source:      'portal',
    created_by:  profile.id,
  });
  if (verErr) console.error('[new-document-from-template] version insert failed:', verErr.message);

  return json(200, { ok: true, document_id: documentId, file_name: fileName });
}
