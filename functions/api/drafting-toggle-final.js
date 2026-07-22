// POST /api/drafting/toggle-final
// Body: { doc_id }
// Toggles is_final on a draft_document. Requires write access on doc_drafting.
// When marking FINAL: sets finalized_at + finalized_by, clears any lock.
// When un-marking FINAL: clears finalized_at + finalized_by.
// Filename convention: marking final strips drafter initials
//   Draft:  "2026-06-18 AS Original Petition for Divorce.docx"
//   Final:  "2026-06-18 Original Petition for Divorce.docx"

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { syncFinalDraftToStorage } from './_storage-sync.js';
import { autoSyncEnabled } from './_adapters/storage/index.js';

export async function onRequest(context) {
  const { request, env, ctx } = context;

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'doc_drafting');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { doc_id } = body;
  if (!doc_id) return json(400, { error: 'doc_id is required' });

  const admin = makeAdminClient(env);

  const { data: doc, error: fetchErr } = await admin
    .from('draft_documents')
    .select('id, matter_id, is_final, file_name, current_version_num')
    .eq('id', doc_id)
    .single();

  if (fetchErr || !doc) return json(404, { error: 'Document not found' });

  const newFinal = !doc.is_final;

  let finalFileName = doc.file_name;
  if (newFinal && doc.file_name) {
    finalFileName = doc.file_name.replace(/^(\d{4}-\d{2}-\d{2}) [A-Z]{2,4} /, '$1 ');
  }

  const patch = newFinal
    ? {
        is_final:     true,
        finalized_at: new Date().toISOString(),
        finalized_by: auth.profile.id,
        file_name:    finalFileName,
        locked_by:    null,
        locked_at:    null,
        lock_token:   null,
      }
    : {
        is_final:     false,
        finalized_at: null,
        finalized_by: null,
      };

  const { error: updErr } = await admin
    .from('draft_documents')
    .update(patch)
    .eq('id', doc_id);

  if (updErr) {
    console.error('[drafting-toggle-final] update:', updErr.message);
    return json(500, { error: 'Failed to update document.' });
  }

  // Fire-and-forget: mirror finalized draft to storage providers (two_way mode only)
  if (newFinal && autoSyncEnabled(env)) {
    const { data: ver } = await admin
      .from('draft_document_versions')
      .select('r2_key')
      .eq('document_id', doc_id)
      .eq('version_num', doc.current_version_num)
      .single();

    if (ver?.r2_key) {
      ctx.waitUntil(syncFinalDraftToStorage(env, {
        matter_id: doc.matter_id,
        file_name: finalFileName,
        r2_key:    ver.r2_key,
      }, admin));
    }
  }

  return json(200, { ok: true, is_final: newFinal, file_name: finalFileName });
}
