// CF Pages Function: purge-trash
// POST { matter_id, document_ids? }
// Permanently deletes trashed documents (deleted_at NOT NULL) for a matter:
// each document's R2 object AND every version's R2 object, then the DB rows.
// This backs both "Empty trash" (no document_ids → all trashed in the matter)
// and per-row "Delete forever" (document_ids → that subset). Available to any
// staff with write access. It ONLY ever touches already-trashed rows — a live
// document can never be reached through this endpoint.

import { verifyAuth, json } from './_helpers.js';
import { purgeDocument } from './_trash.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[purge-trash] Unhandled error:', err);
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

  const { matter_id, document_ids } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required' });
  if (document_ids != null && !Array.isArray(document_ids)) {
    return json(400, { error: 'document_ids must be an array' });
  }

  const { admin } = auth;

  // Eligible rows = trashed documents in this matter (optionally narrowed to
  // the given ids). The deleted_at filter is the safety boundary that lets this
  // run at write level: live documents are unreachable here.
  let query = admin
    .from('documents')
    .select('id, r2_key')
    .eq('matter_id', matter_id)
    .not('deleted_at', 'is', null);
  if (document_ids && document_ids.length) query = query.in('id', document_ids);

  const { data: docs, error: fetchErr } = await query;
  if (fetchErr) return json(500, { error: fetchErr.message });

  let purged = 0;
  for (const doc of (docs || [])) {
    try {
      await purgeDocument(env, admin, doc);
      purged++;
    } catch (err) {
      console.error('[purge-trash] failed for', doc.id, err?.message || err);
    }
  }

  return json(200, { ok: true, purged });
}
