// POST /api/client-send-message
// Client sends an inbound portal message.
// Creates the conversation row if this is the first message from this client.
// Fires a Resend email to all Owner + Attorney staff.
//
// Body: { body }

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'messaging', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (!auth.isClient)  return json(403, { error: 'Clients only.' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { body: msgBody } = body;
  if (!msgBody?.trim()) return json(400, { error: 'Message body is required.' });

  const admin = makeAdminClient(env);

  // Get the client record for this auth user
  const { data: client } = await admin
    .from('clients')
    .select('id, first_name, last_name, email')
    .eq('auth_id', auth.user.id)
    .eq('active', true)
    .single();
  if (!client) return json(404, { error: 'Client record not found.' });

  // Get or create conversation
  let { data: convo } = await admin
    .from('conversations')
    .select('id')
    .eq('client_id', client.id)
    .single();

  if (!convo) {
    const { data: newConvo, error: createErr } = await admin
      .from('conversations')
      .insert({ client_id: client.id })
      .select('id')
      .single();
    if (createErr) {
      console.error('[client-send-message] create conversation:', createErr.message);
      return json(500, { error: 'Failed to create conversation.' });
    }
    convo = newConvo;
  }

  // Insert inbound message
  const { data: message, error: msgErr } = await admin
    .from('messages')
    .insert({
      conversation_id: convo.id,
      direction:       'inbound',
      channel:         'portal',
      body:            msgBody.trim(),
      sender_id:       null,  // client — no users row
    })
    .select('id, body, direction, channel, created_at')
    .single();

  if (msgErr) {
    console.error('[client-send-message] insert message:', msgErr.message);
    return json(500, { error: 'Failed to send message.' });
  }

  // Update conversation timestamp
  await admin
    .from('conversations')
    .update({ last_message_at: message.created_at })
    .eq('id', convo.id);

  // Notify all Owner + Attorney staff via email (best-effort)
  if (env.RESEND_API_KEY) {
    const { data: staffUsers } = await admin
      .from('users')
      .select('email, first_name, roles(name)')
      .eq('active', true)
      .not('email', 'is', null);

    const notifyEmails = (staffUsers || [])
      .filter(u => ['Owner', 'Attorney', 'Partner Attorney'].includes(u.roles?.name))
      .map(u => u.email)
      .filter(Boolean);

    if (notifyEmails.length) {
      const clientName = `${client.first_name} ${client.last_name}`.trim();
      const firmName   = env.PORTAL_FIRM_NAME || 'Your Legal Portal';
      const portalUrl  = env.PORTAL_URL || 'https://your-portal.workers.dev';

      fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    env.PORTAL_FROM_EMAIL || `portal@${env.RESEND_DOMAIN || 'notifications.example.com'}`,
          to:      notifyEmails,
          subject: `New message from ${clientName}`,
          html: `
            <p>A new message has arrived from client <strong>${clientName}</strong>.</p>
            <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555;margin:16px 0;">
              ${msgBody.trim().replace(/\n/g, '<br>')}
            </blockquote>
            <p><a href="${portalUrl}/portal" style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">View in portal</a></p>
            <p style="color:#888;font-size:12px;margin-top:24px;">IurisIQ — ${firmName}</p>
          `,
        }),
      }).then(async r => {
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          console.error('[client-send-message] resend HTTP error:', r.status, body);
        } else {
          console.log('[client-send-message] resend OK to:', notifyEmails.join(', '));
        }
      }).catch(err => console.error('[client-send-message] resend network error:', err.message));
    }
  }

  return json(200, { message, conversation_id: convo.id });
}
