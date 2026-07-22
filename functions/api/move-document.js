// CF Pages Function: move-document
// POST { document_id, folder_path }
// Re-folders a document WITHIN THE SAME MATTER. Folders are virtual — folder_path
// is just metadata on the document; the R2 object key encodes matter_id + document_id
// and is NOT affected by the folder. So a re-folder is a pure DB update (no R2 work).
// This deliberately does NOT move a document to a different matter (that would require
// copying the R2 object + every version to new keys — a separate feature).

import { verifyAuth, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[move-document] Unhandled error:', err);
    return json(500, { error: 'An unexpected error occurred. Please try again.' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { document_id } = body;
  if (!document_id) return json(400, { error: 'document_id is required' });

  // Normalize: trim; blank/whitespace collapses to the default "other" bucket.
  let folderPath = typeof body.folder_path === 'string' ? body.folder_path.trim() : '';
  if (folderPath.length > 300) return json(400, { error: 'folder_path is too long' });
  if (!folderPath) folderPath = 'other';

  const { admin } = auth;

  const { data: doc, error: fetchErr } = await admin
    .from('documents')
    .select('id, deleted_at')
    .eq('id', document_id)
    .single();
  if (fetchErr || !doc) return json(404, { error: 'Document not found' });
  if (doc.deleted_at) return json(410, { error: 'Document has been deleted' });

  const { error: updErr } = await admin
    .from('documents')
    .update({ folder_path: folderPath, updated_at: new Date().toISOString() })
    .eq('id', document_id);
  if (updErr) return json(500, { error: updErr.message });

  return json(200, { ok: true, folder_path: folderPath });
}
