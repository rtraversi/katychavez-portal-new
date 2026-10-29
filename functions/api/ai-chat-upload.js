// POST /api/ai-chat-upload: attach a PDF or image to the next Ask Claude question.
//
// Body: the file's raw bytes. Headers: Content-Type (the file's type) and
// X-File-Name (URI-encoded). Auth: staff with write on ai_chat.
// Returns { attachment: { id, file_name, content_type, size_bytes } }.
//
// The file goes to R2 under ai-chat/<user>/; the row points at it. It belongs
// to no chat until ai-chat-send links it. Files never sent are removed by the
// daily cron (run, below) after UNSENT_ATTACHMENT_HOURS.

import { verifyAuth, json, makeAdminClient } from './_helpers.js';
import { FILE_TYPES, MAX_FILE_BYTES, UNSENT_ATTACHMENT_HOURS, sniffMatches } from './_ai-chat-common.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'ai_chat');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (auth.isClient) return json(403, { error: 'Not available' });

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const type = FILE_TYPES[contentType];
  if (!type) return json(415, { error: 'Attach a PDF or an image (PNG, JPG, GIF or WebP).' });

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_FILE_BYTES) return json(413, { error: tooBig() });

  let fileName = 'file';
  try { fileName = decodeURIComponent(request.headers.get('x-file-name') || '') || `file.${type.ext}`; } catch { /* keep default */ }
  fileName = fileName.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json(400, { error: 'The file is empty.' });
  if (bytes.length > MAX_FILE_BYTES) return json(413, { error: tooBig() });
  if (!sniffMatches(contentType, bytes)) return json(415, { error: "That file isn't a readable PDF or image." });

  const userId = auth.profile.id;
  const r2Key = `ai-chat/${userId}/${crypto.randomUUID()}.${type.ext}`;
  try {
    await env.R2.put(r2Key, bytes, { httpMetadata: { contentType } });
  } catch (err) {
    console.error('[ai-chat-upload] R2 put failed', err?.message || err);
    return json(502, { error: 'The file could not be stored. Try again.' });
  }

  const { data, error } = await auth.admin.from('ai_chat_attachments')
    .insert({ user_id: userId, r2_key: r2Key, file_name: fileName, content_type: contentType, size_bytes: bytes.length })
    .select('id, file_name, content_type, size_bytes');
  if (error) {
    console.error('[ai-chat-upload] insert failed', error.message);
    await env.R2.delete(r2Key).catch(() => {});
    return json(500, { error: 'The file could not be saved. Try again.' });
  }
  return json(200, { attachment: data[0] });
}

function tooBig() {
  return `Files can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
}

// Daily cron: delete attachments uploaded but never sent with a question.
export async function run(env) {
  const db = makeAdminClient(env);
  const cutoff = new Date(Date.now() - UNSENT_ATTACHMENT_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await db.from('ai_chat_attachments')
    .select('id, r2_key').is('conversation_id', null).lt('created_at', cutoff).limit(500);
  if (error) { console.error('[ai-chat-cleanup] query failed', error.message); return; }
  for (const a of data || []) {
    try {
      await env.R2.delete(a.r2_key);
      await db.from('ai_chat_attachments').delete().eq('id', a.id);
    } catch (err) {
      console.error('[ai-chat-cleanup] failed for', a.id, err?.message || err);
    }
  }
  if (data?.length) console.log(`[ai-chat-cleanup] removed ${data.length} unsent attachment(s)`);
}
