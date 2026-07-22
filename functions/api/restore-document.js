// CF Pages Function: restore-document
// POST { document_id }
// Restores a soft-deleted (trashed) document by clearing deleted_at. The R2
// object and version history were kept on soft delete, so the file comes back
// intact. Available to any staff with write access to uploads.

import { verifyAuth, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[restore-document] Unhandled error:', err);
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

  const { admin } = auth;

  const { data: doc, error: fetchErr } = await admin
    .from('documents')
    .select('id, deleted_at')
    .eq('id', document_id)
    .single();

  if (fetchErr || !doc) return json(404, { error: 'Document not found' });
  if (!doc.deleted_at) return json(409, { error: 'Document is not in the trash' });

  const { error: updErr } = await admin
    .from('documents')
    .update({ deleted_at: null })
    .eq('id', document_id);
  if (updErr) return json(500, { error: updErr.message });

  return json(200, { ok: true });
}
