// proof-scan-v2-ssn.js: the audited SSN path for Proof Scan (D-80, D-97).
//
// POST { action: 'save', person_id, ssn }          encrypt and store (ssn: null clears it, D-13)
// POST { action: 'reveal', person_id }             the person's full SSN
// POST { action: 'reveal', suggestion_id }         a suggested SSN, before using it
//
// Same AES-256-GCM helpers and sensitive_field_audit log as save-ssn.js and
// reveal-ssn.js. Every save and every reveal is logged. No other Proof Scan
// route ever returns more than the last four digits.

import { z } from 'zod';
import { ssnEncrypt, ssnDecrypt } from './_helpers.js';
import { requireStaff, readJson, json, guarded, methodNotAllowed, HttpError, clientIp } from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { personInCase } from './_proof-scan-v2-case.js';
import { ssnDigits, maskSsn } from './_proof-scan-v2-common.js';

const id = z.string().uuid();
const SaveSchema = z.object({ action: z.literal('save'), person_id: id, ssn: z.string().max(20).nullable() }).strict();
const RevealPersonSchema = z.object({ action: z.literal('reveal'), person_id: id }).strict();
const RevealSuggestionSchema = z.object({ action: z.literal('reveal'), suggestion_id: id }).strict();

const format = (d) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;

function decrypt(stored, env) {
  try {
    return ssnDecrypt(stored, env);
  } catch (err) {
    console.error('[proof-scan-v2-ssn] decryption error:', err.message);
    throw new HttpError(500, 'Failed to decrypt SSN. Contact support.');
  }
}

export const onRequest = guarded('proof-scan-v2-ssn', async ({ request, env }) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body || {};
  const schema = body.action === 'reveal'
    ? (body.suggestion_id !== undefined ? RevealSuggestionSchema : RevealPersonSchema)
    : SaveSchema;
  const v = validate(schema, body);
  if (v.error) return v.error;
  const { admin } = gate;
  const userId = gate.auth.profile.id;
  const ip = clientIp(request);

  if (v.data.action === 'save') {
    const { person } = await personInCase(admin, v.data.person_id);
    const sources = { ...(person.field_sources || {}) };
    let patch;
    if (v.data.ssn == null || v.data.ssn.trim() === '') {
      delete sources.ssn;
      patch = { ssn_encrypted: null, ssn_last4: null, field_sources: sources };
    } else {
      const d = ssnDigits(v.data.ssn);
      if (!d) return json(400, { error: 'SSN must be exactly 9 digits' });
      let encrypted;
      try { encrypted = ssnEncrypt(d, env); }
      catch (err) {
        console.error('[proof-scan-v2-ssn] encryption error:', err.message);
        return json(500, { error: 'Encryption service unavailable. Contact support.' });
      }
      sources.ssn = { kind: 'staff' };
      patch = { ssn_encrypted: encrypted, ssn_last4: d.slice(-4), field_sources: sources };
    }
    if (person.approved_at) patch.changed_since_approval = true;
    await store.updatePerson(admin, person.id, patch);
    await store.auditSsn(admin, { entityType: 'proof_scan_people', entityId: person.id, action: 'write', userId, ip });
    return json(200, { ok: true, ssn_masked: maskSsn(patch.ssn_last4) });
  }

  if (v.data.suggestion_id) {
    const suggestion = await store.getSuggestion(admin, v.data.suggestion_id);
    if (!suggestion || suggestion.field !== 'ssn' || !suggestion.value_encrypted) {
      throw new HttpError(404, 'No suggested SSN found');
    }
    const ssn = format(decrypt(suggestion.value_encrypted, env));
    await store.auditSsn(admin, { entityType: 'proof_scan_suggestions', entityId: suggestion.id, action: 'read', userId, ip });
    return json(200, { ssn });
  }

  const { person } = await personInCase(admin, v.data.person_id);
  if (!person.ssn_encrypted) throw new HttpError(404, 'No SSN on file for this person');
  const ssn = format(decrypt(person.ssn_encrypted, env));
  await store.auditSsn(admin, { entityType: 'proof_scan_people', entityId: person.id, action: 'read', userId, ip });
  return json(200, { ssn });
});
