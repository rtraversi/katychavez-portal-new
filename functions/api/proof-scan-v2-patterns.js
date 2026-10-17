// proof-scan-v2-patterns.js: answer patterns become suggested rules (v2.1, D-138).
//
//   POST { id, decision: 'approve' | 'decline' }
//
// Every AOS Physical Scan adds its yes/no answers to a tally of counts (no
// case, no client). A question answered No on 5 scans and never Yes is
// suggested in the Rulebook as "normally No; flag a Yes". It never switches on
// by itself (R-6, D-59/D-60 spirit): approving adds a case-type rule to a new
// rule-set version (origin 'answer_pattern'); declining means it is never
// suggested again. A Yes ever withdraws a suggestion (Q-68: "most of the crazy
// ones should be no", but some are sometimes yes).

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { createRule } from './proof-scan-v2-rules.js';

const DecisionSchema = z.object({ id: z.string().uuid(), decision: z.enum(['approve', 'decline']) }).strict();

export const onRequest = guarded('proof-scan-v2-patterns', async ({ request, env }) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(DecisionSchema, parsed.body);
  if (v.error) return v.error;
  const { admin } = gate;
  const row = await store.getTallyRow(admin, v.data.id);
  if (!row) throw new HttpError(404, 'Suggestion not found');
  if (row.state !== 'suggested') throw new HttpError(409, 'Only a suggested pattern can be approved or declined.');
  const now = new Date().toISOString();

  if (v.data.decision === 'decline') {
    const updated = await store.updateTallyRow(admin, row.id, { state: 'declined', decided_by: gate.auth.profile.id, decided_at: now, updated_at: now });
    return json(200, { pattern: updated });
  }
  const created = await createRule(admin, {
    scope: 'case_type', case_type: row.case_type, form: row.form, item: row.item,
    title: `${row.form} item ${row.item} (${row.topic}) is answered No.`,
    expected: 'No',
    note: `Suggested from answer patterns and approved by staff (D-138): No on ${row.no_count} scans, never Yes. A Yes is counted: confirm the answer is right, then clear it.`,
    severity: 'fatal',
    stages: { draft_review: 'checked', preflight: 'not_this_stage' },
  }, { userId: gate.auth.profile.id, origin: 'answer_pattern' });
  const updated = await store.updateTallyRow(admin, row.id, {
    state: 'approved', approved_rule_id: created.rule_id, decided_by: gate.auth.profile.id, decided_at: now, updated_at: now,
  });
  return json(200, { pattern: updated, rule_id: created.rule_id, versions: created.versions });
});
