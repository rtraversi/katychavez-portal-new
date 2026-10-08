// Proof Scan v2: sign-off (D-75), the rulebook as versioned data (D-60, D-61,
// D-65, D-76), suppressions and Possible issues (D-36 to D-39, D-59, D-60), and
// the optional stage email (D-61). Mocked auth, database and model.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as runRoute } from '../../functions/api/proof-scan-v2-run.js';
import { onRequest as signoffRoute } from '../../functions/api/proof-scan-v2-signoff.js';
import { onRequest as rulesRoute } from '../../functions/api/proof-scan-v2-rules.js';
import { onRequest as suppressionsRoute } from '../../functions/api/proof-scan-v2-suppressions.js';
import { onRequest as issueRoute } from '../../functions/api/proof-scan-v2-possible-issue.js';
import { buildProofScanStageEmail } from '../../functions/api/_proof-scan-email.js';
import { nextRuleId, withRuleEdited, stageSettings } from '../../functions/api/_proof-scan-v2-rulebook.js';
import seed from '../../functions/api/proof-scan-profiles/v2-seed.json';
import {
  seededDb, call, ENV, STAFF, CLIENT, NO_TOKEN, pdfFile, mockModel, observations, askedRuleIds,
} from '../support/proof-scan-v2-harness.js';

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

function generalCase() {
  const caseId = crypto.randomUUID();
  db.rows('proof_scan_cases').push({ id: caseId, case_type: 'general', label: 'Client Label Zeta', created_at: '2026-10-07T00:00:00Z' });
  db.rows('proof_scan_people').push({ id: crypto.randomUUID(), case_id: caseId, role: 'beneficiary', is_main: true, field_sources: {}, created_at: '2026-10-07T00:00:00Z' });
  return caseId;
}
const runGeneral = (caseId, body = {}) => call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body: { case_id: caseId, stage: 'physical_scan', files: [pdfFile()], ...body } });
const rules = (method, body, query) => call(rulesRoute, '/api/proof-scan-v2-rules', { method, body, query });
const currentSet = (caseType) => db.rows('proof_scan_rule_sets').find((s) => s.case_type === caseType && s.is_current);
const rulesIn = (setId) => db.rows('proof_scan_rules').filter((r) => r.rule_id && r.rule_set_id === setId);

describe('access', () => {
  it('refuses anon and the Client role on every route', async () => {
    const routes = [
      [signoffRoute, '/api/proof-scan-v2-signoff', { method: 'POST', body: { case_id: crypto.randomUUID(), stage: 'preflight' } }],
      [rulesRoute, '/api/proof-scan-v2-rules', { query: { case_type: 'general' } }],
      [rulesRoute, '/api/proof-scan-v2-rules', { method: 'POST', body: { scope: 'firm', title: 'x' } }],
      [suppressionsRoute, '/api/proof-scan-v2-suppressions', {}],
      [issueRoute, '/api/proof-scan-v2-possible-issue', { method: 'POST', body: { issue_id: crypto.randomUUID(), action: 'accept' } }],
    ];
    for (const who of [NO_TOKEN, CLIENT]) {
      helpersMock.verifyAuth.mockResolvedValue(who);
      for (const [route, path, opts] of routes) expect((await call(route, path, opts)).status, path).toBe(who === NO_TOKEN ? 401 : 403);
    }
  });
});

describe('sign-off (D-75)', () => {
  const sign = (method, case_id, stage = 'physical_scan') => call(signoffRoute, '/api/proof-scan-v2-signoff', { method, body: { case_id, stage } });

  it('needs a run of that stage first', async () => {
    const caseId = generalCase();
    expect((await sign('POST', caseId)).status).toBe(409);
  });

  it('signs off the latest run, can be undone, and a new run clears it', async () => {
    const caseId = generalCase();
    mockModel(vi, [observations(), observations()]);
    const first = await runGeneral(caseId);
    const signed = await sign('POST', caseId);
    expect(signed.body.signoffs).toEqual([expect.objectContaining({ stage: 'physical_scan', run_id: first.body.run_id, signed_by: 'staff-1' })]);
    expect((await sign('DELETE', caseId)).body.signoffs).toEqual([]);
    await sign('POST', caseId);
    await runGeneral(caseId);
    expect(db.rows('proof_scan_signoffs')).toEqual([]);
  });

  it('never changes the report', async () => {
    const caseId = generalCase();
    mockModel(vi, [observations()]);
    await runGeneral(caseId);
    const before = JSON.stringify(db.rows('proof_scans'));
    await sign('POST', caseId);
    expect(JSON.stringify(db.rows('proof_scans'))).toBe(before);
  });
});

describe('the rulebook (D-61)', () => {
  it('lists firm-wide and case-type rules apart, with scope, origin and stage settings', async () => {
    const daca = await rules('GET', undefined, { case_type: 'daca_renewal' });
    expect(daca.body.version).toBe(1);
    expect(daca.body.firm.map((r) => r.rule_id)).toEqual(['PS-101', 'PS-102', 'PS-201', 'PS-103', 'PS-301', 'PS-302', 'PS-303', 'PS-304', 'PS-305', 'PS-306']);
    expect(daca.body.case_type_rules).toHaveLength(32);
    expect(daca.body.firm[0]).toMatchObject({ scope: 'firm', origin: 'general_rules', stages: { draft_review: 'checked', preflight: 'not_this_stage', physical_scan: 'checked' } });
    expect(daca.body.suppressions.map((s) => s.reasoning_key)).toEqual(['signature_date_order']);
    const general = await rules('GET', undefined, { case_type: 'general' });
    expect(general.body.case_type_rules).toEqual([]);
    expect(general.body.package_items).toEqual([]);
    expect((await rules('GET', undefined, { case_type: 'aos' })).status).toBe(400);
  });

  it('adding a firm-wide rule makes a new version of every case type; the old versions are untouched (D-60, D-65)', async () => {
    const before = JSON.stringify(db.rows('proof_scan_rules'));
    const r = await rules('POST', { scope: 'firm', title: 'Every page is right side up.', stages: { draft_review: 'later' } });
    expect(r).toEqual({ status: 201, body: { rule_id: 'FIRM-ADD-001', versions: { daca_renewal: 2, general: 2 } } });
    for (const caseType of ['daca_renewal', 'general']) {
      const set = currentSet(caseType);
      expect(set.version).toBe(2);
      const added = rulesIn(set.id).find((x) => x.rule_id === 'FIRM-ADD-001');
      expect(added).toMatchObject({ scope: 'firm', origin: 'staff_added', retired: false });
      const settings = db.rows('proof_scan_rule_stage_settings').filter((s) => s.rule_pk === added.id);
      expect(Object.fromEntries(settings.map((s) => [s.stage, s.state]))).toEqual({ draft_review: 'later', preflight: 'checked', physical_scan: 'checked' });
      expect(rulesIn(set.id)).toHaveLength(caseType === 'general' ? 11 : 43);
    }
    // Version 1 rows are exactly as they were; only is_current moved.
    expect(JSON.stringify(db.rows('proof_scan_rules').filter((x) => x.rule_set_id.startsWith('rs-')))).toBe(before);
    expect(db.rows('proof_scan_rule_sets').filter((s) => s.version === 1).every((s) => !s.is_current)).toBe(true);
    expect(db.rows('proof_scan_rule_changes')).toHaveLength(2);
    expect(db.rows('proof_scan_rule_changes')[0]).toMatchObject({ action: 'add', rule_id: 'FIRM-ADD-001', changed_by: 'staff-1' });
  });

  it('a case-type rule goes into that case type only', async () => {
    const r = await rules('POST', { scope: 'case_type', case_type: 'daca_renewal', title: 'x', form: 'I-821D', page: '2', item: '3' });
    expect(r.body).toEqual({ rule_id: 'DACA-ADD-001', versions: { daca_renewal: 2 } });
    expect(currentSet('general').version).toBe(1);
    expect((await rules('POST', { scope: 'case_type', title: 'x' })).status).toBe(400);
  });

  it('Physical Scan is always checked: a stage setting for it is refused (D-58)', async () => {
    expect((await rules('POST', { scope: 'firm', title: 'x', stages: { physical_scan: 'later' } })).status).toBe(400);
    expect(stageSettings({ draft_review: 'later' }).physical_scan.state).toBe('checked');
  });

  it('editing a rule makes a new version; later runs use it, older runs keep theirs (D-60, D-76)', async () => {
    const caseId = generalCase();
    mockModel(vi, [observations(), observations()]);
    await runGeneral(caseId);
    const edit = await rules('PATCH', { rule_id: 'PS-101', changes: { title: 'Edition date current everywhere.' } });
    expect(edit.body.versions).toEqual({ daca_renewal: 2, general: 2 }); // firm-wide: every case type
    const second = await runGeneral(caseId);
    expect(db.rows('proof_scans').map((r) => r.rule_set_version)).toEqual([1, 2]);
    expect(second.body.result.rule_set_version).toBe(2);
    expect(rulesIn('rs-general-1').find((r) => r.rule_id === 'PS-101').title).toBe('Edition date is current on every page.');
    expect(db.rows('proof_scan_rule_changes')[0]).toMatchObject({ action: 'edit', before_value: expect.objectContaining({ title: 'Edition date is current on every page.' }) });
  });

  it('a retired rule is no longer asked about', async () => {
    const caseId = generalCase();
    await rules('PATCH', { rule_id: 'PS-103', changes: { retired: true } });
    const calls = mockModel(vi, [observations()]);
    await runGeneral(caseId);
    expect(askedRuleIds(calls[0].body)).not.toContain('PS-103');
    expect(db.rows('proof_scan_rule_changes')[0].action).toBe('retire');
  });

  it('404s an unknown rule and refuses an empty edit', async () => {
    expect((await rules('PATCH', { rule_id: 'NOPE-1', changes: { title: 'x' } })).status).toBe(404);
    expect((await rules('PATCH', { rule_id: 'PS-101' })).status).toBe(400);
  });

  it('numbers added rules in one series per prefix', () => {
    expect(nextRuleId('firm', null, ['FIRM-ADD-001', 'FIRM-ADD-007', 'DACA-ADD-009'])).toBe('FIRM-ADD-008');
    expect(nextRuleId('case_type', 'general', [])).toBe('GEN-ADD-001');
  });

  it('records a stage-only change as such', () => {
    const daca = { ...seed.rule_sets[0], package_items: seed.rule_sets[0].package_items };
    expect(withRuleEdited(daca, 'PS-201', {}, { draft_review: 'checked' }).change.action).toBe('stage_change');
    expect(withRuleEdited(daca, 'NOPE', { title: 'x' })).toBeNull();
  });
});

describe('suppressions (D-59)', () => {
  const sup = (method, body) => call(suppressionsRoute, '/api/proof-scan-v2-suppressions', { method, body });

  it('lists the R-1 seed and adds firm-wide suppressions, once', async () => {
    expect((await sup('GET')).body.suppressions.map((s) => s.reasoning_key)).toEqual(['signature_date_order']);
    const added = await sup('POST', { label: 'Photo background colour' });
    expect(added.body.suppression).toMatchObject({ reasoning_key: 'photo_background_colour', origin: 'staff', created_by: 'staff-1' });
    expect((await sup('POST', { label: 'Photo Background Colour' })).status).toBe(409);
  });
});

describe('Possible issues (D-36 to D-39, D-59, D-60)', () => {
  async function issueFromRun(over = {}) {
    const caseId = generalCase();
    mockModel(vi, [observations({ possible: [{ title: 'Page 5 looks rotated', description: 'd', evidence: 'p.5', why_it_matters: 'w', uncertainty: 'u', reasoning_key: 'rotated_page', ...over }] })]);
    const r = await runGeneral(caseId);
    return { caseId, run: r, issue: r.body.possible_issues[0] };
  }
  const act = (body) => call(issueRoute, '/api/proof-scan-v2-possible-issue', { method: 'POST', body });

  it('accept and dismiss are recorded and never touch the run\'s count or state (D-36)', async () => {
    const { run, issue } = await issueFromRun();
    const before = JSON.stringify(db.rows('proof_scans'));
    const accepted = await act({ issue_id: issue.id, action: 'accept' });
    expect(accepted.body.issue).toMatchObject({ status: 'accepted', decided_by: 'staff-1' });
    expect(JSON.stringify(db.rows('proof_scans'))).toBe(before);
    expect(run.body.result.attention_count).toBe(0);
  });

  it('dismissal choices exist only on an open issue (D-39)', async () => {
    const { issue } = await issueFromRun();
    expect((await act({ issue_id: issue.id, action: 'dismiss', reason: 'not_useful' })).body.issue).toMatchObject({ status: 'dismissed', dismiss_reason: 'not_useful' });
    expect((await act({ issue_id: issue.id, action: 'accept' })).status).toBe(409);
    expect((await act({ issue_id: issue.id, action: 'dismiss', reason: 'because' })).status).toBe(400);
  });

  it('"never suggest this reasoning again" suppresses it firm-wide, and it does not come back (D-59)', async () => {
    const { caseId, issue } = await issueFromRun();
    const r = await act({ issue_id: issue.id, action: 'dismiss', reason: 'never_suggest_reasoning' });
    expect(r.body.suppression).toMatchObject({ reasoning_key: 'rotated_page', origin: 'possible_issue', label: 'Page 5 looks rotated' });
    mockModel(vi, [observations({ possible: [{ title: 'Rotated again', description: 'd', evidence: 'p.2', why_it_matters: 'w', uncertainty: 'u', reasoning_key: 'rotated_page' }] })]);
    const again = await runGeneral(caseId);
    expect(again.body.possible_issues).toEqual([]);
  });

  it('suggest as a future rule: only after accepting, creates an official rule at once, only once (D-38, D-60)', async () => {
    const { issue } = await issueFromRun();
    const rule = { scope: 'case_type', title: 'Every page is upright.' };
    expect((await act({ issue_id: issue.id, action: 'suggest_rule', rule })).status).toBe(409);
    await act({ issue_id: issue.id, action: 'accept' });
    const created = await act({ issue_id: issue.id, action: 'suggest_rule', rule });
    expect(created.body).toEqual({ rule_id: 'GEN-ADD-001', versions: { general: 2 } });
    expect(rulesIn(currentSet('general').id).find((r) => r.rule_id === 'GEN-ADD-001')).toMatchObject({ origin: 'possible_issue', scope: 'case_type' });
    expect(db.rows('proof_scan_rule_changes')[0].possible_issue_id).toBe(issue.id);
    expect((await act({ issue_id: issue.id, action: 'suggest_rule', rule })).status).toBe(409);
  });

  it('staff choose a firm-wide scope instead', async () => {
    const { issue } = await issueFromRun();
    await act({ issue_id: issue.id, action: 'accept' });
    const created = await act({ issue_id: issue.id, action: 'suggest_rule', rule: { scope: 'firm', title: 'Every page is upright.' } });
    expect(created.body.versions).toEqual({ daca_renewal: 2, general: 2 });
  });
});

describe('the optional stage email (D-61)', () => {
  it('sends only the stage result and a link, never Possible issues, only when asked and stored', async () => {
    const caseId = generalCase();
    const sent = [];
    mockModel(vi, [
      observations({ rules: { 'PS-101': 'needs_attention' }, possible: [{ title: 'SECRET IDEA', description: 'd', evidence: 'e', why_it_matters: 'w', uncertainty: 'u', reasoning_key: 'k' }] }),
      observations(),
    ]);
    const model = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes('resend')) { sent.push(JSON.parse(opts.body)); return { ok: true, text: async () => '' }; }
      return model(url, opts);
    });
    const env = { ...ENV, RESEND_API_KEY: 'test' };
    const r = await call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body: { case_id: caseId, stage: 'physical_scan', files: [pdfFile()], email: true } }, env);
    expect(r.body).toMatchObject({ notification_attempted: true, notification_sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['alerts@example.test']);
    expect(sent[0].subject).toBe('Proof Scan: Physical Scan: 1 item needs attention');
    expect(sent[0].html).toContain('https://portal.example.test/portal#proof-scan');
    expect(sent[0].html).not.toContain('SECRET IDEA');
    expect(sent[0].html).not.toContain('Zeta'); // no client or case label
    expect(sent[0].html).not.toContain('—');
    await call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body: { case_id: caseId, stage: 'physical_scan', files: [pdfFile()] } }, env);
    expect(sent).toHaveLength(1); // off unless asked
  });

  it('builds nothing from a result whose phrase does not match its state', () => {
    const good = { stage: 'draft_review', report_state: 'no_issues_found', attention_count: 0, primary_report_language: 'No issues found' };
    expect(buildProofScanStageEmail(good, { portalUrl: 'https://p.example.test' }).subject).toBe('Proof Scan: Draft Review: No issues found');
    expect(buildProofScanStageEmail({ ...good, primary_report_language: 'All good' })).toBeNull();
    expect(buildProofScanStageEmail({ ...good, report_state: 'pass' })).toBeNull();
    expect(buildProofScanStageEmail({ ...good, stage: 'evidence_zero' })).toBeNull();
  });
});
