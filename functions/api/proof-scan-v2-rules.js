// proof-scan-v2-rules.js: the rulebook (D-61, D-65, D-76).
//
//   GET   ?case_type=daca_renewal|general   the current version, firm-wide and
//                                           case-type rules apart, each with its
//                                           scope, origin and stage settings
//   POST  { scope, case_type?, title, form?, page?, item?, expected?, note?, severity?, stages? }
//         add a rule (D-65). A firm-wide rule goes into every case type.
//   PATCH { rule_id, case_type?, changes?, stages? }
//         edit a rule (D-76); changes.retired removes it from later runs.
//
// Every change writes a NEW rule-set version and makes it current; a version a
// run used is never touched, so old results stay tied to their rules (D-60).

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { CASE_TYPES } from './_proof-scan-v2-common.js';
import { STAGE_STATES, nextRuleId, withRuleAdded, withRuleEdited, rulebookView } from './_proof-scan-v2-rulebook.js';

const text = (max) => z.string().trim().min(1).max(max);
const optional = (max) => z.string().trim().max(max).nullable().optional();
const StagesSchema = z.object({
  draft_review: z.enum(STAGE_STATES).optional(),
  preflight: z.enum(STAGE_STATES).optional(),
}).strict();

export const NewRuleSchema = z.object({
  scope: z.enum(['firm', 'case_type']),
  case_type: z.enum(CASE_TYPES).optional(),
  title: text(500),
  form: optional(40),
  page: optional(20),
  item: optional(40),
  expected: optional(1000),
  note: optional(2000),
  severity: z.enum(['fatal', 'warning']).optional(),
  stages: StagesSchema.optional(),
}).strict();

const EditSchema = z.object({
  rule_id: text(120),
  case_type: z.enum(CASE_TYPES).optional(),
  changes: z.object({
    title: text(500).optional(),
    form: optional(40),
    page: optional(20),
    item: optional(40),
    expected: optional(1000),
    pass_text: optional(1000),
    note: optional(2000),
    severity: z.enum(['fatal', 'warning']).optional(),
    retired: z.boolean().optional(),
  }).strict().optional(),
  stages: StagesSchema.optional(),
}).strict();

// Applies `change` to the current version of each case type and writes the
// results as new current versions. Returns the new versions by case type.
async function writeVersions(admin, caseTypes, change, userId, possibleIssueId = null) {
  const written = {};
  for (const caseType of caseTypes) {
    const current = await store.loadCurrentRuleSet(admin, caseType);
    if (!current) throw new HttpError(503, 'No rule set is configured for this case type. Apply migration 2003.');
    const next = change(current);
    if (!next) continue;
    const version = (await store.maxRuleSetVersion(admin, caseType)) + 1;
    const set = await store.writeRuleSetVersion(admin, caseType, version, next.ruleSet, userId);
    await store.insertRuleChanges(admin, [{
      rule_set_id: set.id, previous_rule_set_id: current.id, ...next.change,
      possible_issue_id: possibleIssueId, changed_by: userId,
    }]);
    written[caseType] = version;
  }
  return written;
}

// Shared with the Possible issues route (D-60: "Suggest as a future rule").
export async function createRule(admin, rule, { userId, origin, possibleIssueId = null }) {
  if (rule.scope === 'case_type' && !rule.case_type) throw new HttpError(400, 'Choose the case type for a case-type rule.');
  const caseTypes = rule.scope === 'firm' ? CASE_TYPES : [rule.case_type];
  const prefixIds = await store.ruleIdsWithPrefix(admin, rule.scope === 'firm' ? 'FIRM-ADD-' : rule.case_type === 'general' ? 'GEN-ADD-' : 'DACA-ADD-');
  const ruleId = nextRuleId(rule.scope, rule.case_type, prefixIds);
  const versions = await writeVersions(admin, caseTypes,
    (current) => withRuleAdded(current, { ...rule, rule_id: ruleId, origin }), userId, possibleIssueId);
  return { rule_id: ruleId, versions };
}

export const onRequest = guarded('proof-scan-v2-rules', async ({ request, env }) => {
  if (request.method === 'GET') {
    const gate = await requireStaff(request, env, 'read');
    if (gate.response) return gate.response;
    const caseType = new URL(request.url).searchParams.get('case_type');
    if (!CASE_TYPES.includes(caseType)) return json(400, { error: `case_type must be one of: ${CASE_TYPES.join(', ')}` });
    const current = await store.loadCurrentRuleSet(gate.admin, caseType);
    if (!current) throw new HttpError(503, 'No rule set is configured for this case type. Apply migration 2003.');
    return json(200, { ...rulebookView(current), suppressions: await store.listSuppressions(gate.admin) });
  }

  if (request.method !== 'POST' && request.method !== 'PATCH') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const userId = gate.auth.profile.id;

  if (request.method === 'POST') {
    const v = validate(NewRuleSchema, parsed.body);
    if (v.error) return v.error;
    const created = await createRule(gate.admin, v.data, { userId, origin: 'staff_added' });
    return json(201, created);
  }

  const v = validate(EditSchema, parsed.body);
  if (v.error) return v.error;
  const { rule_id, changes = {}, stages } = v.data;
  if (!Object.keys(changes).length && !stages) return json(400, { error: 'Nothing to change.' });

  // A firm-wide rule is edited everywhere it lives; a case-type rule only in
  // its own case type.
  const caseTypes = [];
  for (const caseType of v.data.case_type ? [v.data.case_type] : CASE_TYPES) {
    const current = await store.loadCurrentRuleSet(gate.admin, caseType);
    const rule = current?.rules.find((r) => r.rule_id === rule_id);
    if (!rule) continue;
    if (rule.scope === 'firm') {
      caseTypes.splice(0, caseTypes.length, ...CASE_TYPES);
      break;
    }
    caseTypes.push(caseType);
  }
  if (!caseTypes.length) throw new HttpError(404, 'Rule not found');
  const versions = await writeVersions(gate.admin, caseTypes,
    (current) => withRuleEdited(current, rule_id, changes, stages), userId);
  return json(200, { rule_id, versions });
});
