// /api/process-doc-reminders
// Automated reminder processor — called by CF Workers cron (daily at 9am CST).
// Also callable as POST for manual/test triggers (Owner only).
//
// Finds all matters with pending required documents where:
//   - last_reminded_at IS NULL (never reminded), OR
//   - last_reminded_at < now() - reminder_interval_days
// Sends one reminder email per matter and updates last_reminded_at.
// Completely silent no-op if RESEND_API_KEY is not configured.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await verifyAuth(request, env, 'admin', 'uploads');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const result = await run(env);
  return json(200, result);
}

// Called directly by the scheduled handler — no HTTP wrapper.
export async function run(env) {
  if (!env.RESEND_API_KEY) {
    console.log('[process-doc-reminders] RESEND_API_KEY not set — skipping');
    return { processed: 0, skipped: 'not_configured' };
  }

  const admin = makeAdminClient(env);

  // Find matters that have pending required docs due for a reminder
  const { data: matters, error } = await admin
    .from('matters')
    .select(`
      id,
      reminder_interval_days,
      clients (
        id,
        first_name,
        last_name,
        email
      )
    `)
    .eq('status', 'active');

  if (error) {
    console.error('[process-doc-reminders] matters query:', error.message);
    return { processed: 0, error: error.message };
  }

  const now          = new Date();
  let   processed    = 0;
  const firmName     = env.PORTAL_FIRM_NAME  || 'Your Legal Team';
  const portalUrl    = env.PORTAL_URL        || 'https://your-portal.workers.dev';
  const fromEmail    = env.PORTAL_FROM_EMAIL || `portal@${env.RESEND_DOMAIN || 'notifications.example.com'}`;

  for (const matter of (matters || [])) {
    if (!matter.clients?.email) continue;

    const intervalDays = matter.reminder_interval_days || 7;
    const cutoff       = new Date(now.getTime() - intervalDays * 86400000).toISOString();

    // Pending required docs that haven't been reminded within the interval
    const { data: docs } = await admin
      .from('documents')
      .select('id, name, required_by_date, last_reminded_at')
      .eq('matter_id', matter.id)
      .eq('status', 'pending')
      .eq('is_required', true)
      .is('deleted_at', null)
      .or(`last_reminded_at.is.null,last_reminded_at.lt.${cutoff}`);

    if (!docs?.length) continue;

    const client  = matter.clients;
    const docList = docs.map(d => {
      const due = d.required_by_date ? ` (due ${d.required_by_date})` : '';
      return `<li style="margin-bottom:6px">${d.name}${due}</li>`;
    }).join('');

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    fromEmail,
          to:      [client.email],
          subject: `Reminder: documents still needed — ${firmName}`,
          html: `
            <p>Hi ${client.first_name},</p>
            <p>This is a friendly reminder that we still need the following documents for your matter:</p>
            <ul style="margin:16px 0;padding-left:20px;line-height:1.6">${docList}</ul>
            <p>You can upload them through your secure client portal, or contact our office for assistance.</p>
            <p>
              <a href="${portalUrl}/portal"
                 style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
                Go to your portal
              </a>
            </p>
            <p style="color:#888;font-size:12px;margin-top:24px;">${firmName}</p>
          `,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error('[process-doc-reminders] resend error for', client.email, res.status, errBody);
        continue;
      }

      // Update last_reminded_at
      await admin
        .from('documents')
        .update({ last_reminded_at: now.toISOString() })
        .in('id', docs.map(d => d.id));

      console.log('[process-doc-reminders] sent to:', client.email, 'docs:', docs.length);
      processed++;
    } catch (err) {
      console.error('[process-doc-reminders] network error for', client.email, err.message);
    }
  }

  return { processed };
}
