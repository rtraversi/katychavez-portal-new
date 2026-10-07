import { describe, expect, it } from 'vitest';
import completed from '../fixtures/proof-scan/completed-no-issues-found.json';
import attention from '../fixtures/proof-scan/configured-items-need-attention.json';
import unreadable from '../fixtures/proof-scan/required-rule-not-checked-unreadable.json';
import malformed from '../fixtures/proof-scan/malformed-model-output.json';
import unknownRule from '../fixtures/proof-scan/unknown-rule-id.json';
import duplicateRule from '../fixtures/proof-scan/duplicate-rule-id.json';
import omittedRule from '../fixtures/proof-scan/omitted-expected-rule-id.json';
import unknownPackageItem from '../fixtures/proof-scan/unknown-package-item-id.json';
import omittedPackageItem from '../fixtures/proof-scan/omitted-expected-package-item-id.json';
import missingBiometrics from '../fixtures/proof-scan/missing-biometrics-g1450-suppression.json';
import unreadableG1450 from '../fixtures/proof-scan/unreadable-g1450-field.json';
import {
  getSelectedScanProfile,
  parseAndComposeObservations,
  parseAndComposeScanResult,
  containsFullSsn,
  validateAndComposeObservations,
  validateAndComposeScanResult,
  validateScanProfile,
} from '../../functions/api/proof-scan-contract.js';

const profile = getSelectedScanProfile('daca_renewal');
const clone = (value) => JSON.parse(JSON.stringify(value));

function recipeMutations(fixture) {
  return fixture.mutations || (fixture.mutation ? [fixture.mutation] : []);
}

function materializeFixture(fixture) {
  const response = clone(completed.model_response);
  for (const mutation of recipeMutations(fixture)) {
    if (mutation.operation === 'append_rule_result') {
      response.rule_results.push(mutation.value);
    } else if (mutation.operation === 'remove_rule_result') {
      response.rule_results = response.rule_results.filter((rule) => rule.rule_id !== mutation.rule_id);
    } else if (mutation.operation === 'append_package_item') {
      response.package_items.push(mutation.value);
    } else if (mutation.operation === 'remove_package_item') {
      response.package_items = response.package_items.filter((item) => item.item_id !== mutation.item_id);
    } else if (mutation.operation === 'replace_package_item') {
      response.package_items = response.package_items.map((item) => (
        item.item_id === mutation.item_id ? mutation.value : item
      ));
    } else if (mutation.operation === 'replace_rule_result') {
      response.rule_results = response.rule_results.map((rule) => (
        rule.rule_id === mutation.rule_id ? mutation.value : rule
      ));
    } else if (mutation.operation === 'replace_rule_results') {
      const ids = new Set(mutation.rule_ids);
      response.rule_results = response.rule_results.map((rule) => (
        ids.has(rule.rule_id) ? { ...rule, ...mutation.value } : rule
      ));
    } else {
      throw new Error('Unsupported fixture mutation: ' + mutation.operation);
    }
  }
  return response;
}

function issueCodes(result) {
  return result.issues.map((entry) => entry.code);
}

describe('Proof Scan DACA profile', () => {
  it('loads the selected versioned DACA profile with exactly 39 PDF rules', () => {
    expect(profile).not.toBeNull();
    expect(profile.rules).toHaveLength(39);
    expect(profile.rules.every((rule) => rule.check === 'pdf')).toBe(true);
    expect(profile.rules.some((rule) => rule.rule_id.startsWith('DACA-INTAKE-'))).toBe(false);
    expect(profile.rules.some((rule) => rule.rule_id.startsWith('DACA-MAIL-'))).toBe(false);
  });

  it('uses the locked stable G-1450 target mapping', () => {
    const targetMap = Object.fromEntries(profile.rules
      .filter((rule) => rule.rule_id.startsWith('DACA-G1450-'))
      .map((rule) => [rule.rule_id, rule.applies_to_item_ids]));
    const both = ['DACA-COMP-G1450-FILING-FEE', 'DACA-COMP-G1450-BIOMETRICS-FEE'];

    expect(targetMap['DACA-G1450-001']).toEqual(both);
    expect(targetMap['DACA-G1450-002']).toEqual(['DACA-COMP-G1450-FILING-FEE']);
    expect(targetMap['DACA-G1450-003']).toEqual(['DACA-COMP-G1450-BIOMETRICS-FEE']);
    expect(targetMap['DACA-G1450-004']).toEqual(both);
    expect(targetMap['DACA-G1450-005']).toEqual(both);
    expect(targetMap['DACA-G1450-006']).toEqual(both);
  });

  it('rejects a form-specific rule targeting a package item for another form', () => {
    const invalidProfile = clone(profile);
    const rule = invalidProfile.rules.find((entry) => entry.rule_id === 'DACA-G1450-002');
    rule.applies_to_item_ids = ['DACA-COMP-G28'];

    const result = validateScanProfile(invalidProfile);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('rule_target_form_mismatch');
  });
});

describe('Proof Scan contract fixtures', () => {
  it.each([completed, attention, unreadable])('$fixture_id composes its validated report state', (fixture) => {
    const result = validateAndComposeScanResult(profile, fixture.model_response);
    expect(result.ok).toBe(true);
    expect(result.report_state).toBe(fixture.expected.report_state);
    expect(result.primary_report_language).toBe(fixture.expected.primary_report_language);
  });

  it('executes the malformed-model-output fixture', () => {
    const result = parseAndComposeScanResult(profile, malformed.raw_model_output);
    expect(result.ok).toBe(false);
    expect(result.report_state).toBe(malformed.expected.report_state);
    expect(issueCodes(result)).toContain(malformed.expected.violation);
  });

  it.each([unknownRule, duplicateRule, omittedRule, unknownPackageItem, omittedPackageItem])(
    '$fixture_id executes its mutation recipe and rejects the result',
    (fixture) => {
      const result = validateAndComposeScanResult(profile, materializeFixture(fixture));
      expect(result.ok).toBe(false);
      expect(result.report_state).toBe(fixture.expected.report_state);
      expect(issueCodes(result)).toContain(fixture.expected.violation);
    },
  );
});

describe('Proof Scan missing-form suppression', () => {
  it('counts a missing $85 G-1450 once and preserves its blocked dependent rules', () => {
    const result = validateAndComposeScanResult(profile, materializeFixture(missingBiometrics));

    expect(result.ok).toBe(true);
    expect(result.report_state).toBe(missingBiometrics.expected.report_state);
    expect(result.attention_count).toBe(1);
    expect(result.attention_items).toEqual([
      { type: 'package_item', id: 'DACA-COMP-G1450-BIOMETRICS-FEE' },
    ]);
    const suppressed = result.rule_results
      .filter((rule) => rule.suppressed_by_package_item_ids.length)
      .map((rule) => rule.rule_id);
    expect(suppressed).toEqual(missingBiometrics.expected.suppressed_rule_ids);
    expect(result.rule_results
      .filter((rule) => suppressed.includes(rule.rule_id))
      .every((rule) => rule.status === 'not_checked')).toBe(true);
  });

  it('does not let a shared G-1450 rule clear when one targeted item is unavailable', () => {
    const response = materializeFixture(missingBiometrics);
    const sharedRule = response.rule_results.find((rule) => rule.rule_id === 'DACA-G1450-004');
    sharedRule.status = 'clear';
    sharedRule.reason = null;

    const result = validateAndComposeScanResult(profile, response);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('rule_clear_with_unavailable_target_item');
  });

  it('keeps an unreadable G-1450 field unsuppressed when both forms are present', () => {
    const result = validateAndComposeScanResult(profile, materializeFixture(unreadableG1450));

    expect(result.ok).toBe(true);
    expect(result.report_state).toBe('review_incomplete');
    expect(result.attention_count).toBe(0);
    expect(result.unsuppressed_not_checked_count).toBe(1);
    const rule = result.rule_results.find((entry) => entry.rule_id === 'DACA-G1450-004');
    expect(rule.suppressed_by_package_item_ids).toEqual([]);
  });

  it('does not suppress a shared rule that is blocked by one missing form and unreadable on the other', () => {
    const response = materializeFixture(missingBiometrics);
    const sharedRule = response.rule_results.find((rule) => rule.rule_id === 'DACA-G1450-004');
    sharedRule.not_checked_item_ids = [
      'DACA-COMP-G1450-BIOMETRICS-FEE',
      'DACA-COMP-G1450-FILING-FEE',
    ];
    sharedRule.reason = 'One G-1450 is missing and the other card-detail field could not be read.';

    const result = validateAndComposeScanResult(profile, response);
    expect(result.ok).toBe(true);
    expect(result.report_state).toBe('items_need_attention');
    expect(result.unsuppressed_not_checked_count).toBe(1);
    const composedRule = result.rule_results.find((rule) => rule.rule_id === 'DACA-G1450-004');
    expect(composedRule.blocked_by_missing_package_item_ids).toEqual([
      'DACA-COMP-G1450-BIOMETRICS-FEE',
    ]);
    expect(composedRule.independently_unchecked_item_ids).toEqual([
      'DACA-COMP-G1450-FILING-FEE',
    ]);
    expect(composedRule.suppressed_by_package_item_ids).toEqual([]);
  });
});

describe('Proof Scan strict response validation', () => {
  it.each(['123', '12a4', '123456789', '123-45-6789'])(
    'rejects non-last-four ssn_last4 value %s',
    (ssn_last4) => {
      const response = clone(completed.model_response);
      response.client_observed.ssn_last4 = ssn_last4;

      const result = validateAndComposeScanResult(profile, response);
      expect(result.ok).toBe(false);
      expect(result.report_state).toBe('scan_could_not_be_completed');
    },
  );

  it('rejects an attempted full-SSN property', () => {
    const response = clone(completed.model_response);
    response.client_observed.full_ssn = '000-00-0000';

    const result = validateAndComposeScanResult(profile, response);
    expect(result.ok).toBe(false);
    expect(result.report_state).toBe('scan_could_not_be_completed');
  });

  it.each([
    ['client summary', (response) => { response.client_observed.address = 'SSN: 123-45-6789'; }],
    ['client summary as bare digits', (response) => { response.client_observed.address = 'SSN: 123456789'; }],
    ['rule evidence', (response) => { response.rule_results[0].evidence = '123 45 6789'; }],
    ['rule summary', (response) => { response.rule_results[0].summary = '123456789'; }],
    ['package evidence', (response) => { response.package_items[0].evidence = '123-45-6789'; }],
  ])('rejects a full SSN hidden in %s', (_label, mutate) => {
    const response = clone(completed.model_response);
    mutate(response);
    const result = validateAndComposeScanResult(profile, response);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('full_ssn_forbidden');
  });

  it.each(['A123456789', '123456789'])(
    'does not mistake legitimate A-Number value %s for an SSN',
    (aNumber) => {
      const response = clone(completed.model_response);
      response.client_observed.a_number = aNumber;
      expect(validateAndComposeScanResult(profile, response).ok).toBe(true);
      expect(containsFullSsn({ a_number: aNumber })).toBe(false);
    },
  );

  it('does not broadly exempt nine-digit values outside the A-Number field', () => {
    expect(containsFullSsn({ a_number: 'SSN: 123456789' })).toBe(true);
    expect(containsFullSsn({ uscis_account_number: '123456789' })).toBe(true);
    expect(containsFullSsn({ evidence: 'Observed 123456789 on the form.' })).toBe(true);
  });

  it('rejects unknown top-level and nested properties', () => {
    const topLevel = clone(completed.model_response);
    topLevel.unexpected = true;
    const nested = clone(completed.model_response);
    nested.rule_results[0].severity = 'fatal';

    expect(validateAndComposeScanResult(profile, topLevel).ok).toBe(false);
    expect(validateAndComposeScanResult(profile, nested).ok).toBe(false);
  });

  it('rejects a profile-version mismatch', () => {
    const response = clone(completed.model_response);
    response.profile_version += 1;

    const result = validateAndComposeScanResult(profile, response);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('profile_version_mismatch');
  });
});

describe('Proof Scan report language', () => {
  // One missing form is the most common real result, so the singular case is the
  // one staff read most often. It must agree: "1 item needs attention".
  it('uses singular agreement for exactly one attention item', () => {
    const result = validateAndComposeScanResult(profile, materializeFixture(missingBiometrics));
    expect(result.ok).toBe(true);
    expect(result.attention_count).toBe(1);
    expect(result.primary_report_language).toBe('1 item needs attention');
  });

  it('uses plural agreement beyond one attention item', () => {
    const result = validateAndComposeScanResult(profile, attention.model_response);
    expect(result.attention_count).toBeGreaterThan(1);
    expect(result.primary_report_language)
      .toBe(`${result.attention_count} items need attention`);
  });

  it('never emits a pass, approved, correct or ready-to-file verdict', () => {
    for (const fixture of [completed, attention, unreadable]) {
      const language = validateAndComposeScanResult(profile, fixture.model_response)
        .primary_report_language;
      expect(language).not.toMatch(/pass|approved|correct|ready to file/i);
    }
  });
});

// Batch 2 refactor guard. Structured output cannot omit a property, so a rule that
// identifies nothing now sends null instead of leaving the key out. Absent, null
// and [] must stay equivalent — and the Batch 1 invariant they sit next to (only a
// not-checked rule may name unevaluated items) must still hold.
describe('Proof Scan not_checked_item_ids null/absent equivalence', () => {
  it.each([
    ['absent', (rule) => { delete rule.not_checked_item_ids; }],
    ['null',   (rule) => { rule.not_checked_item_ids = null; }],
    ['empty',  (rule) => { rule.not_checked_item_ids = []; }],
  ])('treats %s as identifying nothing on a clear rule', (_label, mutate) => {
    const response = clone(completed.model_response);
    for (const rule of response.rule_results) mutate(rule);

    const result = validateAndComposeScanResult(profile, response);
    expect(result.ok).toBe(true);
    expect(result.report_state).toBe('no_issues_found');
    expect(result.rule_results.every((rule) => Array.isArray(rule.not_checked_item_ids))).toBe(true);
  });

  it('still refuses an evaluated rule that names unevaluated package items', () => {
    const response = clone(completed.model_response);
    response.rule_results.find((rule) => rule.rule_id === 'DACA-G1450-002')
      .not_checked_item_ids = ['DACA-COMP-G1450-FILING-FEE'];

    const result = validateAndComposeScanResult(profile, response);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('not_checked_item_ids_on_evaluated_rule');
  });

  it.each([null, []])('still refuses a targeted not-checked rule that names %s', (value) => {
    const response = clone(completed.model_response);
    const rule = response.rule_results.find((entry) => entry.rule_id === 'DACA-G1450-002');
    rule.status = 'not_checked';
    rule.reason = 'Unreadable.';
    rule.not_checked_item_ids = value;

    const result = validateAndComposeScanResult(profile, response);
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('not_checked_rule_missing_target_item_ids');
  });
});

// The observation boundary: Claude supplies three keys and the server owns the rest.
describe('Proof Scan observation boundary', () => {
  const observationsOf = (fixture) => ({
    client_observed: fixture.client_observed,
    package_items: fixture.package_items,
    rule_results: fixture.rule_results,
  });
  const scan = { filename: 'server-owned.pdf', scanned_at: '2026-09-02T12:00:00Z' };

  it('composes the same result as the full envelope, with server-owned metadata', () => {
    const result = validateAndComposeObservations(
      profile, observationsOf(completed.model_response), scan,
    );
    expect(result.ok).toBe(true);
    expect(result.report_state).toBe('no_issues_found');
    expect(result.scan).toEqual(scan);
    expect(result.profile.profile_version).toBe(profile.profile_version);
  });

  it.each(['scan_profile', 'profile_version', 'schema_version', 'scan'])(
    'refuses observations carrying a server-owned %s',
    (field) => {
      const observations = observationsOf(clone(completed.model_response));
      observations[field] = field === 'scan' ? { filename: 'm.pdf', scanned_at: scan.scanned_at } : 1;

      const result = validateAndComposeObservations(profile, observations, scan);
      expect(result.ok).toBe(false);
      expect(result.report_state).toBe('scan_could_not_be_completed');
    },
  );

  it('refuses a server-created scan time that is not a real timestamp', () => {
    const result = validateAndComposeObservations(
      profile, observationsOf(completed.model_response), { filename: 'a.pdf', scanned_at: 'yesterday' },
    );
    expect(result.ok).toBe(false);
  });

  it('refuses model prose or HTML instead of JSON', () => {
    for (const raw of ['<div class="pass">All good</div>', 'Everything looks fine.']) {
      const result = parseAndComposeObservations(profile, raw, scan);
      expect(result.ok).toBe(false);
      expect(issueCodes(result)).toContain('invalid_json');
    }
  });
});
