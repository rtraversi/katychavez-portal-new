// Delivery semantics for the structured Proof Scan notification.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  makeAdminClient: vi.fn(),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { notifyStructuredProofScan } from '../../functions/api/_notifications.js';
import {
  getSelectedScanProfile,
  validateAndComposeObservations,
} from '../../functions/api/proof-scan-contract.js';

const profile = getSelectedScanProfile('daca_renewal');

function storedResult() {
  const observations = {
    client_observed: {
      name: null, a_number: null, ead_expires: null, date_of_birth: null,
      ssn_last4: null, uscis_account_number: null, phone: null, email: null, address: null,
    },
    package_items: profile.package_items.map(({ item_id }) => ({
      item_id, status: 'clear', locations: [], evidence: null, reason: null,
    })),
    rule_results: profile.rules.map(({ rule_id }) => ({
      rule_id, status: 'clear', summary: null, locations: [], evidence: null,
      reason: null, not_checked_item_ids: null,
    })),
  };
  const composed = validateAndComposeObservations(profile, observations, {
    filename: 'safe-package.pdf', scanned_at: '2026-09-02T12:00:00Z',
  });
  return {
    schema_version: profile.contract.result_schema_version,
    scan_profile: profile.profile_id,
    profile_version: profile.profile_version,
    profile_label: profile.label,
    scan: composed.scan,
    report_state: composed.report_state,
    primary_report_language: composed.primary_report_language,
    attention_count: composed.attention_count,
    attention_items: composed.attention_items,
    unsuppressed_not_checked_count: composed.unsuppressed_not_checked_count,
    client_observed: composed.client_observed,
    package_items: composed.package_items,
    rule_results: composed.rule_results,
  };
}

const ENV = {
  RESEND_API_KEY: 'test-key',
  PORTAL_FROM_EMAIL: 'portal@example.test',
  PORTAL_FIRM_NAME: 'Test Firm',
  PORTAL_URL: 'https://portal.example.test',
};

function adminThat(logBehavior = async () => ({ error: null })) {
  const insert = vi.fn(logBehavior);
  helpersMock.makeAdminClient.mockReturnValue({ from: () => ({ insert }) });
  return insert;
}

beforeEach(() => {
  vi.restoreAllMocks();
  helpersMock.makeAdminClient.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe('structured Proof Scan delivery result', () => {
  it('returns false without an API key and makes no request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await notifyStructuredProofScan({ ...ENV, RESEND_API_KEY: '' }, {
      toEmail: 'staff@example.test', result: storedResult(),
    })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false on a network failure', async () => {
    adminThat();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await notifyStructuredProofScan(ENV, {
      toEmail: 'staff@example.test', result: storedResult(),
    })).toBe(false);
  });

  it('returns false when Resend responds non-2xx', async () => {
    adminThat();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rejected', { status: 422 })));
    expect(await notifyStructuredProofScan(ENV, {
      toEmail: 'staff@example.test', result: storedResult(),
    })).toBe(false);
  });

  it('returns true only for a successful Resend response', async () => {
    adminThat();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 202 })));
    expect(await notifyStructuredProofScan(ENV, {
      toEmail: 'staff@example.test', result: storedResult(),
    })).toBe(true);
  });

  it('keeps true when email-log persistence fails after delivery', async () => {
    adminThat(async () => { throw new Error('email log unavailable'); });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    expect(await notifyStructuredProofScan(ENV, {
      toEmail: 'staff@example.test', result: storedResult(),
    })).toBe(true);
  });
});
