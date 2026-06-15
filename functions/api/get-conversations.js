// GET /api/get-conversations
// Staff inbox: all conversations sorted by last message, with unread count per conversation.
// Also returns per-client unread counts for the clients list badge.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'messaging');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const admin = makeAdminClient(env);

  // All conversations with client info + last message preview
  const { data: convos, error } = await admin
    .from('conversations')
    .select(`
      id,
      client_id,
      last_message_at,
      clients (
        id,
        first_name,
        last_name,
        email
      ),
      messages (
        id,
        body,
        direction,
        channel,
        read_at,
        created_at
      )
    `)
    .order('last_message_at', { ascending: false });

  if (error) {
    console.error('[get-conversations] query:', error.message);
    return json(500, { error: 'Failed to load conversations.' });
  }

  // Shape the response: compute unread count + last message preview per conversation
  const conversations = (convos || []).map(c => {
    const msgs      = c.messages || [];
    const unread    = msgs.filter(m => m.direction === 'inbound' && !m.read_at).length;
    const lastMsg   = msgs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    return {
      id:              c.id,
      client_id:       c.client_id,
      client_name:     c.clients ? `${c.clients.first_name} ${c.clients.last_name}`.trim() : 'Unknown',
      client_email:    c.clients?.email || null,
      last_message_at: c.last_message_at,
      unread_count:    unread,
      last_message:    lastMsg ? {
        body:      lastMsg.body.length > 80 ? lastMsg.body.slice(0, 80) + '…' : lastMsg.body,
        direction: lastMsg.direction,
        created_at: lastMsg.created_at,
      } : null,
    };
  });

  return json(200, { conversations });
}
