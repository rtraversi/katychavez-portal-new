// proof-scan-v2-case.js: create a Proof Scan case, or open one.
//
//   POST { case_type, role? }         create. The case type is locked from here
//                                     on (D-77); the folder is not linked to any
//                                     matter or client record (D-83), and it names
//                                     itself from its people (D-101).
//   GET  ?id=<case id>                open: people, documents, open suggestions,
//                                     runs, sign-offs and the evidence requirement.

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { loadCase, publicCaseView } from './_proof-scan-v2-case.js';
import { CASE_TYPES, ROLES, caseLabel } from './_proof-scan-v2-common.js';

const CreateCaseSchema = z.object({
  case_type: z.enum(CASE_TYPES),
  role: z.enum(ROLES).optional(),
}).strict();

const uuid = z.string().uuid();

export const onRequest = guarded('proof-scan-v2-case', async ({ request, env }) => {
  if (request.method === 'GET') {
    const gate = await requireStaff(request, env, 'read');
    if (gate.response) return gate.response;
    const id = new URL(request.url).searchParams.get('id');
    if (!uuid.safeParse(id).success) return json(400, { error: 'id must be a case id' });
    const snapshot = await loadCase(gate.admin, id);
    return json(200, await publicCaseView(gate.admin, snapshot));
  }

  if (request.method === 'POST') {
    const gate = await requireStaff(request, env, 'write');
    if (gate.response) return gate.response;
    const parsed = await readJson(request);
    if (parsed.response) return parsed.response;
    const v = validate(CreateCaseSchema, parsed.body);
    if (v.error) return v.error;
    const { case_type } = v.data;
    const label = caseLabel(case_type, [], new Date().toISOString());

    // DACA is always one applicant (D-94). General starts with the beneficiary
    // unless staff chose another role; more cards are added later.
    const role = case_type === 'daca_renewal' ? 'applicant' : (v.data.role || 'beneficiary');
    const kase = await store.insertCase(gate.admin, { case_type, label, created_by: gate.auth.profile.id });
    await store.insertPerson(gate.admin, { case_id: kase.id, role, is_main: true });
    const snapshot = await loadCase(gate.admin, kase.id);
    return json(201, await publicCaseView(gate.admin, snapshot));
  }

  return methodNotAllowed();
});
