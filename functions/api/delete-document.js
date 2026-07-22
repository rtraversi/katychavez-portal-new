// CF Pages Function: delete-document
// POST { document_id, hard_delete? }
// Soft-deletes the DB row (deleted_at timestamp) — the file moves to the Trash
// and its R2 object + version history are KEPT so it can be restored. Permanent
// removal happens later via the Empty-trash action or the 30-day purge cron.
// hard_delete=true is admin-only and permanently removes the row + every R2
// object the document owns (current key + all version keys).

import { verifyAuth, json } from './_helpers.js';
import { purgeDocument } from './_trash.js';

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

  if (hard_delete) {
    // Permanent removal: drop every R2 object the document owns, then the row.
    try {
      await purgeDocument(env, admin, doc);
    } catch (err) {
      return json(500, { error: err.message });
    }
  } else {
    // Soft delete → Trash. Keep the R2 object + versions so restore works; the
    // objects are only removed when the trash is emptied or the purge cron runs.
    const { error: updateErr } = await admin
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', document_id);
    if (updateErr) return json(500, { error: updateErr.message });
  }

  return json(200, { ok: true });
}
