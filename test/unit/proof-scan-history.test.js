// Unit tests for authenticated Proof Scan history (Batch 4).
//
// The guarantee this file holds: nothing about a saved scan leaves the server
// without passing auth, and no stored result reaches the page unless it still
// validates. A row that cannot be trusted comes back neutral — never clean, never
// with a verdict, never with a phrase the server did not compose itself.
//
// Auth and Supabase are mocked. No test here makes a network call.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { onRequest as history, historyRow } from '../../functions/api/proof-scan-history.js';
import {
  getSelectedScanProfile,
  validateAndComposeObservations,
} from '../../functions/api/proof-scan-contract.js';
import { loadScanProfile } from '../../functions/api/proof-scan-profiles/index.js';

const profile = getSelectedScanProfile('daca_renewal');
const SCAN = { filename: 'daca-renewal-package.pdf', scanned_at: '2026-09-02T12:00:00Z' };
const ID = '11111111-2222-4333-8444-555555555555';
const ENV = {};

// ── Stored-result fixtures ────────────────────────────────────────────────────
//
// Built by the REAL server composition, then shaped exactly as proof-scan.js
// stores them, so these tests exercise the same bytes production writes.

function storedResult(mutate = () => {}) {
  const observations = {
    client_observed: {
      name: 'Jane Doe', a_number: 'A123456789', ead_expires: '01/15/2027',
      date_of_birth: null, ssn_last4: '4321', uscis_account_number: null,
      phone: null, email: null, address: null,
    },
    package_items: profile.package_items.map((item) => ({
      item_id: item.item_id, status: 'clear', locations: [], evidence: null, reason: null,
    })),
    rule_results: profile.rules.map((rule) => ({
      rule_id: rule.rule_id, status: 'clear', summary: null, locations: [],
      evidence: null, reason: null, not_checked_item_ids: null,
    })),
  };
  mutate(observations);

  const result = validateAndComposeObservations(profile, observations, SCAN);
  if (!result.ok) throw new Error('fixture did not compose: ' + JSON.stringify(result.issues));

  return {
    schema_version: profile.contract.result_schema_version,
    scan_profile: profile.profile_id,
    profile_version: profile.profile_version,
    profile_label: profile.label,
    scan: result.scan,
    report_state: result.report_state,
    primary_report_language: result.primary_report_language,
    attention_count: result.attention_count,
    attention_items: result.attention_items,
    unsuppressed_not_checked_count: result.unsuppressed_not_checked_count,
    client_observed: result.client_observed,
    package_items: result.package_items,
    rule_results: result.rule_results,
  };
}

// Rules that depend on no package item, so making one not_checked cannot be
// suppressed by a missing form.
const standaloneRuleIds = new Set(
  profile.rules.filter((rule) => !rule.applies_to_item_ids).map((rule) => rule.rule_id),
);

// One failed check → "1 item needs attention".
const attentionResult = () => storedResult((obs) => {
  const rule = obs.rule_results[0];
  rule.status = 'needs_attention';
  rule.summary = 'The G-28 is not signed by the attorney.';
});

// One independently unreadable check → "Review incomplete".
const incompleteResult = () => storedResult((obs) => {
  const rule = obs.rule_results.find((r) => standaloneRuleIds.has(r.rule_id));
  rule.status = 'not_checked';
  rule.reason = 'That page is too faint to read.';
});

// A structured row as the database holds it.
function structuredRow(result, overrides = {}) {
  return {
    id: ID,
    filename: result?.scan?.filename || 'daca-renewal-package.pdf',
    created_at: '2026-09-02T12:00:00Z',
    status: 'structured',
    report_state: result?.report_state ?? null,
    attention_count: result?.attention_count ?? null,
    scan_profile: result?.scan_profile ?? 'daca_renewal',
    profile_version: 1,
    result_schema_version: 1,
    result_json: result,
    result_html: null,
    ...overrides,
  };
}

const legacyRow = (overrides = {}) => ({
  id: ID,
  filename: 'old-package.pdf',
  created_at: '2025-04-01T12:00:00Z',
  status: 'pass',
  report_state: null,
  attention_count: null,
  scan_profile: null,
  profile_version: null,
  result_schema_version: null,
  result_json: null,
  result_html: '<p>Everything looked fine.</p>',
  ...overrides,
});

// ── Supabase stub ─────────────────────────────────────────────────────────────

function makeAdmin({ rows = [], error = null } = {}) {
  const queries = [];
  function build(table) {
    const q = { table, columns: null, filters: [], limit: null };
    queries.push(q);
    const chain = {
      select: (columns) => { q.columns = columns; return chain; },
      order:  () => chain,
      eq:     (column, value) => { q.filters.push([column, value]); return chain; },
      limit:  (n) => { q.limit = n; return chain; },
      then:   (resolve) => resolve({ data: error ? null : rows, error }),
    };
    return chain;
  }
  return { from: build, queries };
}

// ── Request helpers ───────────────────────────────────────────────────────────

const listRequest = () => new Request('https://x/api/proof-scan-history', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer t', 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});

const detailRequest = (scan_id) => new Request('https://x/api/proof-scan-history', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer t', 'Content-Type': 'application/json' },
  body: JSON.stringify({ scan_id }),
});

async function call(request, admin) {
  helpersMock.makeAdminClient.mockReturnValue(admin);
  const res = await history({ request, env: ENV });
  return { res, body: await res.json() };
}

const asStaff = () => helpersMock.verifyAuth.mockResolvedValue({
  profile: { id: 'staff-1', roles: { name: 'Attorney' } }, accessLevel: 'write', isClient: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  asStaff();
});

describe('proof scan profile registry — historical versions', () => {
  it('selects the configured current version for a fresh scan', () => {
    expect(loadScanProfile('daca_renewal')).toStrictEqual(profile);
  });

  it('loads DACA renewal v1 by exact recorded version', () => {
    expect(loadScanProfile('daca_renewal', 1)).toStrictEqual(profile);
  });

  it.each([
    ['daca_renewal', 99],
    ['unknown_profile', 1],
  ])('rejects unsupported exact profile/version %s@%s', (profileId, version) => {
    expect(loadScanProfile(profileId, version)).toBeNull();
  });
});

// ── Authentication and ownership ──────────────────────────────────────────────

describe('proof scan history — access', () => {
  it.each([
    ['list',   listRequest],
    ['detail', () => detailRequest(ID)],
  ])('rejects an unauthenticated %s request without touching the database', async (_name, make) => {
    helpersMock.verifyAuth.mockResolvedValue({ httpError: { status: 401, message: 'Unauthorized' } });
    const admin = makeAdmin({ rows: [structuredRow(storedResult())] });
    const { res, body } = await call(make(), admin);
    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(admin.queries).toHaveLength(0);
  });

  it.each([
    ['list',   listRequest],
    ['detail', () => detailRequest(ID)],
  ])('rejects a %s from a role without proof_scan access', async (_name, make) => {
    helpersMock.verifyAuth.mockResolvedValue({
      httpError: { status: 403, message: 'Insufficient permissions for proof_scan module' },
    });
    const admin = makeAdmin({ rows: [legacyRow()] });
    const { res } = await call(make(), admin);
    expect(res.status).toBe(403);
    expect(admin.queries).toHaveLength(0);
  });

  it.each([
    ['list',   listRequest],
    ['detail', () => detailRequest(ID)],
  ])('refuses a portal client on %s even if a grant is misconfigured', async (_name, make) => {
    // This is verifyAuth's real post-permission shape: its profile retains the
    // Client role, but isClient is reset to false after the ordinary grant check.
    helpersMock.verifyAuth.mockResolvedValue({
      profile: { id: 'client-1', roles: { name: 'Client' } },
      accessLevel: 'write',
      isClient: false,
    });
    const admin = makeAdmin({ rows: [structuredRow(storedResult())] });
    const { res, body } = await call(make(), admin);
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/permissions/i);
    expect(helpersMock.makeAdminClient).not.toHaveBeenCalled();
    expect(admin.queries).toHaveLength(0);
  });

  it('asks verifyAuth for read on the proof_scan module, without a client bypass', async () => {
    await call(listRequest(), makeAdmin({ rows: [] }));
    expect(helpersMock.verifyAuth).toHaveBeenCalledWith(
      expect.anything(), ENV, 'read', 'proof_scan',
    );
    // A fifth argument is where clientBypass would live. There isn't one.
    expect(helpersMock.verifyAuth.mock.calls[0]).toHaveLength(4);
  });

  it('rejects anything but POST', async () => {
    const req = new Request('https://x/api/proof-scan-history', { method: 'GET' });
    const { res } = await call(req, makeAdmin({ rows: [] }));
    expect(res.status).toBe(405);
  });

  it('rejects a scan_id that is not a scan identifier', async () => {
    for (const bad of ['../../etc/passwd', "' OR 1=1 --", 'not-a-uuid', 42, null, {}]) {
      const admin = makeAdmin({ rows: [] });
      const { res } = await call(detailRequest(bad), admin);
      expect(res.status).toBe(400);
      expect(admin.queries).toHaveLength(0);
    }
  });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe('proof scan history — list', () => {
  it('returns the last ten, newest first, without the heavy result JSON', async () => {
    const admin = makeAdmin({ rows: [structuredRow(storedResult())] });
    const { res } = await call(listRequest(), admin);
    expect(res.status).toBe(200);
    const [query] = admin.queries;
    expect(query.table).toBe('proof_scans');
    expect(query.limit).toBe(10);
    expect(query.columns).not.toMatch(/result_json/);
    expect(query.columns).not.toMatch(/result_html/);
  });

  it('shows the deterministic language for every structured state', async () => {
    const cases = [
      [attentionResult(),  '1 item needs attention', 'items_need_attention'],
      [incompleteResult(), 'Review incomplete',      'review_incomplete'],
      [storedResult(),     'No issues found',        'no_issues_found'],
    ];
    for (const [result, language, state] of cases) {
      const admin = makeAdmin({ rows: [structuredRow(result)] });
      const { body } = await call(listRequest(), admin);
      expect(body.scans[0]).toMatchObject({
        kind: 'structured', report_language: language, report_state: state,
      });
    }
  });

  it('pluralises the attention count from the stored count, not from prose', () => {
    expect(historyRow({ result_schema_version: 1, report_state: 'items_need_attention', attention_count: 1 }))
      .toMatchObject({ report_language: '1 item needs attention' });
    expect(historyRow({ result_schema_version: 1, report_state: 'items_need_attention', attention_count: 4 }))
      .toMatchObject({ report_language: '4 items need attention' });
  });

  it('labels a pre-structured row legacy and gives it no report language', () => {
    expect(historyRow(legacyRow())).toMatchObject({
      kind: 'legacy', report_language: null, report_state: null,
    });
  });

  it.each([
    ['a missing report state',        { report_state: null, attention_count: 0 }],
    ['an unknown report state',       { report_state: 'passed', attention_count: 0 }],
    ['a forbidden verdict state',     { report_state: 'pass', attention_count: 0 }],
    ['attention with no count',       { report_state: 'items_need_attention', attention_count: null }],
    ['attention with a zero count',   { report_state: 'items_need_attention', attention_count: 0 }],
    ['a future schema version',       { result_schema_version: 2, report_state: 'no_issues_found', attention_count: 0 }],
  ])('never turns %s into a clean row', (_name, overrides) => {
    const row = historyRow({ result_schema_version: 1, ...overrides });
    expect(row.kind).toBe('unavailable');
    expect(row.report_language).toBeNull();
    expect(row.report_state).toBeNull();
  });

  it('surfaces a database error rather than an empty, clean-looking list', async () => {
    const admin = makeAdmin({ error: { message: 'connection reset' } });
    const { res, body } = await call(listRequest(), admin);
    expect(res.status).toBe(500);
    expect(body.error).toMatch(/could not load proof scan history/i);
    expect(body.scans).toBeUndefined();
  });

  it('names required migrations when structured history columns are absent', async () => {
    const admin = makeAdmin({ error: { code: '42703', message: 'column attention_count does not exist' } });
    const { res, body } = await call(listRequest(), admin);
    expect(res.status).toBe(500);
    expect(body.error).toMatch(/migrations 1302 and 1303/i);
  });
});

// ── Detail ────────────────────────────────────────────────────────────────────

describe('proof scan history — structured detail', () => {
  it.each(['A123456789', '123456789'])(
    'revalidates and reopens history with A-Number value %s',
    async (aNumber) => {
      const result = storedResult((obs) => { obs.client_observed.a_number = aNumber; });
      const { res, body } = await call(
        detailRequest(ID),
        makeAdmin({ rows: [structuredRow(result)] }),
      );
      expect(res.status).toBe(200);
      expect(body.kind).toBe('structured');
      expect(body.result.client_observed.a_number).toBe(aNumber);
    },
  );

  it('returns the validated stored result for the requested scan only', async () => {
    const result = attentionResult();
    const admin = makeAdmin({ rows: [structuredRow(result)] });
    const { res, body } = await call(detailRequest(ID), admin);
    expect(res.status).toBe(200);
    expect(body.kind).toBe('structured');
    expect(admin.queries[0].filters).toEqual([['id', ID]]);
    expect(body.result.report_state).toBe('items_need_attention');
    expect(body.result.primary_report_language).toBe('1 item needs attention');
    // Everything the renderer needs to draw the same report a fresh scan drew.
    expect(body.result.rule_results).toHaveLength(profile.rules.length);
    expect(body.result.package_items).toHaveLength(profile.package_items.length);
  });

  it('carries hostile observed strings through as data, never as markup', async () => {
    const hostile = `<script>alert(1)</script> & "quoted" 'apostrophed'`;
    const result = storedResult((obs) => {
      obs.client_observed.name = hostile;
      obs.rule_results[0].status = 'needs_attention';
      obs.rule_results[0].summary = hostile;
    });
    const admin = makeAdmin({ rows: [structuredRow(result)] });
    const { body } = await call(detailRequest(ID), admin);
    // Stored verbatim — the renderer draws it with textContent, the email escapes it.
    expect(body.result.client_observed.name).toBe(hostile);
    expect(body.result.rule_results[0].summary).toBe(hostile);
    expect(body.kind).toBe('structured');
  });

  it('404s a scan that does not exist', async () => {
    const { res } = await call(detailRequest(ID), makeAdmin({ rows: [] }));
    expect(res.status).toBe(404);
  });

  it.each([
    ['malformed JSON',            () => ({ nonsense: true })],
    ['a truncated result',        () => { const r = storedResult(); delete r.rule_results; return r; }],
    ['a dropped rule',            () => { const r = storedResult(); r.rule_results.pop(); r.rule_results.push(r.rule_results[0]); return r; }],
    ['an omitted rule',           () => { const r = storedResult(); r.rule_results.pop(); return r; }],
    ['an omitted package item',   () => { const r = storedResult(); r.package_items.pop(); return r; }],
    ['an unknown rule id',        () => { const r = storedResult(); r.rule_results[0] = { ...r.rule_results[0], rule_id: 'PS-999' }; return r; }],
    ['an unknown schema version', () => ({ ...storedResult(), schema_version: 2 })],
    ['an unsupported profile',    () => ({ ...storedResult(), scan_profile: 'aos_family' })],
    ['an unverifiable profile version', () => ({ ...storedResult(), profile_version: 99 })],
    ['a tampered clean state',    () => ({ ...attentionResult(), report_state: 'no_issues_found', attention_count: 0, primary_report_language: 'No issues found' })],
    ['a tampered language',       () => ({ ...storedResult(), primary_report_language: 'Pass' })],
    ['a tampered rule title',     () => { const r = storedResult(); r.rule_results[0].title = 'Model title'; return r; }],
    ['a tampered severity',       () => { const r = storedResult(); r.rule_results[0].severity = 'warning'; return r; }],
    ['reordered rules',           () => { const r = storedResult(); r.rule_results.reverse(); return r; }],
    ['a false attention item',    () => { const r = attentionResult(); r.attention_items[0].id = r.rule_results[1].rule_id; return r; }],
    ['an extra unknown field',    () => ({ ...storedResult(), overall_verdict: 'PASS' })],
    ['a full SSN',                () => { const r = storedResult(); r.client_observed.ssn_last4 = '123456789'; return r; }],
    ['a full SSN in free text',   () => { const r = storedResult(); r.rule_results[0].evidence = 'SSN 123456789'; return r; }],
  ])('refuses to render %s, returning a neutral unavailable message', async (_name, make) => {
    const admin = makeAdmin({ rows: [structuredRow(make())] });
    const { res, body } = await call(detailRequest(ID), admin);
    expect(res.status).toBe(200);
    expect(body.kind).toBe('unavailable');
    expect(body.result).toBeUndefined();
    expect(body.result_html).toBeUndefined();
    expect(body.message).toMatch(/cannot be displayed/i);
    // Not one reassuring word.
    expect(body.message).not.toMatch(/pass|approved|correct|no issues|ready to file/i);
  });

  it('never falls back to legacy HTML when structured JSON is present but broken', async () => {
    const admin = makeAdmin({ rows: [structuredRow({ nonsense: true }, {
      result_html: '<p>an old result that must not stand in</p>',
    })] });
    const { body } = await call(detailRequest(ID), admin);
    expect(body.kind).toBe('unavailable');
    expect(JSON.stringify(body)).not.toMatch(/must not stand in/);
  });
});

describe('proof scan history — legacy detail', () => {
  it('returns a legacy row labelled as legacy, with its raw HTML for plain-text display', async () => {
    const admin = makeAdmin({ rows: [legacyRow()] });
    const { res, body } = await call(detailRequest(ID), admin);
    expect(res.status).toBe(200);
    expect(body.kind).toBe('legacy');
    expect(body.result_html).toBe('<p>Everything looked fine.</p>');
    // No state, no language, no verdict is invented for it.
    expect(body.report_state).toBeUndefined();
    expect(body.primary_report_language).toBeUndefined();
  });

  it('hands hostile legacy HTML back untouched — sanitising is the page boundary', async () => {
    const hostile = '<p onclick="x">hi</p><script>steal()</script><a href="javascript:alert(1)">go</a>';
    const admin = makeAdmin({ rows: [legacyRow({ result_html: hostile })] });
    const { body } = await call(detailRequest(ID), admin);
    expect(body.kind).toBe('legacy');
    expect(body.result_html).toBe(hostile);
  });

  it('calls a legacy row with an empty result unavailable rather than clean', async () => {
    for (const result_html of ['', '   ', null]) {
      const admin = makeAdmin({ rows: [legacyRow({ result_html })] });
      const { body } = await call(detailRequest(ID), admin);
      expect(body.kind).toBe('unavailable');
    }
  });

  it('never repeats the legacy status column as a verdict', async () => {
    const admin = makeAdmin({ rows: [legacyRow({ status: 'pass' })] });
    const { body } = await call(detailRequest(ID), admin);
    expect(JSON.stringify(body)).not.toMatch(/"status"/);
  });
});
