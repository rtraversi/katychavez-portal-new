// report-model.js — pure shaping for the Proof Scan report. No DOM, no fetch.
//
// The server has already validated the model's observations, composed them onto
// the profile's configuration, and derived the report state. Nothing here
// re-derives any of that: this module only decides what goes in which section and
// in what order, so the rules that matter (missing-form suppression, counts, the
// SSN mask, omitting empty fields) can be tested without a browser.
//
// Everything it returns is data. `report.js` turns it into DOM text nodes.

export const MAX_PDF_BYTES = 12 * 1024 * 1024;   // mirrors PROOF_SCAN_MAX_PDF_BYTES
const MAX_PDF_MB = Math.floor(MAX_PDF_BYTES / (1024 * 1024));

// The one configured scan type. `value` is what the API receives; `label` is what
// staff read. Staff pick this explicitly — it is never inferred from the file.
export const SCAN_TYPES = [
  { value: 'daca_renewal', label: 'DACA renewal' },
];

// Whole-package checks — rules the profile gives no form — group under this head.
export const PACKAGE_GROUP_LABEL = 'Whole package';

// ── Client-side file guard ───────────────────────────────────────────────────
//
// A courtesy so staff hear about an obviously wrong file before a multi-megabyte
// base64 read. The server boundary is authoritative and re-checks all of it.
export function checkSelectedFile(file) {
  if (!file) return 'Choose a PDF to scan.';
  const isPdf = /\.pdf$/i.test(file.name || '')
    || file.type === 'application/pdf';
  if (!isPdf) return 'That is not a PDF. Proof Scan reads PDF packages only.';
  if (!file.size) return 'That file is empty. Choose the assembled PDF package.';
  if (file.size > MAX_PDF_BYTES) {
    return `That PDF is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${MAX_PDF_MB} MB.`;
  }
  return null;
}

// ── Request failures ─────────────────────────────────────────────────────────
//
// One place that decides what staff are told, so no branch can accidentally
// report a failed scan as anything reassuring.
export function scanErrorMessage(status, body) {
  const fromServer = body && typeof body.error === 'string' ? body.error : '';
  if (status === 400) return fromServer || 'That request was rejected. Check the scan type and the file.';
  if (status === 401 || status === 403) return 'Your session is not authorised to run a scan. Sign in again.';
  if (status === 413) return `That PDF is too large. The limit is ${MAX_PDF_MB} MB.`;
  if (status === 500) return fromServer || 'The scan could not start. Nothing was saved.';
  if (status === 502 || status === 503) {
    return fromServer || 'The scan could not be completed. Nothing was saved. Please try again.';
  }
  return fromServer || `The scan failed (HTTP ${status}). Nothing was saved.`;
}

// ── Client summary ───────────────────────────────────────────────────────────

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// The only SSN representation that exists anywhere in this pipeline is the last
// four digits. Anything else is dropped rather than displayed.
export function maskSsn(last4) {
  return /^\d{4}$/.test(String(last4 ?? '')) ? `•••-••-${last4}` : null;
}

// Identity facts, always shown — an em dash carries "the package did not say".
export function primaryClientFacts(observed, scanTypeLabel) {
  const c = observed || {};
  return [
    { key: 'Client', value: text(c.name) || '—' },
    { key: 'A-Number', value: text(c.a_number) || '—' },
    { key: 'EAD expires', value: text(c.ead_expires) || '—' },
    { key: 'Case', value: scanTypeLabel || '—' },
  ];
}

// Contact facts, omitted entirely when the package did not carry them.
export function secondaryClientFacts(observed) {
  const c = observed || {};
  return [
    { key: 'Date of birth', value: text(c.date_of_birth), modifier: 'dob' },
    { key: 'SSN', value: maskSsn(c.ssn_last4), modifier: 'ssn' },
    { key: 'USCIS account', value: text(c.uscis_account_number), modifier: 'uscis' },
    { key: 'Phone', value: text(c.phone), modifier: 'phone' },
    { key: 'Email', value: text(c.email), modifier: 'email' },
    { key: 'Address', value: text(c.address), modifier: 'address' },
  ].filter((fact) => fact.value !== null);
}

// ── Report shaping ───────────────────────────────────────────────────────────

const isSuppressed = (rule) => Boolean(rule.suppressed_by_package_item_ids?.length);

function packageItemName(item) {
  return item.instance ? `${item.form} ${item.instance}` : item.form;
}

// What a row says. A cleared check states the profile's pass_text; anything else
// leads with what the model actually observed, falling back to the rule's title.
function checkLine(rule) {
  if (rule.status === 'clear') return text(rule.pass_text) || rule.title;
  return text(rule.summary) || rule.title;
}

// Page/item locator. A one-page form has nothing useful to say with "p.1".
function checkWhere(rule, singlePageForms) {
  const parts = [];
  if (rule.page != null && !singlePageForms.has(rule.form)) parts.push(`p.${rule.page}`);
  if (rule.item) parts.push(`item ${rule.item}`);
  return parts.join(' · ');
}

function notice(entry) {
  return {
    kind: entry.kind,
    id: entry.id,
    status: entry.status,
    severity: entry.severity || null,
    headline: entry.headline,
    expected: entry.expected || null,
    where: entry.where || null,
    reason: entry.reason || null,
    evidence: entry.evidence || null,
    blocked: entry.blocked || [],
  };
}

export function buildReportModel(result) {
  const packageItems = Array.isArray(result?.package_items) ? result.package_items : [];
  const ruleResults = Array.isArray(result?.rule_results) ? result.rule_results : [];
  const scanTypeLabel = result?.profile_label
    || SCAN_TYPES.find((t) => t.value === result?.scan_profile)?.label
    || null;

  const itemsById = new Map(packageItems.map((item) => [item.item_id, item]));
  const singlePageForms = new Set(packageItems.filter((i) => (i.pages || 1) === 1).map((i) => i.form));

  // Which suppressed rules hang off each missing package item. These are the
  // checks that could not run because the form itself is absent — they belong to
  // that one actionable issue, never to a headline or count of their own.
  const suppressedByItem = new Map();
  for (const rule of ruleResults) {
    if (!isSuppressed(rule)) continue;
    for (const itemId of rule.suppressed_by_package_item_ids) {
      if (!suppressedByItem.has(itemId)) suppressedByItem.set(itemId, []);
      suppressedByItem.get(itemId).push({ rule_id: rule.rule_id, title: rule.title });
    }
  }

  // ── Needs attention, in the server's order: missing forms, then failed checks.
  const needsAttention = [];
  for (const item of packageItems) {
    if (item.status !== 'needs_attention') continue;
    needsAttention.push(notice({
      kind: 'package_item',
      id: item.item_id,
      status: 'needs_attention',
      headline: `${packageItemName(item)} is not in the package.`,
      expected: item.label,
      reason: text(item.reason),
      evidence: text(item.evidence),
      where: (item.locations || []).join(' · ') || null,
      blocked: suppressedByItem.get(item.item_id) || [],
    }));
  }
  for (const rule of ruleResults) {
    if (rule.status !== 'needs_attention') continue;
    needsAttention.push(notice({
      kind: 'rule',
      id: rule.rule_id,
      status: 'needs_attention',
      severity: rule.severity,
      headline: checkLine(rule),
      expected: text(rule.expected),
      where: [rule.form, checkWhere(rule, singlePageForms), ...(rule.locations || [])]
        .filter(Boolean).join(' · ') || null,
      reason: text(rule.reason),
      evidence: text(rule.evidence),
    }));
  }

  // ── Not checked. Suppressed rules are deliberately absent: they are already
  // accounted for inside the missing package item that blocked them.
  const notChecked = [];
  for (const item of packageItems) {
    if (item.status !== 'not_checked') continue;
    notChecked.push(notice({
      kind: 'package_item',
      id: item.item_id,
      status: 'not_checked',
      headline: `${packageItemName(item)} could not be read.`,
      expected: item.label,
      reason: text(item.reason),
      evidence: text(item.evidence),
      where: (item.locations || []).join(' · ') || null,
    }));
  }
  for (const rule of ruleResults) {
    if (rule.status !== 'not_checked' || isSuppressed(rule)) continue;
    notChecked.push(notice({
      kind: 'rule',
      id: rule.rule_id,
      status: 'not_checked',
      headline: checkLine(rule),
      expected: text(rule.expected),
      where: [rule.form, checkWhere(rule, singlePageForms), ...(rule.locations || [])]
        .filter(Boolean).join(' · ') || null,
      reason: text(rule.reason),
      evidence: text(rule.evidence),
    }));
  }

  // ── Included in the scan: one row per configured package item, server order.
  const included = packageItems.map((item) => ({
    item_id: item.item_id,
    form: item.form,
    instance: item.instance || null,
    label: item.label,
    status: item.status,
    ok: item.status === 'clear',
  }));

  // ── Checks grouped by form, forms in the order the package is assembled.
  const formOrder = [];
  for (const item of packageItems) if (!formOrder.includes(item.form)) formOrder.push(item.form);

  const byForm = new Map();
  for (const rule of ruleResults) {
    const key = rule.form || PACKAGE_GROUP_LABEL;
    if (!byForm.has(key)) byForm.set(key, []);
    byForm.get(key).push({
      rule_id: rule.rule_id,
      status: rule.status,
      line: checkLine(rule),
      where: checkWhere(rule, singlePageForms) || null,
      suppressed: isSuppressed(rule),
    });
  }

  const rank = (form) => {
    if (form === PACKAGE_GROUP_LABEL) return formOrder.length + 1;
    const i = formOrder.indexOf(form);
    return i < 0 ? formOrder.length : i;
  };
  const groups = [...byForm.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([form, items]) => ({
      form,
      items,
      cleared: items.filter((i) => i.status === 'clear').length,
      total: items.length,
      outstanding: items.filter((i) => i.status !== 'clear'),
    }));

  return {
    scan: {
      filename: result?.scan?.filename || 'Untitled package',
      scanned_at: result?.scan?.scanned_at || null,
    },
    scan_type_label: scanTypeLabel,
    report_state: result?.report_state || null,
    // Server-derived language. The renderer never composes a verdict of its own.
    primary_report_language: result?.primary_report_language || '',
    attention_count: needsAttention.length,
    client: {
      primary: primaryClientFacts(result?.client_observed, scanTypeLabel),
      secondary: secondaryClientFacts(result?.client_observed),
    },
    needs_attention: needsAttention,
    included,
    groups,
    not_checked: notChecked,
  };
}
