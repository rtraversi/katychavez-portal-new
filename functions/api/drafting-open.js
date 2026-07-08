// CF Worker: POST /api/drafting/open
// Body: { doc_id }
// Returns { word_url, file_name } so the UI can re-open an existing draft in Word.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { generateWebDAVToken }               from './webdav.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[drafting-open]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'doc_drafting');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { doc_id } = body;
  if (!doc_id) return json(400, { error: 'doc_id is required' });

  const admin = makeAdminClient(env);
  const { data: doc, error: docErr } = await admin
    .from('draft_documents')
    .select('id, file_name')
    .eq('id', doc_id)
    .single();

  if (docErr || !doc) return json(404, { error: 'Document not found' });

  const token     = await generateWebDAVToken(auth.profile.id, doc_id, env);
  const origin    = new URL(request.url).origin;
  const safeName  = encodeURIComponent(doc.file_name);
  const webdavUrl = `${origin}/webdav/${token}/${doc_id}/${safeName}`;
  const wordUrl   = `ms-word:ofe|u|${webdavUrl}`;

  return json(200, { word_url: wordUrl, file_name: doc.file_name });
}
