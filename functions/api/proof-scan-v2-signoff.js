// proof-scan-v2-signoff.js: "Mark this stage reviewed" (D-75).
//
//   POST   { case_id, stage }   sign off the latest run of that stage
//   DELETE { case_id, stage }   undo
//
// The report itself never changes. A new run of the stage clears the sign-off
// (proof-scan-v2-run.js, and the database trigger from migration 2001).

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { REVIEW_STAGES } from './_proof-scan-v2-common.js';

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
  if (request.method === 'POST') {
    const latest = await store.latestRun(admin, case_id, stage);
    if (!latest) throw new HttpError(409, 'Run this stage before marking it reviewed.');
    await store.insertSignoff(admin, { case_id, stage, run_id: latest.id, signed_by: gate.auth.profile.id });
  }
  return json(200, { signoffs: await store.listSignoffs(admin, case_id) });
});
