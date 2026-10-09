// Unit tests for the Proof Scan page (Batch 3).
//
// Two kinds of test, because the suite runs inside workerd and there is no DOM:
//
//   1. report-model.js is pure by design — all the decisions that matter (missing
//      -form suppression, what counts, the SSN mask, omitting empty fields,
//      grouping and ordering) live there and are tested directly against results
//      composed by the REAL server contract, not hand-written fixtures.
//   2. The DOM layer and the controller are checked at the source level, the same
//      way route-coverage.test.js checks the front end. That is what proves there
//      is no innerHTML path for model output and no lab diagnostic left behind.
//
// No frontend test dependency was added to make either of these possible.
import { describe, it, expect } from 'vitest';
import {
  buildReportModel,
  checkSelectedFile,
  scanErrorMessage,
  maskSsn,
  primaryClientFacts,
  secondaryClientFacts,
  historyRowModel,
  MAX_PDF_BYTES,
  SCAN_TYPES,
  PACKAGE_GROUP_LABEL,
  LEGACY_ROW_LABEL,
  UNAVAILABLE_ROW_LABEL,
} from '../../pages/proof-scan/report-model.js';
import {
  getSelectedScanProfile,
  validateAndComposeObservations,
} from '../../functions/api/proof-scan-contract.js';

const profile = getSelectedScanProfile('daca_renewal');
const SCAN = { filename: 'daca-renewal-package.pdf', scanned_at: '2026-09-02T12:00:00Z' };

// Build observations, run them through the real server composition, then shape
// the payload exactly as functions/api/proof-scan.js does. If either side drifts,
// these tests are looking at the wrong thing — proof-scan-api.test.js pins the
// response keys so that drift shows up there too.
function composeResult(mutate = () => {}) {
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

const ruleOf = (observations, id) => observations.rule_results.find((r) => r.rule_id === id);
const itemOf = (observations, id) => observations.package_items.find((i) => i.item_id === id);
const targetsOf = (id) => profile.rules.find((r) => r.rule_id === id).applies_to_item_ids || [];

// Marks the $85 biometrics G-1450 missing and puts every rule that depends on it
// into not_checked — the shape the server suppresses.
function missingBiometricsForm(observations) {
  const item = itemOf(observations, 'DACA-COMP-G1450-BIOMETRICS-FEE');
  item.status = 'needs_attention';
  item.reason = 'No $85 G-1450 is in the package.';
  for (const rule of observations.rule_results) {
    const targets = targetsOf(rule.rule_id);
    if (!targets.includes('DACA-COMP-G1450-BIOMETRICS-FEE')) continue;
    rule.status = 'not_checked';
    rule.reason = 'The form it depends on is missing.';
    rule.not_checked_item_ids = ['DACA-COMP-G1450-BIOMETRICS-FEE'];
  }
}

// ── Client-side file guard ────────────────────────────────────────────────────

describe('checkSelectedFile', () => {
  const file = (over = {}) => ({ name: 'package.pdf', type: 'application/pdf', size: 1024, ...over });

  it('accepts a normal PDF', () => {
    expect(checkSelectedFile(file())).toBeNull();
  });

  it('rejects a non-PDF', () => {
    expect(checkSelectedFile(file({ name: 'scan.docx', type: 'application/msword' })))
      .toMatch(/not a PDF/i);
  });

  it('rejects an empty file', () => {
    expect(checkSelectedFile(file({ size: 0 }))).toMatch(/empty/i);
  });

  it('rejects a file over the 12 MB server limit and names the limit', () => {
    const message = checkSelectedFile(file({ size: MAX_PDF_BYTES + 1 }));
    expect(message).toMatch(/limit is 12 MB/);
  });

  it('accepts a file exactly at the limit — the client never narrows the server rule', () => {
    expect(checkSelectedFile(file({ size: MAX_PDF_BYTES }))).toBeNull();
  });

  it('rejects nothing selected', () => {
    expect(checkSelectedFile(null)).toMatch(/Choose a PDF/);
  });

  it('mirrors the server limit exactly', () => {
    expect(MAX_PDF_BYTES).toBe(12 * 1024 * 1024);
  });
});

describe('scanErrorMessage', () => {
  it('prefers the server message on a 400', () => {
    expect(scanErrorMessage(400, { error: 'scan_profile: Required' })).toBe('scan_profile: Required');
  });
  it('never implies a 502 produced a result', () => {
    const message = scanErrorMessage(502, null);
    expect(message).toMatch(/Nothing was saved/);
    expect(message).not.toMatch(/\bpassed\b|approved|succeeded|ready to file/i);
  });
  it('covers 500, network-shaped and unknown statuses without inventing a verdict', () => {
    for (const status of [500, 503, 418]) {
      expect(scanErrorMessage(status, null)).toMatch(/could not|failed/i);
    }
  });
});

describe('scan types', () => {
  it('offers exactly one configured scan type, submitting daca_renewal', () => {
    expect(SCAN_TYPES).toEqual([{ value: 'daca_renewal', label: 'DACA renewal' }]);
  });
});

// ── Client summary ────────────────────────────────────────────────────────────

describe('client summary', () => {
  it('masks the SSN to its last four digits and nothing else', () => {
    expect(maskSsn('4321')).toBe('•••-••-4321');
    expect(maskSsn('4321')).not.toContain('123-45');
  });

  it.each([null, undefined, '', '123-45-6789', '123', 'abcd'])(
    'refuses to render %s as an SSN',
    (value) => { expect(maskSsn(value)).toBeNull(); },
  );

  it('always shows the four identity facts, with an em dash for what was not read', () => {
    const facts = primaryClientFacts({ name: 'Jane Doe' }, 'DACA renewal');
    expect(facts.map((f) => f.key)).toEqual(['Client', 'A-Number', 'EAD expires', 'Case']);
    expect(facts[0].value).toBe('Jane Doe');
    expect(facts[1].value).toBe('—');
    expect(facts[3].value).toBe('DACA renewal');
  });

  it('omits secondary facts the package did not carry', () => {
    const facts = secondaryClientFacts({
      date_of_birth: null, ssn_last4: '4321', uscis_account_number: '   ',
      phone: null, email: 'jane@example.com', address: null,
    });
    expect(facts.map((f) => f.key)).toEqual(['SSN', 'Email']);
    expect(facts[0].value).toBe('•••-••-4321');
  });

  it('carries no field other than ssn_last4 that could hold an SSN', () => {
    const model = buildReportModel(composeResult());
    const rendered = JSON.stringify(model.client);
    expect(rendered).toContain('•••-••-4321');
    expect(rendered).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(rendered).not.toMatch(/full_ssn|ssn_last4/);
  });

  it('treats HTML-like observed values as ordinary text, unchanged', () => {
    const hostile = '<script>alert(1)</script>';
    const model = buildReportModel(composeResult((o) => { o.client_observed.name = hostile; }));
    expect(model.client.primary[0].value).toBe(hostile);   // preserved verbatim, not stripped
  });
});

// ── Report states ─────────────────────────────────────────────────────────────

describe('report states', () => {
  it('renders no_issues_found with nothing flagged', () => {
    const model = buildReportModel(composeResult());
    expect(model.report_state).toBe('no_issues_found');
    expect(model.primary_report_language).toBe('No issues found');
    expect(model.needs_attention).toHaveLength(0);
    expect(model.not_checked).toHaveLength(0);
    expect(model.attention_count).toBe(0);
  });

  it('renders review_incomplete when a check could not be evaluated', () => {
    const model = buildReportModel(composeResult((o) => {
      const rule = ruleOf(o, 'DACA-765-001');
      rule.status = 'not_checked';
      rule.reason = 'The field was too faint to read.';
      rule.not_checked_item_ids = ['DACA-COMP-I765'];   // present, but unreadable
    }));
    expect(model.report_state).toBe('review_incomplete');
    expect(model.primary_report_language).toBe('Review incomplete');
    expect(model.needs_attention).toHaveLength(0);
    expect(model.not_checked).toHaveLength(1);
  });

  it('renders items_need_attention, singular, for exactly one issue', () => {
    const model = buildReportModel(composeResult((o) => {
      const rule = ruleOf(o, 'DACA-765-001');
      rule.status = 'needs_attention';
      rule.summary = 'The applicant did not sign the I-765.';
    }));
    expect(model.report_state).toBe('items_need_attention');
    expect(model.primary_report_language).toBe('1 item needs attention');
    expect(model.attention_count).toBe(1);
  });

  it('renders items_need_attention, plural, beyond one', () => {
    const model = buildReportModel(composeResult((o) => {
      for (const id of ['DACA-765-001', 'DACA-765-002']) {
        const rule = ruleOf(o, id);
        rule.status = 'needs_attention';
        rule.summary = 'Something is wrong here.';
      }
    }));
    expect(model.primary_report_language).toBe('2 items need attention');
    expect(model.attention_count).toBe(2);
  });

  it('never produces pass, approved, correct or ready-to-file language', () => {
    for (const mutate of [() => {}, missingBiometricsForm]) {
      const model = buildReportModel(composeResult(mutate));
      const text = JSON.stringify([model.primary_report_language, model.report_state]);
      expect(text).not.toMatch(/\bpass\b|approved|ready to file|needs correction/i);
    }
  });
});

// ── Missing forms and suppression ─────────────────────────────────────────────

describe('missing package item', () => {
  const model = buildReportModel(composeResult(missingBiometricsForm));

  it('appears exactly once, as the single actionable issue', () => {
    expect(model.attention_count).toBe(1);
    expect(model.needs_attention).toHaveLength(1);
    expect(model.needs_attention[0].kind).toBe('package_item');
    expect(model.needs_attention[0].id).toBe('DACA-COMP-G1450-BIOMETRICS-FEE');
    expect(model.needs_attention[0].headline).toMatch(/G-1450 \$85 is not in the package/);
    expect(model.primary_report_language).toBe('1 item needs attention');
  });

  it('keeps its dependent checks out of the general Not checked section', () => {
    expect(model.not_checked).toHaveLength(0);
  });

  it('lists those dependent checks quietly inside the missing item, by title', () => {
    const blocked = model.needs_attention[0].blocked;
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((b) => typeof b.title === 'string' && b.title.length)).toBe(true);
    expect(blocked.every((b) => typeof b.rule_id === 'string')).toBe(true);
  });

  it('never converts a suppressed check to clear', () => {
    const suppressed = new Set(model.needs_attention[0].blocked.map((b) => b.rule_id));
    const rows = model.groups.flatMap((g) => g.items).filter((i) => suppressed.has(i.rule_id));
    expect(rows.length).toBe(suppressed.size);
    expect(rows.every((r) => r.status === 'not_checked' && r.suppressed)).toBe(true);
  });

  it('shows the missing form as not included in the scan', () => {
    const row = model.included.find((i) => i.item_id === 'DACA-COMP-G1450-BIOMETRICS-FEE');
    expect(row.ok).toBe(false);
    expect(row.status).toBe('needs_attention');
  });
});

describe('independently unreadable checks', () => {
  it('stay visible under Not checked while a missing form is suppressed', () => {
    const model = buildReportModel(composeResult((o) => {
      missingBiometricsForm(o);
      // A different form is present but one of its fields could not be read.
      const rule = ruleOf(o, 'DACA-765-003');
      rule.status = 'not_checked';
      rule.reason = 'The date beside the signature was illegible.';
      rule.not_checked_item_ids = ['DACA-COMP-I765'];
    }));

    expect(model.not_checked).toHaveLength(1);
    expect(model.not_checked[0].id).toBe('DACA-765-003');
    expect(model.not_checked[0].reason).toMatch(/illegible/);
    // The missing form is still one issue, not one plus its dependants.
    expect(model.attention_count).toBe(1);
  });

  it('keeps a shared rule visible when only one of its two forms is missing', () => {
    const model = buildReportModel(composeResult((o) => {
      missingBiometricsForm(o);
      const shared = ruleOf(o, 'DACA-G1450-004');
      shared.not_checked_item_ids = [
        'DACA-COMP-G1450-BIOMETRICS-FEE',
        'DACA-COMP-G1450-FILING-FEE',
      ];
      shared.reason = 'One G-1450 is missing and the other card field could not be read.';
    }));

    expect(model.not_checked.map((n) => n.id)).toContain('DACA-G1450-004');
  });
});

// ── Grouping and ordering ─────────────────────────────────────────────────────

describe('checks grouped by form', () => {
  const model = buildReportModel(composeResult());

  it('covers every configured rule exactly once across the groups', () => {
    const ids = model.groups.flatMap((g) => g.items).map((i) => i.rule_id);
    expect(ids).toHaveLength(profile.rules.length);
    expect(new Set(ids).size).toBe(profile.rules.length);
  });

  it('orders forms the way the package is assembled, package-wide checks last', () => {
    const forms = model.groups.map((g) => g.form);
    expect(forms[forms.length - 1]).toBe(PACKAGE_GROUP_LABEL);
    expect(forms.indexOf('G-1450')).toBeLessThan(forms.indexOf('I-765'));
  });

  it('preserves the server ordering of rules inside a group', () => {
    const g28 = model.groups.find((g) => g.form === 'G-28');
    expect(g28.items.map((i) => i.rule_id))
      .toEqual(profile.rules.filter((r) => r.form === 'G-28').map((r) => r.rule_id));
  });

  it('counts cleared against total per group', () => {
    expect(model.groups.every((g) => g.cleared === g.total)).toBe(true);
    expect(model.groups.every((g) => g.outstanding.length === 0)).toBe(true);
  });

  it('lists every package item in configured order', () => {
    expect(model.included.map((i) => i.item_id))
      .toEqual(profile.package_items.map((i) => i.item_id));
  });

  it('uses the profile pass_text on a cleared row and the observation otherwise', () => {
    const clear = model.groups.flatMap((g) => g.items).find((i) => i.rule_id === 'DACA-G1450-002');
    expect(clear.line).toBe(profile.rules.find((r) => r.rule_id === 'DACA-G1450-002').pass_text);

    const flagged = buildReportModel(composeResult((o) => {
      const rule = ruleOf(o, 'DACA-G1450-002');
      rule.status = 'needs_attention';
      rule.summary = 'The G-1450 authorises $495, not $520.';
    }));
    expect(flagged.needs_attention[0].headline).toBe('The G-1450 authorises $495, not $520.');
    expect(flagged.needs_attention[0].severity).toBe('fatal');     // profile-owned
    expect(flagged.needs_attention[0].expected).toBe('$520');      // profile-owned
  });

  it('passes evidence through verbatim, including HTML-like text', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const model2 = buildReportModel(composeResult((o) => {
      const rule = ruleOf(o, 'DACA-765-001');
      rule.status = 'needs_attention';
      rule.summary = 'Unsigned.';
      rule.evidence = hostile;
    }));
    expect(model2.needs_attention[0].evidence).toBe(hostile);
  });

  it('survives an empty or malformed payload without throwing', () => {
    for (const input of [{}, null, undefined, { package_items: null, rule_results: 'nope' }]) {
      const model3 = buildReportModel(input);
      expect(model3.needs_attention).toEqual([]);
      expect(model3.groups).toEqual([]);
      expect(model3.scan.filename).toBe('Untitled package');
    }
  });
});

// The page-source checks that used to follow tested v1.2's /proof-scan page and
// controller. On the production branch that route is still the live checker and
// v1.2's page never shipped, so they were retired when v2 was ported; v2's own
// page-source guarantees live in proof-scan-v2-page.test.js.

describe('history row model', () => {
  const row = (over = {}) => ({
    id: 'ec7d5e2e-0000-4000-8000-000000000001',
    filename: 'daca-renewal-package.pdf',
    created_at: '2026-09-02T12:00:00Z',
    ...over,
  });

  it.each([
    ['items_need_attention', '3 items need attention', 'attention'],
    ['review_incomplete',    'Review incomplete',      'incomplete'],
    ['no_issues_found',      'No issues found',        'clear'],
  ])('shows the stored language for %s', (report_state, report_language, tone) => {
    expect(historyRowModel(row({ kind: 'structured', report_state, report_language })))
      .toMatchObject({ kind: 'structured', label: report_language, tone });
  });

  it('labels a legacy row and gives it no report language', () => {
    expect(historyRowModel(row({ kind: 'legacy', report_state: null, report_language: null })))
      .toMatchObject({ kind: 'legacy', label: LEGACY_ROW_LABEL, tone: 'legacy' });
  });

  it.each([
    ['the server marked it unavailable', { kind: 'unavailable', report_state: null, report_language: null }],
    ['the language is missing',          { kind: 'structured', report_state: 'no_issues_found', report_language: null }],
    ['the language is blank',            { kind: 'structured', report_state: 'no_issues_found', report_language: '   ' }],
    ['the state is missing',             { kind: 'structured', report_state: null, report_language: 'No issues found' }],
    ['the state is unknown',             { kind: 'structured', report_state: 'passed', report_language: 'Pass' }],
    ['the state is a forbidden verdict', { kind: 'structured', report_state: 'pass', report_language: 'Pass' }],
    ['the row is empty',                 {}],
  ])('never renders a clean row when %s', (_name, over) => {
    const model = historyRowModel(row(over));
    expect(model.kind).toBe('unavailable');
    expect(model.label).toBe(UNAVAILABLE_ROW_LABEL);
    expect(model.tone).toBe('unavailable');
  });

  it('never composes a phrase of its own', () => {
    // A state with no language attached does NOT get one invented for it.
    const model = historyRowModel(row({ kind: 'structured', report_state: 'items_need_attention', report_language: null }));
    expect(model.label).toBe(UNAVAILABLE_ROW_LABEL);
  });

  it('falls back to a readable name rather than an empty row', () => {
    expect(historyRowModel(row({ kind: 'legacy', filename: '' })).filename).toBe('Untitled package');
  });
});
