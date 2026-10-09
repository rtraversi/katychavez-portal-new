// _proof-scan-v2-rulebook.js: rulebook changes as pure functions. NOT a route.
//
// A rule-set version is never edited once a run may have used it (D-60, D-76).
// Every change here takes the current version as plain data and returns the
// NEXT version, plus the internal change-log entries (D-61: no visible
// history, but enough to rebuild how a version came to be). The route writes
// the result as a new version and makes it current.
//
// Firm-wide rules live in every case type's rule set (D-93), so a firm-wide
// change produces one new version per case type that carries the rule.

import { REVIEW_STAGES } from './_proof-scan-v2-common.js';

export const STAGE_STATES = ['checked', 'if_filled', 'if_marked', 'if_evidence', 'later', 'not_this_stage'];
const CASE_PREFIX = { daca_renewal: 'DACA', general: 'GEN' };

// The next free ID for a staff-added or learned rule. Firm-wide rules share one
// series across case types so the same rule keeps the same ID everywhere.
export function nextRuleId(scope, caseType, existingIds) {
  const prefix = scope === 'firm' ? 'FIRM-ADD-' : `${CASE_PREFIX[caseType]}-ADD-`;
  const used = existingIds
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter(Number.isInteger);
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// D-58: Physical Scan runs the full rule set, so every rule is checked there.
// Draft Review and Pre-flight are the staff's choice, checked unless they say.
export function stageSettings(requested = {}, previous = {}) {
  const out = {};
  for (const stage of REVIEW_STAGES) {
    const base = previous[stage] || { state: 'checked', stage_title: null, stage_pass_text: null, stage_expected: null, gentle_if_no: false };
    const state = stage === 'physical_scan' ? 'checked' : requested[stage] || base.state;
    out[stage] = { ...base, state, gentle_if_no: stage === 'draft_review' ? Boolean(base.gentle_if_no) : false };
  }
  return out;
}

const copySet = (ruleSet) => ({
  label: ruleSet.label,
  source_note: ruleSet.source_note ?? null,
  package_items: ruleSet.package_items.map((i) => ({ ...i })),
  rules: ruleSet.rules.map((r) => ({ ...r, stages: structuredClone(r.stages || {}) })),
});

const RULE_FIELDS = ['title', 'form', 'page', 'item', 'expected', 'pass_text', 'note', 'severity'];
const snapshot = (r) => Object.fromEntries([...RULE_FIELDS, 'retired'].map((k) => [k, r[k] ?? null]).concat([['stages', r.stages]]));

// rule: { rule_id, scope, origin, title, form?, page?, item?, expected?, note?, severity, stages? }
export function withRuleAdded(ruleSet, rule) {
  const next = copySet(ruleSet);
  const added = {
    rule_id: rule.rule_id,
    title: rule.title,
    severity: rule.severity || 'fatal',
    check_kind: 'pdf',
    form: rule.form ?? null,
    page: rule.page ?? null,
    item: rule.item ?? null,
    expected: rule.expected ?? null,
    pass_text: rule.pass_text ?? null,
    note: rule.note ?? null,
    source_note: null,
    applies_to_item_ids: [],
    scope: rule.scope,
    origin: rule.origin,
    retired: false,
    stages: stageSettings(rule.stages),
  };
  next.rules.push(added);
  return { ruleSet: next, change: { rule_id: rule.rule_id, action: 'add', before_value: null, after_value: snapshot(added) } };
}

// changes: any of RULE_FIELDS plus retired; stages: { draft_review?, preflight? }.
// Returns null when the rule is not in this version.
export function withRuleEdited(ruleSet, ruleId, changes = {}, stages) {
  const next = copySet(ruleSet);
  const rule = next.rules.find((r) => r.rule_id === ruleId);
  if (!rule) return null;
  const before = snapshot(rule);
  for (const k of RULE_FIELDS) if (k in changes) rule[k] = changes[k] ?? null;
  if (!rule.title) rule.title = before.title;
  if ('retired' in changes) rule.retired = Boolean(changes.retired);
  if (stages) rule.stages = stageSettings(stages, rule.stages);
  const action = 'retired' in changes && changes.retired !== before.retired
    ? (changes.retired ? 'retire' : 'restore')
    : stages && !Object.keys(changes).length ? 'stage_change' : 'edit';
  return { ruleSet: next, change: { rule_id: ruleId, action, before_value: before, after_value: snapshot(rule) } };
}

// For the rulebook screen: firm-wide and case-type rules apart, each with its
// scope, origin and stage settings (D-61). Retired rules are not listed.
export function rulebookView(ruleSet) {
  const live = ruleSet.rules.filter((r) => !r.retired).map((r) => ({
    rule_id: r.rule_id, title: r.title, severity: r.severity, form: r.form, page: r.page, item: r.item,
    expected: r.expected, note: r.note, scope: r.scope, origin: r.origin,
    stages: Object.fromEntries(REVIEW_STAGES.map((s) => [s, r.stages?.[s]?.state || 'not_this_stage'])),
  }));
  return {
    case_type: ruleSet.case_type,
    version: ruleSet.version,
    firm: live.filter((r) => r.scope === 'firm'),
    case_type_rules: live.filter((r) => r.scope === 'case_type'),
    package_items: ruleSet.package_items.map((i) => ({ item_id: i.item_id, form: i.form, instance: i.instance ?? null, label: i.label, pages: i.pages, kind: i.kind })),
  };
}
