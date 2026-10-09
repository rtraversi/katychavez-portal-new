// Proof Scan v2: cases, people, the reference record, suggestions and SSN.
// Every boundary is mocked: auth and the database (an in-memory fake). No
// network call is made.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as caseRoute } from '../../functions/api/proof-scan-v2-case.js';
import { onRequest as casesRoute } from '../../functions/api/proof-scan-v2-cases.js';
import { onRequest as personRoute } from '../../functions/api/proof-scan-v2-person.js';
import { onRequest as suggestionRoute } from '../../functions/api/proof-scan-v2-suggestion.js';
import { onRequest as ssnRoute } from '../../functions/api/proof-scan-v2-ssn.js';
import { ssnEncrypt } from '../../functions/api/_helpers.js';
import { evidenceRequirement } from '../../functions/api/_proof-scan-v2-common.js';
import { seededDb, call, ENV, STAFF, CLIENT, NO_TOKEN, NO_ACCESS } from '../support/proof-scan-v2-harness.js';

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

const create = (body) => call(caseRoute, '/api/proof-scan-v2-case', { method: 'POST', body });
const person = (body) => call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body });

async function dacaCase() {
  const { body } = await create({ case_type: 'daca_renewal' });
  return body;
}

describe('access', () => {
  const routes = [
    [caseRoute, '/api/proof-scan-v2-case', { method: 'POST', body: { case_type: 'general' } }],
    [casesRoute, '/api/proof-scan-v2-cases', {}],
    [personRoute, '/api/proof-scan-v2-person', { method: 'POST', body: { action: 'approve', person_id: crypto.randomUUID() } }],
    [suggestionRoute, '/api/proof-scan-v2-suggestion', { method: 'POST', body: { suggestion_id: crypto.randomUUID(), decision: 'keep' } }],
    [ssnRoute, '/api/proof-scan-v2-ssn', { method: 'POST', body: { action: 'reveal', person_id: crypto.randomUUID() } }],
  ];

  it('refuses a request with no login (anon)', async () => {
    helpersMock.verifyAuth.mockResolvedValue(NO_TOKEN);
    for (const [route, path, opts] of routes) expect((await call(route, path, opts)).status, path).toBe(401);
  });

  it('refuses a Client-role login even with a module grant', async () => {
    helpersMock.verifyAuth.mockResolvedValue(CLIENT);
    for (const [route, path, opts] of routes) expect((await call(route, path, opts)).status, path).toBe(403);
    expect(db.log.filter((e) => e.op !== 'select')).toEqual([]);
  });

  it('refuses a role without proof_scan access', async () => {
    helpersMock.verifyAuth.mockResolvedValue(NO_ACCESS);
    for (const [route, path, opts] of routes) expect((await call(route, path, opts)).status, path).toBe(403);
  });

  it('asks for proof_scan write access on writes and read access on reads', async () => {
    await create({ case_type: 'general' });
    expect(helpersMock.verifyAuth.mock.calls.at(-1).slice(2)).toEqual(['write', 'proof_scan']);
    await call(casesRoute, '/api/proof-scan-v2-cases');
    expect(helpersMock.verifyAuth.mock.calls.at(-1).slice(2)).toEqual(['read', 'proof_scan']);
  });
});

describe('cases', () => {
  it('creates a DACA case with exactly one applicant card', async () => {
    const view = await dacaCase();
    expect(view.case.case_type).toBe('daca_renewal');
    expect(view.people).toHaveLength(1);
    expect(view.people[0]).toMatchObject({ role: 'applicant', is_main: true });
    expect(db.rows('proof_scan_cases')[0].created_by).toBe('staff-1');
  });

  it('creates a General case with the beneficiary first, or the role staff chose', async () => {
    expect((await create({ case_type: 'general' })).body.people[0].role).toBe('beneficiary');
    expect((await create({ case_type: 'general', role: 'petitioner' })).body.people[0].role).toBe('petitioner');
  });

  it('refuses an unknown case type and carries no matter or client link (D-83)', async () => {
    expect((await create({ case_type: 'aos' })).status).toBe(400);
    expect((await create({ case_type: 'general', matter_id: 'm' })).status).toBe(400);
  });

  it('opens a case with people, documents, suggestions, runs, sign-offs and the evidence requirement', async () => {
    const created = await dacaCase();
    const { status, body } = await call(caseRoute, '/api/proof-scan-v2-case', { query: { id: created.case.id } });
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['case', 'documents', 'evidence_requirement', 'people', 'runs', 'signoffs', 'suggestions']);
    expect(body.evidence_requirement.ready).toBe(false);
  });

  it('404s an unknown case', async () => {
    expect((await call(caseRoute, '/api/proof-scan-v2-case', { query: { id: crypto.randomUUID() } })).status).toBe(404);
  });

  it('finds cases by client name or by A-Number in any format', async () => {
    const a = await dacaCase();
    await create({ case_type: 'general' });
    await person({ action: 'edit', person_id: a.people[0].id, fields: { first_name: 'Anna', last_name: 'Persona', a_number: 'A-012-345-678' } });
    for (const q of ['persona', 'Anna Persona', 'PERSONA, Anna']) {
      const byName = await call(casesRoute, '/api/proof-scan-v2-cases', { query: { q } });
      expect(byName.body.cases.map((c) => c.label), q).toEqual(['PERSONA, Anna']);
    }
    for (const q of ['A012345678', '012-345-678', '012345678']) {
      const r = await call(casesRoute, '/api/proof-scan-v2-cases', { query: { q } });
      expect(r.body.cases.map((c) => c.id), q).toEqual([a.case.id]);
    }
  });
});

describe('people (D-94)', () => {
  it('keeps DACA to exactly one person', async () => {
    const view = await dacaCase();
    expect((await person({ action: 'add', case_id: view.case.id, role: 'sponsor' })).status).toBe(409);
    expect((await person({ action: 'remove', person_id: view.people[0].id })).status).toBe(409);
    expect((await person({ action: 'edit', person_id: view.people[0].id, role: 'beneficiary' })).status).toBe(409);
  });

  it('adds, re-roles, re-mains and removes General cards', async () => {
    const view = (await create({ case_type: 'general' })).body;
    const added = await person({ action: 'add', case_id: view.case.id, role: 'petitioner' });
    expect(added.status).toBe(200);
    expect(added.body.people.map((p) => p.role)).toEqual(['beneficiary', 'petitioner']);
    expect((await person({ action: 'add', case_id: view.case.id, role: 'petitioner' })).status).toBe(409);
    const pet = added.body.people.find((p) => p.role === 'petitioner');
    expect((await person({ action: 'remove', person_id: view.people[0].id })).status).toBe(409);
    const main = await person({ action: 'set_main', person_id: pet.id });
    expect(main.body.people.filter((p) => p.is_main).map((p) => p.id)).toEqual([pet.id]);
    const removed = await person({ action: 'remove', person_id: view.people[0].id });
    expect(removed.body.people.map((p) => p.role)).toEqual(['petitioner']);
  });

  it('allows several household members', async () => {
    const view = (await create({ case_type: 'general' })).body;
    await person({ action: 'add', case_id: view.case.id, role: 'household_member' });
    expect((await person({ action: 'add', case_id: view.case.id, role: 'household_member' })).status).toBe(200);
  });
});

describe('the reference record', () => {
  it('stores edits in column form, marks them as staff values, and asks for approval again', async () => {
    const view = await dacaCase();
    const id = view.people[0].id;
    await person({ action: 'approve', person_id: id });
    const r = await person({ action: 'edit', person_id: id, fields: {
      first_name: ' Ana ', a_number: 'A-123-456-789', date_of_birth: '03/22/1998', apt_type: 'apt',
    } });
    expect(r.status).toBe(200);
    const p = r.body.people[0];
    expect(p).toMatchObject({ first_name: 'Ana', a_number: '123456789', date_of_birth: '1998-03-22', apt_type: 'Apt.' });
    expect(p.field_sources.first_name).toEqual({ kind: 'staff' });
    expect(p.changed_since_approval).toBe(true);
  });

  it('rejects a value the column cannot hold, naming the field', async () => {
    const view = await dacaCase();
    const r = await person({ action: 'edit', person_id: view.people[0].id, fields: { date_of_birth: 'sometime' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('date of birth');
  });

  it('never accepts an SSN through the record edit', async () => {
    const view = await dacaCase();
    expect((await person({ action: 'edit', person_id: view.people[0].id, fields: { ssn: '123456789' } })).status).toBe(400);
  });

  it('approves with nothing filled in (D-11)', async () => {
    const view = await dacaCase();
    const r = await person({ action: 'approve', person_id: view.people[0].id });
    expect(r.body.people[0].approved_at).toBeTruthy();
    expect(r.body.people[0].approved_by).toBe('staff-1');
  });
});

describe('the evidence requirement (D-74, D-91, D-95)', () => {
  const ready = {
    is_main: true, first_name: 'A', last_name: 'B', date_of_birth: '1998-03-22', a_number: '123456789',
    ead_expiration: '2027-01-01', street: '1 Test St', city: 'Town', state: 'TX', zip: '77001',
    approved_at: '2026-10-07', changed_since_approval: false, no_evidence: false,
  };
  const ead = [{ status: 'current', doc_type: 'ead' }];

  it('opens DACA only with an EAD, its details, the address and an approved record', () => {
    expect(evidenceRequirement('daca_renewal', [ready], ead)).toEqual({ ready: true, missing: [] });
    expect(evidenceRequirement('daca_renewal', [ready], []).missing).toEqual(['ead_doc']);
    expect(evidenceRequirement('daca_renewal', [{ ...ready, a_number: null }], ead).missing).toEqual(['ead_facts']);
    expect(evidenceRequirement('daca_renewal', [{ ...ready, zip: null }], ead).missing).toEqual(['address']);
    expect(evidenceRequirement('daca_renewal', [{ ...ready, approved_at: null }], ead).missing).toEqual(['approve']);
    // D-103 (v2.0.1): approved once is enough; editing afterwards never blocks a re-run.
    expect(evidenceRequirement('daca_renewal', [{ ...ready, changed_since_approval: true }], ead).ready).toBe(true);
    expect(evidenceRequirement('daca_renewal', [ready], [{ status: 'replaced', doc_type: 'ead' }]).missing).toEqual(['ead_doc']);
  });

  it('lets "no evidence for this case" waive the EAD parts but never the address', () => {
    const none = { ...ready, no_evidence: true, a_number: null };
    expect(evidenceRequirement('daca_renewal', [none], []).ready).toBe(true);
    expect(evidenceRequirement('daca_renewal', [{ ...none, street: null }], []).missing).toEqual(['address']);
  });

  it('has no gate for General', () => {
    expect(evidenceRequirement('general', [], []).ready).toBe(true);
  });

  it('is set through the person route', async () => {
    const view = await dacaCase();
    const r = await person({ action: 'no_evidence', person_id: view.people[0].id, value: true });
    expect(r.body.people[0].no_evidence).toBe(true);
    expect(r.body.evidence_requirement.missing).not.toContain('ead_doc');
  });
});

describe('suggestions (D-55, D-97)', () => {
  async function withSuggestion(row) {
    const view = await dacaCase();
    const pid = view.people[0].id;
    await person({ action: 'edit', person_id: pid, fields: { street: '1 Old St' } });
    await person({ action: 'approve', person_id: pid });
    db.rows('proof_scan_suggestions').push({
      id: crypto.randomUUID(), person_id: pid, status: 'open', source_label: 'Newer EAD', document_id: null,
      run_id: null, value: null, value_encrypted: null, value_last4: null, decided_by: null, decided_at: null,
      created_at: '2026-10-07T13:00:00Z', ...row,
    });
    return { pid, sid: db.rows('proof_scan_suggestions').at(-1).id };
  }
  const decide = (suggestion_id, decision) =>
    call(suggestionRoute, '/api/proof-scan-v2-suggestion', { method: 'POST', body: { suggestion_id, decision } });

  it('use copies the value in, records where it came from, and asks for approval again', async () => {
    const { sid } = await withSuggestion({ field: 'street', value: '2 New St' });
    const r = await decide(sid, 'use');
    expect(r.body.people[0]).toMatchObject({ street: '2 New St', changed_since_approval: true });
    expect(r.body.people[0].field_sources.street).toMatchObject({ kind: 'document', label: 'Newer EAD' });
    expect(r.body.suggestions).toEqual([]);
    expect(db.rows('proof_scan_suggestions')[0]).toMatchObject({ status: 'used', decided_by: 'staff-1' });
  });

  it('keep leaves the record alone', async () => {
    const { sid } = await withSuggestion({ field: 'street', value: '2 New St' });
    const r = await decide(sid, 'keep');
    expect(r.body.people[0].street).toBe('1 Old St');
    expect(db.rows('proof_scan_suggestions')[0].status).toBe('kept');
  });

  it('cannot be decided twice', async () => {
    const { sid } = await withSuggestion({ field: 'street', value: '2 New St' });
    await decide(sid, 'keep');
    expect((await decide(sid, 'use')).status).toBe(409);
  });

  it('moves an SSN suggestion across encrypted, shows only the last four, and audits it', async () => {
    const enc = ssnEncrypt('123456789', ENV);
    const { pid, sid } = await withSuggestion({ field: 'ssn', value_encrypted: enc, value_last4: '6789' });
    const open = await call(caseRoute, '/api/proof-scan-v2-case', { query: { id: db.rows('proof_scan_cases')[0].id } });
    expect(open.body.suggestions[0]).toMatchObject({ field: 'ssn', value: '***-**-6789' });
    expect(JSON.stringify(open.body)).not.toContain(enc);
    const r = await decide(sid, 'use');
    expect(r.body.people[0]).toMatchObject({ has_ssn: true, ssn_masked: '***-**-6789' });
    expect(JSON.stringify(r.body)).not.toContain('123456789');
    expect(db.rows('proof_scan_people').find((p) => p.id === pid).ssn_encrypted).toBe(enc);
    expect(db.rows('sensitive_field_audit')).toEqual([expect.objectContaining({ entity_type: 'proof_scan_people', action: 'write' })]);
  });
});

describe('SSN (D-80)', () => {
  const ssn = (body) => call(ssnRoute, '/api/proof-scan-v2-ssn', { method: 'POST', body });

  it('saves encrypted, returns only the last four, and logs the write', async () => {
    const view = await dacaCase();
    const pid = view.people[0].id;
    const r = await ssn({ action: 'save', person_id: pid, ssn: '123-45-6789' });
    expect(r).toEqual({ status: 200, body: { ok: true, ssn_masked: '***-**-6789' } });
    const row = db.rows('proof_scan_people')[0];
    expect(row.ssn_encrypted).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(row.ssn_last4).toBe('6789');
    expect(db.rows('sensitive_field_audit')).toEqual([expect.objectContaining({
      entity_type: 'proof_scan_people', entity_id: pid, action: 'write', performed_by: 'staff-1',
    })]);
    const open = await call(caseRoute, '/api/proof-scan-v2-case', { query: { id: view.case.id } });
    expect(JSON.stringify(open.body)).not.toContain(row.ssn_encrypted);
    expect(JSON.stringify(open.body)).not.toContain('123456789');
  });

  it('reveals the full SSN only through reveal, and logs every reveal', async () => {
    const view = await dacaCase();
    const pid = view.people[0].id;
    await ssn({ action: 'save', person_id: pid, ssn: '123456789' });
    expect(await ssn({ action: 'reveal', person_id: pid })).toEqual({ status: 200, body: { ssn: '123-45-6789' } });
    await ssn({ action: 'reveal', person_id: pid });
    expect(db.rows('sensitive_field_audit').filter((a) => a.action === 'read')).toHaveLength(2);
  });

  it('reveals a suggested SSN and logs it against the suggestion', async () => {
    const view = await dacaCase();
    const id = crypto.randomUUID();
    db.rows('proof_scan_suggestions').push({ id, person_id: view.people[0].id, field: 'ssn', status: 'open',
      value_encrypted: ssnEncrypt('987654321', ENV), value_last4: '4321', source_label: 'EAD' });
    expect((await ssn({ action: 'reveal', suggestion_id: id })).body).toEqual({ ssn: '987-65-4321' });
    expect(db.rows('sensitive_field_audit')[0]).toMatchObject({ entity_type: 'proof_scan_suggestions', entity_id: id, action: 'read' });
  });

  it('refuses a malformed SSN and clears one on null (D-13)', async () => {
    const view = await dacaCase();
    const pid = view.people[0].id;
    expect((await ssn({ action: 'save', person_id: pid, ssn: '12345' })).status).toBe(400);
    await ssn({ action: 'save', person_id: pid, ssn: '123456789' });
    await ssn({ action: 'save', person_id: pid, ssn: null });
    expect(db.rows('proof_scan_people')[0]).toMatchObject({ ssn_encrypted: null, ssn_last4: null });
  });

  it('404s a reveal with nothing on file', async () => {
    const view = await dacaCase();
    expect((await ssn({ action: 'reveal', person_id: view.people[0].id })).status).toBe(404);
  });
});

describe('database failures', () => {
  it('says plainly when the v2 migrations are not applied', async () => {
    db.fail('proof_scan_cases', { code: '42P01', message: 'relation "proof_scan_cases" does not exist' });
    const r = await create({ case_type: 'general' });
    expect(r.status).toBe(503);
    expect(r.body.error).toContain('2000 to 2003');
  });
});
