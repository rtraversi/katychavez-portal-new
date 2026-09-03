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
  MAX_PDF_BYTES,
  SCAN_TYPES,
  PACKAGE_GROUP_LABEL,
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

// ── Source-level guarantees ───────────────────────────────────────────────────
//
// Tests run in workerd with no DOM, so the rules that live in the DOM layer are
// asserted against the source, the way route-coverage.test.js does.

const pageSources = import.meta.glob('../../pages/proof-scan/*.js', {
  query: '?raw', import: 'default', eager: true,
});
const pageMarkup = import.meta.glob('../../pages/proof-scan/index.html', {
  query: '?raw', import: 'default', eager: true,
});
const src = (name) => pageSources[`../../pages/proof-scan/${name}`];
const markup = Object.values(pageMarkup)[0];

// Several checks below are "this token must not appear". The files explain those
// same rules in prose, so strip comments first or the documentation fails the test.
const codeOf = (name) => src(name)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '')).join('\n');

describe('proof-scan page source', () => {
  it('found the files it means to check', () => {
    expect(src('report.js')).toBeTruthy();
    expect(src('report-model.js')).toBeTruthy();
    expect(src('proof-scan.js')).toBeTruthy();
    expect(markup).toBeTruthy();
  });

  it('renders results with text nodes only — no innerHTML anywhere in the renderer', () => {
    expect(codeOf('report.js')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(codeOf('report-model.js')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it('keeps the legacy HTML themer off every new-scan path', () => {
    const controller = codeOf('proof-scan.js');
    // Only the legacy history modal may call it: one definition, one call.
    const calls = controller.match(/themeResultHtml\(/g) || [];
    expect(calls).toHaveLength(2);
    expect(controller).toMatch(/modalBody\.innerHTML = themeResultHtml\(rows\[0\]\.result_html\)/);
    // The new-scan branch renders structured data instead.
    expect(controller).toMatch(/renderReport\(buildReportModel\(data\), resultsContent\)/);
    expect(controller).not.toMatch(/resultsContent\.innerHTML/);
  });

  it('sends the scan type explicitly and never infers it', () => {
    const controller = src('proof-scan.js');
    expect(controller).toMatch(/scan_profile:\s*scanProfile/);
    expect(controller).toMatch(/const scanProfile = scanTypeValue\(\)/);
    expect(controller).toMatch(/if \(!scanProfile\) return;/);
    // No filename- or content-derived case type anywhere in the code.
    expect(codeOf('proof-scan.js')).not.toMatch(/infer|guessCaseType|detectProfile/i);
  });

  it('keeps upload unavailable until a scan type is chosen', () => {
    const controller = src('proof-scan.js');
    expect(controller).toMatch(/chooseFileBtn\.disabled = !chosen/);
    expect(controller).toMatch(/dropZone\.classList\.toggle\('is-locked', !chosen\)/);
    // Every entry point into the file picker is gated.
    expect(controller).toMatch(/dropZone\.addEventListener\('click', \(\) => \{ if \(scanTypeValue\(\)\) fileInput\.click\(\); \}\)/);
    expect(controller).toMatch(/if \(!scanTypeValue\(\)\) return;\s*\n\s*const \{ checkSelectedFile \}/);
    // Markup ships locked and disabled, so it is unavailable before any JS runs.
    expect(markup).toMatch(/id="ps-drop-zone" class="ps-drop is-locked"/);
    expect(markup).toMatch(/id="ps-choose-file-btn" disabled/);
    expect(markup).toMatch(/<option value="" selected>/);
    expect(markup).toMatch(/<option value="daca_renewal">DACA renewal<\/option>/);
  });

  it('offers no scan type the API does not accept', () => {
    const options = [...markup.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(options.filter(Boolean)).toEqual(['daca_renewal']);
  });

  it('validates the chosen file on the client before reading it', () => {
    const controller = src('proof-scan.js');
    const guardAt = controller.indexOf('checkSelectedFile(file)');
    const readAt = controller.indexOf('readAsDataURL');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(readAt);
  });

  it('uses the approved button language and restores it on failure', () => {
    const controller = src('proof-scan.js');
    expect(controller).toMatch(/runBtn\.textContent = 'Reviewing package…'/);
    expect(controller).toMatch(/runBtn\.textContent = 'Scan complete'/);
    // "Review complete" is forbidden: staff review is never finished by a scan.
    expect(controller).not.toMatch(/Review complete/);
    // scanFailed() puts the button back to its ready label.
    expect(controller).toMatch(/function scanFailed[\s\S]*?runBtn\.textContent = 'Run Proof Scan'/);
    expect(controller).toMatch(/function scanFailed[\s\S]*?runBtn\.classList\.remove\('is-scanning', 'is-complete'\)/);
  });

  it('warns without claiming success when a result could not be saved', () => {
    const controller = src('proof-scan.js');
    expect(controller).toMatch(/if \(data\.stored === false\)/);
    expect(controller).toMatch(/will not appear in Recent Scans/);
    // History is only refreshed when the row actually landed.
    expect(controller).toMatch(/if \(data\.stored !== false\) await loadHistory\(\)/);
    expect(markup).toMatch(/id="ps-storage-warning"/);
  });

  it('respects prefers-reduced-motion in both the renderer and the styles', () => {
    expect(src('report.js')).toMatch(/prefers-reduced-motion: reduce/);
    expect(src('proof-scan.js')).toMatch(/reduceMotion\(\) \? 'auto' : 'smooth'/);
  });

  it('does not accumulate document listeners when the SPA route is revisited', () => {
    const controller = src('proof-scan.js');
    expect(controller).toMatch(/window\.__psAbort\?\.abort\(\)/);
    expect(controller).toMatch(/signal: pageAbort\.signal/);
    // No un-aborted document-level listener.
    const raw = controller.match(/document\.addEventListener\(/g) || [];
    expect(raw).toHaveLength(1);                          // the one inside onDocument()
  });

  it('ships no lab diagnostic section, shell or fixture control', () => {
    const forbidden = [
      'Not in the checklist', 'What the current checker said', 'legacy_rejected',
      'unknown_rule_ids', 'ps-lab-', 'data-fixture', 'source_of_truth',
      'Why this matters', 'Next step', 'Negative condition',
    ];
    for (const file of ['report.js', 'report-model.js', 'proof-scan.js']) {
      for (const needle of forbidden) {
        expect(`${file}: ${codeOf(file).includes(needle)}`).toBe(`${file}: false`);
      }
    }
    for (const needle of forbidden) expect(markup).not.toContain(needle);
  });

  it('never writes a verdict of its own into the report', () => {
    const report = src('report.js');
    expect(codeOf('report.js')).not.toMatch(/'PASS'|"PASS"|Approved|Ready to file|Needs Correction/);
    // The headline is whatever the server derived, verbatim.
    expect(report).toMatch(/d\.primary_report_language/);
    expect(report).toMatch(/Staff review is still required before filing\./);
  });

  it('imports the report modules dynamically, stamped with the deploy version', () => {
    const controller = src('proof-scan.js');
    expect(controller).toMatch(/import\(`\/pages\/proof-scan\/report-model\.js\?v=\$\{v\}`\)/);
    expect(controller).toMatch(/import\(`\/pages\/proof-scan\/report\.js\?v=\$\{v\}`\)/);
    // report.js must stay import-free so the two can be versioned independently.
    expect(src('report.js')).not.toMatch(/^\s*import\s/m);
  });

  it('does not import the lab composer or reach into the lab at all', () => {
    for (const file of ['report.js', 'report-model.js', 'proof-scan.js']) {
      expect(codeOf(file)).not.toMatch(/compose\.js|ui-lab|proof-scan-lab/);
    }
  });

  it('keeps rule IDs out of visible staff copy but available as metadata', () => {
    const report = src('report.js');
    expect(report).toMatch(/row\.dataset\.ruleId = item\.rule_id/);
    expect(report).toMatch(/row\.title = item\.rule_id/);
    // No rule ID is ever appended as a text node.
    expect(codeOf('report.js')).not.toMatch(/el\('[a-z]+', [^,]+, *(item|i)\.rule_id\)/);
  });
});

// The ported stylesheet is NOT asserted here: Vite's CSS pipeline returns an empty
// string for portal.css under the workers pool, so any assertion against it would
// pass vacuously. It is verified by `grep` in the batch's verification commands and
// by the light/dark screenshots instead.
