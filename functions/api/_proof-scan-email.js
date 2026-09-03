// _proof-scan-email.js — deterministic Proof Scan email content. NOT a route.
//
// Everything in this file is pure: it takes a VALIDATED structured result and
// returns a subject line and an HTML body. No env, no network, no database.
//
// Three rules hold the whole file up:
//
//   1. Nothing model-authored is forwarded. The old pipeline pasted Claude's HTML
//      straight into the message body; there is no parameter here that could carry
//      HTML at all. Every observed value is escaped before it is interpolated.
//   2. The words come from the same place the portal's words come from —
//      reportStateLanguage() for the report state, buildReportModel() for the item
//      lines — so an email and the report it refers to cannot disagree.
//   3. An unvalidated result cannot produce a message. buildProofScanEmail()
//      re-validates and returns null on any failure, so a malformed, unknown-ID,
//      duplicated or omitted observation set has no path to an inbox.

import { validateStoredScanResult, STAFF_REVIEW_REMINDER } from './proof-scan-contract.js';
import { buildReportModel } from '../../pages/proof-scan/report-model.js';

// Same shaping the portal renders, so a line in the email is the line on screen.
// report-model.js is pure — no DOM, no fetch — which is why it can be imported here.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SUBJECT_FILENAME_LIMIT = 120;
const SUBJECT_LIMIT = 200;

// Email subjects are headers, not HTML. Remove every ASCII/C1 control plus the
// Unicode line separators, collapse whitespace, and bound the result. NFKC keeps
// visually equivalent filename forms consistent without changing the body copy.
export function subjectFilename(value) {
  const cleaned = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Untitled package').slice(0, SUBJECT_FILENAME_LIMIT).trim();
}

// Production links must be HTTPS. Plain HTTP is accepted only for an explicit
// loopback development origin. Credentials and every non-web scheme are refused.
export function proofScanReportUrl(value) {
  try {
    const raw = String(value ?? '').trim();
    if (!raw || /[\u0000-\u001f\u007f-\u009f<>"'\\]/.test(raw)) return null;
    const url = new URL(raw);
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password) return null;
    return new URL('/portal#proof-scan', url.origin).href;
  } catch {
    return null;
  }
}

// The report state's own colour. Deliberately not green for "No issues found":
// nothing here is an approval, and the message says so in words underneath.
const TONE = {
  items_need_attention: '#b91c1c',
  review_incomplete:    '#b45309',
  no_issues_found:      '#374151',
};

function factRows(facts) {
  return facts.map((fact) => `<tr>
      <td style="padding:3px 12px 3px 0;color:#6b7280;font-size:12px;vertical-align:top;white-space:nowrap">${esc(fact.key)}</td>
      <td style="padding:3px 0;font-size:12px;color:#111">${esc(fact.value)}</td>
    </tr>`).join('');
}

function noticeList(items) {
  return items.map((item) => {
    const meta = [item.expected ? `Expected: ${item.expected}` : '', item.where || '']
      .filter(Boolean).map(esc).join(' &middot; ');
    return `<li style="margin:0 0 10px;font-size:13px;color:#111;line-height:1.5">
      ${esc(item.headline)}
      ${meta ? `<div style="margin-top:2px;font-size:12px;color:#6b7280">${meta}</div>` : ''}
    </li>`;
  }).join('');
}

function section(title, items) {
  if (!items.length) return '';
  return `<p style="margin:20px 0 8px;font-size:13px;font-weight:700;color:#111">${esc(title)}</p>
    <ul style="margin:0;padding-left:18px">${noticeList(items)}</ul>`;
}

// Returns { subject, html } for a validated result, or null when the result does
// not validate. Null means: send nothing. There is no partial or fallback email.
export function buildProofScanEmail(result, { firmName, portalUrl } = {}) {
  const validated = validateStoredScanResult(result);
  if (!validated.ok) return null;

  const data = validated.data;
  const model = buildReportModel(data);

  // Composition guarantees this, but the email boundary re-checks rather than
  // interpolating an empty subject if it ever stops being true.
  if (!model.primary_report_language) return null;

  const language = model.primary_report_language;
  const subject = `Proof Scan — ${language} — ${subjectFilename(data.scan.filename)}`
    .slice(0, SUBJECT_LIMIT).trim();
  const tone = TONE[data.report_state] || '#374151';
  const facts = [...model.client.primary, ...model.client.secondary];
  const reportUrl = proofScanReportUrl(portalUrl);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:640px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1)">
  <div style="background:#1a3a5c;padding:22px 32px">
    <p style="margin:0;color:#fff;font-size:17px;font-weight:600">${esc(firmName || 'Your Law Firm')}</p>
    <p style="margin:2px 0 0;color:#fff;font-size:12px;opacity:.8">Proof Scan result</p>
  </div>
  <div style="padding:24px 32px 4px">
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:${tone}">${esc(language)}</p>
    <p style="margin:0 0 2px;font-size:13px;color:#111">${esc(data.scan.filename)}</p>
    <p style="margin:0 0 16px;font-size:12px;color:#6b7280">${esc(model.scan_type_label || '')}</p>
    <table style="border-collapse:collapse">${factRows(facts)}</table>
  </div>
  <div style="padding:0 32px">
    ${section('Needs attention', model.needs_attention)}
    ${section('Not checked', model.not_checked)}
  </div>
  <div style="margin:24px 32px 0;padding:12px 16px;background:#f9fafb;border-left:3px solid #1a3a5c">
    <p style="margin:0;font-size:12px;color:#374151">${esc(STAFF_REVIEW_REMINDER)}</p>
  </div>
  ${reportUrl ? `<div style="padding:20px 32px 28px">
    <a href="${esc(reportUrl)}"
      style="display:inline-block;padding:11px 22px;background:#1a3a5c;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px"
    >Open the full report</a>
  </div>` : ''}
  <div style="padding:14px 32px;background:#f9fafb;font-size:11px;color:#9ca3af;text-align:center">
    Secure notification from your client portal — do not reply to this email.
  </div>
</div>
</body></html>`;

  return { subject, html };
}
