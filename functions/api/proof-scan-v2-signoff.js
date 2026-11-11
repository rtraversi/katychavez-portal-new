// proof-scan-v2-signoff.js: "Mark this stage reviewed" (D-75).
//
//   POST   { case_id, stage }   sign off the latest run of that stage
//   DELETE { case_id, stage }   undo
//
// The report itself never changes. A new run of the stage clears the sign-off
// (proof-scan-v2-run.js, and the database trigger from migration 2001).
// v2.1, D-139 ("stage reviewed means everything gets cleared"): marking it
// clears every item in that stage's latest report; unmarking takes back only
// those, never the items staff cleared by hand. Answers with the report view.

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { REVIEW_STAGES } from './_proof-scan-v2-common.js';
import { reportView } from './_proof-scan-v2-view.js';
import { loadCase, publicCaseView } from './_proof-scan-v2-case.js';

const SignoffSchema = z.object({ case_id: z.string().uuid(), stage: z.enum(REVIEW_STAGES) }).strict();

export const onRequest = guarded('proof-scan-v2-signoff', async ({ request, env }) => {
  if (request.method !== 'POST' && request.method !== 'DELETE') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(SignoffSchema, parsed.body);
  if (v.error) return v.error;
  const { case_id, stage } = v.data;
  const { admin } = gate;

  if (!(await store.getCase(admin, case_id))) throw new HttpError(404, 'Case not found');
  await store.deleteSignoff(admin, case_id, stage);
  await store.deleteReviewClears(admin, case_id, stage);
  const latest = await store.latestRun(admin, case_id, stage);
  const full = latest ? await store.getRun(admin, latest.id) : null;
  if (request.method === 'POST') {
    if (!latest) throw new HttpError(409, 'Run this stage before marking it reviewed.');
    await store.insertSignoff(admin, { case_id, stage, run_id: latest.id, signed_by: gate.auth.profile.id });
    if (full?.result_json) {
      const have = new Set((await store.listClears(admin, case_id, stage)).map((c) => c.item_key));
      const keys = reportView(full.result_json).clearable.filter((k) => !have.has(k));
      await store.insertClears(admin, keys.map((item_key) => ({ case_id, stage, item_key, via: 'review', cleared_by: gate.auth.profile.id })));
    }
  }
  const possibleIssues = full ? await store.listPossibleIssues(admin, full.id) : [];
  return json(200, {
    signoffs: await store.listSignoffs(admin, case_id),
    view: full?.result_json ? reportView(full.result_json, await store.listClears(admin, case_id, stage), { possibleIssues }) : null,
    case_view: await publicCaseView(admin, await loadCase(admin, case_id)),
  });
});
