// _proof-scan-v2-aos.js: the AOS case type's server decisions (v2.1). NOT a route.
//
// Pure. The model has reported what an AOS package shows (the "aos" section of
// the stage-run answer, _proof-scan-v2-ai.js); everything here decides from
// those observations, as the server must (D-18):
//   D-131 / Q-59  the kind switches the spousal-only items; the I-130's
//                 relationship box against the kind is a Possible issue
//   Q-72          which "if needed" items apply, read from the package
//   Q-63 / Q-64   each fee, the I-485 fee by age with its guards, money orders
//   D-134         the cardholder can be anyone; a misspelling is a gentle confirm
//   Q-79          the G-1450 email and phone
//   Q-67          the English and interpreter boxes
//   D-138         the answer tally, general words only
// Decision references point at docs/proof-scan-v2/DECISIONS-MASTER-RECORD.md.

import { normText, digits, normalizeDate, displayValue, formatName } from './_proof-scan-v2-common.js';

export const AOS_SERVER_RULES = new Set([
  'AOS-FEE-I130', 'AOS-FEE-I485', 'AOS-FEE-I765', 'AOS-FEE-I131', 'AOS-G1450-CONTACT',
  'AOS-130A-LANG', 'AOS-485-LANG', 'AOS-765-LANG',
]);
export const RELATIONSHIP_REASONING_KEY = 'relationship_box_kind';

const formKey = (f) => String(f ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const blank = (v) => v == null || String(v).trim() === '';

export const EMPTY_AOS = {
  i130_relationship: null, petitioner_citizenship: null, prior_divorce_listed: 'not_shown',
  fee_payments: [], language_statements: [], yes_no_answers: [],
};

// ── Conditions (Q-59, Q-70, Q-72) ────────────────────────────────────────────
export function aosConditions({ aosKind, forms, aos }) {
  const has = (form, role) => forms.some((f) => formKey(f.form) === form && (!role || f.person_role === role));
  return {
    spousal: aosKind === 'spousal',
    joint_sponsor: has('I864', 'joint_sponsor'),
    household_member: has('I864A'),
    i131: has('I131'),
    naturalized: aos.petitioner_citizenship === 'naturalization',
    divorce: aos.prior_divorce_listed === 'yes',
  };
}

// D-131: what the I-130's relationship box says for each kind. "Child to
// parent": the child petitions for the parent (box "Parent"); "parent to
// child": the parent petitions for the child (box "Child").
const KIND_BOX = { spousal: 'spouse', child_to_parent: 'parent', parent_to_child: 'child' };
export const BOX_LABELS = { spouse: 'Spouse', parent: 'Parent', child: 'Child', sibling: 'Brother/Sister' };
export function relationshipMismatch(aosKind, box) {
  if (!aosKind || !box) return null;
  return KIND_BOX[aosKind] === box ? null : { expected: KIND_BOX[aosKind], box };
}

// ── Money and age (Q-63, Q-64) ───────────────────────────────────────────────
export function parseMoney(v) {
  const m = String(v ?? '').replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// The I-485 amounts as the Rulebook states them (Q-64 guard 4: staff can
// correct an amount without code). "under 14: $950 · 14 to 78: $1,440 · 79 and
// older: $1,140". null when the text cannot be read with certainty.
export function parseAgeTiers(text) {
  const t = String(text || '').replace(/,/g, '');
  const under = t.match(/under\s+(\d{1,3})\D{0,12}\$\s*(\d+(?:\.\d+)?)/i);
  const mid = t.match(/(\d{1,3})\s*(?:to|-|–|through)\s*(\d{1,3})\D{0,12}\$\s*(\d+(?:\.\d+)?)/i);
  const old = t.match(/(\d{1,3})\s*(?:and older|or older|\+|and over)\D{0,12}\$\s*(\d+(?:\.\d+)?)/i);
  if (!under || !mid || !old) return null;
  const tiers = { child: +under[1], childFee: +under[2], from: +mid[1], to: +mid[2], adultFee: +mid[3], senior: +old[1], seniorFee: +old[2] };
  if (tiers.child !== tiers.from || tiers.to + 1 !== tiers.senior) return null;
  return tiers;
}

export function ageOn(dobIso, onIso) {
  const [y1, m1, d1] = dobIso.split('-').map(Number);
  const [y2, m2, d2] = onIso.split('-').map(Number);
  return y2 - y1 - ((m2 < m1 || (m2 === m1 && d2 < d1)) ? 1 : 0);
}

// Days from `onIso` to the birthday at `years` (negative when it has passed).
export function daysToBirthday(dobIso, years, onIso) {
  const [y, m, d] = dobIso.split('-').map(Number);
  const target = Date.UTC(y + years, m - 1, d);
  const [ty, tm, td] = onIso.split('-').map(Number);
  return Math.round((target - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}
// Q-64 guard 2: "within a month" of turning 14 or 79, either side.
export const NEAR_CUTOFF_DAYS = 31;

// Whether a printed name is this person's: their first and last name words are
// both in it, in any order (the G-1450 prints family, given and middle apart).
export function nameIsPerson(printed, person) {
  if (!person || blank(person.first_name) || blank(person.last_name)) return null;
  const words = new Set(normText(printed).split(' ').filter(Boolean));
  if (!words.size) return null;
  const need = [...normText(person.first_name).split(' '), ...normText(person.last_name).split(' ')].filter(Boolean);
  return need.every((w) => words.has(w));
}

// ── Cardholder (D-134 amended) ───────────────────────────────────────────────
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// The person a cardholder name looks like a misspelling of, or null. The
// cardholder can be anyone (D-134): a name that matches someone exactly, or is
// nothing like anyone, is fine. One or two letters off a person's first and last
// name (in either order) looks like handwriting: a gentle confirm.
export function misspeltCardholder(cardholder, people) {
  const c = normText(cardholder);
  if (!c || c.replace(/ /g, '').length < 5) return null;
  for (const p of people) {
    if (blank(p.first_name) || blank(p.last_name)) continue;
    const first = normText(p.first_name).split(' ')[0];
    const last = normText(p.last_name);
    const forms = [`${first} ${last}`, `${last} ${first}`, normText(formatName(p))];
    if (forms.some((f) => f === c)) return null;
    const dist = Math.min(...forms.map((f) => editDistance(f, c)));
    if (dist >= 1 && dist <= 2) return p;
  }
  return null;
}

// ── Contact on the G-1450s (Q-79) ────────────────────────────────────────────
const phoneKey = (v) => digits(v).slice(-10);
const emailKey = (v) => String(v || '').trim().toLowerCase();

// people: [{ role, phones: [...], emails: [...] }] from the cards and the forms.
export function contactCheck(payments, people) {
  const cards = payments.filter((p) => p.method === 'g1450');
  if (!cards.length) return { status: 'clear', none: true };
  const phones = [...new Set(cards.map((p) => phoneKey(p.cardholder_phone)).filter((x) => x.length >= 7))];
  const emails = [...new Set(cards.map((p) => emailKey(p.cardholder_email)).filter(Boolean))];
  const problems = [];
  if (!phones.length && !emails.length) problems.push({ kind: 'blank' });
  if (phones.length > 1) problems.push({ kind: 'phones_differ', values: phones });
  if (emails.length > 1) problems.push({ kind: 'emails_differ', values: emails });
  for (const ph of phones) {
    if (!people.some((p) => p.phones.some((v) => phoneKey(v) === ph))) problems.push({ kind: 'phone_unknown', value: ph });
  }
  for (const em of emails) {
    if (!people.some((p) => p.emails.some((v) => emailKey(v) === em))) problems.push({ kind: 'email_unknown', value: em });
  }
  return { status: problems.length ? 'needs_attention' : 'clear', problems };
}
const showPhone = (d) => (d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);
export function contactProblemText(p) {
  if (p.kind === 'blank') return 'The G-1450 leaves the cardholder\'s email and phone blank.';
  if (p.kind === 'phones_differ') return `The G-1450s give different phones: ${p.values.map(showPhone).join(' and ')}.`;
  if (p.kind === 'emails_differ') return `The G-1450s give different emails: ${p.values.join(' and ')}.`;
  if (p.kind === 'phone_unknown') return `The G-1450 phone ${showPhone(p.value)} belongs to no one on the case.`;
  return `The G-1450 email ${p.value} belongs to no one on the case.`;
}

// ── English and interpreter (Q-67, confirmed 10-16 "loose ends" 3) ───────────
// Returns { status, title } for one form's statement at a stage.
export function languageDecision(st, stage) {
  if (!st) return { status: 'not_checked', reason: 'The applicant\'s statement about English and the interpreter could not be read.' };
  const late = stage !== 'draft_review';
  const signed = st.interpreter_signed_dated !== 'no';
  if (st.has_boxes) {
    if (!st.english_box && !st.interpreter_box) return { status: 'needs_attention', title: `Neither the English box nor the interpreter box is ticked on the ${st.form}.` };
    if (st.english_box && st.interpreter_box) return { status: 'needs_attention', title: `Both the English box and the interpreter box are ticked on the ${st.form}.` };
    if (st.english_box && st.interpreter_section_filled) return { status: 'needs_attention', title: `The English box is ticked on the ${st.form}, but the interpreter section is filled in.` };
    if (st.interpreter_box && !st.interpreter_section_filled) {
      return late
        ? { status: 'needs_attention', title: `The interpreter box is ticked on the ${st.form}, but the interpreter section is empty.` }
        : { status: 'clear', title: 'Interpreter box ticked; the interpreter section can wait for signatures at this stage.' };
    }
  }
  if (late && st.interpreter_section_filled && !signed) return { status: 'needs_attention', title: `The interpreter section on the ${st.form} is not signed and dated.` };
  return { status: 'clear' };
}

// ── Answer tally (D-138) ─────────────────────────────────────────────────────
// Counts only, never tied to a case: the form, the item number, a few general
// words for the topic, and the answer. A topic word that carries anything from
// the case (a name, a place, a number) is dropped.
export function tallyRows(answers, caseWords) {
  const out = new Map();
  for (const a of answers || []) {
    if (a.answer !== 'yes' && a.answer !== 'no') continue;
    const form = String(a.form || '').toUpperCase().replace(/\s+/g, '');
    if (!/^(I|G|N)-\d{2,4}[A-Z]{0,2}$/.test(form)) continue;
    const item = String(a.item || '').trim().replace(/\s+/g, '');
    if (!/^\d{1,3}(\.[a-z]{1,2})?\.?$/i.test(item)) continue;
    const topic = normText(a.topic).split(' ').filter((w) => w && !/\d/.test(w) && !caseWords.has(w)).slice(0, 8).join(' ');
    if (!topic) continue;
    const key = `${form}|${item.replace(/\.$/, '').toLowerCase()}`;
    if (!out.has(key)) out.set(key, { form, item: item.replace(/\.$/, '').toLowerCase(), topic, answer: a.answer });
  }
  return [...out.values()];
}

// The next state of a tally row once these counts are in (D-138).
export const SUGGEST_AFTER = 5;
export function nextTallyState(row) {
  if (row.state === 'approved' || row.state === 'declined') return row.state;
  if (row.yes_count > 0) return 'watching';
  return row.no_count >= SUGGEST_AFTER ? 'suggested' : 'watching';
}

// ── Fees ─────────────────────────────────────────────────────────────────────
const FEE_FOR = { 'AOS-FEE-I130': 'I-130', 'AOS-FEE-I485': 'I-485', 'AOS-FEE-I765': 'I-765', 'AOS-FEE-I131': 'I-131' };
const FEE_ROLE = { 'AOS-FEE-I130': 'petitioner', 'AOS-FEE-I485': 'beneficiary', 'AOS-FEE-I765': 'beneficiary', 'AOS-FEE-I131': 'beneficiary' };
const ROLE_WORD = { petitioner: 'petitioner', beneficiary: 'applicant' };

// One fee rule against the payments. who(role) gives { name parts } or null;
// dob: { settled: bool, iso } for the I-485 (Q-64 guard 1). Returns a check:
// { status, title, expected, reason, confirm } where confirm is a gentle
// question that replaces the count (guard 2).
export function feeDecision(rule, { payments, who, dob, scanDate }) {
  const fee = FEE_FOR[rule.rule_id];
  const role = FEE_ROLE[rule.rule_id];
  const paid = payments.filter((p) => p.fee_for === fee && p.method !== 'money_order');
  const orders = payments.filter((p) => p.fee_for === fee && p.method === 'money_order');
  if (!paid.length && !orders.length) {
    return { status: 'needs_attention', title: `No payment for the ${fee} fee was found.`, expected: rule.expected || null };
  }
  const pay = paid[0] || orders[0];
  const amount = parseMoney(pay.amount);
  const names = [].concat(who(role) || []);
  const person = names[0] || null;
  const tried = names.map((n) => nameIsPerson(pay.payer_name, n)).filter((x) => x != null);
  const nameOk = blank(pay.payer_name) ? false : tried.length ? tried.some(Boolean) : null;
  const nameProblem = nameOk === false
    ? (blank(pay.payer_name)
      ? `The ${fee} fee payment leaves the ${ROLE_WORD[role]}'s name blank.`
      : `The ${fee} fee payment is in the name of ${pay.payer_name}, not the ${ROLE_WORD[role]}${person ? ` (${formatName(person)})` : ''}.`)
    : null;

  if (rule.rule_id === 'AOS-FEE-I485') {
    const tiers = parseAgeTiers(rule.expected);
    if (!tiers) return { status: 'not_checked', title: rule.title, reason: 'The I-485 fee amounts in the Rulebook could not be read. Write them as "under 14: $950 · 14 to 78: $1,440 · 79 and older: $1,140".' };
    if (!dob?.settled) {
      return { status: 'needs_info', title: 'Needs info: the applicant\'s date of birth is not settled, so the I-485 fee by age was not checked.' };
    }
    const age = ageOn(dob.iso, scanDate);
    // Guard 3 as amended (10-16 "loose ends" 5): under 14, only that the fee is there.
    if (age < tiers.child) return nameProblem ? { status: 'needs_attention', title: nameProblem } : { status: 'clear' };
    for (const years of [tiers.child, tiers.senior]) {
      const days = daysToBirthday(dob.iso, years, scanDate);
      if (Math.abs(days) <= NEAR_CUTOFF_DAYS) {
        const when = displayValue('date_of_birth', normalizeDate(`${dob.iso.slice(5, 7)}/${dob.iso.slice(8)}/${Number(dob.iso.slice(0, 4)) + years}`));
        return {
          status: 'please_confirm',
          title: `The applicant ${days >= 0 ? 'turns' : 'turned'} ${years} on ${when}, within a month of this scan. Is the I-485 fee${amount != null ? ` (${money(amount)} on the payment)` : ''} the right one?`,
        };
      }
    }
    const want = age >= tiers.senior ? tiers.seniorFee : tiers.adultFee;
    const band = age >= tiers.senior ? `${tiers.senior} and older` : `${tiers.from} to ${tiers.to}`;
    if (amount == null) return { status: 'needs_attention', title: 'The I-485 fee amount is blank or cannot be read.', expected: `${money(want)} (age ${band})` };
    if (amount !== want) {
      return { status: 'needs_attention', title: `The I-485 fee is ${money(amount)}. The applicant is ${age}, so the fee is ${money(want)}.`,
        expected: `${money(want)} (age ${band})`, reason: `Age worked out from the date of birth, ${displayValue('date_of_birth', dob.iso)}.` };
    }
    return nameProblem ? { status: 'needs_attention', title: nameProblem } : { status: 'clear' };
  }

  const want = parseMoney(rule.expected);
  if (want == null) return { status: 'not_checked', title: rule.title, reason: `The ${fee} fee amount in the Rulebook could not be read.` };
  if (amount == null) return { status: 'needs_attention', title: `The ${fee} fee amount is blank or cannot be read.`, expected: money(want) };
  if (amount !== want) return { status: 'needs_attention', title: `The ${fee} fee is ${money(amount)}. The firm's amount is ${money(want)}.`, expected: money(want) };
  return nameProblem ? { status: 'needs_attention', title: nameProblem } : { status: 'clear' };
}
