// CF Pages Function: get-download-url
// POST { document_id }
// Returns a signed R2 GET URL (60-min TTL). Never exposes the raw R2 key to clients.

import { verifyAuth, presignedGet, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[get-download-url] Unhandled error:', err);
    return json(500, { error: 'An unexpected error occurred. Please try again.' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { document_id } = body;
  if (!document_id) return json(400, { error: 'document_id is required' });

  const { admin } = auth;

  const { data: doc, error: fetchErr } = await admin
    .from('documents')
    .select('id, r2_key, file_name, content_type, status, deleted_at')
    .eq('id', document_id)
    .single();

  if (fetchErr || !doc)             return json(404, { error: 'Document not found' });
  if (doc.deleted_at)               return json(410, { error: 'Document has been deleted' });
  if (doc.status === 'pending')     return json(400, { error: 'File upload not yet confirmed' });
  if (doc.r2_key.startsWith('pending/')) return json(400, { error: 'No file uploaded for this document' });

  let downloadUrl;
  try {
    downloadUrl = await presignedGet(env, doc.r2_key, 3600);
  } catch (err) {
    return json(500, { error: 'Failed to generate download URL' });
  }

  return json(200, {
    download_url: downloadUrl,
    file_name:    doc.file_name,
    content_type: doc.content_type,
  });
}
