// _proof-scan-v2-common.js: shared pure helpers for Proof Scan v2. NOT a route.
//
// No Worker, database, model or DOM dependency. Everything here is a plain
// function over plain data so the decisions it encodes can be unit tested.
// Decision references (D-n, Q-n, N-n) point at the master record,
// Anobe/proof-scan-lab/PROOF-SCAN.md.

export const CASE_TYPES = ['daca_renewal', 'general'];
export const CASE_TYPE_LABELS = { daca_renewal: 'DACA renewal', general: 'General' };

// Evidence Zero is a workspace, not a check stage (D-53); runs happen in these.
export const REVIEW_STAGES = ['draft_review', 'preflight', 'physical_scan'];
export const STAGE_LABELS = {
  evidence_zero: 'Evidence Zero',
  draft_review: 'Draft Review',
  preflight: 'Pre-flight',
  physical_scan: 'Physical Scan',
};
// D-56: individual / whole applies to Draft Review and Pre-flight only.
export const SCOPED_STAGES = new Set(['draft_review', 'preflight']);

export const ROLES = ['applicant', 'beneficiary', 'petitioner', 'sponsor', 'joint_sponsor', 'household_member'];
export const ROLE_LABELS = {
  applicant: 'Applicant', beneficiary: 'Beneficiary', petitioner: 'Petitioner',
  sponsor: 'Sponsor', joint_sponsor: 'Joint sponsor', household_member: 'Household member',
};
// Roles that may appear more than once on a case. Everyone else is one card per
// role, as in the Lab.
export const REPEATABLE_ROLES = new Set(['household_member']);

// The reference record, in the Lab's order (D-12, D-64, D-82). SSN is handled
// separately: it is never a plain column (D-80).
export const REFERENCE_FIELDS = [
  'first_name', 'middle_name', 'last_name',
  'street', 'apt_type', 'apt_number', 'city', 'state', 'zip',
  'in_care_of', 'province', 'postal_code', 'country',
  'date_of_birth', 'a_number', 'ead_expiration',
  'phone', 'email',
];
export const OPTIONAL_FIELDS = new Set(['in_care_of', 'province', 'postal_code', 'country']); // D-82
export const NAME_FIELDS = ['first_name', 'middle_name', 'last_name'];
export const ADDRESS_FIELDS = ['street', 'apt_type', 'apt_number', 'city', 'state', 'zip',
  'in_care_of', 'province', 'postal_code', 'country'];
export const DATE_FIELDS = new Set(['date_of_birth', 'ead_expiration', 'marriage_date']);
export const APT_TYPES = ['Apt.', 'Ste.', 'Flr.'];

export const FIELD_LABELS = {
  first_name: 'first name', middle_name: 'middle name', last_name: 'last name',
  street: 'street', apt_type: 'Apt./Ste./Flr.', apt_number: 'unit number', city: 'city',
  state: 'state', zip: 'ZIP code', in_care_of: 'In Care Of name', province: 'province',
  postal_code: 'postal code', country: 'country', date_of_birth: 'date of birth',
  a_number: 'A-Number', ead_expiration: 'EAD expiration date', phone: 'phone', email: 'email',
  ssn: 'Social Security number', marriage_date: 'marriage date', name: 'name', address: 'address',
};

// Document types Evidence Zero may identify. Only the Lab's own set; no new
// evidence categories are invented here (D-55, rule 4 of the continuation
// protocol).
export const DOC_TYPES = ['ead', 'intake', 'birth_certificate', 'marriage_certificate', 'other'];
export const DOC_TYPE_LABELS = {
  ead: 'EAD', intake: 'Intake', birth_certificate: 'Birth certificate',
  marriage_certificate: 'Marriage certificate', other: 'Other document',
};

// ── Normalising ──────────────────────────────────────────────────────────────

export const digits = (v) => String(v ?? '').replace(/\D/g, '');
export const normText = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isBlank = (v) => v == null || String(v).trim() === '';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

function isoDate(y, m, d) {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Dates as printed on USCIS forms and US documents. Returns YYYY-MM-DD or null.
// US order (month first) for slashed dates, which is how every form here prints.
export function normalizeDate(value) {
  if (isBlank(value)) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return isoDate(+m[3], +m[1], +m[2]);
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase()));
    if (month >= 0) return isoDate(+m[3], month + 1, +m[2]);
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m[2].toLowerCase()));
    if (month >= 0) return isoDate(+m[3], month + 1, +m[1]);
  }
  return null;
}

// A-Numbers: "A-123-456-789", "A123456789" and "123456789" are one number (N-016).
export function normalizeANumber(value) {
  const d = digits(value);
  return d.length >= 7 && d.length <= 9 ? d : null;
}

export function normalizeAptType(value) {
  const v = normText(value);
  if (!v) return null;
  if (/^(apt|apartment)$/.test(v)) return 'Apt.';
  if (/^(ste|suite)$/.test(v)) return 'Ste.';
  if (/^(flr|fl|floor)$/.test(v)) return 'Flr.';
  return null;
}

// Turn a value as printed into what the reference-record column stores.
// Returns { value } or { invalid: true } when it cannot be stored safely.
export function toCardValue(field, raw) {
  if (isBlank(raw)) return { value: null };
  const text = String(raw).trim().replace(/\s+/g, ' ');
  if (DATE_FIELDS.has(field)) {
    const d = normalizeDate(text);
    return d ? { value: d } : { invalid: true };
  }
  if (field === 'a_number') {
    const a = normalizeANumber(text);
    return a ? { value: a } : { invalid: true };
  }
  if (field === 'apt_type') {
    const t = normalizeAptType(text);
    return t ? { value: t } : { invalid: true };
  }
  return { value: text.slice(0, 300) };
}

// Comparison only, never storage. A-Number, phone and SSN compare by digits
// (N-016); dates compare as dates whatever their printed format; everything else
// ignores case, spacing and punctuation.
export function sameValue(field, a, b) {
  if (field === 'a_number' || field === 'phone' || field === 'ssn' || field === 'zip') {
    return digits(a) === digits(b);
  }
  if (DATE_FIELDS.has(field)) {
    const da = normalizeDate(a);
    const db = normalizeDate(b);
    if (da && db) return da === db;
  }
  if (field === 'apt_type') {
    const ta = normalizeAptType(a);
    const tb = normalizeAptType(b);
    if (ta && tb) return ta === tb;
  }
  return normText(a) === normText(b);
}

// D-89: "RIVERA, ANA M." and "ANA MARIA RIVERA" are the same name. Same last and
// first name, and a middle initial that matches the middle name.
export function sameName(scanned, card) {
  const last = normText(scanned.last_name);
  const first = normText(scanned.first_name);
  if (!last || last !== normText(card.last_name) || first !== normText(card.first_name)) return false;
  const mid = normText(scanned.middle_name);
  const cardMid = normText(card.middle_name);
  return !mid || !cardMid || cardMid.startsWith(mid) || mid.startsWith(cardMid);
}

// ── Display ──────────────────────────────────────────────────────────────────

export function formatDate(value) {
  const iso = normalizeDate(value);
  if (!iso) return String(value ?? '');
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

export function formatName(p) {
  return [p.first_name, p.middle_name, p.last_name].filter((v) => !isBlank(v)).join(' ');
}

// G-28 Part 3 item 12 order (D-64): street, Apt./Ste./Flr. number, city, state ZIP.
export function formatAddress(f) {
  const apt = f.apt_number ? `${f.apt_type || ''} ${f.apt_number}`.trim() : '';
  const stateZip = [f.state, f.zip].filter((v) => !isBlank(v)).join(' ');
  const careOf = f.in_care_of ? `c/o ${f.in_care_of}` : '';
  return [careOf, f.street, apt, f.city, stateZip, f.province, f.postal_code, f.country]
    .filter((v) => !isBlank(v)).join(', ');
}

export function displayValue(field, value) {
  if (isBlank(value)) return '';
  if (DATE_FIELDS.has(field)) return formatDate(value);
  if (field === 'a_number') return `A-${digits(value)}`;
  if (field === 'ssn') return maskSsn(digits(value).slice(-4));
  return String(value);
}

export const maskSsn = (last4) => (last4 ? `***-**-${last4}` : '');

// ── SSN handling (D-80, D-97) ────────────────────────────────────────────────

export function ssnDigits(value) {
  const d = digits(value);
  return d.length === 9 ? d : null;
}

// Free text from the model never carries a full SSN into storage. Formatted
// SSNs and bare nine-digit runs are masked to their last four. "A123456789" is
// left alone: it is an A-Number, and the letter is what tells them apart.
export function redactSsn(text) {
  if (text == null) return text;
  return String(text)
    .replace(/(^|[^A-Za-z0-9])(\d{3})[- ](\d{2})[- ](\d{4})(?!\d)/g, (_, pre, _a, _b, last) => `${pre}***-**-${last}`)
    .replace(/(^|[^A-Za-z0-9])\d{5}(\d{4})(?!\d)/g, (_, pre, last) => `${pre}***-**-${last}`);
}

// ── People ───────────────────────────────────────────────────────────────────

// What leaves the server for a person. The encrypted SSN never does; the full
// number is only ever returned by the audited reveal route.
export function publicPerson(row) {
  if (!row) return null;
  const { ssn_encrypted, ...rest } = row;
  return {
    ...rest,
    has_ssn: Boolean(ssn_encrypted),
    ssn_masked: maskSsn(row.ssn_last4),
  };
}

export function publicSuggestion(row) {
  if (!row) return null;
  const { value_encrypted, ...rest } = row;
  if (row.field === 'ssn') return { ...rest, value: maskSsn(row.value_last4), has_encrypted_value: Boolean(value_encrypted) };
  return rest;
}

const sourceKind = (person, field) => person?.field_sources?.[field]?.kind || null;

// D-79, D-99: values copied from draft forms are shown on the card but are never
// the truth the forms are checked against. Neither are values the Physical Scan
// itself filled in from the package it is checking (D-95).
export function truthValue(person, field) {
  if (!person) return null;
  const kind = sourceKind(person, field);
  if (kind === 'forms' || kind === 'scan') return null;
  const v = person[field];
  return isBlank(v) ? null : v;
}

export function mainPerson(people) {
  return people.find((p) => p.is_main) || people[0] || null;
}

// ── Evidence requirement (D-74, D-91, D-95) ──────────────────────────────────
// DACA: an EAD on file, the EAD details and the address filled in, and the record
// approved (and not changed since). The deliberate "there is no evidence for this
// case" step waives the EAD parts; the address is still needed. General: no gate.
const EAD_FACTS = ['first_name', 'last_name', 'date_of_birth', 'a_number', 'ead_expiration'];
const GATE_ADDRESS = ['street', 'city', 'state', 'zip'];

export const GATE_MESSAGES = {
  ead_doc: 'Add the EAD in Evidence Zero, or mark that there is no evidence for this case.',
  ead_facts: 'Fill in the EAD details: name, date of birth, A-Number and expiration date.',
  address: 'Fill in the address: street, city, state and ZIP code.',
  approve: 'Approve the reference record.',
  no_person: 'Add the person this case is about.',
};

export function evidenceRequirement(caseType, people, documents) {
  if (caseType === 'general') return { ready: true, missing: [] };
  const main = mainPerson(people);
  if (!main) return { ready: false, missing: ['no_person'] };
  const missing = [];
  if (!main.no_evidence) {
    const hasEad = documents.some((d) => d.status === 'current' && d.doc_type === 'ead');
    if (!hasEad) missing.push('ead_doc');
    if (EAD_FACTS.some((k) => isBlank(main[k]))) missing.push('ead_facts');
  }
  if (GATE_ADDRESS.some((k) => isBlank(main[k]))) missing.push('address');
  if (!main.approved_at || main.changed_since_approval) missing.push('approve');
  return { ready: missing.length === 0, missing };
}

// ── Report language (D-23, D-24) ─────────────────────────────────────────────
// Three states only, worded exactly as v1.2 words them. Re-exported from the
// v1.2 contract so v1.2 and v2 can never disagree.
export { reportStateLanguage, STAFF_REVIEW_REMINDER } from './proof-scan-contract.js';

export function reportState(attentionCount, notCheckedCount) {
  if (attentionCount > 0) return 'items_need_attention';
  if (notCheckedCount > 0) return 'review_incomplete';
  return 'no_issues_found';
}
