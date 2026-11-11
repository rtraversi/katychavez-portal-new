// proof-scan-v2-clear.js: clear one item in a stage's report, or undo it (v2.1).
//
//   POST { case_id, stage, key, cleared }   cleared: true clears, false undoes
//
// D-132 (Max 2026-10-16): one click on any needs-attention, not-checked,
// needs-info or please-confirm item, with Undo and no reason. Stored per case
// and stage; who and when are kept but never shown (D-143). Only an item in the
// stage's latest report can be cleared. Answers with the report view the
// server computed from the clears (the result line and every count, D-18) and
// the case view, whose stage tracker counts a fully cleared stage as done.

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { REVIEW_STAGES } from './_proof-scan-v2-common.js';
import { reportView } from './_proof-scan-v2-view.js';
import { loadCase, publicCaseView } from './_proof-scan-v2-case.js';

const ClearSchema = z.object({
  case_id: z.string().uuid(),
  stage: z.enum(REVIEW_STAGES),
  key: z.string().trim().min(1).max(300),
  cleared: z.boolean(),
}).strict();

export const onRequest = guarded('proof-scan-v2-clear', async ({ request, env }) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(ClearSchema, parsed.body);
  if (v.error) return v.error;
  const { case_id, stage, key, cleared } = v.data;
  const { admin } = gate;

  if (!(await store.getCase(admin, case_id))) throw new HttpError(404, 'Case not found');
  const latest = await store.latestRun(admin, case_id, stage);
  const full = latest ? await store.getRun(admin, latest.id) : null;
  if (!full?.result_json) throw new HttpError(409, 'Run this stage before clearing its items.');
  if (!reportView(full.result_json).clearable.includes(key)) throw new HttpError(404, 'That item is not in this stage\'s latest report.');

  await store.deleteClear(admin, case_id, stage, key);
  if (cleared) await store.insertClears(admin, [{ case_id, stage, item_key: key, via: 'hand', cleared_by: gate.auth.profile.id }]);

  const possibleIssues = await store.listPossibleIssues(admin, full.id);
  return json(200, {
    view: reportView(full.result_json, await store.listClears(admin, case_id, stage), { possibleIssues }),
    case_view: await publicCaseView(admin, await loadCase(admin, case_id)),
  });
});
