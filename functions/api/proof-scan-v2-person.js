// proof-scan-v2-person.js: the case cards (D-94) and each person's reference
// record (D-10, D-49, D-55).
//
// POST { action, ... }:
//   add          { case_id, role }                  General only; DACA is one person
//   edit         { person_id, fields?, role? }      staff edits; every field editable
//   remove       { person_id }                      General only; never the main card
//   set_main     { person_id }                      General only
//   approve      { person_id }                      approve the record as a whole (D-10, D-11)
//   no_evidence  { person_id, value }               "There is no evidence for this case" (D-74, D-91)
//
// The SSN is never edited here; it goes through the audited SSN route (D-80).

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { loadCase, publicCaseView, personInCase } from './_proof-scan-v2-case.js';
import {
  ROLES, REPEATABLE_ROLES, REFERENCE_FIELDS, FIELD_LABELS, toCardValue,
} from './_proof-scan-v2-common.js';

const id = z.string().uuid();
const fieldValue = z.string().max(300).nullable();
const FieldsSchema = z.object(Object.fromEntries(REFERENCE_FIELDS.map((f) => [f, fieldValue.optional()]))).strict();

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), case_id: id, role: z.enum(ROLES) }).strict(),
  z.object({ action: z.literal('edit'), person_id: id, fields: FieldsSchema.optional(), role: z.enum(ROLES).optional() }).strict(),
  z.object({ action: z.literal('remove'), person_id: id }).strict(),
  z.object({ action: z.literal('set_main'), person_id: id }).strict(),
  z.object({ action: z.literal('approve'), person_id: id }).strict(),
  z.object({ action: z.literal('no_evidence'), person_id: id, value: z.boolean() }).strict(),
]);

const HINTS = {
  date_of_birth: 'use a date like 03/22/1998',
  ead_expiration: 'use a date like 03/22/2027',
  a_number: 'use 7 to 9 digits',
  apt_type: 'use Apt., Ste. or Flr.',
};

function roleTaken(people, role, exceptId) {
  return !REPEATABLE_ROLES.has(role) && people.some((p) => p.role === role && p.id !== exceptId);
}

function dacaOnePerson() {
  return new HttpError(409, 'A DACA renewal case has exactly one person.');
}

export const onRequest = guarded('proof-scan-v2-person', async ({ request, env }) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(ActionSchema, parsed.body);
  if (v.error) return v.error;
  const body = v.data;
  const { admin } = gate;
  const userId = gate.auth.profile.id;

  let caseId;
  if (body.action === 'add') {
    const snapshot = await loadCase(admin, body.case_id);
    if (snapshot.case.case_type === 'daca_renewal') throw dacaOnePerson();
    if (roleTaken(snapshot.people, body.role)) throw new HttpError(409, 'This case already has a card for that role.');
    await store.insertPerson(admin, { case_id: body.case_id, role: body.role, is_main: snapshot.people.length === 0 });
    caseId = body.case_id;
  } else {
    const { person, kase } = await personInCase(admin, body.person_id);
    caseId = kase.id;
    const people = await store.listPeople(admin, kase.id);

    if (body.action === 'edit') {
      const patch = {};
      if (body.role && body.role !== person.role) {
        if (kase.case_type === 'daca_renewal') throw new HttpError(409, 'A DACA renewal case is always about the applicant.');
        if (roleTaken(people, body.role, person.id)) throw new HttpError(409, 'This case already has a card for that role.');
        patch.role = body.role;
      }
      const sources = { ...(person.field_sources || {}) };
      let changed = false;
      for (const [field, raw] of Object.entries(body.fields || {})) {
        const c = toCardValue(field, raw);
        if (c.invalid) throw new HttpError(400, `${FIELD_LABELS[field]}: ${HINTS[field] || 'not a valid value'}`);
        if ((person[field] ?? null) === c.value) continue;
        patch[field] = c.value;
        if (c.value == null) delete sources[field];
        else sources[field] = { kind: 'staff' };
        changed = true;
      }
      if (changed) {
        patch.field_sources = sources;
        // D-10: approval is of the record as it stood; an edit asks for it again.
        if (person.approved_at) patch.changed_since_approval = true;
      }
      if (Object.keys(patch).length) await store.updatePerson(admin, person.id, patch);
    } else if (body.action === 'remove') {
      if (kase.case_type === 'daca_renewal') throw dacaOnePerson();
      if (person.is_main) throw new HttpError(409, 'Choose another main person before removing this card.');
      await store.removePersonFromDocuments(admin, person.id);
      await store.deletePerson(admin, person.id);
    } else if (body.action === 'set_main') {
      if (kase.case_type === 'daca_renewal') throw dacaOnePerson();
      if (!person.is_main) {
        for (const p of people.filter((x) => x.is_main)) await store.updatePerson(admin, p.id, { is_main: false });
        await store.updatePerson(admin, person.id, { is_main: true });
      }
    } else if (body.action === 'approve') {
      // D-11: nothing missing ever blocks approval.
      await store.updatePerson(admin, person.id, {
        approved_at: new Date().toISOString(), approved_by: userId, changed_since_approval: false,
      });
    } else if (body.action === 'no_evidence') {
      await store.updatePerson(admin, person.id, { no_evidence: body.value });
    }
  }

  const snapshot = await loadCase(admin, caseId);
  return json(200, await publicCaseView(admin, snapshot));
});
