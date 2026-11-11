// _proof-scan-v2-common.js: shared pure helpers for Proof Scan v2. NOT a route.
//
// No Worker, database, model or DOM dependency. Everything here is a plain
// function over plain data so the decisions it encodes can be unit tested.
// Decision references (D-n, Q-n, N-n) point at the master record,
// Anobe/proof-scan-lab/PROOF-SCAN.md.

import { COUNTRIES, US_STATES, CBP_PORTS } from './_proof-scan-v2-places.js';

export const CASE_TYPES = ['daca_renewal', 'general', 'aos'];
export const CASE_TYPE_LABELS = { daca_renewal: 'DACA renewal', general: 'General', aos: 'Adjustment of Status' };
// v2.1, D-131: an AOS case is started as one of three kinds, picked by staff.
// The kind only switches the spousal-only items on or off (Q-59): the I-130A
// and the marriage certificate. Labels are Max's to finalise (D-87).
export const AOS_KINDS = ['spousal', 'child_to_parent', 'parent_to_child'];
export const AOS_KIND_LABELS = { spousal: 'Spousal', child_to_parent: 'Child to parent', parent_to_child: 'Parent to child' };
// AOS uses General's multi-person case cards (D-131): one card per person,
// filled from forms and evidence. Only DACA is one person (D-94).
export const isMultiPerson = (caseType) => caseType !== 'daca_renewal';

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
// D-100: plus every other fact the portal's form maps fill per person
// (supabase/migrations/1600-*.sql and 1514 "source" values): USCIS online
// account number, country of birth and citizenship, I-94 number and expiry,
// last entry date and port of entry, employer, marriage date and place.
export const EXTRA_FIELDS = [
  'uscis_account_number', 'country_of_birth', 'country_of_citizenship',
  'i94_number', 'i94_expiration', 'last_entry_date', 'port_of_entry',
  'employer', 'marriage_date', 'marriage_place',
  // v2.0.2, Q-56: carried on the card always, compared only for a US birth.
  'city_of_birth',
  // v2.1, Q-61: the beneficiary's passport is evidence, not truth; only its
  // number and expiration date are checked against the forms.
  'passport_number', 'passport_expiration',
];
export const REFERENCE_FIELDS = [
  'first_name', 'middle_name', 'last_name',
  'street', 'apt_type', 'apt_number', 'city', 'state', 'zip',
  'in_care_of', 'province', 'postal_code', 'country',
  'date_of_birth', 'a_number', 'ead_expiration',
  'phone', 'email',
  ...EXTRA_FIELDS,
];
// Shown and expected only when a source carries them (D-82, D-100).
export const OPTIONAL_FIELDS = new Set(['in_care_of', 'province', 'postal_code', 'country', ...EXTRA_FIELDS]);
export const NAME_FIELDS = ['first_name', 'middle_name', 'last_name'];
export const ADDRESS_FIELDS = ['street', 'apt_type', 'apt_number', 'city', 'state', 'zip',
  'in_care_of', 'province', 'postal_code', 'country'];
export const DATE_FIELDS = new Set(['date_of_birth', 'ead_expiration', 'marriage_date', 'i94_expiration', 'last_entry_date', 'expiration_date', 'passport_expiration']);
export const APT_TYPES = ['Apt.', 'Ste.', 'Flr.'];

export const FIELD_LABELS = {
  first_name: 'first name', middle_name: 'middle name', last_name: 'last name',
  street: 'street', apt_type: 'Apt./Ste./Flr.', apt_number: 'unit number', city: 'city',
  state: 'state', zip: 'ZIP code', in_care_of: 'In Care Of name', province: 'province',
  postal_code: 'postal code', country: 'country', date_of_birth: 'date of birth',
  a_number: 'A-Number', ead_expiration: 'EAD expiration date', phone: 'phone', email: 'email',
  ssn: 'Social Security number', marriage_date: 'marriage date', name: 'name', address: 'address',
  uscis_account_number: 'USCIS online account number', country_of_birth: 'country of birth',
  country_of_citizenship: 'country of citizenship', i94_number: 'I-94 number', i94_expiration: 'I-94 expiration date',
  last_entry_date: 'last entry date', port_of_entry: 'port of entry', employer: 'employer',
  marriage_place: 'place of marriage', expiration_date: 'expiration date', city_of_birth: 'city of birth',
  passport_number: 'passport number', passport_expiration: 'passport expiration date',
};

// Document types Evidence Zero may identify. Only the Lab's own set; no new
// evidence categories are invented here (D-55, rule 4 of the continuation
// protocol).
// D-100 #5 names passports, I-94s and green cards as evidence that can expire.
// v2.0.2, D-121: Max named tax returns, pay stubs and naturalization
// certificates ("a tax return should be easy enough to identify, or a pay
// stub, or a birth certificate"); the rest are the everyday evidence a person
// would name on sight. "other" is left for a document that truly cannot be
// told, and even then the document's own printed title is used when there is one.
export const DOC_TYPES = ['ead', 'intake', 'birth_certificate', 'marriage_certificate', 'passport', 'i94', 'green_card',
  'naturalization_certificate', 'citizenship_certificate', 'tax_return', 'w2', 'pay_stub', 'employment_letter',
  'bank_statement', 'national_id', 'divorce_decree', 'death_certificate', 'other'];
export const DOC_TYPE_LABELS = {
  ead: 'EAD', intake: 'Intake', birth_certificate: 'Birth certificate',
  marriage_certificate: 'Marriage certificate', passport: 'Passport', i94: 'I-94', green_card: 'Green card',
  naturalization_certificate: 'Naturalization certificate', citizenship_certificate: 'Certificate of citizenship',
  tax_return: 'Tax return', w2: 'W-2', pay_stub: 'Pay stub', employment_letter: 'Employment letter',
  bank_statement: 'Bank statement', national_id: 'National ID card', divorce_decree: 'Divorce decree',
  death_certificate: 'Death certificate',
  other: 'Other document',
};

// ── Normalising ──────────────────────────────────────────────────────────────

export const digits = (v) => String(v ?? '').replace(/\D/g, '');
// v2.0.2, D-126: accents never make a difference ("José" = "Jose", "Ramírez" =
// "Ramirez"). Letters are folded to plain ASCII before anything is compared;
// before this, accented letters were dropped altogether.
const FOLD = { ß: 'ss', ø: 'o', Ø: 'o', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', ı: 'i' };
export const foldAccents = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[ßøØæÆœŒłŁđĐı]/g, (c) => FOLD[c]);
export const normText = (v) => foldAccents(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isBlank = (v) => v == null || String(v).trim() === '';

// v2.0.2, D-126: "(none)", "N/A" and the like printed on a form mean the
// field does not apply: the same as a blank field, never a value of its own.
const NOT_APPLICABLE = /^\(?\s*(none|n\s*\/\s*a|na|not applicable|ninguno|ninguna)\s*\.?\s*\)?$/i;
export const isNotApplicable = (v) => v != null && NOT_APPLICABLE.test(String(v).trim());

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
// D-115: evidence can be in Spanish ("29 de enero de 1995").
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthIndex = (word) => {
  const w = normText(word);
  if (w.length < 3) return -1;
  const en = MONTHS.findIndex((name) => name.startsWith(w) || (w === 'sept' && name === 'september'));
  if (en >= 0) return en;
  return MONTHS_ES.findIndex((name) => name.startsWith(w) || (w === 'setiembre' && name === 'septiembre'));
};

function validDay(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isoDate(y, m, d) {
  if (!(y >= 1900 && y <= 2100) || !validDay(y, m, d)) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// A printed date as its parts: { y, m, d, yy } where yy is true when only two
// digits of the year were printed (then y is 0-99). null when it is not a date.
// order: 'mdy' for US forms and documents (the default, strict), 'dmy' for a
// document from a country that writes the day first (D-117). Only the slashed, dotted or
// dashed all-number form depends on it; ISO dates and dates with a month name
// read the same either way.
export function dateParts(value, order = 'mdy') {
  if (isBlank(value)) return null;
  const s = String(value).trim().replace(/\s+/g, ' ');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDay(+m[1], +m[2], +m[3]) ? { y: +m[1], m: +m[2], d: +m[3], yy: false } : null;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    const yy = m[3].length === 2;
    const [mon, day] = order === 'dmy' ? [b, a] : [a, b];
    if (validDay(yy ? 2000 : y, mon, day)) return { y, m: mon, d: day, yy };
    // A day-first document that printed a date which can only be month first
    // (09/30/1993) is read month first. Never the other way: a form is always
    // month first, and a form date that only reads day first is our mistake.
    if (order === 'dmy' && validDay(yy ? 2000 : y, a, b)) return { y, m: a, d: b, yy };
    return null;
  }
  m = s.match(/^([A-Za-zÀ-ÿ]{3,10})\.? (\d{1,2}),? (\d{4})$/);
  if (m) {
    const mon = monthIndex(m[1]) + 1;
    return mon && validDay(+m[3], mon, +m[2]) ? { y: +m[3], m: mon, d: +m[2], yy: false } : null;
  }
  m = s.match(/^(\d{1,2})(?: de)? ([A-Za-zÀ-ÿ]{3,10})\.?,?(?: de| del)? (\d{4})$/i);
  if (m) {
    const mon = monthIndex(m[2]) + 1;
    return mon && validDay(+m[3], mon, +m[1]) ? { y: +m[3], m: mon, d: +m[1], yy: false } : null;
  }
  return null;
}

// D-111 century rule, for STORING a two-digit year on the case card. Proposed
// by terminal 2026-10-15, for Max to confirm (see BUILD-LOG v2.0.2):
//   - a date that can only be in the future of the document (an expiration:
//     EAD, I-94, passport, green card) is 20YY;
//   - a date in the past (birth, marriage, entry) is NOT stored from a
//     two-digit year: "25" in a date of birth could be 1925 or 2025, and the
//     card is the truth the forms are checked against, so it is left for staff
//     to fill in, exactly as before.
// Comparing never needs the century: 01/29/25 and 01/29/2025 are the same date
// either way (sameDate).
export const FUTURE_DATE_FIELDS = new Set(['ead_expiration', 'i94_expiration', 'expiration_date', 'passport_expiration']);
export function centuryFor(field, yy) {
  return FUTURE_DATE_FIELDS.has(field) ? 2000 + yy : null;
}

// Dates as printed. Returns YYYY-MM-DD or null. A two-digit year is read only
// when `field` says which century it is in (centuryFor).
export function normalizeDate(value, { order = 'mdy', field = null } = {}) {
  const p = dateParts(value, order);
  if (!p) return null;
  if (!p.yy) return isoDate(p.y, p.m, p.d);
  const y = field ? centuryFor(field, p.y) : null;
  return y ? isoDate(y, p.m, p.d) : null;
}

// D-111: the same date, whatever the year's length. Month and day must agree;
// a two-digit year matches a four-digit year that ends in those two digits.
// Returns true / false, or null when either side is not a date at all.
export function sameDate(a, b, { aOrder = 'mdy', bOrder = 'mdy' } = {}) {
  const pa = dateParts(a, aOrder);
  const pb = dateParts(b, bOrder);
  if (!pa || !pb) return null;
  if (pa.m !== pb.m || pa.d !== pb.d) return false;
  if (pa.yy === pb.yy) return pa.y === pb.y;
  return (pa.yy ? pa.y : pa.y % 100) === (pb.yy ? pb.y : pb.y % 100);
}

// ── Places (D-118, D-126, Q-56, D-116) ───────────────────────────────────────

const COUNTRY_INDEX = new Map();
const COUNTRY_BY_NAME = new Map();
for (const c of COUNTRIES) {
  COUNTRY_BY_NAME.set(c.name, c);
  for (const alias of [c.a2, c.a3, c.name, ...c.aliases]) {
    const key = normText(alias);
    if (key && !COUNTRY_INDEX.has(key)) COUNTRY_INDEX.set(key, c.name);
  }
}
export const COUNTRY_FIELDS = new Set(['country', 'country_of_birth', 'country_of_citizenship']);

// "MEX", "Mexican", "México" -> "MEXICO". null when the text is not one country.
export function canonicalCountry(value) {
  const key = normText(value);
  return key ? COUNTRY_INDEX.get(key) || null : null;
}

const isUsCountry = (name) => name === 'UNITED STATES' || Boolean(COUNTRY_BY_NAME.get(name)?.usTerritory);
// true for the US (or a US territory), false for another country, null when unknown.
export function usCountry(value) {
  const name = canonicalCountry(value);
  return name ? isUsCountry(name) : null;
}

// D-117: how a document's own country writes an all-number date. Unknown
// country: a document not in English is read day first (most of the world,
// and every Spanish-speaking country), an English one month first.
export function dateOrderFor(country, language) {
  const name = canonicalCountry(country);
  if (name) return COUNTRY_BY_NAME.get(name)?.monthFirst ? 'mdy' : 'dmy';
  const lang = normText(language);
  if (lang && !/^(english|en|eng)$/.test(lang)) return 'dmy';
  return 'mdy';
}

const STATE_BY_CODE = new Map(Object.entries(US_STATES).map(([code, name]) => [code.toLowerCase(), normText(name)]));
const STATE_NAMES = new Set(STATE_BY_CODE.values());
const stateOf = (part) => {
  const p = normText(part);
  if (STATE_BY_CODE.has(p)) return STATE_BY_CODE.get(p);
  return STATE_NAMES.has(p) ? p : null;
};

// "Raleigh, NC", "RALEIGH, NORTH CAROLINA, USA" -> { place: 'raleigh', state: 'north carolina', us: true }.
// us is true for a known US place, false for a known foreign one, null when the
// text alone cannot tell.
export function placeParts(value) {
  const parts = foldAccents(value).split(/[,;]| - /).map((x) => x.trim()).filter(Boolean);
  let state = null;
  let us = null;
  const rest = [];
  for (let i = 0; i < parts.length; i += 1) {
    const st = i > 0 ? stateOf(parts[i]) : null;
    const country = i > 0 ? canonicalCountry(parts[i]) : null;
    if (st && !state) { state = st; us = true; continue; }
    if (country) { us = isUsCountry(country); continue; }
    rest.push(parts[i]);
  }
  if (us === null && parts.length === 1) {
    const whole = normText(parts[0]);
    if (STATE_NAMES.has(whole)) us = true;
  }
  return { place: normText(rest.join(' ')), state, us };
}

const COUNTY = /\b(county|parish|borough|condado)\b/i;
export const namesCounty = (value) => COUNTY.test(foldAccents(value));

export function samePlace(a, b) {
  const pa = placeParts(a);
  const pb = placeParts(b);
  if (!pa.place || !pb.place) return normText(a) === normText(b);
  if (pa.place !== pb.place) return false;
  return !pa.state || !pb.state || pa.state === pb.state;
}

// D-126: an I-94's port code is the port's name ("CHM" = Champlain).
const PORT_BY_CODE = new Map(Object.entries(CBP_PORTS).map(([code, name]) => [code.toLowerCase(), normText(name)]));
function portName(value) {
  const { place } = placeParts(value);
  const key = place || normText(value);
  return PORT_BY_CODE.get(key) || key;
}
export const samePort = (a, b) => portName(a) === portName(b);

// ── Employers (D-119, Q-53) ──────────────────────────────────────────────────
// Judged the way a person would. Proposed by terminal 2026-10-15:
// SAME EMPLOYER, passes
//   - the same words once legal suffixes and filler are set aside
//     ("Wal-mart Associates and Co." = "Walmart"), hyphens and spaces ignored;
//   - one name is the start of the other, word by word ("Amazon" for
//     "Amazon.com Services LLC"), or every word of the shorter name is in the
//     longer one in the same order;
//   - an acronym of the other ("UPS" for "United Parcel Service").
// NOT THE SAME, counted
//   - anything else, a typo included ("Walmrat" for "Walmart"): a short or
//     everyday name only ever drops words, it never changes letters.
const EMPLOYER_FILLER = new Set(['inc', 'incorporated', 'llc', 'l', 'lc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'cos', 'companies', 'associates', 'assoc', 'and', 'the', 'lp', 'llp', 'pllc', 'pc', 'pa',
  'plc', 'sa', 'de', 'cv', 'rl', 'dba', 'of', 'usa', 'us', 'america']);
const employerWords = (v) => normText(String(v ?? '').replace(/(\w)-(\w)/g, '$1$2').replace(/&/g, ' and ').replace(/\.com\b/gi, ' '))
  .split(' ').filter((w) => w && !EMPLOYER_FILLER.has(w));

export function sameEmployer(a, b) {
  const wa = employerWords(a);
  const wb = employerWords(b);
  if (!wa.length || !wb.length) return normText(a) === normText(b);
  if (wa.join('') === wb.join('')) return true;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (short.every((w, i) => long[i] === w)) return true;
  let i = 0;
  for (const w of long) if (w === short[i]) i += 1;
  if (i === short.length) return true;
  // Acronym: a single short word made of the other name's initials.
  if (short.length === 1 && short[0].length >= 2 && short[0].length === long.length
    && long.map((w) => w[0]).join('') === short[0]) return true;
  return false;
}

// ── Comparing ────────────────────────────────────────────────────────────────

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
// order: how the document writes all-number dates (D-117).
export function toCardValue(field, raw, { order = 'mdy' } = {}) {
  if (isBlank(raw)) return { value: null };
  const text = String(raw).trim().replace(/\s+/g, ' ');
  if (DATE_FIELDS.has(field)) {
    const d = normalizeDate(text, { order, field });
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
// ignores case, accents, spacing and punctuation (D-112, D-126). v2.0.2: a
// country compares by what it names (D-118), a port by its name (D-126), a
// place by its city and state (Q-56), an employer the way a person would (D-119).
// opts.aOrder / opts.bOrder: the date order of each side (D-117).
export function sameValue(field, a, b, opts = {}) {
  if (isNotApplicable(a)) a = '';
  if (isNotApplicable(b)) b = '';
  if (field === 'a_number' || field === 'phone' || field === 'ssn' || field === 'zip' || field === 'uscis_account_number') {
    return digits(a) === digits(b);
  }
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  if (DATE_FIELDS.has(field)) {
    const same = sameDate(a, b, opts);
    if (same != null) return same;
    // D-117: one side reads as a date and the other does not (a form that wrote
    // a foreign document's 29/01/1995 day first): never the same, even when
    // the printed text matches. Only two non-dates fall back to the text.
    if (dateParts(a, opts.aOrder) || dateParts(b, opts.bOrder)) return false;
  }
  if (field === 'apt_type') {
    const ta = normalizeAptType(a);
    const tb = normalizeAptType(b);
    if (ta && tb) return ta === tb;
  }
  if (COUNTRY_FIELDS.has(field)) {
    const ca = canonicalCountry(a);
    const cb = canonicalCountry(b);
    if (ca && cb) return ca === cb;
  }
  if (field === 'port_of_entry') return samePort(a, b);
  if (field === 'city_of_birth' || field === 'marriage_place') return samePlace(a, b);
  if (field === 'employer') return sameEmployer(a, b);
  return normText(a) === normText(b);
}

// ── Names (D-89, D-112, D-120) ───────────────────────────────────────────────
const nameWords = (v) => (isNotApplicable(v) ? [] : normText(v).split(' ').filter(Boolean));

// How two names compare, as a person reads them:
//   'same'      the same person's name. Capitals and accents never count
//               (D-112, D-126). A document that prints first and middle name
//               together as the first name is the same name (D-120). With
//               lenientMiddle, a middle initial or a missing middle name is the
//               same too (D-89, the Physical Scan and the evidence).
//   'split'     the same words in the same order, but the last name starts at a
//               different word: "Jane Doe | Douglas" against "Jane | DOE DOUGLAS"
//               (D-112). A gentle confirm, never counted.
//   'different' anything else.
export function compareNames(a, b, { lenientMiddle = false } = {}) {
  const [fa, ma, la] = [nameWords(a.first_name), nameWords(a.middle_name), nameWords(a.last_name)];
  const [fb, mb, lb] = [nameWords(b.first_name), nameWords(b.middle_name), nameWords(b.last_name)];
  const eq = (x, y) => x.join(' ') === y.join(' ');
  if (!la.length || !lb.length) return eq(la, lb) && eq([...fa, ...ma], [...fb, ...mb]) ? 'same' : 'different';
  if (eq(la, lb)) {
    if (eq([...fa, ...ma], [...fb, ...mb])) return 'same';
    if (eq(fa, fb) && lenientMiddle) {
      const mid = ma.join(' ');
      const other = mb.join(' ');
      if (!mid || !other || other.startsWith(mid) || mid.startsWith(other)) return 'same';
    }
    return 'different';
  }
  const all = (f, m, l) => [...f, ...m, ...l].join(' ');
  if (fa[0] && fa[0] === fb[0] && all(fa, ma, la) === all(fb, mb, lb)) return 'split';
  return 'different';
}

// D-89: "RIVERA, ANA M." and "ANA MARIA RIVERA" are the same name.
export function sameName(scanned, card) {
  return compareNames(scanned, card, { lenientMiddle: true }) === 'same';
}

// D-112, Q-48: last names and countries on a form are in capitals (firm rule).
export const notInCaps = (v) => !isBlank(v) && !isNotApplicable(v) && /\p{Ll}/u.test(String(v));
// Q-54: a first-name field with more than one word in it.
export const twoWordFirstName = (v) => !isNotApplicable(v) && String(v ?? '').trim().split(/\s+/).filter(Boolean).length > 1;

// "3-9" -> "pages 3-9", "90" -> "page 90".
export const pagesText = (pages) => {
  const p = String(pages ?? '').trim();
  if (!p) return '';
  return /[-,–\s]/.test(p) ? `pages ${p}` : `page ${p}`;
};

// ── Display ──────────────────────────────────────────────────────────────────

export function formatDate(value) {
  const iso = normalizeDate(value, { field: 'expiration_date' });
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
  aos_evidence: 'Add the birth certificates and the other evidence in Evidence Zero, or mark that there is no evidence for this case.',
};

export function evidenceRequirement(caseType, people, documents) {
  if (caseType === 'general') return { ready: true, missing: [] };
  // v2.1, Q-60: AOS starts in Evidence Zero, as DACA, but it never locks a
  // stage (D-103, D-113). It is "done" once a document is read or staff mark
  // that there is no evidence for this case.
  if (caseType === 'aos') {
    const main = mainPerson(people);
    const any = documents.some((d) => d.status === 'current') || Boolean(main?.no_evidence);
    return { ready: any, missing: any ? [] : ['aos_evidence'] };
  }
  const main = mainPerson(people);
  if (!main) return { ready: false, missing: ['no_person'] };
  const missing = [];
  if (!main.no_evidence) {
    const hasEad = documents.some((d) => d.status === 'current' && d.doc_type === 'ead');
    if (!hasEad) missing.push('ead_doc');
    if (EAD_FACTS.some((k) => isBlank(main[k]))) missing.push('ead_facts');
  }
  if (GATE_ADDRESS.some((k) => isBlank(main[k]))) missing.push('address');
  // D-103: approved once is enough; later edits never block a re-run.
  if (!main.approved_at) missing.push('approve');
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

// ── Folder name (D-101) ──────────────────────────────────────────────────────
// Staff no longer name the folder. It is named from the people on the case once
// a document, form or scan reveals them: DACA "RIVERA, Ana"; General the main
// last names, petitioner first, e.g. "MORALES & REYES". Until then "New case"
// with the date it started. The case type is shown beside it, never repeated in it.
const LABEL_ROLE_ORDER = ['petitioner', 'beneficiary', 'applicant', 'sponsor', 'joint_sponsor', 'household_member'];
const titleCase = (v) => String(v).toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());

export function caseLabel(caseType, people, createdAt) {
  const named = (people || []).filter((p) => !isBlank(p.last_name));
  if (caseType === 'daca_renewal' || named.length === 1) {
    const main = mainPerson(people || []);
    const p = main && !isBlank(main.last_name) ? main : named[0];
    if (p) {
      const first = isBlank(p.first_name) ? '' : `, ${titleCase(String(p.first_name).trim())}`;
      return `${String(p.last_name).trim().toUpperCase()}${first}`.slice(0, 200);
    }
  } else if (named.length) {
    const ordered = [...named].sort((a, b) => (Number(b.is_main) - Number(a.is_main))
      || LABEL_ROLE_ORDER.indexOf(a.role) - LABEL_ROLE_ORDER.indexOf(b.role));
    const top = ordered.slice(0, 2).sort((a, b) => LABEL_ROLE_ORDER.indexOf(a.role) - LABEL_ROLE_ORDER.indexOf(b.role));
    const names = [...new Set(top.map((p) => String(p.last_name).trim().toUpperCase()))];
    // v2.1, D-144: two people with the same last name read "REYES, Miguel &
    // Carmen" (last name once, both first names), so cases can be told apart.
    if (names.length === 1 && top.length === 2) {
      const firsts = top.map((p) => (isBlank(p.first_name) ? '' : titleCase(String(p.first_name).trim()))).filter(Boolean);
      if (firsts.length === 2) return `${names[0]}, ${firsts.join(' & ')}`.slice(0, 200);
    }
    return names.join(' & ').slice(0, 200);
  }
  return `New case ${formatDate(String(createdAt || '').slice(0, 10)) || ''}`.trim();
}
