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

import { validateStoredScanResult, reportStateLanguage, STAFF_REVIEW_REMINDER } from './proof-scan-contract.js';
import { buildReportModel } from '../../pages/proof-scan/report-model.js';
import { copyText } from './_proof-scan-v2-copy.js';
import { reportView } from './_proof-scan-v2-view.js';
// The v2 page's own title splitter. Pure: ui.js touches the DOM only when a
// drawing helper is called, which is why the server can import it.
import { headlineCut } from '../../pages/proof-scan-v2/ui.js';

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

// ── Proof Scan v2: the optional stage email (D-61, D-114, D-151) ─────────────
//
// v2.1 (D-151, Max 2026-11-11): the email carries the report, like the v1
// email the firm finds useful. What needs attention, with the values; what
// could not be checked; and what passed, form by form with its pages (v1's
// PASS rows and page map in one table). Supersedes Q-51 (no personal
// information) and the summary half of D-114. Still: the case's last names
// and a link to that exact case (D-114), no case card block (Max 2026-11-11),
// never a Possible issue (D-36), and gentle confirms only as a count.
//
// Built by code, never by the model: every line comes from the stored result
// through reportView(), the same view the page draws, in the page's own words
// (pages/proof-scan-v2/copy.js, D-87), so the email and the page cannot
// disagree. Every value is escaped. SSNs reach a result already masked to the
// last four (the engine never stores more).
const V2_STAGE_LABELS = { draft_review: 'Draft Review', preflight: 'Pre-flight', physical_scan: 'Physical Scan' };
const LAST_NAME_ROLE_ORDER = ['petitioner', 'beneficiary', 'applicant', 'sponsor', 'joint_sponsor', 'household_member'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The case's last names, main person first: "MORALES & REYES". Nothing else
// about anyone. Header-safe (no control characters), bounded.
export function caseLastNames(people = []) {
  const ordered = [...people].filter((p) => String(p?.last_name || '').trim())
    .sort((a, b) => (Number(Boolean(b.is_main)) - Number(Boolean(a.is_main)))
      || LAST_NAME_ROLE_ORDER.indexOf(a.role) - LAST_NAME_ROLE_ORDER.indexOf(b.role));
  const names = [...new Set(ordered.map((p) => subjectFilename(p.last_name).toUpperCase()))];
  return names.slice(0, 4).join(' & ').slice(0, 120);
}

// The link to this exact case. The portal's router owns the hash, so the
// case travels in the query string; the v2 page opens it on load.
export function proofScanCaseUrl(portalUrl, caseId) {
  const base = proofScanReportUrl(portalUrl);
  if (!base) return null;
  const url = new URL(base);
  url.hash = 'proof-scan-v2';
  if (UUID.test(String(caseId || ''))) url.searchParams.set('ps2case', caseId);
  return url.href;
}

// ── The report blocks (D-151). Each draws what the page draws for the same
// stored result (results.js renderStageResult), in the page's words. ─────────

const RED = '#b91c1c';
const GREY = '#6b7280';
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const formKey = (f) => String(f ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// "I-765 · p.3, item 27 · I-765 page 3" says page 3 twice; keep the precise
// one. The same rule as the page's tidyWhere (results.js).
function tidyWhere(where) {
  const parts = String(where || '').split(' · ').filter(Boolean);
  return parts.filter((p) => {
    const m = p.match(/^(.+) page (\d+)$/);
    return !(m && parts.some((q) => q !== p && q.includes(`p.${m[2]}`)));
  }).join(' · ');
}

// The title says what is wrong (D-136): its first sentence; the rest is detail.
function firstSentence(s) {
  const text = String(s ?? '');
  const cut = headlineCut(text);
  return cut > 0 ? [text.slice(0, cut), text.slice(cut).trim()] : [text, null];
}

function detailRow(label, value, color = '#111') {
  if (value == null || value === '') return '';
  return `<tr>
      <td style="padding:2px 10px 2px 0;color:${GREY};font-size:12px;vertical-align:top">${esc(label)}</td>
      <td style="padding:2px 0;font-size:12px;color:${color};vertical-align:top">${esc(value)}</td>
    </tr>`;
}

// One problem, with the lines of its card on the page (results.js issueCard).
function issueItem(item) {
  let title = item.title;
  let rows = '';
  if (item.kind === 'fact') {
    const many = (item.on_forms || []).length > 1;
    for (const v of item.on_forms || []) {
      const label = many ? `${copyText('v21.on_forms')}: ${(v.forms || []).map((f) => f.form).join(', ')}` : copyText('v21.on_forms');
      rows += detailRow(label, v.value || copyText('review.blank'), RED);
    }
    for (const s of item.sources || []) {
      rows += detailRow(copyText('v21.on_sources', { sources: joinAnd((s.labels || []).map((l) => String(l).replace(/^the /, ''))) }), s.value);
    }
    if (item.fix_on?.length) rows += detailRow(copyText('v21.fix_on'), item.fix_on.map(({ form, n }) => (n > 1 ? `${form} ×${n}` : form)).join(', '));
  } else if (item.kind === 'document_difference') {
    title = firstSentence(item.title)[0];
    for (const d of item.documents || []) rows += detailRow(copyText('v21.on_sources', { sources: String(d.label || '').toLowerCase() }), d.value, RED);
  } else {
    const [head, rest] = firstSentence(item.title);
    title = head;
    rows += detailRow(copyText('v21.detail'), [rest, item.detail].filter(Boolean).join(' '));
    rows += detailRow(copyText('v21.expected'), item.expected);
    rows += detailRow(copyText('v21.where'), tidyWhere(item.where));
    // A one-word reason ("Observed.") says nothing the title did not.
    if (/\s/.test(String(item.reason || '').trim())) rows += detailRow(item.why_label || copyText('v21.why'), item.reason);
  }
  return `<li style="margin:0 0 14px;font-size:13px;color:#111;line-height:1.5">
      <span style="font-weight:600">${esc(String(title || '').replace(/\.$/, ''))}</span>
      ${rows ? `<table style="border-collapse:collapse;margin-top:4px">${rows}</table>` : ''}
    </li>`;
}

function issueSection(heading, items) {
  if (!items.length) return '';
  return `<p style="margin:22px 0 8px;font-size:13px;font-weight:700;color:#111">${esc(heading)}</p>
    <ol style="margin:0;padding-left:20px">${items.join('')}</ol>`;
}

// One form's count, as the page's fold counts it: a form whose only open
// items are needs-info is clean, but not "all passed".
function groupTally(g) {
  const open = g.outstanding.filter((o) => o.status === 'needs_attention').length;
  const unread = g.outstanding.filter((o) => o.status === 'not_checked').length;
  const base = g.passed === g.total
    ? (g.total === 1 ? copyText('v21.email.passed_one') : copyText('v21.email.passed_all', { n: g.total }))
    : g.clean ? copyText('v21.email.passed_soft', { a: g.passed, b: g.total - g.passed })
      : copyText('v21.email.passed_some', { a: g.passed, b: g.total });
  const extra = [
    open ? copyText(open === 1 ? 'v21.email.attention_one' : 'v21.email.attention_many', { n: open }) : '',
    unread ? copyText('v21.email.not_checked_n', { n: unread }) : '',
  ].filter(Boolean).join(', ');
  return `<span style="color:${g.clean ? '#374151' : '#111'}">${esc(base)}</span>${extra ? ` <span style="color:${RED}">· ${esc(extra)}</span>` : ''}`;
}

// Each document once, grouped the way the page groups them (evidenceRows in
// _proof-scan-v2-view.js): on file in Evidence Zero, or in the package.
function evidenceLine(result) {
  const docs = new Map();
  for (const e of result?.evidence_matches || []) {
    const k = `${e.evidence}|${e.source}|${e.evidence_where || ''}`;
    if (!docs.has(k)) docs.set(k, { inPackage: e.source === 'package', ok: true });
    if (!(e.ok || e.gentle)) docs.get(k).ok = false;
  }
  const part = (inPackage, key) => {
    const list = [...docs.values()].filter((d) => d.inPackage === inPackage);
    return list.length ? copyText(key, { a: list.filter((d) => d.ok).length, b: list.length }) : '';
  };
  const parts = [part(false, 'v21.email.evidence_on_file'), part(true, 'v21.email.evidence_in_package')].filter(Boolean);
  return parts.length ? copyText('v21.email.evidence', { parts: joinAnd(parts) }) : '';
}

// What passed: v1's PASS rows and page map in one table. Each form's checks
// with its pages, then the package-wide checks by name, then the evidence.
function whatPassed(view, result) {
  if (!view.groups.length) return '';
  const td = 'padding:5px 12px 5px 0;font-size:12px;vertical-align:top;border-top:1px solid #e5e7eb';
  const row = (name, pages, body) => `<tr><td style="${td};font-weight:600;white-space:nowrap">${esc(name)}</td>
      <td style="${td};color:${GREY}">${esc(pages)}</td><td style="${td}">${body}</td></tr>`;
  const found = result?.forms_found || [];
  const manyFiles = new Set(found.map((f) => f.file)).size > 1;
  const forms = view.groups.filter((g) => g.form).map((g) => {
    const mine = found.filter((f) => formKey(f.form) === formKey(g.form));
    const pages = manyFiles
      ? mine.filter((f) => f.pages).map((f) => `${f.file} p.${f.pages}`).join(', ')
      : (() => { const p = [...new Set(mine.map((f) => f.pages).filter(Boolean))]; return p.length ? `p.${p.join(', ')}` : ''; })();
    return row(mine.length > 1 ? `${g.form} ×${mine.length}` : g.form, pages, groupTally(g));
  }).join('');
  const whole = view.groups.find((g) => !g.form);
  let wholeRow = '';
  if (whole) {
    const passed = whole.rows.filter((r) => r.kind !== 'evidence' && (r.status === 'clear' || r.cleared))
      .map((r) => String(r.title || '').replace(/\.$/, ''));
    const evidence = evidenceLine(result);
    wholeRow = row(copyText('r12.package_group'), '', `${groupTally(whole)}
        ${passed.length ? `<div style="margin-top:3px;color:${GREY};line-height:1.5">${esc(passed.join(' · '))}</div>` : ''}
        ${evidence ? `<div style="margin-top:3px;color:${GREY}">${esc(evidence)}</div>` : ''}`);
  }
  return `<p style="margin:24px 0 2px;font-size:13px;font-weight:700;color:#111">${esc(copyText('v21.email.passed_heading'))}</p>
    <p style="margin:0 0 6px;font-size:11px;color:${GREY}">${esc(copyText('v21.email.passed_note'))}</p>
    <table style="border-collapse:collapse;width:100%">${forms}${wholeRow}</table>`;
}

export function buildProofScanStageEmail(result, { firmName, portalUrl, caseId, people } = {}) {
  const stageLabel = V2_STAGE_LABELS[result?.stage];
  const language = reportStateLanguage(result?.report_state, result?.attention_count);
  if (!stageLabel || !language || language !== result?.primary_report_language) return null;

  const names = caseLastNames(people);
  const subject = (names
    ? copyText('v202.email.subject', { names, stage: stageLabel, result: language })
    : copyText('v202.email.subject_unnamed', { stage: stageLabel, result: language })).slice(0, SUBJECT_LIMIT);
  const tone = TONE[result.report_state] || '#374151';
  const caseUrl = proofScanCaseUrl(portalUrl, caseId);
  // The email goes out as the run is stored, before anyone can clear an item,
  // so this is the page exactly as it first opens on this run.
  const view = reportView(result, [], {});
  const open = view.attention.filter((a) => !a.cleared);
  const notChecked = view.not_checked.filter((x) => !x.cleared);
  const clean = !open.length && !notChecked.length;
  const confirm = view.confirm.filter((x) => !x.cleared).length;
  const files = result.scan?.files || [];
  const fileLine = result.scope === 'individual' && result.form ? copyText('review.individual_file', { form: result.form })
    : files.length === 1 ? files[0].filename
      : files.length ? copyText('review.n_files', { n: files.length }) : '';
  const caseKind = [result.case_type_label, stageLabel].filter(Boolean).join(' · ');
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
    ${names ? `<p style="margin:0 0 2px;font-size:13px;color:#111">${esc(copyText('v202.email.case', { names }))}</p>` : ''}
    <p style="margin:0 0 2px;font-size:12px;color:${GREY}">${esc(caseKind)}</p>
    ${fileLine ? `<p style="margin:0 0 4px;font-size:12px;color:${GREY}">${esc(fileLine)}</p>` : ''}
  </div>
  <div style="padding:0 32px">
    ${clean ? `<p style="margin:12px 0 0;font-size:14px;color:#111">${esc(copyText('v202.email.good_to_go'))}</p>` : ''}
    ${issueSection(copyText('v21.needs_attention'), open.map(issueItem))}
    ${issueSection(copyText('r12.not_checked'), notChecked.map((c) => issueItem({
    kind: 'check', title: c.title, where: c.where, reason: c.reason, why_label: copyText('r12.why_not_checked'),
  })))}
    ${whatPassed(view, result)}
    ${confirm ? `<p style="margin:16px 0 0;font-size:12px;color:${GREY}">${esc(copyText(confirm === 1 ? 'v21.email.confirm_one' : 'v21.email.confirm_many', { n: confirm }))}</p>` : ''}
  </div>
  <div style="margin:24px 32px 0;padding:12px 16px;background:#f9fafb;border-left:3px solid #1a3a5c">
    <p style="margin:0;font-size:12px;color:#374151">${esc(STAFF_REVIEW_REMINDER)}</p>
  </div>
  ${caseUrl ? `<div style="padding:20px 32px 28px">
    <a href="${esc(caseUrl)}"
      style="display:inline-block;padding:11px 22px;background:#1a3a5c;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px"
    >${esc(copyText('v202.email.open_case'))}</a>
  </div>` : '<div style="padding:12px"></div>'}
  <div style="padding:14px 32px;background:#f9fafb;font-size:11px;color:#9ca3af;text-align:center">
    Secure notification from your client portal. Do not reply to this email.
  </div>
</div>
</body></html>`;
  return { subject, html };
}
