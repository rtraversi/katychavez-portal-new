// POST /api/ai-chat-conversation: rename or delete one of your Ask Claude chats.
//
// Body: { action: 'rename', id, title } | { action: 'delete', id }
// Auth: staff with write on ai_chat, and only on chats they started.
// Delete removes the chat's files from R2 first; the rows cascade.

import { verifyAuth, json } from './_helpers.js';
import { UUID_RE } from './_ai-chat-common.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'ai_chat');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (auth.isClient) return json(403, { error: 'Not available' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { action, id } = body || {};
  if (typeof id !== 'string' || !UUID_RE.test(id)) return json(400, { error: 'Invalid chat id' });

  const db = auth.admin;
  const { data: owned, error: ownErr } = await db.from('ai_chat_conversations')
    .select('id').eq('id', id).eq('user_id', auth.profile.id);
  if (ownErr) return fail('load', ownErr);
  if (!owned?.length) return json(404, { error: 'Chat not found' });

  if (action === 'rename') {
    const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!title) return json(400, { error: 'Give the chat a name.' });
    const { error } = await db.from('ai_chat_conversations').update({ title }).eq('id', id);
    if (error) return fail('rename', error);
    return json(200, { ok: true, title });
  }

  if (action === 'delete') {
    const { data: atts, error: aErr } = await db.from('ai_chat_attachments').select('id, r2_key').eq('conversation_id', id);
    if (aErr) return fail('load files', aErr);
    for (const a of atts || []) {
      try { await env.R2.delete(a.r2_key); } catch (err) {
        console.error('[ai-chat-conversation] R2 delete failed', a.r2_key, err?.message || err);
      }
    }
    const { error } = await db.from('ai_chat_conversations').delete().eq('id', id);
    if (error) return fail('delete', error);
    return json(200, { ok: true });
  }

  return json(400, { error: 'Unknown action' });
}

function fail(what, error) {
  console.error(`[ai-chat-conversation] ${what}:`, error?.message || error);
  return json(500, { error: 'Something went wrong. Try again.' });
}
