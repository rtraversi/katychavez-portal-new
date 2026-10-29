// GET /api/ai-chat-attachment?id=<uuid>: open a file attached in one of your chats.
// Auth: staff with read on ai_chat, and only for their own files.
// Streams the file from R2; the page shows it through a blob URL.

import { verifyAuth, json } from './_helpers.js';
import { UUID_RE } from './_ai-chat-common.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'ai_chat');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (auth.isClient) return json(403, { error: 'Not available' });

  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID_RE.test(id)) return json(400, { error: 'Invalid file id' });

  const { data, error } = await auth.admin.from('ai_chat_attachments')
    .select('r2_key, file_name, content_type').eq('id', id).eq('user_id', auth.profile.id);
  if (error) {
    console.error('[ai-chat-attachment]', error.message);
    return json(500, { error: 'Something went wrong. Try again.' });
  }
  const att = data?.[0];
  if (!att) return json(404, { error: 'File not found' });

  const obj = await env.R2.get(att.r2_key);
  if (!obj) return json(404, { error: 'File not found' });

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': att.content_type,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.file_name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
