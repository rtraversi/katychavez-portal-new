// _proof-scan-v2-engine.js: one engine for Draft Review, Pre-flight and Physical
// Scan. NOT a route.
//
// Pure. The model has already reported observations (specs E.2, E.3) and they
// have been validated. Everything from here on is decided by the server (D-18),
// following the v2 Lab (ui-lab-v2/review.js evaluate, evaluateCorrections,
// cardsFromForms, evidenceRows; physical-scan.js withPeopleDiffs; evidence-match.js).
//
// Two halves:
//   selectRules()  before the call: which checks and package items this run asks about
//   evaluateRun()  after the call: the official result, plus the card fills and
//                  suggestions the route should write once the run is stored

import {
  REFERENCE_FIELDS, OPTIONAL_FIELDS, NAME_FIELDS, ADDRESS_FIELDS, EXTRA_FIELDS, FIELD_LABELS, ROLE_LABELS,
  DOC_TYPE_LABELS, STAGE_LABELS, CASE_TYPE_LABELS, sameValue, normText, digits, toCardValue,
  displayValue, formatName, formatAddress, truthValue, mainPerson, redactSsn, ssnDigits, maskSsn, normalizeDate,
  reportState, reportStateLanguage, STAFF_REVIEW_REMINDER,
  compareNames, isNotApplicable, placeParts, namesCounty, usCountry, dateOrderFor, notInCaps, twoWordFirstName,
  COUNTRY_FIELDS, pagesText, isMultiPerson, ADDRESS_FIELDS as ADDRESS_PARTS, DATE_FIELDS as DATE_FIELDS_SET,
} from './_proof-scan-v2-common.js';
import { copyText } from './_proof-scan-v2-copy.js';
import {
  AOS_SERVER_RULES, RELATIONSHIP_REASONING_KEY, EMPTY_AOS, aosConditions, relationshipMismatch, BOX_LABELS,
  feeDecision, contactCheck, contactProblemText, languageDecision, misspeltCardholder, tallyRows,
} from './_proof-scan-v2-aos.js';
import { mergeFacts, groupOf, docWord, valueHash as valueHashOf } from './_proof-scan-v2-merge.js';

// v2.1: 3. Attention items are merged per wrong fact (kind 'fact', D-135) and
// every item has a stable key for clears (D-132).
export const RESULT_SCHEMA_VERSION = 3;
export const CONSISTENCY = new Set(['PS-301', 'PS-302', 'PS-303', 'PS-305']); // D-47 "our errors"
export const EVIDENCE_RULE = 'PS-304';                                // D-98, server-computed
export const SHARED_FACTS_RULE = 'PS-305';                            // D-100 #1, server-computed
export const TRANSLATION_RULE = 'PS-306';                             // D-100 #6, server-computed
const SERVER_RULES = new Set([EVIDENCE_RULE, SHARED_FACTS_RULE, TRANSLATION_RULE, ...AOS_SERVER_RULES]);

// D-81: a form is compared only on the address parts it has. Known DACA forms;
// any other form is compared on whatever it shows.
const formKey = (f) => String(f ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const NO_ADDRESS = new Set(['G1145', 'I765WS']);
const HAS_IN_CARE_OF = new Set(['I821D', 'I765']);
const KNOWN_FORMS = new Set(['G28', 'I821D', 'I765', 'G1450', 'G1145', 'I765WS']);
const FOREIGN_PARTS = new Set(['province', 'postal_code', 'country']);

export function formHasField(form, field) {
  const k = formKey(form);
  if (!KNOWN_FORMS.has(k)) return true;
  if (!ADDRESS_FIELDS.includes(field)) return true;
  if (NO_ADDRESS.has(k)) return false;
  if (field === 'in_care_of') return HAS_IN_CARE_OF.has(k);
  if (FOREIGN_PARTS.has(field)) return k === 'G28';
  return true;
}

const US_COUNTRY = /^(united states( of america)?|usa?|u\.?s\.?(a\.?)?)$/i; // D-72
const blank = (v) => v == null || String(v).trim() === '';

// Corrections that miss another form fold into these consistency checks (D-72).
const FIELD_RULE = {
  first_name: 'PS-301', middle_name: 'PS-301', last_name: 'PS-301', a_number: 'PS-302',
  ...Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, 'PS-303'])),
};

// ── Before the call ──────────────────────────────────────────────────────────

// Returns the rules sent to the model, the server-computed rules, the rules
// waiting for a later stage, and the package items to look for.
// v2.1, D-131 / Q-59: an AOS case's kind switches the spousal-only rules and
// items before anything is asked; the other "if needed" conditions (Q-72) are
// read from the package after the call.
const kindAllows = (x, aosKind) => x.applies_when !== 'spousal' || aosKind === 'spousal';

export function selectRules({ ruleSet, stage, scope, form, hasMarkedFiles, aosKind = null }) {
  const filed = new Set(ruleSet.package_items.map((i) => formKey(i.form)));
  const out = { ask: [], server: [], later: [], notThisStage: [], conditional: [] };
  for (const rule of ruleSet.rules) {
    if (rule.retired) continue;
    if (!kindAllows(rule, aosKind)) continue;
    // Never a rule for a form this case type does not file. A rule that applies
    // only when its form is in the package (an I-864A, an I-131) is kept.
    if (rule.form && filed.size && !filed.has(formKey(rule.form)) && !rule.applies_when) continue;
    // D-56: an individual review ignores the rest of the package, so the
    // across-the-package consistency checks do not apply to it.
    if (scope === 'individual') {
      if (rule.form ? formKey(rule.form) !== formKey(form) : CONSISTENCY.has(rule.rule_id)) continue;
    }
    const state = rule.stages?.[stage]?.state || 'not_this_stage';
    if (state === 'later') { out.later.push(rule); continue; }
    if (state === 'not_this_stage') { out.notThisStage.push(rule); continue; }
    // D-100 #6: checked at Draft Review and Pre-flight only when evidence is part
    // of the run, which only the observations can say; decided after the call.
    if (state === 'if_evidence') {
      if (SERVER_RULES.has(rule.rule_id)) { out.server.push(rule); continue; }
      out.conditional.push(rule);
    }
    if (state === 'if_marked') {
      // D-71: checked only when the client's markups show it, so only asked
      // about when there are marked-up pages at all.
      if (stage !== 'preflight' || !hasMarkedFiles) { out.notThisStage.push(rule); continue; }
      out.conditional.push(rule);
    }
    if (SERVER_RULES.has(rule.rule_id)) { out.server.push(rule); continue; }
    out.ask.push(rule);
  }

  // D-56, D-58, D-66, D-73: forms are expected in a whole Draft Review; forms and
  // evidence at Physical Scan; nothing at Pre-flight or in an individual review.
  let items = [];
  const packageItems = ruleSet.package_items.filter((i) => kindAllows(i, aosKind));
  if (stage === 'physical_scan') items = packageItems;
  else if (stage === 'draft_review' && scope === 'whole') items = packageItems.filter((i) => (i.kind || 'form') === 'form');
  return { ...out, items };
}

// ── After the call ───────────────────────────────────────────────────────────

const roleText = (role) => (ROLE_LABELS[role] || '').toLowerCase();

// Which card a form or document is about. DACA is always the one applicant.
function resolvePerson(caseType, people, role) {
  if (caseType === 'daca_renewal') return mainPerson(people);
  if (!role) return mainPerson(people);
  return people.find((p) => p.role === role) || null;
}

function checkTitle(rule, setting, status) {
  if (status === 'clear') return setting?.stage_pass_text || rule.pass_text || rule.title;
  return setting?.stage_title || rule.title;
}

// D-109: a problem leads with what is wrong, never with the rule's own wording
// ("Required signatures are present." over a missing signature read as a pass).
// The model's one-line finding is the headline; without one, say plainly that
// the check was not met.
function problemTitle(rule, setting, summary) {
  const finding = String(summary || '').trim();
  if (finding) return finding;
  return `Not met: ${checkTitle(rule, setting, 'needs_attention')}`;
}

// v2.0.1, D-107: checks where a "no" is a gentle "was this intended?" at every
// stage, and a blank answer means the firm's default, which is fine. The G-28's
// EAD delivery boxes: blank means home.
const CONFIRM_RULES = new Map([
  ['DACA-G28-003', { blankIsClear: true, confirmTitle: 'The EAD will be delivered to the office, not home.' }],
  // v2.1, Q-65: D-107 applies to the AOS applicant's G-28 as in DACA.
  ['AOS-G28A-003', { blankIsClear: true, confirmTitle: 'The card will be delivered to the office, not home.' }],
]);

function whereOf(rule) {
  return [rule.page != null && rule.page !== '' ? `p.${rule.page}` : null, rule.item ? `item ${rule.item}` : null]
    .filter(Boolean).join(', ');
}

const shown = (field, v) => (blank(v) ? 'blank' : displayValue(field, v));

// D-98, D-100 #2: every fact a document carries against the forms about the
// same person, on the full fact list.
const EVIDENCE_FIELDS = ['first_name', 'last_name', 'date_of_birth', 'a_number', 'ead_expiration', ...EXTRA_FIELDS];

// v2.0.2, D-123 / Q-55: blank or duplicate pages are a Possible issue, never
// counted. The server raises it from the model's page observations under this
// key, which can never be suppressed firm-wide: dismissing it is per case only,
// so one "never suggest this" cannot silence it for every package for good.
export const PAGES_REASONING_KEY = 'blank_or_duplicate_pages';
// D-149: a Yes on a suggested answer pattern. Staff silence it by declining
// the pattern in the Rulebook, never by "never suggest".
export const ANSWER_PATTERN_REASONING_KEY = 'answer_pattern';
export const RESERVED_REASONING_KEYS = new Set([PAGES_REASONING_KEY, RELATIONSHIP_REASONING_KEY, ANSWER_PATTERN_REASONING_KEY]);
export const PAGES_RULE = 'PS-103';

// D-121: the actual document, by its type, or by its own printed title when
// its type is "other"; "Other document" only when nothing better is known.
export function evidenceLabel(docType, docTitle) {
  const title = String(docTitle || '').trim().replace(/\s+/g, ' ');
  if (docType === 'other' && title && !/\d{3}/.test(title)) return title.slice(0, 60);
  return DOC_TYPE_LABELS[docType] || DOC_TYPE_LABELS.other;
}

// Q-56, D-116 follow-up: a city of birth is compared only when the birth is
// known to be in the US; a place of marriage is never compared when the
// marriage is known to be outside the US. signals: country values and place
// texts that may say which.
function placeCompared(field, places, countries) {
  const says = [...countries.map(usCountry), ...places.map((v) => placeParts(v).us)].filter((x) => x != null);
  if (says.includes(false)) return false;
  if (field === 'city_of_birth') return says.includes(true);
  return true;
}
const PLACE_FIELDS = new Set(['city_of_birth', 'marriage_place']);

// Words that would carry this case's details into firm-wide text (D-125,
// Q-57): every name and value on the cards, the forms and the evidence.
function caseWords(people, forms, evidence) {
  const words = new Set();
  const add = (v) => {
    if (v == null || typeof v === 'object') return;
    for (const w of normText(v).split(' ')) if (w.length >= 3) words.add(w);
  };
  for (const p of people) for (const f of REFERENCE_FIELDS) add(p[f]);
  for (const f of forms) Object.values(f.values || {}).forEach(add);
  for (const e of evidence) Object.values(e.facts || {}).forEach(add);
  return words;
}
const carriesCase = (text, words) => /\d/.test(String(text || '')) || normText(text).split(' ').some((w) => words.has(w));

// A reasoning key keeps only its general words (Q-57).
function generalKey(key, words) {
  const parts = normalizeReasoningKey(key).split('_').filter((w) => w && !/\d/.test(w) && !words.has(w));
  return parts.length ? normalizeReasoningKey(parts.join('_')) : 'unnamed_reasoning';
}

// D-100 #1: facts compared form against form, per person. Name, A-Number and
// address stay with PS-301 to PS-303, which the model reports; everything else
// shared by two forms about the same person is compared here.
const SHARED_FACTS = [...REFERENCE_FIELDS.filter((f) => !NAME_FIELDS.includes(f) && !ADDRESS_FIELDS.includes(f) && f !== 'a_number'), 'ssn'];
const isEnglish = (lang) => /^(english|en|eng)$/i.test(String(lang || '').trim());

export function evaluateRun(input) {
  const {
    caseType, stage, scope = null, form = null, ruleSet, selection, people, documents = [],
    openSuggestions = [], cardSsn = new Map(), obs, hasMarkedFiles = false, suppressedKeys = [],
    files = [], scannedAt, editionAlerts = [], aosKind = null, answerPatterns = [],
  } = input;
  // General and AOS have one card per person (D-94, D-131); DACA has one person.
  const general = isMultiPerson(caseType);
  const aos = caseType === 'aos';
  const aosObs = aos ? { ...EMPTY_AOS, ...(obs.aos || {}) } : EMPTY_AOS;
  // D-126: "(none)" or "N/A" printed on a form means the field does not apply,
  // which is a blank field, never a value. The stored result keeps what was printed.
  const printedForms = obs.forms_found;
  const forms = printedForms.map((f) => ({
    ...f, values: Object.fromEntries(Object.entries(f.values).map(([k, v]) => [k, isNotApplicable(v) ? '' : v])),
  }));
  const formsPresent = new Set(forms.map((f) => formKey(f.form)));
  const attention = [];
  const notes = [];
  // v2.0.2: gentle confirms, never counted (D-112, D-116, Q-48, Q-50, Q-54, D-127).
  const confirms = new Map();
  const confirm = (id, key, vars = {}) => {
    if (confirms.has(id)) return confirms.get(id);
    const c = {
      rule_id: `confirm:${id}`, status: 'please_confirm', severity: null, form: null, where: '',
      title: copyText(key, vars), expected: null, consistency: false, summary: null, reason: null, evidence: null, locations: [],
    };
    confirms.set(id, c);
    return c;
  };
  const whoOf = (role) => (general && role ? `the ${roleText(role)}'s ` : '');
  const nameOf = (v) => ({ first_name: v.first_name, middle_name: v.middle_name, last_name: v.last_name });
  const splitConfirm = (role, formLast, card, form) => confirm(`name_split:${role || 'main'}`, 'v202.confirm.name_split', {
    who: whoOf(role), form, form_last: redactSsn(formLast), card_name: redactSsn(formatName(card)), card_middle: redactSsn(card.middle_name || ''),
  });
  const countyConfirm = (role, field, place, form) => confirm(`county:${role || 'main'}:${field}`, 'v202.confirm.county', {
    who: whoOf(role), field: FIELD_LABELS[field], place: redactSsn(place), form,
  });

  // ── People: cards found in the forms (D-94, D-95, D-99) ──
  const newPeople = [];       // roles to create
  const cardFills = [];       // { role, person_id?, field, value, source }
  const virtual = people.map((p) => ({ ...p }));
  if (general) {
    const sourceKind = stage === 'physical_scan' ? 'scan' : 'forms';
    for (const f of forms) {
      if (!f.person_role) continue;
      let card = virtual.find((p) => p.role === f.person_role);
      if (!card) {
        card = { id: null, role: f.person_role, field_sources: {}, _new: true };
        virtual.push(card);
        newPeople.push(f.person_role);
      }
      // Fill only fields with no evidence behind them; evidence is never overwritten.
      for (const field of REFERENCE_FIELDS) {
        const raw = f.values[field];
        if (blank(raw) || !formHasField(f.form, field)) continue;
        if (truthValue(card, field) != null) continue;
        const kind = card.field_sources?.[field]?.kind;
        if (!blank(card[field]) && kind === sourceKind) continue; // first form wins
        const c = toCardValue(field, raw);
        if (c.invalid || c.value == null) continue;
        card[field] = c.value;
        card.field_sources = { ...(card.field_sources || {}), [field]: { kind: sourceKind, label: f.form } };
        cardFills.push({ role: card.role, person_id: card.id, field, value: c.value, source: { kind: sourceKind, label: f.form } });
      }
    }
  }
  const personFor = (role) => resolvePerson(caseType, virtual, role);

  // ── v2.1: AOS conditions (Q-59, Q-70, Q-72) and married names (Q-62) ──
  const conditions = aos ? aosConditions({ aosKind, forms, aos: aosObs }) : {};
  const applies = (x) => !x?.applies_when || (aos && Boolean(conditions[x.applies_when]));
  // Q-62: a married name on the forms against the maiden name on the birth
  // certificate is not a mistake when a marriage certificate backs it up: the
  // spouse's last name, or both names together. A gentle confirm asks staff to
  // check the client wants the married name. Spousal AOS cases only.
  const SPOUSE = { petitioner: 'beneficiary', beneficiary: 'petitioner' };
  const marriageCertificate = aos && aosKind === 'spousal' && (
    documents.some((d) => d.status === 'current' && d.doc_type === 'marriage_certificate')
    || obs.evidence_found.some((e) => e.doc_type === 'marriage_certificate' && e.read_quality !== 'unreadable'));
  const spouseLastNames = (role) => {
    const sp = SPOUSE[role];
    const names = new Set();
    const add = (v) => { if (!blank(v)) names.add(normText(v)); };
    for (const p of virtual.filter((x) => x.role === sp)) add(p.last_name);
    for (const f of forms.filter((x) => x.person_role === sp)) add(f.values.last_name);
    return [...names];
  };
  const marriedName = (role, shown, truth) => {
    if (!marriageCertificate || !SPOUSE[role]) return false;
    const first = (n) => normText(n.first_name).split(' ')[0];
    if (!first(shown) || first(shown) !== first(truth)) return false;
    const formLast = normText(shown.last_name);
    const birthLast = normText(truth.last_name);
    if (!formLast || formLast === birthLast) return false;
    return spouseLastNames(role).some((sp) => [sp, `${birthLast} ${sp}`, `${sp} ${birthLast}`].includes(formLast));
  };
  const i94Gentle = (person, field) => aos && (field === 'last_entry_date' || field === 'port_of_entry')
    && person?.field_sources?.[field]?.label === 'I-94';
  const i94Confirm = (field, truth, value, form) => confirm(`i94:${field}:${formKey(form)}`, 'v21.confirm.i94', {
    field: FIELD_LABELS[field], ev_value: redactSsn(displayValue(field, truth)), form, form_value: redactSsn(displayValue(field, value)),
  });
  const marriedConfirm = (role, shownLast, birthLast) => confirm(`married_name:${role}`, 'v21.confirm.married_name', {
    who: whoOf(role), form_last: redactSsn(shownLast), birth_last: redactSsn(birthLast),
  });

  // ── Pre-flight corrections (D-68, D-72, D-73) ──
  let corrections = null;
  const correctionSuggestions = [];
  const departuresMarked = obs.markups.some((m) => m.field === 'departures');
  if (stage === 'preflight' && hasMarkedFiles) {
    const rows = obs.markups.map((m) => {
      let status;
      if (!m.corrected_page_present) status = 'no_page';
      else if (m.field === 'country' && US_COUNTRY.test(String(m.markup_read || '').trim()) && blank(m.corrected)) status = 'omitted_ok';
      else if (m.read_confidence === 'unreadable') status = 'unreadable';
      else if (m.read_confidence === 'uncertain') status = 'check';
      else if (!blank(m.original) && sameValue(m.field, m.corrected, m.original)) status = 'not_fixed';
      else if (sameValue(m.field, m.corrected, m.markup_read)) status = 'fixed';
      else status = 'check';
      return { ...m, status };
    });
    // D-72: a fixed correction must reach every other form in the package.
    const carried = [];
    if (scope === 'whole') {
      for (const c of rows.filter((r) => r.status === 'fixed' && REFERENCE_FIELDS.includes(r.field))) {
        // With several people on the case, a correction about one person only
        // has to reach the forms about that same person (v2.1).
        const whose = forms.find((f) => formKey(f.form) === formKey(c.form))?.person_role;
        const seen = new Set();
        for (const other of forms) {
          if (formKey(other.form) === formKey(c.form)) continue;
          if (general && whose && other.person_role && other.person_role !== whose) continue;
          const v = other.values[c.field];
          if (blank(v) || !formHasField(other.form, c.field)) continue;
          if (seen.has(formKey(other.form))) continue;
          if (!sameValue(c.field, v, c.corrected)) { seen.add(formKey(other.form)); carried.push({ ...c, status: 'not_carried', other_form: other.form, other_value: v }); }
        }
      }
    }
    // D-55, D-72: fixed values are proposed to the record, never written.
    for (const c of rows.filter((r) => r.status === 'fixed' && REFERENCE_FIELDS.includes(r.field))) {
      const owner = personFor(forms.find((f) => formKey(f.form) === formKey(c.form))?.person_role);
      if (!owner?.id) continue;
      const v = toCardValue(c.field, c.corrected);
      if (v.invalid || v.value == null) continue;
      if (truthValue(owner, c.field) != null && sameValue(c.field, owner[c.field], v.value)) continue;
      correctionSuggestions.push({ person_id: owner.id, field: c.field, value: v.value, label: `Client correction, ${c.form} page ${c.page}` });
    }
    corrections = [...rows, ...carried];
  }
  const pending = [
    ...openSuggestions.map((s) => ({ person_id: s.person_id, field: s.field, value: s.value })),
    ...correctionSuggestions,
  ];
  const isPending = (person, field, value) =>
    pending.some((s) => s.person_id === person.id && s.field === field && sameValue(field, s.value, value));

  // ── Checks reported by the model ──
  const obsByRule = new Map(obs.rule_results.map((r) => [r.rule_id, r]));
  const itemObs = new Map(obs.package_items.map((i) => [i.item_id, i]));
  // Q-72: an "if needed" item counts only when the package says it is needed.
  const missingAll = selection.items.filter((i) => itemObs.get(i.item_id)?.status === 'missing' && applies(i));
  // Q-74: a missing US visa or I-94 is a gentle confirm, never counted.
  const missingItems = missingAll.filter((i) => !i.missing_confirm);
  for (const i of missingAll.filter((x) => x.missing_confirm)) {
    confirm(`missing:${i.item_id}`, 'v21.confirm.missing_item', { item: String(i.label || i.form).replace(/^./, (c) => c.toLowerCase()) });
  }
  const unreadableItems = selection.items.filter((i) => itemObs.get(i.item_id)?.status === 'unreadable');
  const missingItemIds = new Set(missingItems.map((i) => i.item_id));

  const checks = [];
  const suppressed = [];
  for (const rule of selection.ask) {
    const setting = rule.stages?.[stage] || {};
    const o = obsByRule.get(rule.rule_id);
    // D-71: departures only when the client's markups show any.
    if (setting.state === 'if_marked' && !departuresMarked) { suppressed.push(rule.rule_id); continue; }
    if (setting.state === 'if_evidence' && !obs.evidence_found.length) { suppressed.push(rule.rule_id); continue; }
    // Q-70, Q-72: a co-sponsor's, household member's or I-131 check only when that form is in the package.
    if (!applies(rule)) { suppressed.push(rule.rule_id); continue; }
    // D-21: a missing form is one item; its own checks are not repeated.
    const dependsOnMissing = (rule.applies_to_item_ids || []).some((id) => missingItemIds.has(id));
    const formMissing = scope !== 'individual' && rule.form && !formsPresent.has(formKey(rule.form));
    if (dependsOnMissing || (formMissing && o.status === 'not_checked')) { suppressed.push(rule.rule_id); continue; }

    let status = o.status;
    const confirmRule = CONFIRM_RULES.get(rule.rule_id) || null;
    if (status === 'blank' && confirmRule?.blankIsClear) status = 'clear'; // D-107
    if (status === 'blank') status = setting.state === 'if_filled' ? 'needs_info' : 'needs_attention'; // D-70
    if (status === 'needs_attention' && confirmRule) status = 'please_confirm'; // D-107
    if (status === 'needs_attention' && setting.gentle_if_no && stage === 'draft_review') status = 'please_confirm'; // D-70
    const summary = redactSsn(o.summary);
    let title = checkTitle(rule, setting, status);
    if (status === 'needs_attention') title = problemTitle(rule, setting, summary);
    if (status === 'please_confirm') title = confirmRule ? confirmRule.confirmTitle : problemTitle(rule, setting, summary);
    checks.push({
      rule_id: rule.rule_id, status, severity: rule.severity, form: rule.form || null, where: whereOf(rule),
      // The firm's own wording for the check, never the finding: the email
      // names what needs attention without any case detail (Q-51).
      rule_title: checkTitle(rule, setting, 'needs_attention'),
      title, expected: setting.stage_expected || rule.expected || null,
      consistency: CONSISTENCY.has(rule.rule_id),
      // The finding is already the headline; it is not repeated underneath.
      summary: title === summary ? null : summary, reason: redactSsn(o.reason), evidence: redactSsn(o.evidence),
      locations: o.locations.map(redactSsn),
    });
  }

  // ── Package items (D-56, D-58) ──
  const packageItems = selection.items.map((i) => ({
    item_id: i.item_id, form: i.form, instance: i.instance ?? null, label: i.label, kind: i.kind || 'form',
    status: itemObs.get(i.item_id)?.status, locations: (itemObs.get(i.item_id)?.locations || []).map(redactSsn),
  }));
  // v2.1: an evidence item is named by its label; an "if needed" item says why
  // it is needed (Q-72).
  const WHY = {
    spousal: 'It is needed in a spousal case.',
    joint_sponsor: 'It is needed because there is a co-sponsor I-864.',
    household_member: 'It is needed because there is an I-864A.',
    i131: 'It is needed because an I-131 is filed.',
    naturalized: 'It is needed because the I-130 says the petitioner naturalized.',
    divorce: 'It is needed because the I-130 or I-130A lists an earlier marriage that ended in divorce.',
  };
  for (const i of missingItems) {
    const evidenceItem = (i.kind || 'form') === 'evidence' && i.form === 'Evidence';
    const name = evidenceItem
      ? String(i.label).replace(/\s*\((?:when|spousal|physical)[^)]*\)\s*$/i, '').replace(/^./, (ch) => ch.toLowerCase())
      : `${i.form}${i.instance ? ` (${i.instance})` : ''}`;
    attention.push({
      kind: 'missing_item', key: `item:${i.item_id}`, form: evidenceItem ? null : i.form,
      title: `The ${name} is missing from the package.`,
      detail: i.applies_when ? WHY[i.applies_when] : `Expected for every ${CASE_TYPE_LABELS[caseType]} ${stage === 'physical_scan' ? 'final package' : 'draft set'}.`,
    });
  }

  // ── The forms against each person's own card ──
  const differences = [];   // per form (Draft Review, Pre-flight)
  const needsInfo = new Map();
  const noReference = new Map();
  if (stage !== 'physical_scan') {
    for (const f of forms) {
      const person = personFor(f.person_role);
      if (!person || person._new) continue; // no card yet: nothing to compare against
      // D-112, D-120: the name is read as a whole first. Capitals never count;
      // first and middle name printed together is the same name; a last name
      // that starts at a different word is a gentle confirm, never counted.
      let namesHandled = false;
      const cardName = { first_name: truthValue(person, 'first_name'), middle_name: truthValue(person, 'middle_name') || '', last_name: truthValue(person, 'last_name') };
      if (cardName.first_name && cardName.last_name && !blank(f.values.last_name)) {
        const cmp = compareNames(nameOf(f.values), cardName);
        if (cmp === 'same') namesHandled = true;
        if (cmp === 'split') { namesHandled = true; splitConfirm(person.role, f.values.last_name, cardName, f.form); }
        if (cmp === 'different' && marriedName(person.role, nameOf(f.values), cardName)) {
          namesHandled = true;
          marriedConfirm(person.role, f.values.last_name, cardName.last_name);
        }
      }
      // D-135: the whole name and the whole address, for the merged item.
      const formName = formatName(nameOf(f.values));
      const cardFull = formatName(cardName);
      const addrParts = ADDRESS_PARTS.filter((k) => formHasField(f.form, k) && !blank(f.values[k]));
      const formAddress = formatAddress(Object.fromEntries(addrParts.map((k) => [k, f.values[k]])));
      const cardAddress = formatAddress(Object.fromEntries(addrParts.map((k) => [k, truthValue(person, k)])));
      for (const field of [...REFERENCE_FIELDS, 'ssn']) {
        const value = f.values[field];
        if (value == null || !formHasField(f.form, field)) continue; // the form has no such field
        if (namesHandled && NAME_FIELDS.includes(field)) continue;
        const truth = field === 'ssn'
          ? (cardSsn.get(person.id) && cardSsn.get(person.id) !== 'unknown' ? cardSsn.get(person.id) : null)
          : truthValue(person, field);
        if (truth == null) {
          const key = `${person.role}:${field}`;
          // D-11: no basis for truth. Draft Review: a blank is information not
          // obtained yet (D-47). Pre-flight: a light note (Q-46).
          if (stage === 'preflight' && !OPTIONAL_FIELDS.has(field)) {
            if (!noReference.has(key)) noReference.set(key, { role: person.role, field, forms: [] });
            noReference.get(key).forms.push(f.form);
          } else if (stage === 'draft_review' && blank(value)) {
            if (!needsInfo.has(key)) needsInfo.set(key, { role: person.role, field, forms: [] });
            needsInfo.get(key).forms.push(f.form);
          }
          continue;
        }
        if (PLACE_FIELDS.has(field) && !blank(value)) {
          if (!placeCompared(field, [truth, value], [truthValue(person, 'country_of_birth'), f.values.country_of_birth].filter((x) => field === 'city_of_birth' && x))) continue;
          if (namesCounty(truth) && !namesCounty(value)) { countyConfirm(person.role, field, truth, f.form); continue; }
        }
        if (field === 'ssn' ? ssnDigits(value) === truth : sameValue(field, truth, value)) continue;
        if (isPending(person, field, value)) continue;
        // Q-61 (AOS): the I-94's entry date and port are Katy's to fill; a form
        // that differs from the I-94 on the card is a gentle nudge, never counted.
        if (i94Gentle(person, field)) { i94Confirm(field, truth, value, f.form); continue; }
        const who = general ? `the ${roleText(person.role)}'s ` : '';
        const grp = groupOf(field);
        differences.push({
          kind: 'reference_difference', key: `ref:${person.role}:${field}:${formKey(f.form)}`,
          person_role: person.role, field, form: f.form,
          group_form_value: grp === 'name' ? formName : grp === 'address' ? formAddress : (field === 'ssn' ? maskSsn(digits(value).slice(-4)) : shown(field, value)),
          group_card_value: grp === 'name' ? cardFull : grp === 'address' ? cardAddress : (field === 'ssn' ? maskSsn(truth.slice(-4)) : displayValue(field, truth)),
          form_value: field === 'ssn' ? maskSsn(digits(value).slice(-4)) : shown(field, value),
          card_value: field === 'ssn' ? maskSsn(truth.slice(-4)) : displayValue(field, truth),
          title: blank(value)
            ? `The ${f.form} leaves ${who}${FIELD_LABELS[field]} blank. The case card has ${field === 'ssn' ? maskSsn(truth.slice(-4)) : displayValue(field, truth)}.`
            : `The ${f.form} shows ${who}${FIELD_LABELS[field]} ${field === 'ssn' ? maskSsn(digits(value).slice(-4)) : displayValue(field, value)}. The case card has ${field === 'ssn' ? maskSsn(truth.slice(-4)) : displayValue(field, truth)}.`,
        });
      }
    }
  }

  // ── Physical Scan: the package against the case card (D-89) ──
  // No client block. Each difference from the card leads the report. Name order,
  // middle initials, A-Number format and address punctuation are not differences.
  const cardDiffs = [];
  if (stage === 'physical_scan') {
    const seen = new Map();
    const add = (person, group, scanned, card, form) => {
      const key = `card:${person.role}:${group}:${normText(scanned)}`;
      if (seen.has(key)) { seen.get(key).forms.push(form); return; }
      const who = general ? `the ${roleText(person.role)}'s ` : 'the ';
      const item = {
        kind: 'case_card_difference', key, person_role: person.role, field: group, forms: [form],
        package_value: scanned, card_value: card,
        title: `The package shows ${who}${FIELD_LABELS[group]} as ${scanned}. The case card has ${card}.`,
      };
      seen.set(key, item);
      cardDiffs.push(item);
    };
    for (const f of forms) {
      const person = personFor(f.person_role);
      if (!person || person._new) continue;
      const v = f.values;
      const strong = (field) => truthValue(person, field);
      if (!blank(v.last_name) && strong('last_name') && strong('first_name')) {
        const scanned = nameOf(v);
        const card = { first_name: strong('first_name'), middle_name: strong('middle_name') || '', last_name: strong('last_name') };
        const cmp = compareNames(scanned, card, { lenientMiddle: true });
        if (cmp === 'split') splitConfirm(person.role, v.last_name, card, f.form);
        else if (cmp !== 'same' && marriedName(person.role, scanned, card)) marriedConfirm(person.role, v.last_name, card.last_name);
        else if (cmp !== 'same') add(person, 'name', formatName(scanned), formatName(card), f.form);
      }
      for (const field of ['a_number', 'date_of_birth', 'ead_expiration', 'phone', 'email', ...EXTRA_FIELDS]) {
        if (blank(v[field]) || strong(field) == null) continue;
        if (PLACE_FIELDS.has(field)) {
          if (!placeCompared(field, [strong(field), v[field]], [strong('country_of_birth'), v.country_of_birth].filter((x) => field === 'city_of_birth' && x))) continue;
          if (namesCounty(strong(field)) && !namesCounty(v[field])) { countyConfirm(person.role, field, strong(field), f.form); continue; }
        }
        if (!sameValue(field, strong(field), v[field])) {
          if (i94Gentle(person, field)) i94Confirm(field, strong(field), v[field], f.form);
          else add(person, field, displayValue(field, v[field]), displayValue(field, strong(field)), f.form);
        }
      }
      const have = cardSsn.get(person.id);
      if (!blank(v.ssn) && have && have !== 'unknown' && ssnDigits(v.ssn) && ssnDigits(v.ssn) !== have) {
        add(person, 'ssn', maskSsn(digits(v.ssn).slice(-4)), maskSsn(have.slice(-4)), f.form);
      }
      const parts = ADDRESS_FIELDS.filter((field) => formHasField(f.form, field) && !blank(v[field]));
      if (!blank(v.street) && strong('street')) {
        const scanned = Object.fromEntries(parts.map((field) => [field, v[field]]));
        const card = Object.fromEntries(parts.map((field) => [field, strong(field)]));
        // D-72: a US country left off the card is never a difference.
        if (card.country == null && US_COUNTRY.test(String(scanned.country || '').trim())) delete scanned.country;
        if (!parts.every((field) => scanned[field] == null || sameValue(field, scanned[field], card[field] ?? ''))) {
          add(person, 'address', formatAddress(scanned), formatAddress(card), f.form);
        }
      }
    }
    // D-105 (v2.0.1): no "not on the case card yet" note at all.
  }

  // ── Evidence matches the forms (D-98, PS-304) ──
  const evidenceRows = [];
  const evidenceRule = selection.server.find((r) => r.rule_id === EVIDENCE_RULE);
  const unclearOwners = [];
  const roleOf = (pid) => virtual.find((p) => p.id === pid)?.role;
  // Evidence read reliably: the Evidence Zero cards and the documents in these files.
  // D-117: each piece of evidence carries the date order of its own country.
  // D-121: and its actual name, and where it is.
  const baseEvidence = [
    ...documents.filter((d) => d.status === 'current' && (d.owner_ids || []).length)
      .map((d) => ({
        doc_type: d.doc_type, label: evidenceLabel(d.doc_type, d.facts?.doc_title), roles: d.owner_ids.map(roleOf).filter(Boolean),
        facts: d.facts || {}, people: Array.isArray(d.facts?.people) ? d.facts.people : [],
        source: 'evidence_zero', where: d.filename || '', country: d.facts?.issuing_country || null,
        order: dateOrderFor(d.facts?.issuing_country, d.facts?.language),
      })),
    ...obs.evidence_found.filter((e) => {
      if (!e.owner_roles.length && general) { unclearOwners.push(e); return false; }
      return e.read_quality === 'clear'; // D-54: an unreliable read never makes a difference
    }).map((e) => ({
      doc_type: e.doc_type, label: evidenceLabel(e.doc_type, e.doc_title), roles: e.owner_roles, facts: e.facts, people: e.people || [],
      source: 'package', where: [e.file, pagesText(e.pages)].filter(Boolean).join(', '), country: e.issuing_country || null,
      order: dateOrderFor(e.issuing_country, e.language),
    })),
  ];
  // v2.1: a document about two people (a marriage certificate) carries each
  // person's own name and date of birth; each is checked as that person's.
  // A passport's own expiry is its passport expiration (Q-61).
  const PERSON_FACTS = ['first_name', 'middle_name', 'last_name', 'date_of_birth'];
  const evidence = baseEvidence.flatMap((ev) => {
    const facts = { ...ev.facts };
    if (ev.doc_type === 'passport' && blank(facts.passport_expiration) && !blank(facts.expiration_date)) facts.passport_expiration = facts.expiration_date;
    const people = (ev.people || []).filter((p) => ev.roles.includes(p.role) || !ev.roles.length);
    if (!people.length) return [{ ...ev, facts }];
    const shared = { ...facts };
    for (const k of PERSON_FACTS) delete shared[k];
    return [{ ...ev, facts: shared }, ...people.map((p) => ({
      ...ev, roles: [p.role], facts: { ...shared, ...Object.fromEntries(PERSON_FACTS.map((k) => [k, p[k] ?? null])) },
    }))];
  });
  const formWhere = (f) => [f.file, pagesText(f.pages)].filter(Boolean).join(', ');
  if (evidenceRule) {
    for (const ev of evidence) {
      const owners = caseType === 'daca_renewal' ? [mainPerson(virtual)?.role] : ev.roles;
      // Q-61 (AOS): the passport is evidence, not truth; only its number and
      // expiration date are checked against the forms.
      const passportOnly = aos && ev.doc_type === 'passport';
      // A date as the document's own country writes it, shown the USCIS way (D-117).
      const evShown = (field, v) => {
        const iso = DATE_FIELDS_SET.has(field) ? normalizeDate(v, { order: ev.order, field }) : null;
        return iso ? displayValue(field, iso) : displayValue(field, v);
      };
      const row = (field, f, person, evValue, fv, ok) => {
        const isName = NAME_FIELDS.includes(field);
        // Q-61 (AOS): the I-94's entry date and port are Katy's to fill; a
        // difference is a gentle nudge, never counted.
        const gentle = !ok && aos && ev.doc_type === 'i94' && (field === 'last_entry_date' || field === 'port_of_entry');
        if (gentle) {
          confirm(`i94:${field}:${formKey(f.form)}`, 'v21.confirm.i94', {
            field: FIELD_LABELS[field], ev_value: redactSsn(displayValue(field, evValue)), form: f.form, form_value: redactSsn(displayValue(field, fv)),
          });
        }
        evidenceRows.push({
          evidence: ev.label, doc_type: ev.doc_type, source: ev.source, owner_roles: owners, field, form: f.form,
          evidence_value: evShown(field, evValue), form_value: blank(fv) ? '' : displayValue(field, fv),
          ok, gentle, person_role: person.role, evidence_where: ev.where, form_where: formWhere(f),
          evidence_group_value: isName ? formatName(nameOf(ev.facts)) : evShown(field, evValue),
          form_group_value: isName ? formatName(nameOf(f.values)) : (blank(fv) ? 'blank' : displayValue(field, fv)),
        });
      };
      for (const f of forms) {
        const person = personFor(f.person_role);
        if (!person || !owners.includes(person.role)) continue;
        // D-112, D-120: the name as a whole first, as a person reads it.
        let namesHandled = passportOnly;
        if (!passportOnly && !blank(ev.facts.last_name) && !blank(f.values.last_name)) {
          const cmp = compareNames(nameOf(ev.facts), nameOf(f.values), { lenientMiddle: true });
          if (cmp === 'different' && marriedName(person.role, nameOf(f.values), nameOf(ev.facts))) {
            namesHandled = true;
            marriedConfirm(person.role, f.values.last_name, ev.facts.last_name);
          }
          if (cmp !== 'different') {
            namesHandled = true;
            for (const field of ['first_name', 'last_name']) {
              if (!blank(ev.facts[field]) && !blank(f.values[field])) row(field, f, person, ev.facts[field], f.values[field], true);
            }
            if (cmp === 'split') {
              splitConfirm(person.role, f.values.last_name, { ...nameOf(ev.facts), middle_name: ev.facts.middle_name || '' }, f.form);
            }
          }
        }
        for (const field of passportOnly ? ['passport_number', 'passport_expiration'] : EVIDENCE_FIELDS) {
          if (namesHandled && NAME_FIELDS.includes(field)) continue;
          const evValue = ev.facts[field];
          if (blank(evValue)) continue;
          const fv = f.values[field];
          // Q-53: an employer the evidence shows but the form leaves out is
          // caught; any other blank on the form is not compared here.
          if (field === 'employer' && fv === '' && formHasField(f.form, field)) { row(field, f, person, evValue, '', false); continue; }
          if (blank(fv)) continue;
          if (PLACE_FIELDS.has(field)) {
            const countries = field === 'city_of_birth'
              ? [ev.facts.country_of_birth, f.values.country_of_birth, ev.doc_type === 'birth_certificate' ? ev.country : null]
              : [ev.doc_type === 'marriage_certificate' ? ev.country : null];
            if (!placeCompared(field, [evValue, fv], countries.filter(Boolean))) continue;
            // D-116: a county against a city is always a gentle confirm, never counted.
            if (namesCounty(evValue) && !namesCounty(fv)) { countyConfirm(person.role, field, evValue, f.form); row(field, f, person, evValue, fv, true); continue; }
          }
          row(field, f, person, evValue, fv, sameValue(field, evValue, fv, { aOrder: ev.order, bOrder: 'mdy' }));
        }
      }
    }
  }
  // D-135 (v2.1): every evidence difference goes into the merged fact it
  // belongs to, beside the case card's, so none is dropped as already reported.
  const evidenceDiffs = evidenceRows.filter((r) => !r.ok && !r.gentle).map((r) => {
    const owner = r.owner_roles.map(roleText).filter(Boolean).join(' and ');
    const vars = {
      owner: owner ? `${owner}'s ` : '', doc: r.evidence.toLowerCase(), doc_where: redactSsn(r.evidence_where) || '',
      field: FIELD_LABELS[r.field], evidence_value: r.evidence_value, form: r.form, form_where: redactSsn(r.form_where) || '',
      form_value: r.form_value,
    };
    return {
      kind: 'evidence_difference', key: `evidence:${r.evidence}:${r.field}:${formKey(r.form)}:${r.person_role}`,
      person_role: r.person_role, field: r.field, form: r.form, doc_type: r.doc_type, evidence: r.evidence,
      evidence_group_value: r.evidence_group_value, form_group_value: r.form_group_value,
      evidence_where: r.evidence_where, form_where: r.form_where,
      title: copyText(r.form_value === '' ? 'v202.evidence_diff_blank' : 'v202.evidence_diff', vars),
    };
  });
  if (evidenceRule) {
    const setting = evidenceRule.stages?.[stage] || {};
    const status = !evidenceRows.length ? 'nothing_to_compare' : evidenceRows.some((r) => !r.ok && !r.gentle) ? 'needs_attention' : 'clear';
    checks.push({
      rule_id: EVIDENCE_RULE, status, severity: evidenceRule.severity, form: null, where: '',
      title: status === 'nothing_to_compare' ? 'No evidence to compare with the forms yet.' : checkTitle(evidenceRule, setting, status),
      expected: null, consistency: false, summary: null, reason: null, evidence: null, locations: [],
      // Each difference is its own attention item (D-98); this row is their heading.
      counted_by_items: true,
    });
  }

  // ── Every shared fact matches across the forms, per person (D-100 #1, PS-305) ──
  // Form against form, so no value is treated as truth (D-79, D-99). A field
  // already reported against the case card or the evidence is not reported twice.
  const formDiffs = [];
  const sharedRule = selection.server.find((r) => r.rule_id === SHARED_FACTS_RULE);
  let sharedCompared = 0;
  if (sharedRule) {
    const reported = (role, field) => [...differences, ...cardDiffs, ...evidenceDiffs]
      .some((d) => d.person_role === role && d.field === field);
    const byPerson = new Map();
    for (const f of forms) {
      const person = personFor(f.person_role);
      const role = person?.role || f.person_role;
      if (!role) continue;
      if (!byPerson.has(role)) byPerson.set(role, []);
      byPerson.get(role).push(f);
    }
    for (const [role, list] of byPerson) {
      for (const field of SHARED_FACTS) {
        const seen = list.filter((f) => !blank(f.values[field]) && formHasField(f.form, field));
        if (seen.length < 2) continue;
        if (PLACE_FIELDS.has(field) && !placeCompared(field, seen.map((f) => f.values[field]),
          field === 'city_of_birth' ? seen.map((f) => f.values.country_of_birth).filter(Boolean) : [])) continue;
        sharedCompared += 1;
        const groups = [];
        for (const f of seen) {
          const g = groups.find((x) => sameValue(field, x.value, f.values[field]));
          if (g) g.forms.push(f.form); else groups.push({ value: f.values[field], forms: [f.form] });
        }
        if (groups.length < 2 || reported(role, field)) continue;
        // A correction that did not reach another form is already its own item (D-72).
        if ((corrections || []).some((c) => c.status === 'not_carried' && c.field === field)) continue;
        const show = (v) => (field === 'ssn' ? maskSsn(digits(v).slice(-4)) : displayValue(field, v));
        const who = general ? `the ${roleText(role)}'s ` : '';
        const parts = groups.map((g) => `${show(g.value)} on the ${[...new Set(g.forms)].join(' and the ')}`);
        formDiffs.push({
          kind: 'form_difference', key: `forms:${role}:${field}`, person_role: role, field,
          forms: groups.flatMap((g) => g.forms), values: groups.map((g) => ({ value: show(g.value), forms: [...new Set(g.forms)] })),
          title: `The forms disagree on ${who}${FIELD_LABELS[field]}. It is ${parts.join(', but ')}.`,
        });
      }
    }
    checks.push({
      rule_id: SHARED_FACTS_RULE, status: formDiffs.length ? 'needs_attention' : sharedCompared ? 'clear' : 'nothing_to_compare',
      severity: sharedRule.severity, form: null, where: '',
      title: formDiffs.length || sharedCompared ? checkTitle(sharedRule, sharedRule.stages?.[stage], formDiffs.length ? 'needs_attention' : 'clear')
        : 'No fact appears on more than one form for the same person.',
      expected: null, consistency: true, summary: null, reason: null, evidence: null, locations: [], counted_by_items: true,
    });
  }

  // ── Foreign-language evidence needs a translation (D-100 #6, PS-306) ──
  const translationItems = [];
  const translationRule = selection.server.find((r) => r.rule_id === TRANSLATION_RULE);
  const translationState = translationRule?.stages?.[stage]?.state;
  if (translationRule && !(translationState === 'if_evidence' && !obs.evidence_found.length)) {
    const readable = obs.evidence_found.filter((e) => e.read_quality !== 'unreadable' && e.doc_type !== 'passport');
    for (const e of readable) {
      if (isEnglish(e.language) || e.has_english_translation) continue;
      // D-124: a passport usually carries its own translation; PS-306 does not apply to it.
      if (e.doc_type === 'passport') continue;
      const owner = e.owner_roles.map(roleText).filter(Boolean).join(' and ');
      translationItems.push({
        // A key without the file name, so a re-run with renamed files keeps a clear (D-132).
        kind: 'translation', key: `translation:${e.doc_type}:${[...e.owner_roles].sort().join(',')}:${normText(e.language)}`, person_role: e.owner_roles[0] || null,
        where: `${e.file}, pages ${e.pages}`,
        title: `The ${owner ? `${owner}'s ` : ''}${evidenceLabel(e.doc_type, e.doc_title).toLowerCase()} is in ${redactSsn(e.language)}. There is no English translation of it in the package.`,
      });
    }
    checks.push({
      rule_id: TRANSLATION_RULE, status: translationItems.length ? 'needs_attention' : readable.length ? 'clear' : 'nothing_to_compare',
      severity: translationRule.severity, form: null, where: '',
      title: readable.length ? checkTitle(translationRule, translationRule.stages?.[stage], translationItems.length ? 'needs_attention' : 'clear')
        : 'No evidence in these files to check for translations.',
      expected: null, consistency: false, summary: null, reason: null, evidence: null, locations: [], counted_by_items: true,
    });
  } else if (translationRule) {
    suppressed.push(TRANSLATION_RULE);
  }

  // ── Corrections that did not reach another form fold into consistency (D-72) ──
  const correctionAttention = [];
  if (corrections) {
    for (const c of corrections) {
      if (c.status === 'not_fixed') {
        correctionAttention.push({ kind: 'correction', key: `corr:${formKey(c.form)}:${c.page}:${c.field}`, form: c.form, field: c.field,
          title: `The client corrected the ${c.form} page ${c.page} ${FIELD_LABELS[c.field] || c.field}, but the corrected page still shows ${shown(c.field, c.corrected)}.` });
      } else if (c.status === 'no_page') {
        correctionAttention.push({ kind: 'correction', key: `corr:${formKey(c.form)}:${c.page}:${c.field}:no_page`, form: c.form, field: c.field,
          title: `The client marked up the ${c.form}, but there is no corrected page for it.` });
      }
    }
    for (const c of corrections.filter((x) => x.status === 'not_carried')) {
      const ruleId = FIELD_RULE[c.field];
      const item = checks.find((i) => i.rule_id === ruleId);
      const title = `The ${FIELD_LABELS[c.field]} was corrected on the ${c.form} but not on the ${c.other_form}.`;
      if (!item) {
        correctionAttention.push({ kind: 'not_carried', key: `carry:${c.field}:${formKey(c.other_form)}`, form: c.other_form, field: c.field, title });
      } else if (item.status !== 'needs_attention') {
        item.status = 'needs_attention';
        item.title = title;
      }
    }
  }

  // ── v2.0.1: the EAD's middle name ──
  // The EAD does not show the full middle name (Max, 2026-10-09). When the forms
  // carry a full middle name and no other evidence shows it, staff confirm it was
  // verified with the client or the client's record. A gentle question, never counted.
  if (caseType === 'daca_renewal') {
    const squash = (v) => String(v || '').replace(/[.\s]/g, '');
    const ead = documents.find((d) => d.status === 'current' && d.doc_type === 'ead');
    const formMiddle = forms.map((f) => String(f.values?.middle_name || '').trim()).find((m) => squash(m).length > 1);
    const backedUp = evidence.some((e) => e.doc_type !== 'ead' && squash(e.facts?.middle_name).length > 1);
    if (ead && formMiddle && !backedUp && squash(ead.facts?.middle_name).length <= 1) {
      checks.push({
        rule_id: 'confirm:middle_name', status: 'please_confirm', severity: null, form: null, where: '',
        title: `The EAD does not show the full middle name (${redactSsn(formMiddle)}). Was it confirmed with the client or the client's record?`,
        expected: null, consistency: false, summary: null, reason: null, evidence: null, locations: [],
      });
    }
  }

  // ── v2.0.2: gentle confirms about the forms themselves ──
  // Q-48: last names and countries on a form are in capitals (firm rule, D-112).
  // Q-54: one first name; a second word is almost always a middle name in the
  // wrong field. Both gentle, never counted.
  const lastNoCaps = [];
  const countryNoCaps = [];
  const firstTwo = [];
  for (const f of printedForms) {
    if (notInCaps(f.values.last_name) && formHasField(f.form, 'last_name')) lastNoCaps.push(f.form);
    if ([...COUNTRY_FIELDS].some((k) => notInCaps(f.values[k]) && formHasField(f.form, k))) countryNoCaps.push(f.form);
    if (twoWordFirstName(f.values.first_name)) firstTwo.push(f.form);
  }
  const listOf = (xs) => [...new Set(xs)].join(', ');
  if (lastNoCaps.length) confirm('caps:last_name', 'v202.confirm.caps_last_name', { forms: listOf(lastNoCaps) });
  if (countryNoCaps.length) confirm('caps:country', 'v202.confirm.caps_country', { forms: listOf(countryNoCaps) });
  if (firstTwo.length) confirm('first_name_words', 'v202.confirm.first_name_words', { forms: listOf(firstTwo) });

  // Q-49, Q-50: Draft Review and Pre-flight never wait for the EAD. When there
  // is none anywhere (not in Evidence Zero, not in these files), they ask for it
  // gently. "No evidence for this case", marked on purpose, is not asked again.
  if (caseType === 'daca_renewal' && (stage === 'draft_review' || stage === 'preflight')) {
    const main = mainPerson(people);
    const onFile = documents.some((d) => d.status === 'current' && d.doc_type === 'ead');
    const inFiles = obs.evidence_found.some((e) => e.doc_type === 'ead' && e.read_quality !== 'unreadable');
    if (!onFile && !inFiles && !main?.no_evidence) confirm('ead_missing', 'v202.confirm.no_ead');
  }

  // D-127: USCIS posted a notice about a form's editions that could not be
  // read with certainty. A person checks it; the checker never guesses.
  const alertForms = new Set(editionAlerts.map(formKey));
  for (const f of printedForms) {
    if (alertForms.has(formKey(f.form))) confirm(`edition_alert:${formKey(f.form)}`, 'v202.confirm.edition_alert', { form: f.form });
  }
  // ── v2.1: AOS checks the server decides (Q-63, Q-64, Q-67, Q-79, D-134) ──
  const documentDiffs = [];
  if (aos) {
    const roleCard = (role) => virtual.find((p) => p.role === role) || null;
    // A person's name as a payment form should show it: the card, else the forms.
    // Every way the person's name appears: the card and each of their forms,
    // so a married name on the forms is still the person (Q-62).
    const who = (role) => {
      const card = roleCard(role);
      return [card, ...forms.filter((x) => x.person_role === role).map((x) => nameOf(x.values))]
        .filter((n) => n && !blank(n.first_name) && !blank(n.last_name));
    };
    // Q-64 guard 1: the age comes from the birth certificate or the case card
    // only, and only when they agree.
    const ben = roleCard('beneficiary');
    const dobs = [truthValue(ben, 'date_of_birth'), ...evidence
      .filter((e) => e.doc_type === 'birth_certificate' && e.roles.includes('beneficiary'))
      .map((e) => normalizeDate(e.facts.date_of_birth, { order: e.order }))]
      .filter(Boolean).map((v) => normalizeDate(v) || v);
    const dob = { settled: dobs.length > 0 && dobs.every((d) => d === dobs[0]), iso: dobs[0] || null };
    const scanDate = String(scannedAt || new Date().toISOString()).slice(0, 10);
    const LANG_FORM = { 'AOS-130A-LANG': 'I-130A', 'AOS-485-LANG': 'I-485', 'AOS-765-LANG': 'I-765' };
    const contactPeople = ['petitioner', 'beneficiary'].map((role) => ({
      role,
      phones: [roleCard(role)?.phone, ...forms.filter((f) => f.person_role === role).map((f) => f.values.phone)].filter((v) => !blank(v)),
      emails: [roleCard(role)?.email, ...forms.filter((f) => f.person_role === role).map((f) => f.values.email)].filter((v) => !blank(v)),
    }));
    for (const rule of selection.server.filter((r) => AOS_SERVER_RULES.has(r.rule_id))) {
      const setting = rule.stages?.[stage] || {};
      if (!applies(rule) || (rule.applies_to_item_ids || []).some((id) => missingItemIds.has(id))) { suppressed.push(rule.rule_id); continue; }
      let d;
      if (rule.rule_id.startsWith('AOS-FEE-')) d = feeDecision(rule, { payments: aosObs.fee_payments, who, dob, scanDate });
      else if (rule.rule_id === 'AOS-G1450-CONTACT') {
        const c = contactCheck(aosObs.fee_payments, contactPeople);
        d = c.status === 'clear' ? { status: 'clear', title: c.none ? 'No card payment (G-1450) in these files.' : null }
          : { status: 'needs_attention', title: contactProblemText(c.problems[0]), reason: c.problems.slice(1).map(contactProblemText).join(' ') || null };
      } else {
        const form = LANG_FORM[rule.rule_id];
        if (!formsPresent.has(formKey(form))) { suppressed.push(rule.rule_id); continue; }
        d = languageDecision(aosObs.language_statements.find((x) => x.form === form), stage);
      }
      const status = d.status;
      checks.push({
        rule_id: rule.rule_id, status, severity: rule.severity, form: rule.form || null, where: whereOf(rule),
        rule_title: checkTitle(rule, setting, 'needs_attention'),
        title: status === 'clear' ? (d.title || checkTitle(rule, setting, 'clear')) : (d.title ? redactSsn(d.title) : problemTitle(rule, setting, null)),
        expected: d.expected || setting.stage_expected || rule.expected || null,
        consistency: false, summary: null, reason: d.reason ? redactSsn(d.reason) : null, evidence: null, locations: [],
      });
    }

    // Q-63 as amended: USCIS no longer takes money orders; one in the package is a gentle confirm.
    if (aosObs.fee_payments.some((p) => p.method === 'money_order')) confirm('money_order', 'v21.confirm.money_order');
    // D-134 as amended: a cardholder that looks like a misspelling of someone on the case.
    const named = virtual.filter((p) => !blank(p.first_name) && !blank(p.last_name));
    for (const pay of aosObs.fee_payments) {
      const like = blank(pay.cardholder_name) ? null : misspeltCardholder(pay.cardholder_name, named);
      if (like) {
        confirm(`cardholder:${normText(pay.cardholder_name).replace(/ /g, '_')}`, 'v21.confirm.cardholder', {
          cardholder: redactSsn(pay.cardholder_name), person: redactSsn(formatName(like)), who: roleText(like.role),
        });
      }
    }
    // Q-60, as D-113: Draft Review and Pre-flight ask gently for evidence when there is none anywhere.
    if ((stage === 'draft_review' || stage === 'preflight') && !documents.some((x) => x.status === 'current')
      && !obs.evidence_found.length && !mainPerson(people)?.no_evidence) confirm('aos_no_evidence', 'v21.confirm.no_evidence');

    // Q-61 follow-up (A): two documents that disagree about the same person are
    // counted. The passport is not a source of truth and the I-94 is Katy's.
    const TRUTH_DOCS = (e) => !['passport', 'i94', 'intake', 'ead'].includes(e.doc_type);
    const seenDocDiff = new Set();
    for (const role of [...new Set(evidence.flatMap((e) => e.roles))]) {
      const docs = evidence.filter((e) => e.roles.length === 1 && e.roles[0] === role && TRUTH_DOCS(e));
      for (let i = 0; i < docs.length; i += 1) {
        for (let j = i + 1; j < docs.length; j += 1) {
          const [a, b] = [docs[i], docs[j]];
          if (a.label === b.label && a.source !== b.source) continue; // the same document on file and in the package
          const diffs = [];
          if (!blank(a.facts.last_name) && !blank(b.facts.last_name)
            && compareNames(nameOf(a.facts), nameOf(b.facts), { lenientMiddle: true }) === 'different'
            && !marriedName(role, nameOf(a.facts), nameOf(b.facts)) && !marriedName(role, nameOf(b.facts), nameOf(a.facts))) {
            diffs.push(['name', formatName(nameOf(a.facts)), formatName(nameOf(b.facts))]);
          }
          if (!blank(a.facts.date_of_birth) && !blank(b.facts.date_of_birth)
            && !sameValue('date_of_birth', a.facts.date_of_birth, b.facts.date_of_birth, { aOrder: a.order, bOrder: b.order })) {
            diffs.push(['date_of_birth', displayValue('date_of_birth', normalizeDate(a.facts.date_of_birth, { order: a.order }) || a.facts.date_of_birth),
              displayValue('date_of_birth', normalizeDate(b.facts.date_of_birth, { order: b.order }) || b.facts.date_of_birth)]);
          }
          for (const [field, av, bv] of diffs) {
            const key = `docs:${role}:${field}:${[normText(av), normText(bv)].sort().join('|')}`;
            if (seenDocDiff.has(key)) continue;
            seenDocDiff.add(key);
            documentDiffs.push({
              kind: 'document_difference', key: `docs:${role}:${field}:${valueHashOf(key)}`, person_role: role, field,
              documents: [{ label: a.label, value: redactSsn(av), where: a.where }, { label: b.label, value: redactSsn(bv), where: b.where }],
              title: copyText('v21.document_difference', {
                who: roleText(role), field: FIELD_LABELS[field], a: docWord(a.label), av: redactSsn(av), b: docWord(b.label), bv: redactSsn(bv),
              }),
            });
          }
        }
      }
    }
  }

  checks.push(...confirms.values());

  // ── Counting (D-23, D-36) ──
  const checkAttention = checks.filter((c) => c.status === 'needs_attention' && !c.counted_by_items);
  const missingAttention = attention.splice(0, attention.length);
  for (const c of checkAttention) attention.push({ kind: 'check', key: `rule:${c.rule_id}`, rule_id: c.rule_id, form: c.form, rule_title: c.rule_title || null, title: c.title });
  const checkItems = attention.splice(0, attention.length);
  // D-135: every wrong fact once, naming every source; then the failed checks,
  // missing items, translations and corrections (Max 2026-10-16).
  const facts = mergeFacts([
    ...differences.map((d) => ({ role: d.person_role, group: groupOf(d.field), field: d.field, form: d.form,
      forms_value: d.group_form_value, source: 'the case card', source_value: d.group_card_value, part: d })),
    ...cardDiffs.map((d) => ({ role: d.person_role, group: d.field, field: d.field, forms: d.forms,
      forms_value: d.package_value, source: 'the case card', source_value: d.card_value, part: d })),
    ...evidenceDiffs.map((d) => ({ role: d.person_role, group: groupOf(d.field), field: d.field, form: d.form,
      forms_value: d.form_group_value, source: `the ${docWord(d.evidence)}`, source_value: d.evidence_group_value, doc: d.evidence,
      copy: d.evidence_where, part: d })),
    ...formDiffs.flatMap((d) => d.values.map((v) => ({ role: d.person_role, group: d.field, field: d.field, forms: v.forms,
      forms_value: v.value, source: null, part: d }))),
  ]).map((f) => ({ ...f, parts: f.parts.filter((x, i, a) => a.indexOf(x) === i) }));
  attention.push(...facts, ...documentDiffs, ...checkItems, ...missingAttention, ...translationItems, ...correctionAttention);
  const notChecked = checks.filter((c) => c.status === 'not_checked').length + unreadableItems.length;
  const state = reportState(attention.length, notChecked);

  for (const [, v] of needsInfo) notes.push({ kind: 'needs_info', person_role: v.role, field: v.field, forms: v.forms, title: `Needs info: ${FIELD_LABELS[v.field]} (${v.forms.join(', ')}).` });
  // D-105 (v2.0.1): the "no reference value" light note is gone too.

  // ── Possible issues: their own list, never counted, never emailed (D-36, D-86) ──
  // D-125, Q-57: what can leave this case (a suggested rule, a suppression)
  // is general: the reasoning key keeps only its general words, and the
  // suggested rule wording is dropped if it carries any of this case's details.
  const words = caseWords(people, forms, evidence);
  const suppressedSet = new Set([...suppressedKeys].filter((k) => !RESERVED_REASONING_KEYS.has(k)));
  const possibleIssues = obs.possible_issues
    .map((p) => ({ ...p, reasoning_key: generalKey(p.reasoning_key || p.title, words) }))
    .filter((p) => !suppressedSet.has(p.reasoning_key) && !RESERVED_REASONING_KEYS.has(p.reasoning_key))
    .map((p) => ({
      title: redactSsn(p.title), description: redactSsn(p.description), evidence: redactSsn(p.evidence),
      why_it_matters: redactSsn(p.why_it_matters), uncertainty: redactSsn(p.uncertainty), reasoning_key: p.reasoning_key,
      general_rule: p.general_rule && !carriesCase(p.general_rule, words) ? String(p.general_rule).trim().slice(0, 500) : null,
    }));

  // D-123, Q-55: blank or duplicate pages, from the model's page observations,
  // when PS-103 is no longer a counted check in this rule set.
  const pageProblems = obs.page_problems || [];
  if (pageProblems.length && !selection.ask.some((r) => r.rule_id === PAGES_RULE)) {
    const where = pageProblems.map((pp) => copyText(`v202.pi.pages.${pp.kind}`, { file: redactSsn(pp.file), pages: redactSsn(pp.pages) })).join('\n');
    possibleIssues.push({
      title: copyText('v202.pi.pages.title'),
      description: copyText('v202.pi.pages.description'),
      evidence: where,
      why_it_matters: copyText('v202.pi.pages.why'),
      uncertainty: copyText('v202.pi.pages.uncertainty'),
      reasoning_key: PAGES_REASONING_KEY,
      general_rule: null,
    });
  }
  // D-100 #5: evidence whose own expiration date has passed is a Possible issue,
  // never counted. An EAD on a DACA renewal is expected to be expiring: that is
  // what the renewal is for, so it is not raised.
  const today = String(scannedAt || new Date().toISOString()).slice(0, 10);
  const expiredSeen = new Set();
  for (const ev of evidence) {
    if (ev.doc_type === 'ead' && caseType === 'daca_renewal') continue;
    const expiry = normalizeDate(ev.facts.expiration_date) || (ev.doc_type === 'ead' ? normalizeDate(ev.facts.ead_expiration) : null);
    if (!expiry || expiry >= today || suppressedSet.has('expired_evidence')) continue;
    const label = ev.label;
    const owner = (caseType === 'daca_renewal' ? [mainPerson(virtual)?.role] : ev.roles).map(roleText).filter(Boolean).join(' and ');
    const key = `${ev.doc_type}|${ev.roles.join(',')}|${expiry}`;
    if (expiredSeen.has(key)) continue;
    expiredSeen.add(key);
    possibleIssues.push({
      title: `The ${owner ? `${owner}'s ` : ''}${docWord(label)} expired on ${displayValue('expiration_date', expiry)}.`,
      description: `The ${docWord(label)} in the evidence has an expiration date that has passed.`,
      evidence: ev.where || label,
      why_it_matters: 'An expired document may need to be replaced or explained, depending on what it is filed to show.',
      uncertainty: 'An expired document can still be the right evidence, for example to show a past entry or identity.',
      reasoning_key: 'expired_evidence',
      general_rule: null,
    });
  }

  // D-131 follow-up: the I-130's relationship box against the kind picked at
  // the start is a Possible issue, never counted. Its key is reserved (like the
  // pages key) so one "never suggest" cannot silence it for every case.
  const mismatch = aos ? relationshipMismatch(aosKind, aosObs.i130_relationship) : null;
  if (mismatch) {
    possibleIssues.push({
      title: copyText('v21.pi.relationship.title', { box: BOX_LABELS[mismatch.box], kind: copyText(`v21.kind.${aosKind}`).toLowerCase() }),
      description: copyText('v21.pi.relationship.description', { expected: BOX_LABELS[mismatch.expected] }),
      evidence: copyText('v21.pi.relationship.evidence'),
      why_it_matters: copyText('v21.pi.relationship.why'),
      uncertainty: copyText('v21.pi.relationship.uncertainty'),
      reasoning_key: RELATIONSHIP_REASONING_KEY,
      general_rule: null,
    });
  }

  // D-149: a Yes on a question the tally suggests is normally No, at every
  // stage. Only the form, the item and the pattern's own general topic words.
  const answers = aos ? tallyRows(aosObs.yes_no_answers, words) : [];
  const patternSeen = new Set();
  for (const a of answers) {
    if (a.answer !== 'yes') continue;
    const p = answerPatterns.find((r) => r.state === 'suggested' && r.form === a.form && r.item === a.item);
    const key = `${a.form}|${a.item}`;
    if (!p || patternSeen.has(key)) continue;
    patternSeen.add(key);
    const vars = { form: p.form, item: p.item, topic: p.topic, no: p.no_count, yes: p.yes_count };
    possibleIssues.push({
      title: copyText('v21.pi.pattern.title', vars),
      description: copyText('v21.pi.pattern.description', vars),
      evidence: `${p.form}, item ${p.item}`,
      why_it_matters: copyText('v21.pi.pattern.why', vars),
      uncertainty: copyText('v21.pi.pattern.uncertainty', vars),
      reasoning_key: ANSWER_PATTERN_REASONING_KEY,
      general_rule: null,
    });
  }

  // D-94: a document whose owner is unclear goes to Possible issues.
  for (const e of unclearOwners) {
    if (suppressedSet.has('evidence_owner_unclear')) break;
    possibleIssues.push({
      title: `Whose ${evidenceLabel(e.doc_type, e.doc_title).toLowerCase()} is this?`,
      description: `A ${evidenceLabel(e.doc_type, e.doc_title).toLowerCase()} in ${e.file} could not be matched to a person on the case, so it was not compared with the forms.`,
      evidence: `${e.file}, pages ${e.pages}`,
      why_it_matters: 'Evidence is checked against the forms of the person it belongs to.',
      uncertainty: 'The document may belong to someone who has no case card yet.',
      reasoning_key: 'evidence_owner_unclear',
      general_rule: null,
    });
  }

  const result = {
    schema_version: RESULT_SCHEMA_VERSION,
    case_type: caseType,
    case_type_label: aos && aosKind ? `${CASE_TYPE_LABELS[caseType]} · ${copyText(`v21.kind.${aosKind}`)}` : CASE_TYPE_LABELS[caseType],
    ...(aos ? { aos_kind: aosKind } : {}),
    stage,
    stage_label: STAGE_LABELS[stage],
    scope,
    form: scope === 'individual' ? form : null,
    rule_set_version: ruleSet.version,
    scan: { files: files.map((f) => ({ filename: f.filename, kind: f.kind || 'package' })), scanned_at: scannedAt },
    report_state: state,
    primary_report_language: reportStateLanguage(state, attention.length),
    attention_count: attention.length,
    not_checked_count: notChecked,
    staff_review_reminder: STAFF_REVIEW_REMINDER,
    attention,
    checks,
    package_items: packageItems,
    later: selection.later.map((r) => ({ rule_id: r.rule_id, title: r.title, form: r.form || null })),
    not_this_stage_count: selection.notThisStage.length + suppressed.length,
    notes,
    forms_found: printedForms.map((f) => ({
      form: f.form, file: f.file, pages: f.pages, person_role: f.person_role,
      values: Object.fromEntries(Object.entries(f.values).filter(([, v]) => v != null)
        .map(([k, v]) => [k, k === 'ssn' ? (blank(v) ? '' : maskSsn(digits(v).slice(-4))) : k === 'a_number' ? v : redactSsn(v)])),
    })),
    evidence_matches: evidenceRows,
    corrections: corrections && corrections.map((c) => ({
      form: c.form, page: c.page, field: c.field, status: c.status, original: c.original, markup_read: c.markup_read,
      read_confidence: c.read_confidence, corrected: c.corrected, other_form: c.other_form || null, other_value: c.other_value || null,
    })),
    new_cards: newPeople,
  };

  return {
    result,
    possibleIssues,
    newPeople,
    cardFills,
    suggestions: correctionSuggestions,
    // D-138: the yes/no answers, as counts to add (no case, no person).
    answers,
  };
}

export function normalizeReasoningKey(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return key || 'unnamed_reasoning';
}
