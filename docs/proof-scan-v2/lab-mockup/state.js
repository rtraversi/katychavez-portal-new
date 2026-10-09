// state.js: the whole v2 Lab state, in memory only. Reload resets everything.
// Nothing here is stored, sent, or read from a real file.

// D-12, in order. Full SSN is shown to staff (D-62, supersedes D-40).
export const REFERENCE_FIELDS = [
  { key: 'first_name',     group: 'name' },
  { key: 'middle_name',    group: 'name' },
  { key: 'last_name',      group: 'name' },
  // Address mirrors G-28 Part 3 item 12 (fieldmap 1514): 12.a street number and
  // name, 12.b Apt./Ste./Flr. plus number, 12.c city or town, 12.d state, 12.e ZIP.
  { key: 'street',         group: 'address' },
  { key: 'apt_type',       group: 'address' },
  { key: 'apt_number',     group: 'address' },
  { key: 'city',           group: 'address' },
  { key: 'state',          group: 'address' },
  { key: 'zip',            group: 'address' },
  // Max 2026-10-06: these appear only when a document actually carries them.
  { key: 'in_care_of',     group: 'address', optional: true },
  { key: 'province',       group: 'address', optional: true },
  { key: 'postal_code',    group: 'address', optional: true },
  { key: 'country',        group: 'address', optional: true },
  { key: 'date_of_birth',  group: 'identity' },
  { key: 'a_number',       group: 'identity' },
  { key: 'ead_expiration', group: 'identity' },
  { key: 'phone',          group: 'contact' },
  { key: 'email',          group: 'contact' },
  { key: 'ssn',            group: 'identity' },
  // D-100: further facts the portal's form maps fill per person. Shown only when a
  // document, form or scan carries them.
  { key: 'country_of_birth',       group: 'identity', optional: true },
  { key: 'country_of_citizenship', group: 'identity', optional: true },
  { key: 'uscis_account',          group: 'identity', optional: true },
  { key: 'i94_number',             group: 'identity', optional: true },
  { key: 'i94_expiry',             group: 'identity', optional: true },
  { key: 'last_entry_date',        group: 'identity', optional: true },
  { key: 'port_of_entry',          group: 'identity', optional: true },
  { key: 'employer',               group: 'contact',  optional: true },
  { key: 'marriage_date',          group: 'identity', optional: true },
  { key: 'marriage_place',         group: 'identity', optional: true },
];
// Every fact a case card can show, in display order (D-100).
export const CARD_FACTS = ['date_of_birth', 'a_number', 'ssn', 'country_of_birth', 'country_of_citizenship',
  'address', 'phone', 'email', 'uscis_account', 'i94_number', 'i94_expiry', 'last_entry_date', 'port_of_entry',
  'employer', 'marriage_date', 'marriage_place', 'ead_expiration'];
export const DATE_FACTS = new Set(['date_of_birth', 'ead_expiration', 'i94_expiry', 'last_entry_date', 'marriage_date']);

const blank = () => ({ value: '', source: null });

// D-94: one case card per person. The main card is `state.reference`; everyone
// else is in `state.others`, with the identity fields that name checks need.
export const ROLES = ['applicant', 'beneficiary', 'petitioner', 'sponsor', 'joint_sponsor', 'household_member'];
export const PERSON_FIELDS = ['first_name', 'middle_name', 'last_name', 'date_of_birth', 'a_number',
  'country_of_birth', 'country_of_citizenship', 'address', 'phone', 'email', 'uscis_account', 'i94_number',
  'i94_expiry', 'last_entry_date', 'port_of_entry', 'employer', 'marriage_date', 'marriage_place'];
export function newPerson(role, sourceLabel, facts = {}) {
  const fields = Object.fromEntries(PERSON_FIELDS.map((k) => [k, facts[k]
    ? { value: facts[k], source: sourceLabel ? { kind: 'doc', label: sourceLabel } : { kind: 'staff' } }
    : blank()]));
  return { id: nextId('person'), role, fields };
}
// The record for a role: the main card if it has that role, otherwise another person's card.
export function personByRole(role) {
  if (!role || state.reference.role === role) return { id: 'main', role: state.reference.role, fields: state.reference.fields };
  return state.others.find((p) => p.role === role) || null;
}

export const state = {
  caseType: null,
  stage: null,
  reference: {
    fields: Object.fromEntries(REFERENCE_FIELDS.map((f) => [f.key, blank()])),
    approvedAt: null,
    changedSinceApproval: false,
    noEad: false,      // staff chose to move forward without an EAD (rare)
    role: null,        // D-94: 'applicant' for DACA; General defaults to 'beneficiary'
  },
  others: [],        // D-94: further case cards (petitioner, sponsor, ...)
  proposals: [],     // { id, field, value, source } from a later document (D-55)
  docs: [],          // Evidence Zero workspace documents
  runs: {},          // stage key -> last result state key ('clear' | 'attention' | 'incomplete')
  signedOff: {},     // stage key -> true when staff signed the stage off (Max 2026-10-02)
  showSsn: false,    // Max 2026-10-06: SSN hidden until staff toggles it
  justAdded: null,   // id of the document added a moment ago, for its entrance
  justFilled: null,  // reference fields a document just filled, for their highlight
  workspaceNote: '', // one-line notice, e.g. a replaced EAD
  learnedRules: [],  // D-60, lost on reload
  ruleEdits: {},     // rule_id -> { title, form, page, item } edited in the rulebook (D-61), lost on reload
  // D-59: firm-wide, all case types. The signature-date-order reasoning is the
  // named example that must not return (R-1), so it starts suppressed.
  // `reasoning` is the suggestion title it was made from; the seed row's text
  // lives in copy.js like every other string.
  suppressed: [{ copyKey: 'rulebook.suppressed_seed', origin: 'r1' }],
};

// Max 2026-10-02: "ead MUST be present before drafting so yes it must be filled in
// first. at least from an ead and address." The review stages open once an EAD is
// on file, the EAD facts and the address are filled in, and the record is approved.
const EAD_FIELDS = ['first_name', 'last_name', 'date_of_birth', 'a_number', 'ead_expiration'];
const ADDRESS_FIELDS = ['street', 'city', 'state', 'zip'];
export function stageGate() {
  // D-95: General has no evidence gate; staff may go straight to Physical Scan.
  if (state.caseType === 'general') return { ready: true, missing: [] };
  const f = state.reference.fields;
  const missing = [];
  // Max 2026-10-02: staff are pushed back first, but when there really is no EAD
  // they may deliberately move forward without one. The address is still needed.
  if (!state.reference.noEad) {
    if (!state.docs.some((d) => d.sample.doc_type === 'ead')) missing.push('gate.ead_doc');
    if (EAD_FIELDS.some((k) => !f[k].value)) missing.push('gate.ead_facts');
  }
  if (ADDRESS_FIELDS.some((k) => !f[k].value)) missing.push('gate.address');
  if (!state.reference.approvedAt || state.reference.changedSinceApproval) missing.push('gate.approve');
  return { ready: missing.length === 0, missing };
}

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach((fn) => fn(state));

let seq = 0;
export const nextId = (p) => `${p}-${++seq}`;

// Comparison only. A-XXXXXXXXX and XXX-XXX-XXX are the same number (N-016).
export function sameValue(field, a, b) {
  const norm = (v) => String(v ?? '').trim().toUpperCase();
  if (field === 'a_number' || field === 'phone' || field === 'ssn') return norm(a).replace(/\D/g, '') === norm(b).replace(/\D/g, '');
  return norm(a).replace(/\s+/g, ' ') === norm(b).replace(/\s+/g, ' ');
}

export function setField(key, value, source) {
  const f = state.reference.fields[key];
  if (f.value === value && f.source === source) return;
  f.value = value;
  f.source = value ? source : null;
  if (state.reference.approvedAt) state.reference.changedSinceApproval = true;
}
