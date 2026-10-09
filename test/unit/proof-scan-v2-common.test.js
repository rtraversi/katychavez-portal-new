// Proof Scan v2: the shared comparison and safety helpers, and two static
// guards over the v2 sources (routes registered, no em dashes in wording).
import { describe, it, expect } from 'vitest';
import {
  normalizeDate, normalizeANumber, sameValue, sameName, toCardValue, redactSsn, publicPerson,
  publicSuggestion, displayValue, formatAddress,
} from '../../functions/api/_proof-scan-v2-common.js';
import { formHasField, normalizeReasoningKey } from '../../functions/api/_proof-scan-v2-engine.js';
import { routes } from '../../_worker.js';

describe('dates and numbers as printed', () => {
  it.each([
    ['03/22/1998', '1998-03-22'], ['3/2/1998', '1998-03-02'], ['1998-03-22', '1998-03-22'],
    ['March 22, 1998', '1998-03-22'], ['22 Mar 1998', '1998-03-22'], ['02/30/1998', null], ['sometime', null],
  ])('reads %s as %s', (raw, iso) => expect(normalizeDate(raw)).toBe(iso));

  it('treats every A-Number format as the same number (N-016)', () => {
    for (const v of ['A-123-456-789', 'A123456789', '123 456 789', 'a#123456789']) expect(normalizeANumber(v)).toBe('123456789');
    expect(normalizeANumber('12345')).toBeNull();
    expect(sameValue('a_number', 'A-123-456-789', '123456789')).toBe(true);
  });

  it('compares dates as dates and text without case, spacing or punctuation', () => {
    expect(sameValue('date_of_birth', '03/22/1998', '1998-03-22')).toBe(true);
    expect(sameValue('date_of_birth', '03/22/1998', '03/23/1998')).toBe(false);
    expect(sameValue('street', '1 Test St.', '1 TEST ST')).toBe(true);
    expect(sameValue('phone', '(555) 010-0100', '5550100100')).toBe(true);
    expect(sameValue('apt_type', 'Apartment', 'Apt.')).toBe(true);
  });

  it('stores values in column form, or refuses them', () => {
    expect(toCardValue('date_of_birth', '03/22/1998')).toEqual({ value: '1998-03-22' });
    expect(toCardValue('date_of_birth', 'soon')).toEqual({ invalid: true });
    expect(toCardValue('apt_type', 'suite')).toEqual({ value: 'Ste.' });
    expect(toCardValue('street', '  1   Test  St ')).toEqual({ value: '1 Test St' });
    expect(toCardValue('city', '')).toEqual({ value: null });
  });
});

describe('names (D-89)', () => {
  const card = { first_name: 'Ana', middle_name: 'Maria', last_name: 'Rivera' };
  it('accepts a middle initial or a missing middle name, never a different name', () => {
    expect(sameName({ first_name: 'ANA', middle_name: 'M.', last_name: 'RIVERA' }, card)).toBe(true);
    expect(sameName({ first_name: 'ANA', middle_name: '', last_name: 'RIVERA' }, card)).toBe(true);
    expect(sameName({ first_name: 'ANA', middle_name: 'L', last_name: 'RIVERA' }, card)).toBe(false);
    expect(sameName({ first_name: 'ANA', last_name: 'RIVERO' }, card)).toBe(false);
  });
});

describe('addresses per form (D-81)', () => {
  it('G-1145 and I-765WS carry no address; In Care Of only on the I-821D and I-765; foreign parts only on the G-28', () => {
    expect(formHasField('G-1145', 'street')).toBe(false);
    expect(formHasField('I-765WS', 'zip')).toBe(false);
    expect(formHasField('G-1145', 'email')).toBe(true);
    expect(formHasField('I-821D', 'in_care_of')).toBe(true);
    expect(formHasField('G-28', 'in_care_of')).toBe(false);
    expect(formHasField('G-28', 'country')).toBe(true);
    expect(formHasField('I-765', 'province')).toBe(false);
    expect(formHasField('I-130', 'in_care_of')).toBe(true); // any other form: compared on what it shows
  });

  it('formats in G-28 Part 3 item 12 order (D-64)', () => {
    expect(formatAddress({ street: '1 Test St', apt_type: 'Apt.', apt_number: '4', city: 'Town', state: 'TX', zip: '77001' }))
      .toBe('1 Test St, Apt. 4, Town, TX 77001');
  });
});

describe('SSN never leaves in full (D-80, D-97)', () => {
  it('masks formatted and bare SSNs in free text, but leaves an A-Number alone', () => {
    expect(redactSsn('SSN 123-45-6789 and 987654321.')).toBe('SSN ***-**-6789 and ***-**-4321.');
    expect(redactSsn('A123456789')).toBe('A123456789');
    expect(redactSsn('Call 5550100100')).toBe('Call 5550100100');
  });

  it('strips the encrypted value from every person and suggestion that leaves the server', () => {
    const p = publicPerson({ id: 'p', ssn_encrypted: 'aa:bb:cc', ssn_last4: '6789' });
    expect(p).toEqual({ id: 'p', ssn_last4: '6789', has_ssn: true, ssn_masked: '***-**-6789' });
    const s = publicSuggestion({ id: 's', field: 'ssn', value: null, value_encrypted: 'aa:bb:cc', value_last4: '4321' });
    expect(s).toEqual({ id: 's', field: 'ssn', value: '***-**-4321', value_last4: '4321', has_encrypted_value: true });
    expect(displayValue('ssn', '123456789')).toBe('***-**-6789');
  });
});

describe('reasoning keys (D-59)', () => {
  it('normalise the way the suppression table requires', () => {
    expect(normalizeReasoningKey('Signature date order')).toBe('signature_date_order');
    expect(normalizeReasoningKey('')).toBe('unnamed_reasoning');
    expect(normalizeReasoningKey('x'.repeat(200))).toMatch(/^[a-z0-9_]{1,80}$/);
  });
});

const v2Sources = import.meta.glob(['../../functions/api/*proof-scan-v2*.js', '../../functions/api/_proof-scan-email.js'], {
  query: '?raw', import: 'default', eager: true,
});

describe('static guards', () => {
  it('registers every v2 route in the worker', () => {
    const files = Object.keys(v2Sources).map((p) => p.split('/').pop()).filter((f) => !f.startsWith('_'));
    expect(files.length).toBe(12); // 11 from the v2 build, plus proof-scan-v2-process (staged runs)
    for (const f of files) expect(routes[`/api/${f.replace(/\.js$/, '')}`], f).toBeTypeOf('function');
  });

  it('has no em dash in any v2 wording', () => {
    for (const [path, src] of Object.entries(v2Sources)) {
      if (path.endsWith('_proof-scan-email.js')) {
        const v2Part = src.slice(src.indexOf('Proof Scan v2: the optional stage email'));
        expect(v2Part, path).not.toContain('—');
      } else {
        expect(src, path).not.toContain('—');
      }
    }
  });

  it('every v2 route asks for proof_scan access through requireStaff', () => {
    for (const [path, src] of Object.entries(v2Sources)) {
      if (path.split('/').pop().startsWith('_')) continue;
      expect(src, path).toContain('requireStaff(');
      expect(src, path).not.toMatch(/verifyAuth\(/);
    }
  });
});
