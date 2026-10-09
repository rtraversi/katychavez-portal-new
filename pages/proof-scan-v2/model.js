// model.js: pure shaping for the Proof Scan v2 page. No DOM, no fetch.
//
// The browser NEVER decides a result (D-18). The server has already chosen every
// status, every attention item, the count, the report state and its wording,
// and stored them. This module only decides where each stored piece is drawn
// and in what order, plus two things the browser must check for itself before
// a request is sent: the size limits (D-95) and the file types.
//
// Everything here is plain data in, plain data out, so it is tested without a
// browser (test/unit/proof-scan-v2-page.test.js).

export const STAGES = ['evidence_zero', 'draft_review', 'preflight', 'physical_scan'];
export const REVIEW_STAGES = ['draft_review', 'preflight', 'physical_scan'];
export const SCOPED_STAGES = new Set(['draft_review', 'preflight']);
export const CASE_TYPES = [
  { value: 'daca_renewal', label: 'DACA renewal' },
  { value: 'general', label: 'General' },
];

// ── Size limits and file types (D-95) ────────────────────────────────────────
// The same numbers the server enforces (_proof-scan-v2-http.js). The browser
// checks them first so staff hear about a large file before a long upload; the
// server stays the authority.

const MB = 1024 * 1024;
export const LIMITS = { fileBytes: 12 * MB, requestBytes: 22 * MB, maxFiles: 20, fileMb: 12, requestMb: 22 };

export const MEDIA_TYPES = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};

export function mediaTypeOf(file) {
  const type = String(file?.type || '').toLowerCase();
  if (MEDIA_TYPES[type]) return type;
  const ext = String(file?.name || '').toLowerCase().split('.').pop();
  return Object.keys(MEDIA_TYPES).find((k) => MEDIA_TYPES[k].includes(ext)) || null;
}

const mb = (bytes) => (bytes / MB).toFixed(1);

// Returns null when the files may be sent together, or { key, vars } naming the
// first problem (a copy key and its values). `already` are files already
// added to the same request.
export function checkFiles(files, already = []) {
  const all = [...already, ...files];
  if (all.length > LIMITS.maxFiles) return { key: 'limit.too_many', vars: { n: LIMITS.maxFiles } };
  for (const f of files) {
    if (!mediaTypeOf(f)) return { key: 'limit.wrong_type', vars: { name: f.name } };
    if (!f.size) return { key: 'limit.empty', vars: { name: f.name } };
    if (f.size > LIMITS.fileBytes) return { key: 'limit.file_too_big', vars: { name: f.name, mb: mb(f.size) } };
  }
  const total = all.reduce((sum, f) => sum + (f.size || 0), 0);
  if (total > LIMITS.requestBytes) return { key: 'limit.total_too_big', vars: { mb: mb(total) } };
  return null;
}

export const totalBytes = (files) => files.reduce((sum, f) => sum + (f.size || 0), 0);

// ── The case: tracker, gate, runs, sign-offs ─────────────────────────────────

// Newest run per stage. The server lists runs newest first.
export function latestRuns(runs = []) {
  const out = {};
  for (const r of runs) if (r?.stage && !out[r.stage]) out[r.stage] = r;
  return out;
}

export const isSignedOff = (view, stage) => (view?.signoffs || []).some((s) => s.stage === stage);
export const gateReady = (view) => Boolean(view?.evidence_requirement?.ready);
export const isGeneral = (view) => view?.case?.case_type === 'general';
export const mainPerson = (view) => (view?.people || []).find((p) => p.is_main) || view?.people?.[0] || null;

// One step of the tracker: done / attention / locked / todo. Read off the
// server's evidence requirement, the latest stored run and the sign-offs.
export function stepState(view, stage) {
  const ready = gateReady(view);
  if (stage === 'evidence_zero') {
    // General: Evidence Zero is optional (D-95); done once anything is in it.
    if (isGeneral(view)) {
      const any = (view.documents || []).some((d) => d.status !== 'replaced') || (view.people || []).some((p) => p.approved_at);
      return any ? 'done' : 'todo';
    }
    return ready ? 'done' : 'todo';
  }
  if (!ready) return 'locked';
  if (isSignedOff(view, stage)) return 'done';
  const run = latestRuns(view.runs)[stage];
  if (!run) return 'todo';
  if (run.report_state === 'no_issues_found') return 'done';
  return 'attention';
}

export function statusKey(view, stage, state, current) {
  if (current === stage) return 'track.current';
  if (stage === 'preflight' && state === 'todo') return 'track.optional';
  if (stage === 'evidence_zero' && state === 'todo' && isGeneral(view)) return 'track.optional';
  if (state === 'done' && isSignedOff(view, stage)) return 'track.signed';
  return `track.${state}`;
}

// ── People ───────────────────────────────────────────────────────────────────

export const ADDRESS_PARTS = ['street', 'apt_type', 'apt_number', 'city', 'state', 'zip', 'in_care_of', 'province', 'postal_code', 'country'];
// D-100: the other per-person facts the form maps fill. Like the D-82 address
// parts, they appear only when a document, form or scan carried them.
export const EXTRA_FIELDS = ['uscis_account_number', 'country_of_birth', 'country_of_citizenship', 'i94_number',
  'i94_expiration', 'last_entry_date', 'port_of_entry', 'employer', 'marriage_date', 'marriage_place'];
export const OPTIONAL_FIELDS = new Set(['in_care_of', 'province', 'postal_code', 'country', ...EXTRA_FIELDS]);
export const DATE_FIELDS = new Set(['date_of_birth', 'ead_expiration', 'marriage_date', 'i94_expiration', 'last_entry_date', 'expiration_date']);

// The reference record, in the Lab's groups and order (D-12, D-64, D-82).
export const FIELD_GROUPS = [
  ['name', ['first_name', 'middle_name', 'last_name']],
  ['address', ['street', 'apt_type', 'apt_number', 'city', 'state', 'zip', 'in_care_of', 'province', 'postal_code', 'country']],
  ['identity', ['date_of_birth', 'a_number', 'ead_expiration', 'ssn']],
  ['contact', ['phone', 'email']],
  ['immigration', ['uscis_account_number', 'country_of_birth', 'country_of_citizenship', 'i94_number', 'i94_expiration', 'last_entry_date', 'port_of_entry']],
  ['work', ['employer']],
  ['marriage', ['marriage_date', 'marriage_place']],
];

export const fullName = (p) => [p?.first_name, p?.middle_name, p?.last_name].filter((v) => v && String(v).trim()).join(' ');

// G-28 Part 3 item 12 order (D-64): street, Apt./Ste./Flr. number, city, state ZIP.
export function formatAddress(f = {}) {
  const apt = f.apt_number ? `${f.apt_type || ''} ${f.apt_number}`.trim() : '';
  const stateZip = [f.state, f.zip].filter(Boolean).join(' ');
  const careOf = f.in_care_of ? `c/o ${f.in_care_of}` : '';
  return [careOf, f.street, apt, f.city, stateZip, f.province, f.postal_code, f.country].filter(Boolean).join(', ');
}

// Where a value came from, as the Lab's coloured dot names it.
export function sourceKind(person, field) {
  const value = field === 'ssn' ? person?.has_ssn : person?.[field];
  if (!value) return 'none';
  const src = person?.field_sources?.[field];
  if (!src) return 'staff';
  if (src.kind === 'scan' || src.kind === 'forms' || src.kind === 'staff') return src.kind;
  if (src.kind === 'document') return /\bEAD\b/i.test(src.label || '') ? 'ead' : /intake/i.test(src.label || '') ? 'intake' : 'doc';
  return 'staff';
}

// Optional address parts appear only when a value or a suggestion carries one (D-82).
export function visibleFields(person, suggestions = []) {
  return FIELD_GROUPS.map(([group, fields]) => [group, fields.filter((f) => !OPTIONAL_FIELDS.has(f)
    || person?.[f] || suggestions.some((s) => s.person_id === person?.id && s.field === f))])
    .filter(([, fields]) => fields.length);
}

export const suggestionsFor = (view, person) => (view?.suggestions || []).filter((s) => s.person_id === person.id);

// ── Documents (Evidence Zero cards) ──────────────────────────────────────────

export const DOC_TYPE_SETS = {
  daca_renewal: ['ead', 'intake', 'other'],
  general: ['birth_certificate', 'marriage_certificate', 'passport', 'i94', 'green_card', 'other'],
};

// Documents shown in the workspace. A replaced card has done its job (D-55).
export const workspaceDocuments = (view) => (view?.documents || []).filter((d) => d.status !== 'replaced');

// The case-relevant facts a card shows (D-53). An EAD always shows its four,
// even when one is not on the document; other cards show what they carry.
const EAD_FACTS = ['name', 'date_of_birth', 'a_number', 'ead_expiration'];
const OTHER_FACTS = ['name', 'date_of_birth', 'a_number', 'ead_expiration', 'expiration_date', 'address', 'phone', 'email', 'ssn', ...EXTRA_FIELDS];
export function docFactKeys(docRow) {
  const f = docRow?.facts || {};
  if (docRow?.doc_type === 'ead') return EAD_FACTS;
  const has = (k) => (k === 'name' ? Boolean(fullName(f)) : k === 'address' ? Boolean(f.street || f.city) : Boolean(f[k]));
  const unreadable = new Set(docRow?.unreadable_fields || []);
  return OTHER_FACTS.filter((k) => has(k) || unreadable.has(k));
}

export function docFactValue(docRow, key) {
  const f = docRow?.facts || {};
  if (key === 'name') return fullName(f);
  if (key === 'address') return formatAddress(f);
  if (key === 'a_number') return f.a_number ? `A-${String(f.a_number).replace(/\D/g, '')}` : '';
  if (DATE_FIELDS.has(key)) return f[key] ? toUsDate(f[key]) : '';
  return f[key] || '';
}

export function docFactUnreadable(docRow, key) {
  const u = new Set(docRow?.unreadable_fields || []);
  if (key === 'name') return ['first_name', 'last_name', 'middle_name'].some((k) => u.has(k));
  if (key === 'address') return ['street', 'city', 'state', 'zip'].some((k) => u.has(k));
  return u.has(key);
}

export function toUsDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(v || '');
}

// ── Stored results: where each piece is drawn ────────────────────────────────

const byKind = (result, ...kinds) => (result?.attention || []).filter((a) => kinds.includes(a.kind));
const formKey = (f) => String(f ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function verdictTone(state) {
  return state === 'items_need_attention' ? 'attention' : state === 'review_incomplete' ? 'incomplete' : 'clear';
}

// Evidence-against-forms rows grouped by document, so a clean match shows too (D-98).
export function matchGroups(rows = []) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.evidence}|${(r.owner_roles || []).join(',')}|${r.source}`;
    if (!groups.has(key)) groups.set(key, { evidence: r.evidence, owner_roles: r.owner_roles || [], source: r.source, rows: [] });
    groups.get(key).rows.push(r);
  }
  return [...groups.values()].map((g) => ({ ...g, ok: g.rows.every((r) => r.ok) }));
}

// The order forms are listed in: the package definition first, then as found.
function formOrder(result) {
  const order = [];
  for (const i of result?.package_items || []) if (i.form && !order.includes(i.form)) order.push(i.form);
  for (const f of result?.forms_found || []) if (f.form && !order.includes(f.form)) order.push(f.form);
  return order;
}

function groupChecks(checks, order) {
  const groups = new Map();
  for (const c of checks) {
    const k = c.form || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const rank = (form) => {
    if (!form) return order.length + 1;
    const i = order.findIndex((f) => formKey(f) === formKey(form));
    return i < 0 ? order.length : i;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([form, items]) => ({ form, items }));
}

// Draft Review and Pre-flight: the Lab's sections, filled from the stored result.
export function reviewModel(result) {
  const checks = result?.checks || [];
  const byRule = new Map(checks.map((c) => [c.rule_id, c]));
  const attentionChecks = byKind(result, 'check').map((a) => ({ ...byRule.get(a.rule_id), ...a }));
  const listed = checks.filter((c) => !c.counted_by_items);
  const order = formOrder(result);
  return {
    header: {
      files: (result?.scan?.files || []).map((f) => f.filename),
      case_type_label: result?.case_type_label || '',
      stage: result?.stage,
      stage_label: result?.stage_label || '',
      scope: result?.scope || null,
      form: result?.form || null,
      tone: verdictTone(result?.report_state),
      phrase: result?.primary_report_language || '',
      reminder: result?.staff_review_reminder || '',
      scanned_at: result?.scan?.scanned_at || null,
    },
    attention_count: result?.attention_count ?? 0,
    evidence_differences: byKind(result, 'evidence_difference'),
    matches: matchGroups(result?.evidence_matches),
    corrections: Array.isArray(result?.corrections) ? result.corrections : null,
    correction_items: byKind(result, 'correction'),
    our: {
      consistency: attentionChecks.filter((c) => c.consistency),
      differences: byKind(result, 'reference_difference'),
      not_carried: byKind(result, 'not_carried'),
      // D-100 #1: a fact two forms about the same person disagree on.
      form_differences: byKind(result, 'form_difference'),
      fold: listed.filter((c) => c.consistency),
    },
    checklist: {
      missing: byKind(result, 'missing_item'),
      // D-100 #6: foreign-language evidence without a translation.
      translations: byKind(result, 'translation'),
      attention: attentionChecks.filter((c) => !c.consistency),
      groups: groupChecks(listed.filter((c) => !c.consistency), order),
    },
    needs_info: {
      notes: (result?.notes || []).filter((n) => n.kind === 'needs_info'),
      checks: checks.filter((c) => c.status === 'needs_info'),
    },
    confirm: checks.filter((c) => c.status === 'please_confirm'),
    awareness: (result?.notes || []).filter((n) => n.kind === 'no_reference' || n.kind === 'never_added'),
    later: result?.later || [],
    not_this_stage_count: result?.not_this_stage_count || 0,
    not_checked: [
      ...checks.filter((c) => c.status === 'not_checked'),
      ...(result?.package_items || []).filter((i) => i.status === 'unreadable')
        .map((i) => ({ rule_id: `item:${i.item_id}`, status: 'not_checked', form: i.form, title: `${i.form}${i.instance ? ` (${i.instance})` : ''} could not be read.`, where: (i.locations || []).join(' · ') })),
    ],
    case_card_differences: byKind(result, 'case_card_difference'),
    forms_found: formsFound(result),
  };
}

// D-100 #3: every form found, its pages and whose it is. Information only.
export function formsFound(result) {
  return (result?.forms_found || []).map((f) => ({ form: f.form, file: f.file || '', pages: f.pages || '', person_role: f.person_role || null }));
}

// Physical Scan: the stored result in the shape pages/proof-scan/report.js draws
// (the v1.2 report-model shape), with no client block (D-89). Differences from
// the case card lead, then evidence against forms, then the rest, in the
// server's order. Every attention item is drawn exactly once.
export function physicalScanReport(result) {
  const checks = result?.checks || [];
  const byRule = new Map(checks.map((c) => [c.rule_id, c]));
  const attention = result?.attention || [];
  const rank = (a) => (a.kind === 'case_card_difference' ? 0 : a.kind === 'evidence_difference' ? 1 : 2);
  const ordered = attention.map((a, i) => [a, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([a]) => a);
  const whereOf = (c) => [c?.form, c?.where, ...(c?.locations || [])].filter(Boolean).join(' · ') || null;

  const needsAttention = ordered.map((a) => {
    const c = a.rule_id ? byRule.get(a.rule_id) : null;
    return {
      kind: a.kind,
      id: a.key,
      status: 'needs_attention',
      severity: c?.severity || null,
      headline: a.title,
      expected: c?.expected || null,
      where: c ? whereOf(c) : (a.forms || [a.form]).filter(Boolean).join(' · ') || null,
      reason: c?.reason || null,
      evidence: c?.evidence || null,
      blocked: [],
    };
  });

  const notChecked = [
    ...checks.filter((c) => c.status === 'not_checked').map((c) => ({
      kind: 'rule', id: c.rule_id, status: 'not_checked', severity: null, headline: c.title,
      expected: c.expected || null, where: whereOf(c), reason: c.reason || null, evidence: c.evidence || null, blocked: [],
    })),
    ...(result?.package_items || []).filter((i) => i.status === 'unreadable').map((i) => ({
      kind: 'package_item', id: i.item_id, status: 'not_checked', severity: null,
      headline: `${i.form}${i.instance ? ` ${i.instance}` : ''} could not be read.`, expected: i.label || null,
      where: (i.locations || []).join(' · ') || null, reason: null, evidence: null, blocked: [],
    })),
  ];

  const included = (result?.package_items || []).map((i) => ({
    item_id: i.item_id, form: i.form, instance: i.instance || null, label: i.label,
    status: i.status === 'present' ? 'clear' : i.status === 'unreadable' ? 'not_checked' : 'needs_attention',
    ok: i.status === 'present',
  }));

  const order = formOrder(result);
  const groups = groupChecks(checks.filter((c) => !c.counted_by_items), order).map(({ form, items }) => {
    const rows = items.map((c) => ({ rule_id: c.rule_id, status: c.status, line: c.title, where: c.where || null, suppressed: false }));
    return {
      form: form || 'Whole package',
      items: rows,
      cleared: rows.filter((r) => r.status === 'clear').length,
      total: rows.length,
      outstanding: rows.filter((r) => r.status !== 'clear'),
    };
  });

  return {
    scan: {
      filename: (result?.scan?.files || []).map((f) => f.filename).join(', ') || 'Package',
      scanned_at: result?.scan?.scanned_at || null,
    },
    scan_type_label: [result?.case_type_label, result?.stage_label].filter(Boolean).join(' · '),
    report_state: result?.report_state || null,
    primary_report_language: result?.primary_report_language || '',
    attention_count: needsAttention.length,
    client: { primary: [], secondary: [] },
    needs_attention: needsAttention,
    included,
    groups,
    not_checked: notChecked,
  };
}

// General Physical Scan: who the package is about, their forms and their
// evidence, read off the stored result (D-94, D-95, D-99).
export function peopleInPackage(result) {
  const roles = [];
  const add = (r) => { if (r && !roles.includes(r)) roles.push(r); };
  for (const f of result?.forms_found || []) add(f.person_role);
  for (const m of result?.evidence_matches || []) (m.owner_roles || []).forEach(add);
  const newCards = new Set(result?.new_cards || []);
  return roles.map((role) => {
    const forms = (result?.forms_found || []).filter((f) => f.person_role === role);
    const first = forms[0]?.values || {};
    const evidence = [];
    for (const g of matchGroups(result?.evidence_matches)) {
      if (!g.owner_roles.includes(role)) continue;
      if (!evidence.some((e) => e.label === g.evidence)) evidence.push({ label: g.evidence, shared: g.owner_roles.length > 1 });
    }
    return {
      role,
      is_new: newCards.has(role),
      name: fullName(first),
      date_of_birth: first.date_of_birth || '',
      a_number: first.a_number || '',
      forms: [...new Set(forms.map((f) => f.form))],
      evidence,
    };
  });
}

// What the optional email said (D-61): the official stage result and a link.
export function emailOutcome(response) {
  if (!response?.stored) return null;
  if (response.notification_attempted && response.notification_sent) return 'email.sent';
  if (response.notification_attempted) return 'email.not_sent';
  return 'email.no_address';
}
