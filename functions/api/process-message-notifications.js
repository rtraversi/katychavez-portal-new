// POST /api/process-message-notifications
// Debounced client notification cron — called by CF Workers cron every 5 minutes.
// Also callable as POST for manual/test triggers (Owner only).
//
// Finds conversations with outbound messages that are:
//   - unread (client_read_at IS NULL) — if the client already read them in the portal, skip
//   - older than 10 minutes (debounce window — lets rapid-fire messages accumulate)
//   - newer than the last notification sent for this conversation
// Sends ONE batched email per qualifying conversation and stamps client_notified_at.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await verifyAuth(request, env, 'admin', 'messaging');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const result = await run(env);
  return json(200, result);
}

export async function run(env) {
  if (!env.RESEND_API_KEY) {
    console.log('[process-message-notifications] RESEND_API_KEY not set — skipping');
    return { processed: 0, skipped: 'not_configured' };
  }

  const admin     = makeAdminClient(env);
  const firmName  = env.PORTAL_FIRM_NAME  || 'Your Legal Team';
  const portalUrl = env.PORTAL_URL        || 'https://your-portal.workers.dev';
  const fromEmail = env.PORTAL_FROM_EMAIL || 'portal@notifications.example.com';
  const cutoff    = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10-min debounce

  const { data: convos, error } = await admin
    .from('conversations')
    .select('id, client_notified_at, clients(id, first_name, last_name, email)');

  if (error) {
    console.error('[process-message-notifications] conversations query:', error.message);
    return { processed: 0, error: error.message };
  }

  let processed = 0;

  for (const convo of (convos || [])) {
    if (!convo.clients?.email) continue;

    // Unread outbound messages outside the debounce window, not yet notified
    let q = admin
      .from('messages')
      .select('id, body, created_at')
      .eq('conversation_id', convo.id)
      .eq('direction', 'outbound')
      .is('client_read_at', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (convo.client_notified_at) {
      q = q.gt('created_at', convo.client_notified_at);
    }

    const { data: msgs } = await q;
    if (!msgs?.length) continue;

    const client     = convo.clients;
    const countLabel = msgs.length === 1 ? '1 new message' : `${msgs.length} new messages`;
    const msgItems   = msgs.map(m =>
      `<li style="margin-bottom:8px;line-height:1.5">${m.body.trim().replace(/\n/g, '<br>')}</li>`
    ).join('');

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    fromEmail,
          to:      [client.email],
          subject: `${countLabel} from ${firmName}`,
          html: `
            <p>Hi ${client.first_name},</p>
            <p>You have ${countLabel} from <strong>${firmName}</strong>:</p>
            <ul style="margin:16px 0;padding-left:20px;color:#333">${msgItems}</ul>
            <p>
              <a href="${portalUrl}/portal"
                 style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;
                        text-decoration:none;display:inline-block">
                Reply in your portal
              </a>
            </p>
            <p style="color:#888;font-size:12px;margin-top:24px;">
              ${firmName}<br>
              Please do not reply to this email — log in to your portal to respond.
            </p>
          `,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('[process-message-notifications] resend error for', client.email, res.status, body);
        continue;
      }

      await admin
        .from('conversations')
        .update({ client_notified_at: new Date().toISOString() })
        .eq('id', convo.id);

      console.log('[process-message-notifications] sent to:', client.email, 'msgs:', msgs.length);
      processed++;
    } catch (err) {
      console.error('[process-message-notifications] network error for', client.email, err.message);
    }
  }

  return { processed };
}
