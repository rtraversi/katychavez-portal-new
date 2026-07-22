// CF Pages Function: get-version-url
// POST { version_id }
// Returns a signed R2 GET URL (60-min TTL) for a specific historical version of
// a document, so staff can download an older save from the History list. Never
// exposes the raw R2 key. Read access (staff).

import { verifyAuth, presignedGet, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[get-version-url] Unhandled error:', err);
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

  const { version_id } = body;
  if (!version_id) return json(400, { error: 'version_id is required' });

  const { admin } = auth;

  const { data: ver, error: fetchErr } = await admin
    .from('document_versions')
    .select('id, version_no, r2_key, document_id, documents ( file_name, content_type )')
    .eq('id', version_id)
    .single();

  if (fetchErr || !ver)                  return json(404, { error: 'Version not found' });
  if (!ver.r2_key || ver.r2_key.startsWith('pending/'))
    return json(400, { error: 'No file stored for this version' });

  let downloadUrl;
  try {
    downloadUrl = await presignedGet(env, ver.r2_key, 3600);
  } catch (err) {
    return json(500, { error: 'Failed to generate download URL' });
  }

  return json(200, {
    download_url: downloadUrl,
    version_no:   ver.version_no,
    file_name:    ver.documents?.file_name || 'document',
    content_type: ver.documents?.content_type || null,
  });
}
