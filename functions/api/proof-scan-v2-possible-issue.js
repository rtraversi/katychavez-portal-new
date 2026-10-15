// proof-scan-v2-possible-issue.js: staff decisions on a Possible issue (D-35 to
// D-39, D-59, D-60).
//
// POST { issue_id, action: 'accept' }
// POST { issue_id, action: 'dismiss', reason: 'not_an_issue_here' | 'not_useful' | 'never_suggest_reasoning' }
//        'never_suggest_reasoning' also suppresses that reasoning firm-wide,
//        for every case type and every Proof Scan user (D-59).
// POST { issue_id, action: 'suggest_rule', rule: { scope, title, ... } }
//        only after accepting (D-38). It becomes an official, editable rule
//        immediately, in the scope staff chose (D-60); future scans only.
//
// None of this changes the run's count, state or email (D-36).

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { NewRuleSchema, createRule } from './proof-scan-v2-rules.js';
import { normalizeReasoningKey, RESERVED_REASONING_KEYS } from './_proof-scan-v2-engine.js';

// Q-57 (v2.0.2): a suppression stores the reasoning only, never the issue's
// headline or any case detail. Every label is sent to the AI with every scan
// of every case, so it must be general. The key is already general (the engine
// keeps only general words); the label is the key in words.
export function suppressionLabel(key) {
  const words = String(key || '').split('_').filter((w) => w && !/\d/.test(w)).join(' ');
  const text = words ? `${words[0].toUpperCase()}${words.slice(1)}.` : 'Unnamed reasoning.';
  return text.slice(0, 300);
}

const id = z.string().uuid();
const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), issue_id: id }).strict(),
  z.object({
    action: z.literal('dismiss'), issue_id: id,
    reason: z.enum(['not_an_issue_here', 'not_useful', 'never_suggest_reasoning']),
  }).strict(),
  z.object({ action: z.literal('suggest_rule'), issue_id: id, rule: NewRuleSchema.omit({ case_type: true }) }).strict(),
]);

export const onRequest = guarded('proof-scan-v2-possible-issue', async ({ request, env }) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(ActionSchema, parsed.body);
  if (v.error) return v.error;
  const { admin } = gate;
  const userId = gate.auth.profile.id;
  const decided = { decided_by: userId, decided_at: new Date().toISOString() };

  const issue = await store.getPossibleIssue(admin, v.data.issue_id);
  if (!issue) throw new HttpError(404, 'Possible issue not found');

  if (v.data.action === 'accept') {
    if (issue.status !== 'open') throw new HttpError(409, 'This possible issue has already been decided.');
    return json(200, { issue: await store.updatePossibleIssue(admin, issue.id, { status: 'accepted', ...decided }) });
  }

  if (v.data.action === 'dismiss') {
    // D-39: dismissal choices exist only on an open issue.
    if (issue.status !== 'open') throw new HttpError(409, 'This possible issue has already been decided.');
    const never = v.data.reason === 'never_suggest_reasoning';
    // Q-57: without a reasoning key there is nothing general to suppress; the
    // title is never used in its place, it can carry the case's details.
    const key = issue.reasoning_key ? normalizeReasoningKey(issue.reasoning_key) : null;
    // D-123 / Q-55 guard: blank or duplicate pages can be dismissed for this
    // case only. Silencing them firm-wide would hide them on every package for good.
    if (never && (!key || RESERVED_REASONING_KEYS.has(key))) {
      throw new HttpError(409, 'This possible issue can only be dismissed for this case.');
    }
    const updated = await store.updatePossibleIssue(admin, issue.id, { status: 'dismissed', dismiss_reason: v.data.reason, ...decided });
    let suppression = null;
    if (never) {
      suppression = await store.getSuppressionByKey(admin, key)
        || await store.insertSuppression(admin, { reasoning_key: key, label: suppressionLabel(key), origin: 'possible_issue', created_by: userId });
    }
    return json(200, { issue: updated, suppression });
  }

  // suggest_rule
  if (issue.status !== 'accepted') throw new HttpError(409, 'Accept the possible issue before suggesting it as a rule.');
  if ((await store.ruleChangesForIssue(admin, issue.id)).length) {
    throw new HttpError(409, 'A rule has already been created from this possible issue.');
  }
  const run = await store.getRun(admin, issue.run_id);
  const caseType = run?.result_json?.case_type;
  if (v.data.rule.scope === 'case_type' && !caseType) throw new HttpError(409, 'The case type of this run is unknown.');
  const created = await createRule(admin, { ...v.data.rule, case_type: caseType }, {
    userId, origin: 'possible_issue', possibleIssueId: issue.id,
  });
  return json(201, created);
});
