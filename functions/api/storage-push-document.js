// CF Worker: POST /api/storage-push-document
// Body: { document_ids: [uuid, ...] }  (or { document_id } for a single file)
// Manually pushes matter documents to every configured storage provider —
// the explicit, on-demand half of manual mode (STORAGE_SYNC_MODE). Files go
// out under the same client/folder structure the automatic mirror uses.
// Requires write access on the storage_sync module (premium-gated via
// activeAdapters, same as Import from Storage).

import { verifyAuth, json } from './_helpers.js';
import { activeAdapters }   from './_adapters/storage/index.js';
import { pushDocumentToAdapters } from './_storage-sync.js';

const MAX_BATCH = 20;

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[storage-push-document]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'storage_sync');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const ids = Array.isArray(body.document_ids)
    ? body.document_ids
    : body.document_id ? [body.document_id] : [];
  if (!ids.length) return json(400, { error: 'document_ids is required' });
  if (ids.length > MAX_BATCH) return json(400, { error: `At most ${MAX_BATCH} files per push` });

  const { admin } = auth;

  const adapters = await activeAdapters(env, admin);
  if (!adapters.length) {
    return json(400, { error: 'No storage provider is configured for this portal (or the Storage Sync module is not enabled).' });
  }

  // Sequential on purpose: each push holds the full file in memory; one at a
  // time keeps the Worker inside its memory/subrequest budget.
  const results = [];
  for (const id of ids) {
    const { data: doc } = await admin
      .from('documents')
      .select('id, matter_id, r2_key, folder_path, file_name, name, status, deleted_at')
      .eq('id', id)
      .single();

    if (!doc)             { results.push({ document_id: id, ok: false, error: 'Document not found' }); continue; }
    if (doc.deleted_at)   { results.push({ document_id: id, file_name: doc.file_name, ok: false, error: 'Document has been deleted' }); continue; }
    if (doc.status === 'pending' || doc.r2_key.startsWith('pending/')) {
      results.push({ document_id: id, file_name: doc.file_name, ok: false, error: 'File upload not yet confirmed' });
      continue;
    }

    const providerResults = await pushDocumentToAdapters(env, admin, doc, adapters);
    results.push({
      document_id: id,
      file_name:   doc.file_name,
      ok:          providerResults.some(r => r.ok),
      providers:   providerResults,
    });
  }

  const pushed = results.filter(r => r.ok).length;
  return json(200, { ok: pushed > 0, pushed, total: ids.length, results });
}
