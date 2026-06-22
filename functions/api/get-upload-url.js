// CF Pages Function: get-upload-url
// POST { matter_id, file_name, file_size, content_type, doc_type, name }
// Returns { upload_url, document_id, r2_key } — browser PUTs directly to R2.

import { verifyAuth, sanitizeFilename, json } from './_helpers.js';
import { MAX_UPLOAD_BYTES } from './_scan.js';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
]);

const ALLOWED_DOC_TYPES = new Set(['pleading','agreement','correspondence','financial','id','court_order','other']);

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[get-upload-url] Unhandled error:', err);
    return json(500, { error: `Unexpected error: ${err?.message || err}` });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'uploads', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, file_name, content_type, doc_type, name, fulfill_document_id } = body;
  const file_size = Number(body.file_size) || null;

  if (!file_name)    return json(400, { error: 'file_name is required' });
  if (!content_type) return json(400, { error: 'content_type is required' });
  if (!name)         return json(400, { error: 'Document name (name) is required' });

  if (!ALLOWED_TYPES.has(content_type)) {
    return json(400, { error: `File type not allowed: ${content_type}. Allowed: PDF, Word, Excel, JPEG, PNG, TIFF.` });
  }
  if (file_size && file_size > MAX_UPLOAD_BYTES) {
    return json(413, { error: `File is too large (${(file_size / 1024 / 1024).toFixed(1)}MB). Maximum size is 25MB.` });
  }
  if (doc_type && !ALLOWED_DOC_TYPES.has(doc_type)) {
    return json(400, { error: 'Invalid doc_type' });
  }

  const { admin, profile } = auth;

  if (fulfill_document_id) {
    return await fulfillPlaceholder({ admin, env, profile, auth, fulfill_document_id, file_name, file_size, content_type, doc_type, name });
  }

  if (!matter_id) return json(400, { error: 'matter_id is required' });

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, client_id')
    .eq('id', matter_id)
    .single();

  if (matterErr || !matter) return json(404, { error: 'Matter not found' });

  if (auth.isClient) {
    const { data: clientRow } = await admin
      .from('clients').select('id').eq('auth_id', auth.user.id).single();
    if (!clientRow || matter.client_id !== clientRow.id) {
      return json(403, { error: 'You may only upload documents for your own matter.' });
    }
  }

  const documentId = crypto.randomUUID();
  const safe = sanitizeFilename(file_name);
  const r2Key = `matters/${matter_id}/${documentId}/${safe}`;

  const { error: insertErr } = await admin.from('documents').insert({
    id:           documentId,
    matter_id,
    uploaded_by:  profile.id,
    name:         name.trim(),
    file_name,
    file_size,
    r2_key:       r2Key,
    content_type,
    doc_type:     doc_type || 'other',
    status:       'pending',
  });

  if (insertErr) return json(500, { error: insertErr.message });

  return json(200, { upload_url: `/api/upload-proxy?doc=${documentId}`, document_id: documentId, r2_key: r2Key });
}

async function fulfillPlaceholder({ admin, env, profile, fulfill_document_id, file_name, file_size, content_type, doc_type, name }) {
  const { data: doc, error: fetchErr } = await admin
    .from('documents')
    .select('id, matter_id, r2_key, status, deleted_at')
    .eq('id', fulfill_document_id)
    .single();

  if (fetchErr || !doc)         return json(404, { error: 'Document not found' });
  if (doc.deleted_at)           return json(410, { error: 'Document has been deleted' });
  if (doc.status !== 'pending') return json(409, { error: 'Document is no longer pending' });
  // Allow retry when a prior attempt updated r2_key before the upload confirmed
  if (!doc.r2_key.startsWith('pending/') && !doc.r2_key.startsWith('matters/')) {
    return json(409, { error: 'Document is not a checklist placeholder' });
  }

  const safe  = sanitizeFilename(file_name);
  const r2Key = `matters/${doc.matter_id}/${fulfill_document_id}/${safe}`;

  const update = { r2_key: r2Key, file_name, content_type, uploaded_by: profile.id };
  if (file_size)                                    update.file_size = Number(file_size);
  if (doc_type && ALLOWED_DOC_TYPES.has(doc_type)) update.doc_type  = doc_type;
  if (name && name.trim())                          update.name      = name.trim();

  const { error: updateErr } = await admin.from('documents').update(update).eq('id', fulfill_document_id);
  if (updateErr) return json(500, { error: updateErr.message });

  return json(200, { upload_url: `/api/upload-proxy?doc=${fulfill_document_id}`, document_id: fulfill_document_id, r2_key: r2Key });
}
