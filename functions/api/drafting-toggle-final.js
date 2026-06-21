// POST /api/drafting/toggle-final
// Body: { doc_id }
// Toggles is_final on a draft_document. Requires write access on doc_drafting.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
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
    .select('id, is_final, file_name')
    .eq('id', doc_id)
    .single();

  if (fetchErr || !doc) return json(404, { error: 'Document not found' });

  const newFinal = !doc.is_final;

  const patch = newFinal
    ? { is_final: true,  finalized_at: new Date().toISOString(), finalized_by: auth.profile.id }
    : { is_final: false, finalized_at: null, finalized_by: null };

  const { error: updErr } = await admin
    .from('draft_documents')
    .update(patch)
    .eq('id', doc_id);

  if (updErr) {
    console.error('[drafting-toggle-final] update:', updErr.message);
    return json(500, { error: 'Failed to update document.' });
  }

  return json(200, { ok: true, is_final: newFinal });
}
