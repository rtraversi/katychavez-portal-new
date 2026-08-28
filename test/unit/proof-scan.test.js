// Unit tests for the pure logic of the proof scanner (functions/api/proof-scan.js).
// No network, no DB, no model call — only the two decisions we make in our own
// code: what edition facts we hand the model, and how we read a verdict back.
//
// These are the first tests this endpoint has ever had. Both properties under
// test are ones where a silent failure looks exactly like a clean pass:
//   - a stale stored edition presented as ground truth manufactures a false
//     positive against a package that is actually correct
//   - a truncated or misread report scored as 'pass' tells a paralegal a package
//     is fine when nobody ever checked it

import { describe, it, expect } from 'vitest';
import { formatEditions, readStatus } from '../../functions/api/proof-scan.js';

describe('formatEditions', () => {
  const row = (over = {}) => ({
    form_number: 'I-765', pages: 7, edition_date: '08/21/25',
    upstream_edition: null, check_status: 'current', ...over,
  });

  it('renders a verified row with no annotation', () => {
    expect(formatEditions([row()])).toBe('I-765|7p|08/21/25');
  });

  it('names the real current edition when ours is superseded', () => {
    const out = formatEditions([row({ check_status: 'stale', upstream_edition: '01/20/26' })]);
    expect(out).toContain('OUT OF DATE');
    expect(out).toContain('01/20/26');
  });

  it('marks a row unverified when the check errored', () => {
    expect(formatEditions([row({ check_status: 'error' })])).toContain('UNVERIFIED');
  });

  it('leaves never-checked rows alone, so the edition check still runs on them', () => {
    // 'unknown' is the column default. Annotating these would disable the
    // edition check for every form until the first cron run.
    expect(formatEditions([row({ check_status: 'unknown' })])).toBe('I-765|7p|08/21/25');
  });

  it('does not claim an upstream edition it does not have', () => {
    // 'stale' with a null upstream_edition should never render "now publishes null".
    const out = formatEditions([row({ check_status: 'stale', upstream_edition: null })]);
    expect(out).not.toContain('null');
    expect(out).not.toContain('OUT OF DATE');
  });

  it('joins multiple forms on a comma', () => {
    const out = formatEditions([row(), row({ form_number: 'I-130', pages: 12, edition_date: '04/01/24' })]);
    expect(out).toBe('I-765|7p|08/21/25, I-130|12p|04/01/24');
  });
});

describe('readStatus', () => {
  it('reads an explicit PASS marker', () => {
    expect(readStatus('<!--STATUS:PASS--><h2>Summary</h2>')).toBe('pass');
  });

  it('reads an explicit NEEDS CORRECTION marker', () => {
    expect(readStatus('<!--STATUS:NEEDS CORRECTION--><h2>Summary</h2>')).toBe('needs_correction');
  });

  it('tolerates whitespace inside the marker', () => {
    expect(readStatus('<!-- STATUS: NEEDS CORRECTION -->')).toBe('needs_correction');
  });

  it('trusts the marker over the phrase appearing in a finding', () => {
    // The old substring-only test flipped the whole scan to needs_correction
    // whenever the model used the phrase inside the table's Detail column.
    const html = '<!--STATUS:PASS--><td>No NEEDS CORRECTION items were found.</td>';
    expect(readStatus(html)).toBe('pass');
  });

  it('falls back to the substring test when the marker is missing', () => {
    expect(readStatus('<p>Overall status: NEEDS CORRECTION</p>')).toBe('needs_correction');
    expect(readStatus('<p>Overall status: PASS</p>')).toBe('pass');
  });
});
