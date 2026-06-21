// POST /api/send-doc-reminder
// Staff manually triggers a document reminder email to a client.
// Lists all pending required documents for the matter.
// Updates last_reminded_at on those docs IF the email sends.
// No-op (returns { sent: false }) if RESEND_API_KEY not configured.
//
// Body: { matter_id, document_ids?: string[] }
// If document_ids is provided, only those docs are included in the reminder.
// If omitted, all pending required docs for the matter are included.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'uploads');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, document_ids } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required.' });

  if (!env.RESEND_API_KEY) {
    return json(200, { sent: false, reason: 'Email not configured — reminder not sent. Wire up Resend to enable.' });
  }

  const admin = makeAdminClient(env);

  // Get matter + client info
  const { data: matter } = await admin
    .from('matters')
    .select('id, case_type, clients(id, first_name, last_name, email)')
    .eq('id', matter_id)
    .single();

  if (!matter) return json(404, { error: 'Matter not found.' });
  if (!matter.clients?.email) return json(422, { error: 'Client has no email address on file.' });

  // Get pending required docs — filtered to specific IDs if provided
  let docsQuery = admin
    .from('documents')
    .select('id, name, required_by_date')
    .eq('matter_id', matter_id)
    .eq('status', 'pending')
    .eq('is_required', true)
    .is('deleted_at', null)
    .order('name');

  if (Array.isArray(document_ids) && document_ids.length) {
    docsQuery = docsQuery.in('id', document_ids);
  }

  const { data: pendingDocs } = await docsQuery;

  if (!pendingDocs?.length) {
    return json(200, { sent: false, reason: 'No pending required documents.' });
  }

  const client    = matter.clients;
  const firmName  = env.PORTAL_FIRM_NAME || 'Your Legal Team';
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';

  const docList = pendingDocs.map(d => {
    const due = d.required_by_date ? ` (due ${d.required_by_date})` : '';
    return `<li style="margin-bottom:6px">${d.name}${due}</li>`;
  }).join('');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    env.PORTAL_FROM_EMAIL || `portal@${env.RESEND_DOMAIN || 'notifications.example.com'}`,
      to:      [client.email],
      subject: `Action required: documents needed for your matter — ${firmName}`,
      html: `
        <p>Hi ${client.first_name},</p>
        <p>We still need the following documents to move forward with your matter:</p>
        <ul style="margin:16px 0;padding-left:20px;line-height:1.6">${docList}</ul>
        <p>You can upload them directly through your secure client portal, or bring them to our office.</p>
        <p>
          <a href="${portalUrl}/portal"
             style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
            Go to your portal
          </a>
        </p>
        <p style="color:#888;font-size:12px;margin-top:24px;">
          ${firmName}<br>
          If you have questions, please contact our office directly.
        </p>
      `,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[send-doc-reminder] resend HTTP error:', res.status, errBody);
    admin.from('email_log').insert({ type: 'doc_reminder', to_email: client.email, subject: `Action required: documents needed for your matter — ${firmName}`, status: 'failed', error: errBody.slice(0, 500) }).catch(() => {});
    return json(502, { error: 'Failed to send reminder email. Check Resend configuration.' });
  }

  admin.from('email_log').insert({ type: 'doc_reminder', to_email: client.email, subject: `Action required: documents needed for your matter — ${firmName}`, status: 'sent' }).catch(() => {});
  console.log('[send-doc-reminder] sent to:', client.email, 'docs:', pendingDocs.length);

  // Mark reminded
  const now = new Date().toISOString();
  const ids  = pendingDocs.map(d => d.id);
  await admin.from('documents').update({ last_reminded_at: now }).in('id', ids);

  return json(200, { sent: true, count: pendingDocs.length, to: client.email });
}
