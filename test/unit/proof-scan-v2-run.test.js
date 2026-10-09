// Proof Scan v2: Draft Review, Pre-flight and Physical Scan (specs E.2, E.3).
// The model is mocked; every answer below is synthetic. The engine's decisions
// are checked through the real route, against an in-memory database.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as runRoute } from '../../functions/api/proof-scan-v2-run.js';
import { ssnEncrypt } from '../../functions/api/_helpers.js';
import {
  seededDb, call, ENV, STAFF, CLIENT, NO_TOKEN, pdfFile, oversizePdf, mockModel,
  observations, formValues, evidenceFacts, askedRuleIds, askedItemIds,
} from '../support/proof-scan-v2-harness.js';

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

// ── Fixtures (synthetic) ─────────────────────────────────────────────────────

const NAME = { first_name: 'ANA', middle_name: 'MARIA', last_name: 'RIVERA' };
const ADDRESS = { street: '1 TEST ST', city: 'TESTVILLE', state: 'TX', zip: '77001' };
const CARD = { ...NAME, ...ADDRESS, date_of_birth: '1998-03-22', a_number: '123456789', ead_expiration: '2027-01-15', phone: '5550100100', email: 'ana@example.test' };
const PERSON_NULLS = Object.fromEntries(['first_name', 'middle_name', 'last_name', 'street', 'apt_type', 'apt_number', 'city', 'state', 'zip',
  'in_care_of', 'province', 'postal_code', 'country', 'date_of_birth', 'a_number', 'ead_expiration', 'phone', 'email'].map((f) => [f, null]));
const docSources = (fields) => Object.fromEntries(Object.keys(fields).map((f) => [f, { kind: 'document', label: 'EAD' }]));

function addCase(case_type) {
  const id = crypto.randomUUID();
  db.rows('proof_scan_cases').push({ id, case_type, label: 'Test', created_at: '2026-10-07T00:00:00Z' });
  return id;
}
function addPerson(caseId, role, fields = {}, extra = {}) {
  const id = crypto.randomUUID();
  db.rows('proof_scan_people').push({
    id, case_id: caseId, role, is_main: false, ...PERSON_NULLS, ...fields, field_sources: docSources(fields),
    approved_at: '2026-10-07T00:00:00Z', approved_by: 'staff-1', changed_since_approval: false, no_evidence: false,
    ssn_encrypted: null, ssn_last4: null, created_at: `2026-10-07T00:00:0${db.rows('proof_scan_people').length}Z`, ...extra,
  });
  return id;
}
function addDoc(caseId, ownerIds, doc_type, facts) {
  const id = crypto.randomUUID();
  db.rows('proof_scan_documents').push({ id, case_id: caseId, doc_type, read_quality: 'clear', unreadable_fields: [], filename: `${doc_type}.pdf`,
    facts, status: 'current', replaced_by: null, type_corrected: false, created_at: '2026-10-07T00:00:00Z' });
  for (const pid of ownerIds) db.rows('proof_scan_document_people').push({ document_id: id, person_id: pid, proposed_by: 'ai' });
  return id;
}
function readyDaca(card = CARD) {
  const caseId = addCase('daca_renewal');
  const personId = addPerson(caseId, 'applicant', card, { is_main: true });
  addDoc(caseId, [personId], 'ead', { first_name: 'ANA', last_name: 'RIVERA', date_of_birth: '03/22/1998', a_number: '123-456-789', ead_expiration: '01/15/2027' });
  return { caseId, personId };
}

const form = (name, values, person_role = 'applicant', file = 'package.pdf') => ({ form: name, file, pages: '1', person_role, values: formValues(values) });
function dacaForms(over = {}) {
  const v = (name, base) => ({ ...base, ...(over[name] || {}) });
  return [
    form('G-1450', v('G-1450', { ...NAME, phone: '(555) 010-0100', email: 'ana@example.test' })),
    form('G-1450', v('G-1450', { ...NAME, phone: '(555) 010-0100', email: 'ana@example.test' })),
    form('G-1145', v('G-1145', { ...NAME, phone: '555-010-0100', email: 'ana@example.test' })),
    form('G-28', v('G-28', { ...NAME, ...ADDRESS, a_number: 'A123456789' })),
    form('I-821D', v('I-821D', { ...NAME, ...ADDRESS, date_of_birth: '03/22/1998', a_number: '123-456-789' })),
    form('I-765', v('I-765', { ...NAME, ...ADDRESS, date_of_birth: '03/22/1998', a_number: 'A-123-456-789' })),
    form('I-765WS', v('I-765WS', { ...NAME })),
  ].filter((f) => !(over.omit || []).includes(f.form));
}

const run = (body, env) => call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body: { files: [pdfFile()], ...body } }, env);
const attentionKinds = (r) => r.body.result.attention.map((a) => a.kind);
const check = (r, id) => r.body.result.checks.find((c) => c.rule_id === id);

// ── Access, input, gate ──────────────────────────────────────────────────────

describe('access and input', () => {
  it('refuses anon and the Client role, and calls nothing', async () => {
    const { caseId } = readyDaca();
    helpersMock.verifyAuth.mockResolvedValue(NO_TOKEN);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).status).toBe(401);
    helpersMock.verifyAuth.mockResolvedValue(CLIENT);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses a file over 12 MB, or files over 22 MB together, with a clear message (D-95)', async () => {
    const { caseId } = readyDaca();
    const big = await run({ case_id: caseId, stage: 'physical_scan', files: [pdfFile('pkg.pdf', { file_base64: oversizePdf(12) })] });
    expect(big).toEqual({ status: 400, body: { error: 'pkg.pdf is larger than 12 MB. Reduce the file size and try again.' } });
    const eleven = oversizePdf(11).slice(0, -8);
    const total = await run({ case_id: caseId, stage: 'physical_scan', files: [pdfFile('a.pdf', { file_base64: eleven }), pdfFile('b.pdf', { file_base64: eleven }), pdfFile('c.pdf')] });
    expect(total.body.error).toBe('These files add up to more than 22 MB. Reduce them and try again.');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('enforces scope: required at Draft Review and Pre-flight, refused at Physical Scan (D-56)', async () => {
    const { caseId } = readyDaca();
    expect((await run({ case_id: caseId, stage: 'draft_review' })).status).toBe(400);
    expect((await run({ case_id: caseId, stage: 'physical_scan', scope: 'whole' })).status).toBe(400);
    expect((await run({ case_id: caseId, stage: 'preflight', scope: 'individual' })).status).toBe(400);
  });

  it('accepts marked-up and corrected pages at Pre-flight only (D-68)', async () => {
    const { caseId } = readyDaca();
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole', files: [pdfFile('m.pdf', { kind: 'marked' })] });
    expect(r.status).toBe(400);
  });

  it('stops a DACA run until the evidence requirement is met, without calling the AI (D-74, D-91)', async () => {
    const caseId = addCase('daca_renewal');
    addPerson(caseId, 'applicant', {}, { is_main: true, approved_at: null });
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(r.status).toBe(409);
    expect(r.body.evidence_requirement.missing).toEqual(['ead_doc', 'ead_facts', 'address', 'approve']);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('lets General go straight to Physical Scan with no gate (D-95)', async () => {
    const caseId = addCase('general');
    addPerson(caseId, 'beneficiary', {}, { is_main: true, approved_at: null });
    mockModel(vi, [observations()]);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).status).toBe(200);
  });
});

// ── What is asked, and fail-closed answers ───────────────────────────────────

describe('the request to the AI', () => {
  it('records the model that answered, read past the leading thinking block', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms() })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.status).toBe(200);
    expect(db.rows('proof_scans').at(-1).model).toBe('claude-sonnet-5-5');
  });

  it('lets a portal pin the model with MODEL_PROOF, and drops fallback for a model without it', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [observations({ forms: dacaForms() })]);
    await run({ case_id: caseId, stage: 'physical_scan' }, { ...ENV, MODEL_PROOF: 'claude-sonnet-4-6' });
    expect(calls[0].body.model).toBe('claude-sonnet-4-6');
    expect(calls[0].body.fallbacks).toBeUndefined();
  });

  it('uses the proof model streamed with refusal fallback, and sends each file labelled', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [observations({ forms: dacaForms() })]);
    await run({ case_id: caseId, stage: 'physical_scan', files: [pdfFile('a.pdf'), { filename: 'b.png', media_type: 'image/png', file_base64: btoa('\x89PNG\r\n\x1a\n00000000') }] });
    const body = calls[0].body;
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.stream).toBe(true);
    expect(body.fallbacks).toBe('default');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.messages[0].content.map((c) => c.type)).toEqual(['text', 'document', 'text', 'image', 'text']);
  });

  it('asks only for the checks active at the stage; PS-304 is the server\'s own (D-57, D-98)', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [observations({ forms: dacaForms() })]);
    await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    const asked = askedRuleIds(calls[0].body);
    expect(asked).toHaveLength(31); // 40 checks, minus 8 waiting for later, minus the server's PS-304
    for (const later of ['PS-201', 'DACA-G28-004', 'DACA-821D-007', 'DACA-821D-010', 'DACA-765-009', 'DACA-G1450-004', 'DACA-G1450-005', 'DACA-G1450-006']) {
      expect(asked, later).not.toContain(later);
    }
    expect(asked).not.toContain('PS-304');
    expect(askedItemIds(calls[0].body)).not.toContain('DACA-COMP-EAD-CARD'); // D-66: evidence is Physical Scan's
  });

  it('never sends an SSN to the AI, even when the card has one', async () => {
    const { caseId, personId } = readyDaca();
    db.rows('proof_scan_people').find((p) => p.id === personId).ssn_encrypted = ssnEncrypt('555123456', ENV);
    const calls = mockModel(vi, [observations({ forms: dacaForms() })]);
    await run({ case_id: caseId, stage: 'physical_scan' });
    expect(JSON.stringify(calls[0].body)).not.toMatch(/555-?12-?3456/);
  });

  it.each([
    ['an unknown check ID', (o) => { o.rule_results[0].rule_id = 'PS-999'; }],
    ['a duplicate check ID', (o) => { o.rule_results[1].rule_id = o.rule_results[0].rule_id; }],
    ['a missing check ID', (o) => { o.rule_results.pop(); }],
    ['a missing package item', (o) => { o.package_items.pop(); }],
    ['an unknown status', (o) => { o.rule_results[0].status = 'pass'; }],
    ['an extra field', (o) => { o.verdict = 'ok'; }],
  ])('fails closed on %s, storing nothing (D-19, D-20)', async (_label, mutate) => {
    const { caseId } = readyDaca();
    const build = observations({ forms: dacaForms() });
    mockModel(vi, [(body) => { const o = build(body); mutate(o); return o; }]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.status).toBe(502);
    expect(r.body.report_state).toBe('scan_could_not_be_completed');
    expect(db.rows('proof_scans')).toEqual([]);
  });

  it('fails closed on a truncated answer', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [{ output: {}, stop_reason: 'max_tokens' }]);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).status).toBe(502);
  });
});

// ── Result states and storage ────────────────────────────────────────────────

describe('result and storage', () => {
  it('a clean run: "No issues found", the staff reminder, stored in its case with its rule-set version', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms() })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({
      report_state: 'no_issues_found', primary_report_language: 'No issues found', attention_count: 0,
      staff_review_reminder: 'Staff review is still required before filing.', schema_version: 2, rule_set_version: 1,
    });
    expect(r.body.result).not.toHaveProperty('client_observed'); // D-89
    expect(db.rows('proof_scans')[0]).toMatchObject({
      case_id: caseId, stage: 'draft_review', scope: 'whole', rule_set_version: 1, scan_profile: 'daca_renewal',
      profile_version: 1, status: 'structured', result_schema_version: 2, report_state: 'no_issues_found', attention_count: 0,
    });
  });

  it('words the three states exactly (D-23)', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [
      observations({ forms: dacaForms(), rules: { 'PS-101': 'needs_attention' } }),
      observations({ forms: dacaForms(), rules: { 'PS-101': 'needs_attention', 'PS-102': 'needs_attention' } }),
      observations({ forms: dacaForms(), rules: { 'PS-101': 'not_checked' } }),
    ]);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).body.result.primary_report_language).toBe('1 item needs attention');
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).body.result.primary_report_language).toBe('2 items need attention');
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).body.result.primary_report_language).toBe('Review incomplete');
  });

  it('never stores the files (D-84)', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms() })]);
    await run({ case_id: caseId, stage: 'physical_scan' });
    expect(JSON.stringify(db.tables)).not.toContain(pdfFile().file_base64);
  });

  it('a run that cannot be stored changes nothing else', async () => {
    const { caseId } = readyDaca();
    db.rows('proof_scan_signoffs').push({ id: 's1', case_id: caseId, stage: 'physical_scan', run_id: 'old' });
    db.fail('proof_scans');
    mockModel(vi, [observations({ forms: dacaForms(), possible: [{ title: 'x', description: 'd', evidence: 'e', why_it_matters: 'w', uncertainty: 'u', reasoning_key: 'k' }] })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.body).toMatchObject({ stored: false, run_id: null });
    expect(db.rows('proof_scan_signoffs')).toHaveLength(1);
    expect(db.rows('proof_scan_possible_issues')).toEqual([]);
  });

  it('a new run clears that stage\'s sign-off, and only that one (D-75)', async () => {
    const { caseId } = readyDaca();
    db.rows('proof_scan_signoffs').push(
      { id: 's1', case_id: caseId, stage: 'draft_review', run_id: 'r1' },
      { id: 's2', case_id: caseId, stage: 'physical_scan', run_id: 'r2' },
    );
    mockModel(vi, [observations({ forms: dacaForms() })]);
    await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(db.rows('proof_scan_signoffs').map((s) => s.stage)).toEqual(['physical_scan']);
  });

  it('opens a stored run with its Possible issues', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms(), possible: [{ title: 'Odd page', description: 'd', evidence: 'e', why_it_matters: 'w', uncertainty: 'u', reasoning_key: 'odd_page' }] })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    const got = await call(runRoute, '/api/proof-scan-v2-run', { query: { id: r.body.run_id } });
    expect(got.body.run.result_json.report_state).toBe('no_issues_found');
    expect(got.body.possible_issues.map((p) => p.title)).toEqual(['Odd page']);
  });
});

// ── Stage states (D-57, D-69 to D-73) ────────────────────────────────────────

describe('stage states', () => {
  it('signatures and card details are "checked later" at Draft Review, never counted', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms() })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(r.body.result.later.map((l) => l.rule_id)).toEqual(expect.arrayContaining(['PS-201', 'DACA-G1450-004', 'DACA-821D-007']));
    expect(r.body.result.checks.map((c) => c.rule_id)).not.toContain('PS-201');
  });

  it('checks not set for Pre-flight are not asked or shown there (D-71)', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [observations({ forms: dacaForms() })]);
    const r = await run({ case_id: caseId, stage: 'preflight', scope: 'whole' });
    expect(askedRuleIds(calls[0].body).sort()).toEqual(['DACA-765-009', 'DACA-821D-010', 'DACA-G1450-004', 'DACA-G1450-005', 'DACA-G1450-006', 'DACA-G28-004', 'PS-201', 'PS-301', 'PS-302', 'PS-303']);
    expect(r.body.result.not_this_stage_count).toBeGreaterThan(20);
  });

  it('"checked only if filled in": blank is needs info, not attention (D-70)', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms(), rules: { 'DACA-G28-003': 'blank' } })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(check(r, 'DACA-G28-003').status).toBe('needs_info');
    expect(r.body.result.report_state).toBe('no_issues_found');
  });

  it('a blank field on an ordinary check is attention', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms(), rules: { 'DACA-G1145-001': 'blank' } })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(check(r, 'DACA-G1145-001').status).toBe('needs_attention');
    expect(r.body.result.attention_count).toBe(1);
  });

  it('English NO is a gentle "please confirm" at Draft Review only (D-70)', async () => {
    const { caseId } = readyDaca();
    const english = { 'DACA-821D-009': 'needs_attention', 'DACA-765-008': 'needs_attention' };
    mockModel(vi, [observations({ forms: dacaForms(), rules: english }), observations({ forms: dacaForms(), rules: english })]);
    const draft = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(check(draft, 'DACA-821D-009').status).toBe('please_confirm');
    expect(draft.body.result.attention_count).toBe(0);
    const physical = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(check(physical, 'DACA-821D-009').status).toBe('needs_attention');
    expect(physical.body.result.attention_count).toBe(2);
  });

  it('departures are asked about at Pre-flight only with marked-up pages, and count only if the client marked any (D-71)', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [
      observations({ forms: dacaForms() }),
      observations({ forms: dacaForms(), rules: { 'DACA-821D-007': 'needs_attention' }, markups: [] }),
      observations({ forms: dacaForms(), rules: { 'DACA-821D-007': 'needs_attention' }, markups: [
        { form: 'I-821D', page: '3', field: 'departures', original: '', markup_read: 'Trip to Mexico 2023', read_confidence: 'clear', corrected_page_present: true, corrected: 'Trip to Mexico 2023' }] }),
    ]);
    await run({ case_id: caseId, stage: 'preflight', scope: 'whole' });
    expect(askedRuleIds(calls[0].body)).not.toContain('DACA-821D-007');
    const files = [pdfFile('pkg.pdf'), pdfFile('marked.pdf', { kind: 'marked' }), pdfFile('fixed.pdf', { kind: 'corrected' })];
    const none = await run({ case_id: caseId, stage: 'preflight', scope: 'whole', files });
    expect(askedRuleIds(calls[1].body)).toContain('DACA-821D-007');
    expect(check(none, 'DACA-821D-007')).toBeUndefined();
    const marked = await run({ case_id: caseId, stage: 'preflight', scope: 'whole', files });
    expect(check(marked, 'DACA-821D-007').status).toBe('needs_attention');
  });

  it('uses the stage wording: the I-765WS template sentence at Draft Review (D-69)', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [observations({ forms: dacaForms(), rules: { 'DACA-765WS-001': 'needs_attention' } })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(calls[0].body.system).toContain('I have to work to pay for my living expenses.');
    expect(check(r, 'DACA-765WS-001').title).toContain('I have to work to pay for my living expenses.');
  });

  it('an individual review asks only about that form and skips the cross-package checks (D-56)', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [observations({ forms: [dacaForms()[4]] })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'individual', form: 'I-821D' });
    const asked = askedRuleIds(calls[0].body);
    // Its own checks, plus the per-form checks that have no form of their own.
    expect(asked.every((id) => id.startsWith('DACA-821D') || ['PS-101', 'PS-102', 'PS-103', 'DACA-ASM-001'].includes(id))).toBe(true);
    expect(asked).not.toContain('PS-301');
    expect(askedItemIds(calls[0].body)).toEqual([]);
    expect(r.body.result.form).toBe('I-821D');
  });
});

// ── Missing forms and evidence ───────────────────────────────────────────────

describe('missing package items', () => {
  it('Draft Review: a missing form is one attention item and its checks are not repeated (D-21, D-56)', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({
      forms: dacaForms({ omit: ['G-28'] }),
      items: { 'DACA-COMP-G28': 'missing' },
      rules: { 'DACA-G28-001': 'not_checked', 'DACA-G28-002': 'not_checked', 'DACA-G28-003': 'not_checked' },
    })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(r.body.result.attention).toEqual([expect.objectContaining({ kind: 'missing_item', title: 'The G-28 is missing from the package.' })]);
    expect(r.body.result.checks.map((c) => c.rule_id)).not.toContain('DACA-G28-001');
    expect(r.body.result.report_state).toBe('items_need_attention');
  });

  it('Pre-flight never asks for the full set and says nothing about a form left out (D-73)', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [observations({ forms: dacaForms({ omit: ['G-1145', 'G-28'] }) })]);
    const r = await run({ case_id: caseId, stage: 'preflight', scope: 'whole' });
    expect(askedItemIds(calls[0].body)).toEqual([]);
    expect(r.body.result.attention).toEqual([]);
    expect(r.body.result.notes.filter((n) => /missing/i.test(n.title))).toEqual([]);
  });

  it('Physical Scan: missing expected evidence is attention (D-58)', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms(), items: { 'DACA-COMP-EAD-CARD': 'missing' } })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.body.result.attention.map((a) => a.title)).toEqual(['The EAD card is missing from the package.']);
  });

  it('an unreadable item makes the review incomplete, not clean', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms(), items: { 'DACA-COMP-G1145': 'unreadable' } })]);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).body.result.report_state).toBe('review_incomplete');
  });
});

// ── The forms against each person's own card ────────────────────────────────

describe('reference comparison (D-79, D-81, D-94, D-99, N-016)', () => {
  it('a value that differs from the case card is one attention item per form and field', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms({ 'I-821D': { street: '9 OTHER ST' }, 'I-765': { street: '9 OTHER ST' } }) })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(r.body.result.attention.map((a) => a.title)).toEqual([
      'The I-821D shows street 9 OTHER ST. The case card has 1 TEST ST.',
      'The I-765 shows street 9 OTHER ST. The case card has 1 TEST ST.',
    ]);
  });

  it('a blank box the card has a value for is its own item, per field and form (D-96)', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms({ 'G-1450': { phone: '', email: '' } }) })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(r.body.result.attention).toHaveLength(4);
    expect(r.body.result.attention[0].title).toBe('The G-1450 leaves phone blank. The case card has 5550100100.');
  });

  it('A-Number format is never a difference', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms({ 'G-28': { a_number: 'A 123 456 789' } }) })]);
    expect((await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' })).body.result.attention).toEqual([]);
  });

  it('compares each form only on the address parts it has (D-81)', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms({ 'G-1145': { street: '9 OTHER ST' }, 'G-28': { in_care_of: 'SOMEONE' } }) })]);
    expect((await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' })).body.result.attention).toEqual([]);
  });

  it('a value with no reference is needs info at Draft Review (D-47) and a light note at Pre-flight (Q-46)', async () => {
    const { caseId } = readyDaca({ ...CARD, phone: null });
    mockModel(vi, [
      observations({ forms: dacaForms({ 'G-1450': { phone: '' } }) }),
      observations({ forms: dacaForms({ 'G-1450': { phone: '' } }) }),
    ]);
    const draft = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(draft.body.result.notes).toEqual([expect.objectContaining({ kind: 'needs_info', field: 'phone' })]);
    expect(draft.body.result.attention).toEqual([]);
    const pre = await run({ case_id: caseId, stage: 'preflight', scope: 'whole' });
    expect(pre.body.result.notes.map((n) => n.kind)).toContain('no_reference');
    expect(pre.body.result.attention).toEqual([]);
  });

  it('a difference already proposed as a suggestion is not reported again', async () => {
    const { caseId, personId } = readyDaca();
    db.rows('proof_scan_suggestions').push({ id: 'sg', person_id: personId, field: 'street', value: '9 OTHER ST', status: 'open', source_label: 'Intake' });
    mockModel(vi, [observations({ forms: dacaForms({ 'I-821D': { street: '9 OTHER ST' } }) })]);
    expect((await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' })).body.result.attention).toEqual([]);
  });

  describe('General: two people', () => {
    function family() {
      const caseId = addCase('general');
      const ben = addPerson(caseId, 'beneficiary', { first_name: 'BEA', last_name: 'TESTER', date_of_birth: '1990-01-01' }, { is_main: true });
      const pet = addPerson(caseId, 'petitioner', { first_name: 'PAT', last_name: 'TESTER', date_of_birth: '1985-05-05' });
      return { caseId, ben, pet };
    }

    it('compares each form only with its own person; the petitioner is never checked against the beneficiary (D-94)', async () => {
      const { caseId, pet } = family();
      addDoc(caseId, [pet], 'birth_certificate', { first_name: 'PAT', last_name: 'TESTER', date_of_birth: '05/05/1985' });
      mockModel(vi, [observations({ forms: [
        form('I-130', { first_name: 'PAT', last_name: 'TESTER', date_of_birth: '05/05/1985' }, 'petitioner'),
        form('I-130A', { first_name: 'BEA', last_name: 'TESTER', date_of_birth: '01/01/1990' }, 'beneficiary'),
      ] })]);
      const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
      expect(r.body.result.attention).toEqual([]);
      expect(check(r, 'PS-304').status).toBe('clear');
    });

    it('names the person in a difference', async () => {
      const { caseId } = family();
      mockModel(vi, [observations({ forms: [form('I-130', { first_name: 'PAT', last_name: 'TESTER', date_of_birth: '05/06/1985' }, 'petitioner')] })]);
      const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
      expect(r.body.result.attention.map((a) => a.title)).toEqual(["The I-130 shows the petitioner's date of birth 05/06/1985. The case card has 05/05/1985."]);
    });

    it('evidence against the forms: each difference is its own attention item (D-98)', async () => {
      const { caseId, pet, ben } = family();
      db.rows('proof_scan_people').find((p) => p.id === pet).field_sources = {};
      Object.assign(db.rows('proof_scan_people').find((p) => p.id === pet), { first_name: null, last_name: null, date_of_birth: null });
      addDoc(caseId, [pet], 'birth_certificate', { first_name: 'PAT', last_name: 'TESTER', date_of_birth: '05/05/1985' });
      addDoc(caseId, [pet, ben], 'marriage_certificate', { marriage_date: '06/01/2020' });
      mockModel(vi, [observations({ forms: [
        form('I-130', { first_name: 'PAT', last_name: 'TESTOR', date_of_birth: '05/06/1985' }, 'petitioner'),
      ] })]);
      const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
      expect(r.body.result.attention.map((a) => a.title)).toEqual([
        "The petitioner's birth certificate shows last name TESTER. The I-130 shows TESTOR.",
        "The petitioner's birth certificate shows date of birth 05/05/1985. The I-130 shows 05/06/1985.",
      ]);
      expect(check(r, 'PS-304').status).toBe('needs_attention');
      expect(r.body.result.attention_count).toBe(2);
    });

    it('cards for people found in the forms; draft values are shown but never the truth (D-99)', async () => {
      const caseId = addCase('general');
      addPerson(caseId, 'beneficiary', {}, { is_main: true });
      mockModel(vi, [
        observations({ forms: [form('I-130', { first_name: 'PAT', last_name: 'TESTER' }, 'petitioner')] }),
        observations({ forms: [form('I-130A', { first_name: 'PATRICK', last_name: 'TESTER' }, 'petitioner')] }),
      ]);
      const first = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
      const pet = first.body.case_view.people.find((p) => p.role === 'petitioner');
      expect(pet).toMatchObject({ first_name: 'PAT', field_sources: { first_name: { kind: 'forms', label: 'I-130' } } });
      const second = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
      expect(second.body.result.attention).toEqual([]); // PAT came from a draft, so PATRICK is not "wrong"
    });
  });

  it('DACA: an EAD difference is counted once, not as both a card and an evidence difference', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms({ 'I-821D': { date_of_birth: '03/23/1998' } }) })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(r.body.result.attention_count).toBe(1);
  });
});

// ── Physical Scan: the package against the case card (D-89, D-95) ────────────

describe('Physical Scan', () => {
  it('any difference from the case card leads the report, once per value', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms({ 'I-821D': { date_of_birth: '03/23/1998' }, 'I-765': { date_of_birth: '03/23/1998' } }) })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    const card = r.body.result.attention.filter((a) => a.kind === 'case_card_difference');
    expect(card).toEqual([expect.objectContaining({
      title: 'The package shows the date of birth as 03/23/1998. The case card has 03/22/1998.', forms: ['I-821D', 'I-765'],
    })]);
  });

  it('name order, middle initials, A-Number format and address punctuation are not differences', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms({
      'I-821D': { middle_name: 'M.', street: '1 Test St.', a_number: 'A-123456789' },
      'G-28': { middle_name: '', city: 'Testville,' },
    }) })]);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).body.result.attention).toEqual([]);
  });

  it('compares the SSN against the card without ever showing more than the last four', async () => {
    const { caseId, personId } = readyDaca();
    Object.assign(db.rows('proof_scan_people').find((p) => p.id === personId), { ssn_encrypted: ssnEncrypt('555123456', ENV), ssn_last4: '3456' });
    mockModel(vi, [observations({ forms: dacaForms({ 'I-765': { ssn: '555-12-0000' } }) })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.body.result.attention.map((a) => a.title)).toEqual(['The package shows the Social Security number as ***-**-0000. The case card has ***-**-3456.']);
    expect(JSON.stringify(db.rows('proof_scans'))).not.toMatch(/555-?12-?0000|555-?12-?3456/);
  });

  it('a value never added to the card is a light note, not attention (Q-46)', async () => {
    const { caseId } = readyDaca({ ...CARD, email: null });
    mockModel(vi, [observations({ forms: dacaForms() })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.body.result.notes).toEqual([expect.objectContaining({ kind: 'never_added', fields: ['email'] })]);
    expect(r.body.result.report_state).toBe('no_issues_found');
  });

  it('General builds the cards from the package and does not flag its own values (D-95, D-99)', async () => {
    const caseId = addCase('general');
    addPerson(caseId, 'beneficiary', {}, { is_main: true, approved_at: null });
    mockModel(vi, [observations({
      forms: [form('I-130', { first_name: 'PAT', last_name: 'TESTER' }, 'petitioner'), form('I-485', { first_name: 'BEA', last_name: 'TESTER' }, 'beneficiary')],
      evidence: [{ doc_type: 'birth_certificate', file: 'package.pdf', pages: '40', owner_roles: ['petitioner'], read_quality: 'clear', facts: evidenceFacts({ first_name: 'PAT', last_name: 'TESTER' }) }],
    })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.body.result.attention).toEqual([]);
    expect(r.body.result.new_cards).toEqual(['petitioner']);
    const people = r.body.case_view.people;
    expect(people.map((p) => [p.role, p.first_name, p.field_sources.first_name?.kind])).toEqual([
      ['beneficiary', 'BEA', 'scan'], ['petitioner', 'PAT', 'scan'],
    ]);
  });

  it('package evidence that disagrees with its owner\'s forms is attention; a damaged read never is (D-54, D-98)', async () => {
    const caseId = addCase('general');
    addPerson(caseId, 'beneficiary', {}, { is_main: true });
    const ev = (read_quality) => ({ doc_type: 'birth_certificate', file: 'p.pdf', pages: '9', owner_roles: ['beneficiary'], read_quality, facts: evidenceFacts({ date_of_birth: '01/02/1990' }) });
    mockModel(vi, [
      observations({ forms: [form('I-485', { date_of_birth: '01/03/1990' }, 'beneficiary')], evidence: [ev('clear')] }),
      observations({ forms: [form('I-485', { date_of_birth: '01/03/1990' }, 'beneficiary')], evidence: [ev('partial')] }),
    ]);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).body.result.attention.map((a) => a.kind)).toEqual(['evidence_difference']);
    expect((await run({ case_id: caseId, stage: 'physical_scan' })).body.result.attention).toEqual([]);
  });

  it('evidence with no clear owner goes to Possible issues, not the count (D-94)', async () => {
    const caseId = addCase('general');
    addPerson(caseId, 'beneficiary', {}, { is_main: true });
    mockModel(vi, [observations({ evidence: [{ doc_type: 'other', file: 'p.pdf', pages: '12', owner_roles: [], read_quality: 'clear', facts: evidenceFacts({ first_name: 'X' }) }] })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.body.result.attention).toEqual([]);
    expect(r.body.possible_issues.map((p) => p.reasoning_key)).toEqual(['evidence_owner_unclear']);
  });
});

// ── Pre-flight corrections (D-68, D-72, D-73) ────────────────────────────────

describe('Pre-flight corrections', () => {
  const files = [pdfFile('pkg.pdf'), pdfFile('marked.pdf', { kind: 'marked' }), pdfFile('fixed.pdf', { kind: 'corrected' })];
  const markup = (over) => ({ form: 'I-821D', page: '2', field: 'street', original: '1 TEST ST', markup_read: '2 NEW ST', read_confidence: 'clear', corrected_page_present: true, corrected: '2 NEW ST', ...over });

  async function preflight(markups, forms = dacaForms({ 'I-821D': { street: '2 NEW ST' }, 'I-765': { street: '2 NEW ST' }, 'G-28': { street: '2 NEW ST' } })) {
    const ids = readyDaca();
    mockModel(vi, [observations({ forms, markups })]);
    const r = await run({ case_id: ids.caseId, stage: 'preflight', scope: 'whole', files });
    return { ...ids, r, statuses: r.body.result.corrections.map((c) => c.status) };
  }

  it('fixed: proposed to the record as a suggestion, never written (D-55, D-72)', async () => {
    const { r, personId, statuses } = await preflight([markup()]);
    expect(statuses).toEqual(['fixed']);
    expect(r.body.result.attention).toEqual([]);
    expect(db.rows('proof_scan_suggestions')).toEqual([expect.objectContaining({
      person_id: personId, field: 'street', value: '2 NEW ST', source_label: 'Client correction, I-821D page 2', run_id: r.body.run_id,
    })]);
    expect(db.rows('proof_scan_people')[0].street).toBe('1 TEST ST');
  });

  it('not fixed: counted', async () => {
    const { r, statuses } = await preflight([markup({ corrected: '1 TEST ST' })], dacaForms());
    expect(statuses).toEqual(['not_fixed']);
    expect(r.body.result.attention_count).toBe(1);
  });

  it('uncertain handwriting is "check" and unreadable is "unreadable": never counted', async () => {
    const { r, statuses } = await preflight([markup({ read_confidence: 'uncertain', field: 'city', original: 'TESTVILLE', markup_read: 'TESTVIL?', corrected: 'TESTVILLE' }), markup({ read_confidence: 'unreadable', field: 'zip', original: '77001', markup_read: null, corrected: '77001' })], dacaForms());
    expect(statuses).toEqual(['check', 'unreadable']);
    expect(r.body.result.attention).toEqual([]);
  });

  it('a US country the firm leaves off is left out on purpose, not missed (D-72)', async () => {
    const { statuses, r } = await preflight([markup({ field: 'country', original: '', markup_read: 'USA', corrected: null })], dacaForms());
    expect(statuses).toEqual(['omitted_ok']);
    expect(r.body.result.attention).toEqual([]);
  });

  it('a marked-up form with no corrected page is counted (D-73)', async () => {
    const { statuses, r } = await preflight([markup({ form: 'I-765', corrected_page_present: false, corrected: null })], dacaForms());
    expect(statuses).toEqual(['no_page']);
    expect(r.body.result.attention.map((a) => a.title)).toEqual(['The client marked up the I-765, but there is no corrected page for it.']);
  });

  it('a correction not carried to other forms turns the consistency check red once (D-72)', async () => {
    const { r, statuses } = await preflight([markup()], dacaForms({ 'I-821D': { street: '2 NEW ST' } }));
    expect(statuses).toEqual(['fixed', 'not_carried', 'not_carried']);
    expect(check(r, 'PS-303')).toMatchObject({ status: 'needs_attention', title: 'The street was corrected on the I-821D but not on the G-28.' });
    expect(r.body.result.attention.filter((a) => a.rule_id === 'PS-303')).toHaveLength(1);
  });
});

// ── Possible issues (D-36, D-59, D-86) ───────────────────────────────────────

describe('Possible issues', () => {
  const issue = (over) => ({ title: 'Check page 5', description: 'd', evidence: 'p.5', why_it_matters: 'w', uncertainty: 'u', reasoning_key: 'odd_page', ...over });

  it('are stored in their own table and never counted or put in the result', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms(), possible: [issue(), issue({ title: 'Another', reasoning_key: 'another' })] })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(r.body.result).toMatchObject({ attention_count: 0, report_state: 'no_issues_found' });
    expect(JSON.stringify(r.body.result)).not.toContain('Check page 5');
    expect(db.rows('proof_scan_possible_issues').map((p) => [p.title, p.run_id])).toEqual([['Check page 5', r.body.run_id], ['Another', r.body.run_id]]);
  });

  it('suppressed reasoning never comes back, signature date order included (D-59, R-1)', async () => {
    const { caseId } = readyDaca();
    const calls = mockModel(vi, [observations({ forms: dacaForms(), possible: [issue({ title: 'Attorney signed first', reasoning_key: 'Signature date order' })] })]);
    const r = await run({ case_id: caseId, stage: 'physical_scan' });
    expect(calls[0].body.system).toContain('signature_date_order');
    expect(r.body.possible_issues).toEqual([]);
  });

  it('never carry a full SSN', async () => {
    const { caseId } = readyDaca();
    mockModel(vi, [observations({ forms: dacaForms(), possible: [issue({ evidence: 'SSN 123-45-6789 on page 2' })] })]);
    await run({ case_id: caseId, stage: 'physical_scan' });
    expect(db.rows('proof_scan_possible_issues')[0].evidence).toBe('SSN ***-**-6789 on page 2');
  });
});
