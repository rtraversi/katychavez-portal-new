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
  DOC_TYPE_LABELS, STAGE_LABELS, CASE_TYPE_LABELS, sameValue, sameName, normText, digits, toCardValue,
  displayValue, formatName, formatAddress, truthValue, mainPerson, redactSsn, ssnDigits, maskSsn, normalizeDate,
  reportState, reportStateLanguage, STAFF_REVIEW_REMINDER,
} from './_proof-scan-v2-common.js';

export const RESULT_SCHEMA_VERSION = 2;
export const CONSISTENCY = new Set(['PS-301', 'PS-302', 'PS-303', 'PS-305']); // D-47 "our errors"
export const EVIDENCE_RULE = 'PS-304';                                // D-98, server-computed
export const SHARED_FACTS_RULE = 'PS-305';                            // D-100 #1, server-computed
export const TRANSLATION_RULE = 'PS-306';                             // D-100 #6, server-computed
const SERVER_RULES = new Set([EVIDENCE_RULE, SHARED_FACTS_RULE, TRANSLATION_RULE]);

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
export function selectRules({ ruleSet, stage, scope, form, hasMarkedFiles }) {
  const filed = new Set(ruleSet.package_items.map((i) => formKey(i.form)));
  const out = { ask: [], server: [], later: [], notThisStage: [], conditional: [] };
  for (const rule of ruleSet.rules) {
    if (rule.retired) continue;
    // Never a rule for a form this case type does not file.
    if (rule.form && filed.size && !filed.has(formKey(rule.form))) continue;
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
  if (stage === 'physical_scan') items = ruleSet.package_items;
  else if (stage === 'draft_review' && scope === 'whole') items = ruleSet.package_items.filter((i) => (i.kind || 'form') === 'form');
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
]);

function whereOf(rule) {
  return [rule.page != null && rule.page !== '' ? `p.${rule.page}` : null, rule.item ? `item ${rule.item}` : null]
    .filter(Boolean).join(', ');
}

const shown = (field, v) => (blank(v) ? 'blank' : displayValue(field, v));

// D-98, D-100 #2: every fact a document carries against the forms about the
// same person, on the full fact list.
const EVIDENCE_FIELDS = ['first_name', 'last_name', 'date_of_birth', 'a_number', 'ead_expiration', ...EXTRA_FIELDS];

// D-100 #1: facts compared form against form, per person. Name, A-Number and
// address stay with PS-301 to PS-303, which the model reports; everything else
// shared by two forms about the same person is compared here.
const SHARED_FACTS = [...REFERENCE_FIELDS.filter((f) => !NAME_FIELDS.includes(f) && !ADDRESS_FIELDS.includes(f) && f !== 'a_number'), 'ssn'];
const isEnglish = (lang) => /^(english|en|eng)$/i.test(String(lang || '').trim());

export function evaluateRun(input) {
  const {
    caseType, stage, scope = null, form = null, ruleSet, selection, people, documents = [],
    openSuggestions = [], cardSsn = new Map(), obs, hasMarkedFiles = false, suppressedKeys = [],
    files = [], scannedAt,
  } = input;
  const general = caseType === 'general';
  const forms = obs.forms_found;
  const formsPresent = new Set(forms.map((f) => formKey(f.form)));
  const attention = [];
  const notes = [];

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
        for (const other of forms) {
          if (formKey(other.form) === formKey(c.form)) continue;
          const v = other.values[c.field];
          if (blank(v) || !formHasField(other.form, c.field)) continue;
          if (!sameValue(c.field, v, c.corrected)) carried.push({ ...c, status: 'not_carried', other_form: other.form, other_value: v });
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
  const missingItems = selection.items.filter((i) => itemObs.get(i.item_id)?.status === 'missing');
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
    // D-21: a missing form is one item; its own checks are not repeated.
    const dependsOnMissing = (rule.applies_to_item_ids || []).some((id) => missingItemIds.has(id));
    const formMissing = scope !== 'individual' && rule.form && !formsPresent.has(formKey(rule.form));
    if (dependsOnMissing || (formMissing && o.status === 'not_checked')) { suppressed.push(rule.rule_id); continue; }

    let status = o.status;
    const confirmRule = caseType === 'daca_renewal' ? CONFIRM_RULES.get(rule.rule_id) : null;
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
  for (const i of missingItems) {
    const name = `${i.form}${i.instance ? ` (${i.instance})` : ''}`;
    attention.push({
      kind: 'missing_item', key: `item:${i.item_id}`,
      title: `The ${name} is missing from the package.`,
      detail: `Expected for every ${CASE_TYPE_LABELS[caseType]} ${stage === 'physical_scan' ? 'final package' : 'draft set'}.`,
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
      for (const field of [...REFERENCE_FIELDS, 'ssn']) {
        const value = f.values[field];
        if (value == null || !formHasField(f.form, field)) continue; // the form has no such field
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
        if (field === 'ssn' ? ssnDigits(value) === truth : sameValue(field, truth, value)) continue;
        if (isPending(person, field, value)) continue;
        const who = general ? `the ${roleText(person.role)}'s ` : '';
        differences.push({
          kind: 'reference_difference', key: `ref:${person.role}:${field}:${formKey(f.form)}`,
          person_role: person.role, field, form: f.form,
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
        const scanned = { first_name: v.first_name, middle_name: v.middle_name, last_name: v.last_name };
        if (!sameName(scanned, person)) add(person, 'name', formatName(scanned), formatName(person), f.form);
      }
      for (const field of ['a_number', 'date_of_birth', 'ead_expiration', 'phone', 'email', ...EXTRA_FIELDS]) {
        if (blank(v[field]) || strong(field) == null) continue;
        if (!sameValue(field, strong(field), v[field])) add(person, field, displayValue(field, v[field]), displayValue(field, strong(field)), f.form);
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
  const evidence = [
    ...documents.filter((d) => d.status === 'current' && (d.owner_ids || []).length)
      .map((d) => ({ doc_type: d.doc_type, label: DOC_TYPE_LABELS[d.doc_type], roles: d.owner_ids.map(roleOf).filter(Boolean), facts: d.facts || {}, source: 'evidence_zero', where: d.filename || '' })),
    ...obs.evidence_found.filter((e) => {
      if (!e.owner_roles.length && general) { unclearOwners.push(e); return false; }
      return e.read_quality === 'clear'; // D-54: an unreliable read never makes a difference
    }).map((e) => ({ doc_type: e.doc_type, label: DOC_TYPE_LABELS[e.doc_type], roles: e.owner_roles, facts: e.facts, source: 'package', where: `${e.file}, pages ${e.pages}` })),
  ];
  if (evidenceRule) {
    for (const ev of evidence) {
      const owners = caseType === 'daca_renewal' ? [mainPerson(virtual)?.role] : ev.roles;
      for (const field of EVIDENCE_FIELDS) {
        const evValue = ev.facts[field];
        if (blank(evValue)) continue;
        for (const f of forms) {
          const person = personFor(f.person_role);
          if (!person || !owners.includes(person.role)) continue;
          const fv = f.values[field];
          if (blank(fv)) continue;
          evidenceRows.push({
            evidence: ev.label, source: ev.source, owner_roles: owners, field, form: f.form,
            evidence_value: displayValue(field, evValue), form_value: displayValue(field, fv),
            ok: sameValue(field, evValue, fv), person_role: person.role,
          });
        }
      }
    }
  }
  // Already reported as a difference from the card: not counted twice.
  const alreadyReported = (row) => differences.some((d) => d.person_role === row.person_role && d.field === row.field && formKey(d.form) === formKey(row.form))
    || cardDiffs.some((d) => d.person_role === row.person_role && (d.field === row.field || (d.field === 'name' && NAME_FIELDS.includes(row.field))) && d.forms.some((x) => formKey(x) === formKey(row.form)));
  const evidenceDiffs = evidenceRows.filter((r) => !r.ok && !alreadyReported(r)).map((r) => {
    const owner = r.owner_roles.map(roleText).filter(Boolean).join(' and ');
    return {
      kind: 'evidence_difference', key: `evidence:${r.evidence}:${r.field}:${formKey(r.form)}:${r.person_role}`,
      person_role: r.person_role, field: r.field, form: r.form,
      title: `The ${owner ? `${owner}'s ` : ''}${r.evidence.toLowerCase()} shows ${FIELD_LABELS[r.field]} ${r.evidence_value}. The ${r.form} shows ${r.form_value}.`,
    };
  });
  if (evidenceRule) {
    const setting = evidenceRule.stages?.[stage] || {};
    const status = !evidenceRows.length ? 'nothing_to_compare' : evidenceRows.some((r) => !r.ok) ? 'needs_attention' : 'clear';
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
        sharedCompared += 1;
        const groups = [];
        for (const f of seen) {
          const g = groups.find((x) => sameValue(field, x.value, f.values[field]));
          if (g) g.forms.push(f.form); else groups.push({ value: f.values[field], forms: [f.form] });
        }
        if (groups.length < 2 || reported(role, field)) continue;
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
    const readable = obs.evidence_found.filter((e) => e.read_quality !== 'unreadable');
    for (const e of readable) {
      if (isEnglish(e.language) || e.has_english_translation) continue;
      const owner = e.owner_roles.map(roleText).filter(Boolean).join(' and ');
      translationItems.push({
        kind: 'translation', key: `translation:${e.file}:${e.pages}`, person_role: e.owner_roles[0] || null,
        where: `${e.file}, pages ${e.pages}`,
        title: `The ${owner ? `${owner}'s ` : ''}${DOC_TYPE_LABELS[e.doc_type].toLowerCase()} is in ${redactSsn(e.language)}. There is no English translation of it in the package.`,
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

  // ── Counting (D-23, D-36) ──
  const checkAttention = checks.filter((c) => c.status === 'needs_attention' && !c.counted_by_items);
  for (const c of checkAttention) attention.push({ kind: 'check', key: `rule:${c.rule_id}`, rule_id: c.rule_id, form: c.form, title: c.title });
  attention.push(...differences, ...cardDiffs, ...evidenceDiffs, ...formDiffs, ...translationItems, ...correctionAttention);
  const notChecked = checks.filter((c) => c.status === 'not_checked').length + unreadableItems.length;
  const state = reportState(attention.length, notChecked);

  for (const [, v] of needsInfo) notes.push({ kind: 'needs_info', person_role: v.role, field: v.field, forms: v.forms, title: `Needs info: ${FIELD_LABELS[v.field]} (${v.forms.join(', ')}).` });
  // D-105 (v2.0.1): the "no reference value" light note is gone too.

  // ── Possible issues: their own list, never counted, never emailed (D-36, D-86) ──
  const suppressedSet = new Set(suppressedKeys);
  const possibleIssues = obs.possible_issues
    .map((p) => ({ ...p, reasoning_key: normalizeReasoningKey(p.reasoning_key || p.title) }))
    .filter((p) => !suppressedSet.has(p.reasoning_key))
    .map((p) => ({
      title: redactSsn(p.title), description: redactSsn(p.description), evidence: redactSsn(p.evidence),
      why_it_matters: redactSsn(p.why_it_matters), uncertainty: redactSsn(p.uncertainty), reasoning_key: p.reasoning_key,
    }));
  // D-100 #5: evidence whose own expiration date has passed is a Possible issue,
  // never counted. An EAD on a DACA renewal is expected to be expiring: that is
  // what the renewal is for, so it is not raised.
  const today = String(scannedAt || new Date().toISOString()).slice(0, 10);
  const expiredSeen = new Set();
  for (const ev of evidence) {
    if (ev.doc_type === 'ead' && caseType === 'daca_renewal') continue;
    const expiry = normalizeDate(ev.facts.expiration_date) || (ev.doc_type === 'ead' ? normalizeDate(ev.facts.ead_expiration) : null);
    if (!expiry || expiry >= today || suppressedSet.has('expired_evidence')) continue;
    const label = DOC_TYPE_LABELS[ev.doc_type];
    const owner = (caseType === 'daca_renewal' ? [mainPerson(virtual)?.role] : ev.roles).map(roleText).filter(Boolean).join(' and ');
    const key = `${ev.doc_type}|${ev.roles.join(',')}|${expiry}`;
    if (expiredSeen.has(key)) continue;
    expiredSeen.add(key);
    possibleIssues.push({
      title: `The ${owner ? `${owner}'s ` : ''}${label.toLowerCase()} expired on ${displayValue('expiration_date', expiry)}.`,
      description: `The ${label.toLowerCase()} in the evidence has an expiration date that has passed.`,
      evidence: ev.where || label,
      why_it_matters: 'An expired document may need to be replaced or explained, depending on what it is filed to show.',
      uncertainty: 'An expired document can still be the right evidence, for example to show a past entry or identity.',
      reasoning_key: 'expired_evidence',
    });
  }

  // D-94: a document whose owner is unclear goes to Possible issues.
  for (const e of unclearOwners) {
    if (suppressedSet.has('evidence_owner_unclear')) break;
    possibleIssues.push({
      title: `Whose ${DOC_TYPE_LABELS[e.doc_type].toLowerCase()} is this?`,
      description: `A ${DOC_TYPE_LABELS[e.doc_type].toLowerCase()} in ${e.file} could not be matched to a person on the case, so it was not compared with the forms.`,
      evidence: `${e.file}, pages ${e.pages}`,
      why_it_matters: 'Evidence is checked against the forms of the person it belongs to.',
      uncertainty: 'The document may belong to someone who has no case card yet.',
      reasoning_key: 'evidence_owner_unclear',
    });
  }

  const result = {
    schema_version: RESULT_SCHEMA_VERSION,
    case_type: caseType,
    case_type_label: CASE_TYPE_LABELS[caseType],
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
    forms_found: forms.map((f) => ({
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
  };
}

export function normalizeReasoningKey(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return key || 'unnamed_reasoning';
}
