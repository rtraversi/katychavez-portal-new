// GET  /api/get-messages?conversation_id=X  — staff: get thread by conversation ID
// GET  /api/get-messages                    — client: get their own thread
// Marks all inbound messages as read when staff fetches.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'messaging', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const admin  = makeAdminClient(env);
  const url    = new URL(request.url);
  let convoId  = url.searchParams.get('conversation_id');

  if (auth.isClient) {
    // Client: derive conversation from their own client record
    const { data: client } = await admin
      .from('clients')
      .select('id')
      .eq('auth_id', auth.user.id)
      .single();
    if (!client) return json(404, { error: 'Client record not found.' });

    const { data: convo } = await admin
      .from('conversations')
      .select('id')
      .eq('client_id', client.id)
      .single();

    if (!convo) return json(200, { messages: [], conversation_id: null });
    convoId = convo.id;
  }

  // Staff: allow lookup by client_id (auto-derives conversation for client card Messages tab)
  if (!convoId && !auth.isClient) {
    const clientIdParam = url.searchParams.get('client_id');
    if (clientIdParam) {
      const { data: convo } = await admin
        .from('conversations')
        .select('id')
        .eq('client_id', clientIdParam)
        .maybeSingle();
      if (!convo) return json(200, { messages: [], conversation_id: null });
      convoId = convo.id;
    }
  }

  if (!convoId) return json(400, { error: 'conversation_id is required.' });

  // Fetch messages
  const { data: messages, error } = await admin
    .from('messages')
    .select(`
      id,
      body,
      direction,
      channel,
      read_at,
      client_read_at,
      created_at,
      sender_id,
      users (
        id,
        first_name,
        last_name
      )
    `)
    .eq('conversation_id', convoId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[get-messages] query:', error.message);
    return json(500, { error: 'Failed to load messages.' });
  }

  const now = new Date().toISOString();

  // Staff: mark unread inbound messages as read
  if (!auth.isClient) {
    const unreadIds = (messages || [])
      .filter(m => m.direction === 'inbound' && !m.read_at)
      .map(m => m.id);
    if (unreadIds.length) {
      await admin.from('messages').update({ read_at: now }).in('id', unreadIds);
    }
  }

  // Client: mark unread outbound messages (staff → client) as client-read
  if (auth.isClient) {
    const unreadIds = (messages || [])
      .filter(m => m.direction === 'outbound' && !m.client_read_at)
      .map(m => m.id);
    if (unreadIds.length) {
      await admin.from('messages').update({ client_read_at: now }).in('id', unreadIds);
    }
  }

  const shaped = (messages || []).map(m => ({
    id:              m.id,
    body:            m.body,
    direction:       m.direction,
    channel:         m.channel,
    created_at:      m.created_at,
    read_at:         m.read_at,
    client_read_at:  m.client_read_at,
    sender_name:     m.users ? `${m.users.first_name} ${m.users.last_name}`.trim() : null,
  }));

  return json(200, { messages: shaped, conversation_id: convoId });
}
