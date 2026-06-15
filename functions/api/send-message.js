// POST /api/send-message
// Staff sends an outbound message to a client via the portal.
// Creates the conversation row if this is the first message to this client.
// Fires a Resend email notification to the client.
//
// Body: { client_id, body }

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'messaging');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { client_id, body: msgBody } = body;
  if (!client_id)           return json(400, { error: 'client_id is required.' });
  if (!msgBody?.trim())     return json(400, { error: 'Message body is required.' });

  const admin = makeAdminClient(env);

  // Verify the client exists
  const { data: client } = await admin
    .from('clients')
    .select('id, first_name, last_name, email')
    .eq('id', client_id)
    .eq('active', true)
    .single();
  if (!client) return json(404, { error: 'Client not found.' });

  // Get or create conversation
  let { data: convo } = await admin
    .from('conversations')
    .select('id')
    .eq('client_id', client_id)
    .single();

  if (!convo) {
    const { data: newConvo, error: createErr } = await admin
      .from('conversations')
      .insert({ client_id })
      .select('id')
      .single();
    if (createErr) {
      console.error('[send-message] create conversation:', createErr.message);
      return json(500, { error: 'Failed to create conversation.' });
    }
    convo = newConvo;
  }

  // Insert the message
  const { data: message, error: msgErr } = await admin
    .from('messages')
    .insert({
      conversation_id: convo.id,
      direction:       'outbound',
      channel:         'portal',
      body:            msgBody.trim(),
      sender_id:       auth.profile.id,
    })
    .select('id, body, direction, channel, created_at, sender_id')
    .single();

  if (msgErr) {
    console.error('[send-message] insert message:', msgErr.message);
    return json(500, { error: 'Failed to send message.' });
  }

  // Update conversation timestamp
  await admin
    .from('conversations')
    .update({ last_message_at: message.created_at })
    .eq('id', convo.id);

  // Email notification is handled by the debounced cron (process-message-notifications).
  // Messages accumulate for 10 min; if the client reads them first, no email is sent.

  return json(200, {
    message,
    conversation_id: convo.id,
  });
}
