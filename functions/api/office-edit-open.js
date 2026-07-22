// CF Worker: POST /api/office-edit/open
// Body: { document_id }
// Returns { word_url, file_name } — a ms-word: protocol URL that launches
// desktop Word against this document's WebDAV endpoint so saves land straight
// back in R2. Premium office_edit module.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { generateWebDAVToken }               from './webdav.js';

const EDITABLE_EXTENSIONS = /\.(docx|docm)$/i;

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[office-edit-open]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'office_edit');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { document_id } = body;
  if (!document_id) return json(400, { error: 'document_id is required' });

  const admin = makeAdminClient(env);

  // Premium gate — module must be enabled for this firm.
  const { data: mod } = await admin
    .from('enabled_modules').select('module_key')
    .eq('module_key', 'office_edit').maybeSingle();
  if (!mod) return json(403, { error: 'Edit in Word is not enabled for this firm' });

  const { data: doc, error: docErr } = await admin
    .from('documents')
    .select('id, file_name, r2_key, status, deleted_at, edit_locked_by, locker:users!edit_locked_by(first_name, last_name)')
    .eq('id', document_id)
    .single();

  if (docErr || !doc)               return json(404, { error: 'Document not found' });
  if (doc.deleted_at)               return json(410, { error: 'Document has been deleted' });
  if (doc.status === 'pending' || doc.r2_key.startsWith('pending/'))
    return json(400, { error: 'File upload not yet confirmed' });
  if (!EDITABLE_EXTENSIONS.test(doc.file_name))
    return json(400, { error: 'Only Word documents (.docx) can be edited in Word' });

  // Surface an existing checkout by someone else — Word would open it
  // read-only anyway, so tell the user who has it.
  if (doc.edit_locked_by && doc.edit_locked_by !== auth.profile.id) {
    const who = doc.locker ? `${doc.locker.first_name} ${doc.locker.last_name}` : 'another user';
    return json(423, { error: `Document is checked out by ${who}` });
  }

  const token     = await generateWebDAVToken(auth.profile.id, document_id, env, 'doc');
  const origin    = new URL(request.url).origin;
  const safeName  = encodeURIComponent(doc.file_name);
  const webdavUrl = `${origin}/webdav/${token}/${document_id}/${safeName}`;
  const wordUrl   = `ms-word:ofe|u|${webdavUrl}`;

  return json(200, { word_url: wordUrl, file_name: doc.file_name });
}
