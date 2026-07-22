// CF Pages Function: restore-version
// POST { version_id }
// Non-destructively restores an older version: it does NOT delete the newer
// versions. Instead it creates a NEW version row at the top of the history that
// re-points at the chosen version's stored object, and repoints
// documents.r2_key to match — so "restore" is itself just another version you
// can later step back from. Write access (staff).
//
// The new row reuses the target's r2_key rather than copying the object; the
// key-aware pruner (_versions.js) protects a key that any retained row still
// references, so no copy is needed. History is then pruned to VERSION_CAP.

import { verifyAuth, json } from './_helpers.js';
import { pruneVersions } from './_versions.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[restore-version] Unhandled error:', err);
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

  const { version_id } = body;
  if (!version_id) return json(400, { error: 'version_id is required' });

  const { admin } = auth;

  const { data: ver, error: verErr } = await admin
    .from('document_versions')
    .select('id, document_id, version_no, r2_key, file_size, content_hash')
    .eq('id', version_id)
    .single();

  if (verErr || !ver)                    return json(404, { error: 'Version not found' });
  if (!ver.r2_key || ver.r2_key.startsWith('pending/'))
    return json(400, { error: 'This version has no stored file to restore' });

  const { data: doc, error: docErr } = await admin
    .from('documents')
    .select('id, deleted_at')
    .eq('id', ver.document_id)
    .single();
  if (docErr || !doc)  return json(404, { error: 'Document not found' });
  if (doc.deleted_at)  return json(410, { error: 'Restore the document from the trash first' });

  const { data: maxV } = await admin
    .from('document_versions')
    .select('version_no')
    .eq('document_id', ver.document_id)
    .order('version_no', { ascending: false })
    .limit(1).maybeSingle();
  const currentNo = maxV?.version_no || ver.version_no;
  if (ver.version_no === currentNo) {
    return json(409, { error: 'That version is already the current one' });
  }
  const newNo = currentNo + 1;

  const { error: insErr } = await admin.from('document_versions').insert({
    document_id:  ver.document_id,
    version_no:   newNo,
    r2_key:       ver.r2_key,
    file_size:    ver.file_size,
    content_hash: ver.content_hash,
    source:       'portal',
    created_by:   auth.profile?.id || null,
  });
  if (insErr) return json(500, { error: insErr.message });

  const { error: updErr } = await admin
    .from('documents')
    .update({ r2_key: ver.r2_key, file_size: ver.file_size, updated_at: new Date().toISOString() })
    .eq('id', ver.document_id);
  if (updErr) return json(500, { error: updErr.message });

  await pruneVersions(env, admin, ver.document_id);

  return json(200, { ok: true, version_no: newNo, restored_from: ver.version_no });
}
