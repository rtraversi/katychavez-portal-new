// CF Pages Function: delete-document
// POST { document_id, hard_delete? }
// Soft-deletes the DB row (deleted_at timestamp). Also deletes the R2 object.
// hard_delete=true is admin-only and permanently removes the DB row.

import { verifyAuth, deleteR2Object, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[delete-document] Unhandled error:', err);
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

  const { document_id, hard_delete } = body;
  if (!document_id) return json(400, { error: 'document_id is required' });

  if (hard_delete && auth.accessLevel !== 'admin') {
    return json(403, { error: 'Hard delete requires admin access' });
  }

  const { admin } = auth;

  const { data: doc, error: fetchErr } = await admin
    .from('documents')
    .select('id, r2_key, status, deleted_at')
    .eq('id', document_id)
    .single();

  if (fetchErr || !doc) return json(404, { error: 'Document not found' });
  if (doc.deleted_at && !hard_delete) return json(410, { error: 'Document already deleted' });

  if (!doc.r2_key.startsWith('pending/')) {
    try {
      await deleteR2Object(env, doc.r2_key);
    } catch (err) {
      console.error('[delete-document] R2 delete error:', err.message);
    }
  }

  if (hard_delete) {
    const { error: delErr } = await admin.from('documents').delete().eq('id', document_id);
    if (delErr) return json(500, { error: delErr.message });
  } else {
    const { error: updateErr } = await admin
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', document_id);
    if (updateErr) return json(500, { error: updateErr.message });
  }

  return json(200, { ok: true });
}
