// Notification helper — wraps Resend email API.
// Import from other functions; NOT a route endpoint (underscore prefix).
// Set RESEND_API_KEY + PORTAL_FROM_EMAIL + PORTAL_FIRM_NAME + PORTAL_URL in CF Pages env.
// Gracefully no-ops when RESEND_API_KEY is absent (dev / pre-domain setup).

async function sendEmail(env, to, subject, html) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[notify] RESEND_API_KEY not set — skipping: "${subject}" → ${to}`);
    return;
  }
  const firmName  = env.PORTAL_FIRM_NAME  || 'Your Firm Name';
  const fromEmail = env.PORTAL_FROM_EMAIL || 'noreply@example.com';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ from: `${firmName} <${fromEmail}>`, to: [to], subject, html }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[notify] Resend error to ${to}: ${err}`);
    }
  } catch (err) {
    console.error(`[notify] fetch error: ${err.message}`);
  }
}

function layout(env, body) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Firm Name';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1)">
  <div style="background:#1a3a5c;padding:22px 32px">
    <p style="margin:0;color:#fff;font-size:17px;font-weight:600">${firmName}</p>
  </div>
  <div style="padding:32px">${body}</div>
  <div style="padding:14px 32px;background:#f9fafb;font-size:11px;color:#9ca3af;text-align:center">
    Secure notification from your client portal — do not reply to this email.
  </div>
</div>
</body></html>`;
}

function btn(href, label) {
  return `<div style="margin-top:24px"><a href="${href}"
    style="display:inline-block;padding:12px 24px;background:#1a3a5c;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px"
  >${label}</a></div>`;
}

function row(label, value) {
  return value
    ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:4px 0;font-size:13px;color:#111">${value}</td></tr>`
    : '';
}

export async function notifyClientInvited(env, { toEmail, clientName }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
  const firmName  = env.PORTAL_FIRM_NAME || 'Your Firm Name';
  await sendEmail(env, toEmail, `You've been invited to the ${firmName} client portal`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">Welcome, ${clientName}</p>
      <p style="margin:0 0 12px;color:#374151">You've been invited to securely access your matter through the <strong>${firmName}</strong> client portal.</p>
      <p style="margin:0 0 8px;color:#374151">Through the portal you can:</p>
      <ul style="margin:0 0 16px;padding-left:20px;color:#374151;line-height:1.8">
        <li>View your matter status and upcoming key dates</li>
        <li>Upload requested documents securely</li>
        <li>Track your document checklist</li>
      </ul>
      <p style="margin:0;color:#374151">A separate email with your sign-in link has been sent. Use that link to set your password — <strong>the link expires in 20 minutes.</strong> If it expires before you can use it, reply to this email and we'll send a new one.</p>
      ${btn(`${portalUrl}/portal`, 'Open portal')}
    `)
  );
}

export async function notifyTaskAssigned(env, { toEmail, taskTitle, clientName, dueDate }) {
  const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
  const due = dueDate
    ? new Date(dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  await sendEmail(env, toEmail, `Task assigned: ${taskTitle}`,
    layout(env, `
      <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#111">A task has been assigned to you</p>
      <table style="border-collapse:collapse">
        ${row('Task', taskTitle)}
        ${row('Client', clientName)}
        ${row('Due', due)}
      </table>
      ${btn(`${portalUrl}/portal#tasks`, 'View tasks')}
    `)
  );
}

export async function notifyDocumentUploaded(env, { toEmail, uploaderName, clientName, fileName, matterLabel }) {
  const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
  await sendEmail(env, toEmail, `New document uploaded — ${clientName}`,
    layout(env, `
      <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#111">A document has been uploaded</p>
      <table style="border-collapse:collapse">
        ${row('File', fileName)}
        ${row('Uploaded by', uploaderName)}
        ${row('Client', clientName)}
        ${row('Matter', matterLabel)}
      </table>
      ${btn(`${portalUrl}/portal#uploads`, 'Review documents')}
    `)
  );
}

export async function notifyMalwareBlocked(env, { toEmail, uploaderName, clientName, fileName, matterLabel, finding }) {
  const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
  await sendEmail(env, toEmail, `⚠️ Infected file blocked — ${clientName}`,
    layout(env, `
      <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#b91c1c">A malicious file was blocked</p>
      <p style="margin:0 0 16px;color:#374151">An uploaded file failed the malware scan and was automatically deleted before anyone could access it. No action is needed in the portal, but the uploader's device may be compromised — consider letting them know.</p>
      <table style="border-collapse:collapse">
        ${row('File', fileName)}
        ${row('Uploaded by', uploaderName)}
        ${row('Client', clientName)}
        ${row('Matter', matterLabel)}
        ${row('Threat detected', finding)}
      </table>
      ${btn(`${portalUrl}/portal#uploads`, 'Open documents')}
    `)
  );
}

export async function notifyChecklistItemReceived(env, { toEmail, clientName, documentLabel, matterLabel }) {
  const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
  await sendEmail(env, toEmail, `Checklist item received — ${clientName}`,
    layout(env, `
      <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#111">A required document has been received</p>
      <table style="border-collapse:collapse">
        ${row('Document', documentLabel)}
        ${row('Client', clientName)}
        ${row('Matter', matterLabel)}
      </table>
      ${btn(`${portalUrl}/portal#uploads`, 'Review documents')}
    `)
  );
}

export async function notifySignatureRequested(env, { toEmail, clientName, requestedBy, documentName, message }) {
  const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
  await sendEmail(env, toEmail, `Signature requested — ${documentName}`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">Your signature is needed</p>
      <p style="margin:0 0 16px;color:#374151"><strong>${requestedBy}</strong> has requested your electronic signature on a document.</p>
      <table style="border-collapse:collapse">
        ${row('Document', documentName)}
        ${row('From', requestedBy)}
        ${message ? row('Message', message) : ''}
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Log in to the portal to review the document and sign. This request expires in 30 days.</p>
      ${btn(`${portalUrl}/portal`, 'Sign document')}
    `)
  );
}

export async function notifySignatureSigned(env, { toEmail, signerName, documentName, requestId }) {
  const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
  await sendEmail(env, toEmail, `Document signed — awaiting your counter-signature`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">Client has signed — your counter-signature is needed</p>
      <table style="border-collapse:collapse">
        ${row('Document', documentName)}
        ${row('Signed by', signerName)}
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Log in to the portal to review the signed document and add your counter-signature.</p>
      ${btn(`${portalUrl}/portal#esign`, 'Counter-sign now')}
    `)
  );
}

export async function notifySignatureCompleted(env, { documentName, requestId }) {
  console.log(`[notify] Signature completed for "${documentName}" (request ${requestId}) — no email configured yet`);
}

export async function notifySignatureDeclined(env, { toEmail, clientName, documentName, reason }) {
  const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
  await sendEmail(env, toEmail, `Signature declined — ${documentName}`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">A client has declined to sign</p>
      <table style="border-collapse:collapse">
        ${row('Document', documentName)}
        ${row('Client', clientName)}
        ${reason ? row('Reason', reason) : ''}
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Log in to the portal to follow up with the client.</p>
      ${btn(`${portalUrl}/portal#esign`, 'View e-sign requests')}
    `)
  );
}
