// proof-scan-v2-suppressions.js: firm-wide suppressed reasoning (D-59).
//
//   GET                              every suppression, the R-1 seed included
//   POST { label, reasoning_key? }   suppress a reasoning pattern for every case
//                                    type; any Proof Scan user may (D-59)
//
// The model is told about every suppression, and the server drops any Possible
// issue whose reasoning matches one, so it cannot come back.

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { normalizeReasoningKey } from './_proof-scan-v2-engine.js';

const AddSchema = z.object({
  label: z.string().trim().min(1).max(300),
  reasoning_key: z.string().trim().min(1).max(80).optional(),
}).strict();

export const onRequest = guarded('proof-scan-v2-suppressions', async ({ request, env }) => {
  if (request.method === 'GET') {
    const gate = await requireStaff(request, env, 'read');
    if (gate.response) return gate.response;
    return json(200, { suppressions: await store.listSuppressions(gate.admin) });
  }
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(AddSchema, parsed.body);
  if (v.error) return v.error;
  const key = normalizeReasoningKey(v.data.reasoning_key || v.data.label);
  if (await store.getSuppressionByKey(gate.admin, key)) throw new HttpError(409, 'That reasoning is already suppressed.');
  const suppression = await store.insertSuppression(gate.admin, {
    reasoning_key: key, label: v.data.label, origin: 'staff', created_by: gate.auth.profile.id,
  });
  return json(201, { suppression });
});
