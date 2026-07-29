// Notification helper — wraps Resend email API.
// Import from other functions; NOT a route endpoint (underscore prefix).
// Set RESEND_API_KEY + PORTAL_FROM_EMAIL + PORTAL_FIRM_NAME + PORTAL_URL in CF Pages env.
// Gracefully no-ops when RESEND_API_KEY is absent (dev / pre-domain setup).

import { makeAdminClient } from './_helpers.js';

async function sendEmail(env, to, subject, html, type = 'other') {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[notify] RESEND_API_KEY not set — skipping: "${subject}" → ${to}`);
    return;
  }
  const firmName  = env.PORTAL_FIRM_NAME  || 'Your Law Firm';
  const fromEmail = env.PORTAL_FROM_EMAIL || 'noreply@example.com';
  let status = 'sent';
  let error  = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ from: `${firmName} <${fromEmail}>`, to: [to], subject, html }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[notify] Resend error to ${to}: ${err}`);
      status = 'failed';
      error  = err.slice(0, 500);
    }
  } catch (err) {
    console.error(`[notify] fetch error: ${err.message}`);
    status = 'failed';
    error  = err.message;
  }
  // Log every attempt to email_log (fire-and-forget — never block the notification)
  try {
    await makeAdminClient(env).from('email_log').insert({ type, to_email: to, subject, status, error });
  } catch (logErr) {
    console.error('[notify] email_log insert failed:', logErr.message);
  }
}

function layout(env, body) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
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

export async function notifyClientInvited(env, { toEmail, clientName, inviteLink }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
  const firmName  = env.PORTAL_FIRM_NAME || 'Your Law Firm';
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
      ${inviteLink
        ? `<p style="margin:0 0 16px;color:#374151">Click the button below to set your password and access the portal. <strong>This link expires in 20 minutes.</strong></p>${btn(inviteLink, 'Access your portal')}`
        : `<p style="margin:0;color:#374151">A separate email with your sign-in link has been sent. Use that link to set your password — <strong>the link expires in 20 minutes.</strong> If it expires before you can use it, reply to this email and we'll send a new one.</p>${btn(`${portalUrl}/portal`, 'Open portal')}`
      }
    `), 'client_invite'
  );
}

export async function notifyTaskAssigned(env, { toEmail, taskTitle, clientName, dueDate }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
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
    `), 'task_assigned'
  );
}

export async function notifyDocumentUploaded(env, { toEmail, uploaderName, clientName, fileName, matterLabel }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
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
    `), 'doc_uploaded'
  );
}

export async function notifyMalwareBlocked(env, { toEmail, uploaderName, clientName, fileName, matterLabel, finding }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
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
    `), 'malware_blocked'
  );
}

export async function notifyChecklistItemReceived(env, { toEmail, clientName, documentLabel, matterLabel }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
  await sendEmail(env, toEmail, `Checklist item received — ${clientName}`,
    layout(env, `
      <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#111">A required document has been received</p>
      <table style="border-collapse:collapse">
        ${row('Document', documentLabel)}
        ${row('Client', clientName)}
        ${row('Matter', matterLabel)}
      </table>
      ${btn(`${portalUrl}/portal#uploads`, 'Review documents')}
    `), 'checklist_received'
  );
}

export async function notifyIntakeSubmitted(env, { toEmail, clientName, matterLabel }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
  await sendEmail(env, toEmail, `Intake submitted — ${clientName}`,
    layout(env, `
      <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#111">A client has completed their intake</p>
      <table style="border-collapse:collapse">
        ${row('Client', clientName)}
        ${row('Matter', matterLabel)}
      </table>
      <p style="margin:16px 0 0;color:#374151">Opposing party, opposing counsel, children, and financial info have been submitted and are now locked on the client's end. Review and edit as needed from the client's case file.</p>
      ${btn(`${portalUrl}/portal#clients`, 'Review client')}
    `), 'intake_submitted'
  );
}

export async function notifyIntakeRequest(env, { toEmail, clientName, link }) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
  const greeting = clientName ? `Hello ${clientName},` : 'Hello,';
  await sendEmail(env, toEmail, `${firmName} — please complete your intake form`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">${greeting}</p>
      <p style="margin:0 0 12px;color:#374151"><strong>${firmName}</strong> has requested some information to get started on your case. Please click below to complete a short, secure intake form.</p>
      <p style="margin:0 0 16px;color:#374151">No account or password is needed — the form opens right from this link. <strong>The link expires in 14 days.</strong></p>
      ${btn(link, 'Complete your intake')}
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af">If the button doesn't work, copy and paste this link into your browser:<br>${link}</p>
    `), 'intake_request'
  );
}

export async function notifyRetainerRequest(env, { toEmail, clientName, amount, description, link }) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
  const greeting = clientName ? `Hello ${clientName},` : 'Hello,';
  // Open-amount request (amount null): the client enters the amount at checkout.
  const hasAmount = amount != null && Number(amount) > 0;
  const amountStr = hasAmount
    ? '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  await sendEmail(env, toEmail, `${firmName} — retainer payment request`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">${greeting}</p>
      <p style="margin:0 0 12px;color:#374151"><strong>${firmName}</strong> has requested a retainer payment to get started on your matter.</p>
      <table style="border-collapse:collapse;margin:0 0 8px">
        ${row('Amount', `<strong>${amountStr || 'You choose the amount to pay'}</strong>`)}
        ${description ? row('For', description) : ''}
      </table>
      <p style="margin:0 0 16px;color:#374151">Your payment is held securely in the firm's client trust account. Click below to pay by card or bank transfer — no account or password is needed.</p>
      ${btn(link, amountStr ? `Pay ${amountStr} retainer` : 'Pay retainer')}
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af">If the button doesn't work, copy and paste this link into your browser:<br>${link}</p>
    `), 'retainer_request'
  );
}

// Staff-facing: a retainer payment landed in trust. Sent individually to every
// active staff user (anyone whose role isn't Client) by the payment webhook.
// fbHint: 'recorded' (portal put the prepayment credit into FreshBooks),
// 'manual' (FreshBooks is connected — remind staff to record it there), or
// null (no FreshBooks on this deployment — say nothing about it).
export async function notifyRetainerPaid(env, { toEmail, clientName, matterLabel, amount, description, fbHint }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
  const amountStr = amount != null
    ? '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  const fbLine = fbHint === 'recorded'
    ? `<p style="margin:12px 0 0;color:#374151">This retainer was also recorded in FreshBooks as a <strong>Prepayment credit</strong> under the client.</p>`
    : fbHint === 'manual'
      ? `<p style="margin:12px 0 0;padding:10px 14px;background:#fef3c7;border-radius:6px;color:#92400e"><strong>FreshBooks reminder:</strong> record this retainer as a <strong>Prepayment credit</strong> under the client (Credits → New Credit → Prepayment) — <em>not</em> as an invoice — so it can be applied to their next invoice.</p>`
      : '';
  await sendEmail(env, toEmail, `Retainer paid — ${clientName || 'client'}${amountStr ? ` (${amountStr})` : ''}`,
    layout(env, `
      <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#15803d">A retainer payment has been received</p>
      <table style="border-collapse:collapse">
        ${row('Client', esc(clientName))}
        ${row('Matter', esc(matterLabel))}
        ${row('Amount', amountStr ? `<strong>${amountStr}</strong>` : null)}
        ${description ? row('For', esc(description)) : ''}
      </table>
      <p style="margin:16px 0 0;color:#374151">The funds have been recorded as a deposit in the client's trust ledger.</p>
      ${fbLine}
      ${btn(`${portalUrl}/portal#billing`, 'Open Billing')}
    `), 'retainer_paid'
  );
}

export async function notifySignatureRequested(env, { toEmail, clientName, requestedBy, documentName, message }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
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
    `), 'signature_request'
  );
}

export async function notifySignatureSigned(env, { toEmail, signerName, documentName, requestId }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
  await sendEmail(env, toEmail, `Document signed — awaiting your counter-signature`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">Client has signed — your counter-signature is needed</p>
      <table style="border-collapse:collapse">
        ${row('Document', documentName)}
        ${row('Signed by', signerName)}
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Log in to the portal to review the signed document and add your counter-signature.</p>
      ${btn(`${portalUrl}/portal#esign`, 'Counter-sign now')}
    `), 'signature_signed'
  );
}

export async function notifySignatureCompleted(env, { documentName, requestId }) {
  console.log(`[notify] Signature completed for "${documentName}" (request ${requestId}) — no email configured yet`);
}

export async function notifySignatureDeclined(env, { toEmail, clientName, documentName, reason }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
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
    `), 'signature_declined'
  );
}

export async function notifyProofScanComplete(env, { toEmail, filename, status, resultHtml }) {
  const label    = status === 'needs_correction' ? 'NEEDS CORRECTION' : 'PASS';
  const subject  = `Proof Scan — ${label} — ${filename}`;
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
  const color    = status === 'needs_correction' ? '#b91c1c' : '#15803d';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:860px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1)">
  <div style="background:#1a3a5c;padding:22px 32px;display:flex;align-items:center;justify-content:space-between">
    <p style="margin:0;color:#fff;font-size:17px;font-weight:600">${firmName}</p>
    <p style="margin:0;color:#fff;font-size:13px;opacity:.8">Proof Scan Result</p>
  </div>
  <div style="padding:24px 32px 8px">
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:${color}">${label}</p>
    <p style="margin:0 0 20px;font-size:13px;color:#6b7280">${filename}</p>
  </div>
  <div style="padding:0 32px 32px;font-size:13px;line-height:1.6;color:#111">
    ${resultHtml}
  </div>
  <div style="padding:14px 32px;background:#f9fafb;font-size:11px;color:#9ca3af;text-align:center">
    Secure notification from your client portal — do not reply to this email.
  </div>
</div>
</body></html>`;
  await sendEmail(env, toEmail, subject, html, 'proof_scan');
}

export async function notifyPasswordReset(env, { toEmail, resetLink }) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
  await sendEmail(env, toEmail, `Reset your ${firmName} portal password`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">Password reset request</p>
      <p style="margin:0 0 20px;color:#374151">A password reset was requested for your <strong>${firmName}</strong> portal account. Click the button below to choose a new password.</p>
      <p style="margin:0 0 20px;color:#374151"><strong>This link expires in 1 hour.</strong> If you did not request this, you can safely ignore this email — your password has not changed.</p>
      ${btn(resetLink, 'Reset my password')}
    `), 'password_reset'
  );
}

// ── Scheduling / consult booking ─────────────────────────────────────────────
// Prospect-supplied strings (name, notes) are attacker-controlled on the public
// booking endpoint — escape them before interpolating into email HTML.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function notifyBookingProspect(env, {
  toEmail, prospectName, attorneyName, consultTypeName, whenText, feeText,
}) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
  await sendEmail(env, toEmail, `Your consultation with ${firmName} is confirmed`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">You're booked, ${esc(prospectName)}</p>
      <p style="margin:0 0 20px;color:#374151">Your consultation with <strong>${firmName}</strong> has been scheduled.</p>
      <table style="border-collapse:collapse">
        ${row('Attorney', esc(attorneyName))}
        ${row('Consultation', esc(consultTypeName))}
        ${row('When', esc(whenText))}
        ${row('Fee', feeText ? esc(feeText) : null)}
      </table>
      <p style="margin:20px 0 0;color:#374151">If you need to reschedule or cancel, please contact our office.</p>
    `), 'booking_confirmed'
  );
}

export async function notifyBookingAttorney(env, {
  toEmail, prospectName, prospectEmail, prospectPhone, consultTypeName, whenText, caseTypeName, notes,
}) {
  await sendEmail(env, toEmail, `New consultation booked — ${prospectName}`,
    layout(env, `
      <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#111">A new consultation was booked online</p>
      <table style="border-collapse:collapse">
        ${row('Prospect', esc(prospectName))}
        ${row('Email', esc(prospectEmail))}
        ${row('Phone', esc(prospectPhone))}
        ${row('Consultation', esc(consultTypeName))}
        ${row('When', esc(whenText))}
        ${row('Regarding', esc(caseTypeName))}
        ${row('Notes', esc(notes))}
      </table>
      <p style="margin:20px 0 0;color:#374151">The appointment has been added to your calendar. Manage it from the portal's Appointments page.</p>
    `), 'booking_received'
  );
}

export async function notifyBookingCancelled(env, { toEmail, prospectName, consultTypeName, whenText }) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
  await sendEmail(env, toEmail, `Your consultation with ${firmName} has been cancelled`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">Hi ${esc(prospectName)},</p>
      <p style="margin:0 0 12px;color:#374151">Your <strong>${esc(consultTypeName)}</strong> scheduled for
      ${esc(whenText)} has been <strong>cancelled</strong>.</p>
      <p style="margin:0;color:#374151">If you'd like to rebook, please visit our booking page or contact our office.</p>
    `), 'booking_cancelled'
  );
}

export async function notifyBookingPaymentLink(env, { toEmail, prospectName, consultTypeName, amount, link }) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
  const amt = '$' + Number(amount).toFixed(2);
  await sendEmail(env, toEmail, `Payment for your consultation with ${firmName}`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">Hi ${esc(prospectName)},</p>
      <p style="margin:0 0 12px;color:#374151">Here is the secure payment link for your
      <strong>${esc(consultTypeName)}</strong> (${amt}).</p>
      ${btn(link, `Pay ${amt}`)}
      <p style="margin:20px 0 0;color:#374151;font-size:13px">If you have any questions about this payment, please contact our office.</p>
    `), 'booking_payment_link'
  );
}

export async function notifyBookingReminder(env, { toEmail, prospectName, consultTypeName, attorneyName, whenText }) {
  const firmName = env.PORTAL_FIRM_NAME || 'Your Law Firm';
  await sendEmail(env, toEmail, `Reminder: your consultation with ${firmName}`,
    layout(env, `
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111">Hi ${esc(prospectName)},</p>
      <p style="margin:0 0 12px;color:#374151">This is a friendly reminder about your upcoming consultation.</p>
      <table style="border-collapse:collapse">
        ${row('Consultation', esc(consultTypeName))}
        ${row('Attorney', esc(attorneyName))}
        ${row('When', esc(whenText))}
      </table>
      <p style="margin:20px 0 0;color:#374151">If you need to reschedule or cancel, please contact our office as soon as possible.</p>
    `), 'booking_reminder'
  );
}

// Weekly edition-check digest to staff. `forms` is the list of forms that newly
// went stale/error this run: { form_number, ours, upstream, status, detail }.
export async function notifyFormEditionStale(env, { toEmail, forms }) {
  const portalUrl = env.PORTAL_URL || 'https://your-portal.workers.dev';
  const list = (forms || []).map(f => {
    const isStale = f.status === 'stale';
    const badge = isStale ? '#b45309' : '#6b7280';
    const line  = isStale
      ? `USCIS now shows <strong>${esc(f.upstream)}</strong>; the portal has <strong>${esc(f.ours)}</strong>.`
      : `Could not verify automatically — check it by hand.${f.detail ? ` (${esc(f.detail)})` : ''}`;
    return `<tr>
      <td style="padding:8px 12px 8px 0;font-size:13px;font-weight:700;color:#111;vertical-align:top;white-space:nowrap">${esc(f.form_number)}
        <span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:${badge};color:#fff;font-size:10px;font-weight:700;text-transform:uppercase">${isStale ? 'Stale' : 'Unverified'}</span>
      </td>
      <td style="padding:8px 0;font-size:13px;color:#374151">${line}</td>
    </tr>`;
  }).join('');

  await sendEmail(env, toEmail, `Form editions need review — ${forms.length} form${forms.length === 1 ? '' : 's'}`,
    layout(env, `
      <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#111">Form editions need review</p>
      <p style="margin:0 0 16px;color:#374151">The weekly edition check flagged the following. USCIS rejects filings made on a superseded edition, so please confirm each against uscis.gov and update the template if it has changed.</p>
      <table style="border-collapse:collapse;width:100%">${list}</table>
      ${btn(`${portalUrl}/portal#draft-forms`, 'Open USCIS Forms')}
    `), 'form_edition_stale'
  );
}
