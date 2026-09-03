// Unit tests for the deterministic Proof Scan email (Batch 4).
//
// The old pipeline pasted Claude's HTML into the message body and put "PASS" or
// "NEEDS CORRECTION" in the subject line. Both are gone. What replaces them has
// to hold three things:
//
//   1. The subject and body are built ONLY from a validated, server-composed
//      result, and say the same words the portal says.
//   2. Every observed value is escaped. A package that quotes "<script>" produces
//      an email that shows those characters.
//   3. An unvalidated result produces no message at all — there is no partial
//      email and no fallback body.
import { describe, it, expect } from 'vitest';
import {
  buildProofScanEmail,
  esc,
  proofScanReportUrl,
  subjectFilename,
} from '../../functions/api/_proof-scan-email.js';
import {
  getSelectedScanProfile,
  validateAndComposeObservations,
  reportStateLanguage,
  STAFF_REVIEW_REMINDER,
} from '../../functions/api/proof-scan-contract.js';

const profile = getSelectedScanProfile('daca_renewal');
const SCAN = { filename: 'daca-renewal-package.pdf', scanned_at: '2026-09-02T12:00:00Z' };
const OPTS = { firmName: 'Chavez Law', portalUrl: 'https://portal.example' };

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

const attentionResult = (n = 1) => storedResult((obs) => {
  for (let i = 0; i < n; i += 1) {
    obs.rule_results[i].status = 'needs_attention';
    obs.rule_results[i].summary = `Finding ${i + 1}. It needs a correction.`;
  }
});

const incompleteResult = () => storedResult((obs) => {
  const target = obs.rule_results.find(
    (r) => !profile.rules.find((c) => c.rule_id === r.rule_id).applies_to_item_ids,
  );
  target.status = 'not_checked';
  target.reason = 'That page is too faint to read.';
});

// ── Subject and body language ─────────────────────────────────────────────────

describe('proof scan email — report language', () => {
  it.each([
    ['items need attention', () => attentionResult(1), '1 item needs attention'],
    ['a plural count',       () => attentionResult(3), '3 items need attention'],
    ['review incomplete',    incompleteResult,          'Review incomplete'],
    ['no issues found',      storedResult,              'No issues found'],
  ])('uses the portal phrase for %s', (_name, make, language) => {
    const mail = buildProofScanEmail(make(), OPTS);
    expect(mail.subject).toBe(`Proof Scan — ${language} — daca-renewal-package.pdf`);
    expect(mail.html).toContain(language);
  });

  it('says the same thing the report state says, from the same function', () => {
    const result = attentionResult(2);
    expect(buildProofScanEmail(result, OPTS).subject)
      .toContain(reportStateLanguage(result.report_state, result.attention_count));
  });

  it.each(['Pass', 'PASS', 'Approved', 'Correct', 'Ready to file', 'Needs Correction'])(
    'never uses the forbidden verdict word "%s"',
    (word) => {
      for (const make of [storedResult, incompleteResult, () => attentionResult(2)]) {
        const mail = buildProofScanEmail(make(), OPTS);
        expect(mail.subject).not.toMatch(new RegExp(word, 'i'));
        // "compass" and friends would false-positive, so match on word boundaries.
        expect(mail.html).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
      }
    },
  );

  it('carries the standing staff-review reminder in every state', () => {
    for (const make of [storedResult, incompleteResult, () => attentionResult(1)]) {
      expect(buildProofScanEmail(make(), OPTS).html).toContain(STAFF_REVIEW_REMINDER);
    }
  });

  it('lists the findings and the unevaluated checks', () => {
    const mail = buildProofScanEmail(attentionResult(2), OPTS);
    expect(mail.html).toContain('Needs attention');
    expect(mail.html).toContain('Finding 1.');
    expect(mail.html).toContain('Finding 2.');

    const incomplete = buildProofScanEmail(incompleteResult(), OPTS);
    expect(incomplete.html).toContain('Not checked');
  });

  it('omits an empty section rather than printing an empty heading', () => {
    const mail = buildProofScanEmail(storedResult(), OPTS);
    expect(mail.html).not.toContain('Needs attention');
    expect(mail.html).not.toContain('Not checked');
  });
});

// ── Escaping ──────────────────────────────────────────────────────────────────

describe('proof scan email — escaping', () => {
  const HOSTILE = `<script>alert(1)</script>"><img src=x onerror=alert(1)> & 'quoted'`;

  it('escapes every observed value it prints', () => {
    const result = storedResult((obs) => {
      obs.client_observed.name = HOSTILE;
      obs.client_observed.a_number = HOSTILE;
      obs.client_observed.address = HOSTILE;
      obs.rule_results[0].status = 'needs_attention';
      obs.rule_results[0].summary = HOSTILE;
      obs.rule_results[0].evidence = HOSTILE;
    });
    const { html } = buildProofScanEmail(result, OPTS);

    // It is present, and only in escaped form.
    expect(html).toContain(esc(HOSTILE));
    // Strip the escaped occurrences; nothing of the payload may remain loose.
    const rest = html.split(esc(HOSTILE)).join('');
    expect(rest).not.toContain('<script');
    expect(rest).not.toContain('<img');
    expect(rest).not.toMatch(/onerror/);
    expect(rest).not.toContain('alert(1)');
  });

  it('escapes the filename in the body and strips header controls from the subject', () => {
    const result = storedResult();
    result.scan.filename = `<b>x</b>\r\nBcc: victim@example.test\0.pdf`;
    const { subject, html } = buildProofScanEmail(result, OPTS);
    expect(subject).toBe('Proof Scan — No issues found — <b>x</b> Bcc: victim@example.test .pdf');
    expect(subject).not.toMatch(/[\r\n\0\u0085]/);
    expect(html).toContain(esc(result.scan.filename));
    expect(html).not.toContain('<b>x</b>');
  });

  it('normalizes and bounds hostile subject components', () => {
    expect(subjectFilename('  package\r\n\0 name.pdf  ')).toBe('package name.pdf');
    expect(subjectFilename('')).toBe('Untitled package');
    const result = storedResult();
    result.scan.filename = 'x'.repeat(500) + '.pdf';
    expect(buildProofScanEmail(result, OPTS).subject.length).toBeLessThanOrEqual(200);
  });

  it('escapes the firm name and omits an invalid portal URL', () => {
    const { html } = buildProofScanEmail(storedResult(), {
      firmName: '<script>evil</script>',
      portalUrl: 'https://x/"><script>evil</script>',
    });
    expect(html).not.toContain('<script>evil</script>');
    expect(html).toContain('&lt;script&gt;evil&lt;/script&gt;');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('Open the full report');
  });

  it.each([
    ['https://portal.example/base', 'https://portal.example/portal#proof-scan'],
    ['http://localhost:3000/base', 'http://localhost:3000/portal#proof-scan'],
    ['http://127.0.0.1:8788', 'http://127.0.0.1:8788/portal#proof-scan'],
    ['http://[::1]:8788', 'http://[::1]:8788/portal#proof-scan'],
  ])('allows an approved report origin %s', (input, expected) => {
    expect(proofScanReportUrl(input)).toBe(expected);
    expect(buildProofScanEmail(storedResult(), { ...OPTS, portalUrl: input }).html)
      .toContain(`href="${expected}"`);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://portal.example',
    'https://user:pass@portal.example',
    'not a url',
    '',
  ])('never puts dangerous or malformed portal URL %s in href', (portalUrl) => {
    expect(proofScanReportUrl(portalUrl)).toBeNull();
    const { html } = buildProofScanEmail(storedResult(), { ...OPTS, portalUrl });
    expect(html).not.toContain('href=');
    expect(html).not.toContain('Open the full report');
  });

  it('shows only the last four SSN digits, masked', () => {
    const { html } = buildProofScanEmail(storedResult(), OPTS);
    expect(html).toContain('•••-••-4321');
    expect(html).not.toMatch(/\b\d{9}\b/);
    expect(html).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
  });

  it('omits client fields the package did not carry', () => {
    const { html } = buildProofScanEmail(storedResult(), OPTS);
    // date_of_birth, phone, email and address were all null in the fixture.
    expect(html).not.toContain('Date of birth');
    expect(html).not.toContain('Phone');
    expect(html).not.toContain('Address');
  });
});

// ── Refusal ───────────────────────────────────────────────────────────────────

describe('proof scan email — unvalidated input cannot produce a message', () => {
  it.each([
    ['null',                      () => null],
    ['a string',                  () => 'PASS — everything looks fine'],
    ['model-authored HTML',       () => ({ result_html: '<p>looks good</p>' })],
    ['an unknown schema version', () => ({ ...storedResult(), schema_version: 99 })],
    ['an unsupported profile',    () => ({ ...storedResult(), scan_profile: 'aos_family' })],
    ['an unverifiable profile version', () => ({ ...storedResult(), profile_version: 99 })],
    ['a duplicated rule',         () => { const r = storedResult(); r.rule_results[1] = r.rule_results[0]; return r; }],
    ['an omitted rule',           () => { const r = storedResult(); r.rule_results.pop(); return r; }],
    ['an unknown extra field',    () => ({ ...storedResult(), overall_verdict: 'PASS' })],
    ['a tampered clean state',    () => ({ ...attentionResult(1), report_state: 'no_issues_found', attention_count: 0, primary_report_language: 'No issues found' })],
    ['a full SSN',                () => { const r = storedResult(); r.client_observed.ssn_last4 = '123456789'; return r; }],
  ])('returns null for %s', (_name, make) => {
    expect(buildProofScanEmail(make(), OPTS)).toBeNull();
  });

  it('has no parameter that could carry model-authored HTML into the body', () => {
    // A result whose fields contain HTML still produces an escaped body — there
    // is no raw-HTML-shaped door left in the signature.
    const result = storedResult((obs) => {
      obs.rule_results[0].status = 'needs_attention';
      obs.rule_results[0].summary = '<div class="ok">Everything passed</div>';
    });
    const { html } = buildProofScanEmail(result, OPTS);
    expect(html).not.toContain('<div class="ok">');
    expect(html).toContain('&lt;div class=&quot;ok&quot;&gt;');
  });
});
