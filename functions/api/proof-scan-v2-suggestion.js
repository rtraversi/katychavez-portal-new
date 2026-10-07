// proof-scan-v2-suggestion.js: use or keep a proposed change (D-55, D-72, D-97).
//
// POST { suggestion_id, decision: 'use' | 'keep' }
//   use   copy the proposed value into the person's record (an SSN suggestion
//         moves its encrypted value across, never through plaintext)
//   keep  leave the record as it is
// A suggestion is never applied without this call.

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError, clientIp } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { loadCase, publicCaseView, personInCase } from './_proof-scan-v2-case.js';
import { toCardValue } from './_proof-scan-v2-common.js';

const DecisionSchema = z.object({
  suggestion_id: z.string().uuid(),
  decision: z.enum(['use', 'keep']),
}).strict();

export const onRequest = guarded('proof-scan-v2-suggestion', async ({ request, env }) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(DecisionSchema, parsed.body);
  if (v.error) return v.error;
  const { admin } = gate;
  const userId = gate.auth.profile.id;

  const suggestion = await store.getSuggestion(admin, v.data.suggestion_id);
  if (!suggestion) throw new HttpError(404, 'Suggestion not found');
  if (suggestion.status !== 'open') throw new HttpError(409, 'This suggestion has already been decided.');
  const { person, kase } = await personInCase(admin, suggestion.person_id);

  if (v.data.decision === 'use') {
    const sources = { ...(person.field_sources || {}) };
    sources[suggestion.field] = {
      kind: 'document', label: suggestion.source_label,
      ...(suggestion.document_id ? { document_id: suggestion.document_id } : {}),
    };
    const patch = { field_sources: sources };
    if (suggestion.field === 'ssn') {
      patch.ssn_encrypted = suggestion.value_encrypted;
      patch.ssn_last4 = suggestion.value_last4;
    } else {
      const c = toCardValue(suggestion.field, suggestion.value);
      if (c.invalid) throw new HttpError(409, 'This suggested value cannot be stored. Edit the record by hand instead.');
      patch[suggestion.field] = c.value;
    }
    if (person.approved_at) patch.changed_since_approval = true;
    await store.updatePerson(admin, person.id, patch);
    if (suggestion.field === 'ssn') {
      await store.auditSsn(admin, {
        entityType: 'proof_scan_people', entityId: person.id, action: 'write', userId, ip: clientIp(request),
      });
    }
  }

  await store.updateSuggestion(admin, suggestion.id, {
    status: v.data.decision === 'use' ? 'used' : 'kept',
    decided_by: userId,
    decided_at: new Date().toISOString(),
  });

  const snapshot = await loadCase(admin, kase.id);
  return json(200, await publicCaseView(admin, snapshot));
});
