// Unit tests for the proof-scan job path.
//
// The scan had no size limit anywhere — not in the UI, not in the Worker — so an
// oversized package failed as an opaque gateway error with nothing to act on. The
// guard's whole job is to fail in words instead, so the arithmetic behind the
// limit is worth pinning: it is the kind of thing that only misbehaves on a
// package sitting exactly on the line.
//
// The scan is now a queued job whose package reaches the Worker through R2, which
// puts three more things under test: the key the upload and the job have to agree
// on, the encoder that turns 20 MiB of bytes into what the Anthropic document
// block wants, and the two decisions the job makes about its own outcome — is
// this report a pass, and is this stalled scan worth retrying.
//
// formatEditions and readStatus are the other two decisions the job makes about
// its own inputs and outputs: what edition facts we hand the model, and how we
// read a verdict back. Both are places where a silent failure looks exactly
// like a clean pass — a stale stored edition presented as ground truth
// manufactures a false positive against a package that is actually correct,
// and a truncated or misread report scored as 'pass' tells a paralegal a
// package is fine when nobody ever checked it.
import { describe, it, expect } from 'vitest';
import { reportFrom, sweepVerdict, formatEditions, readStatus } from '../../functions/api/_proof-scan-run.js';
import { bytesToBase64 } from '../../functions/api/_segment-package.js';
import { tmpKey, isUploadId, MAX_PDF_BYTES, tooLargeMessage } from '../../functions/api/proof-scan-upload.js';

const bytesOf = str => new TextEncoder().encode(str);

describe('bytesToBase64', () => {
  it('agrees with btoa across all three padding cases', () => {
    // Length mod 3 decides the padding: 0 -> none, 1 -> '==', 2 -> '='.
    for (const raw of ['abc', 'a', 'ab']) {
      expect(bytesToBase64(bytesOf(raw))).toBe(btoa(raw));
    }
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });

  it('encodes identically across the chunk boundary', () => {
    // Chunking assembles the binary string, then btoa runs once over the whole
    // of it — so a chunk may split a triplet harmlessly. Change it to encode
    // per chunk and that stops being true, which is what this pins.
    const CHUNK = 0x8000;
    const bytes = new Uint8Array(CHUNK * 2 + 7);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    for (const n of [CHUNK - 1, CHUNK, CHUNK + 1, CHUNK + 2, bytes.length]) {
      const slice = bytes.subarray(0, n);
      let binary = '';
      for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
      expect(bytesToBase64(slice)).toBe(btoa(binary));
    }
  });

  it('survives a byte array large enough to blow an unchunked btoa', () => {
    // String.fromCharCode(...bytes) throws RangeError well below this size —
    // which is exactly the bug the chunking exists to avoid.
    const bytes = new Uint8Array(300_000).fill(0x41);
    const out   = bytesToBase64(bytes);
    expect(out.length).toBe(Math.ceil(bytes.length / 3) * 4);
    expect(out.startsWith('QUFB')).toBe(true);
  });
});

describe('reportFrom', () => {
  it('passes only a clean report that ran to the end', () => {
    const r = reportFrom('<p>All forms verified.</p>', 'end_turn');
    expect(r.status).toBe('pass');
    expect(r.truncated).toBe(false);
    expect(r.html).toBe('<p>All forms verified.</p>');
  });

  it('reads the verdict out of the model prose', () => {
    expect(reportFrom('<td>NEEDS CORRECTION</td>', 'end_turn').status).toBe('needs_correction');
  });

  it('never lets a truncated report read as a pass', () => {
    // The original bug: stop_reason was never checked, so a report cut off
    // before it reached the problem was stored as a clean PASS.
    const r = reportFrom('<p>Everything looks fine so f', 'max_tokens');
    expect(r.truncated).toBe(true);
    expect(r.status).toBe('needs_correction');
    expect(r.html).toContain('cut off before it finished');
    // and the partial report is kept — it is still the best evidence there is
    expect(r.html).toContain('Everything looks fine so f');
  });
});

describe('formatEditions', () => {
  // A stale stored edition presented as ground truth manufactures a false
  // positive against a package that is actually correct — this is the fact
  // the weekly cron (process-form-edition-check.js) exists to prevent.
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

describe('sweepVerdict', () => {
  const now  = 1_800_000_000_000;
  const mins = n => new Date(now - n * 60_000).toISOString();

  it('leaves a scan alone while it is still plausibly running', () => {
    expect(sweepVerdict({ started_at: mins(3), attempts: 1 }, now)).toBe('wait');
  });

  it('requeues a scan whose runner is long gone', () => {
    // The common cause is a closed tab, and the retry is what makes closing the
    // tab safe in the first place.
    expect(sweepVerdict({ started_at: mins(30), attempts: 1 }, now)).toBe('requeue');
  });

  it('gives up rather than retrying forever', () => {
    // Each sweep costs a full Opus scan of the package. A job that has already
    // died twice stops here.
    expect(sweepVerdict({ started_at: mins(30), attempts: 2 }, now)).toBe('abandon');
    expect(sweepVerdict({ started_at: mins(30), attempts: 9 }, now)).toBe('abandon');
  });

  it('does not strand a row whose started_at is missing or unparseable', () => {
    // Otherwise a claim that failed to record its start time would sit in
    // 'processing' with nothing able to touch it.
    expect(sweepVerdict({ started_at: null, attempts: 0 }, now)).toBe('requeue');
    expect(sweepVerdict({ attempts: 0 }, now)).toBe('requeue');
    expect(sweepVerdict({ started_at: 'nonsense', attempts: 0 }, now)).toBe('requeue');
  });
});

describe('staged upload identity', () => {
  it('keys every upload under one prefix the cleanup cron can list', () => {
    expect(tmpKey('abc')).toBe('proof-scan-tmp/abc');
  });

  it('accepts only a UUID as an upload id', () => {
    // The id becomes part of an R2 key. Anything looser lets a caller point the
    // scan at an arbitrary object — or at another module's temp prefix.
    expect(isUploadId(crypto.randomUUID())).toBe(true);
    for (const bad of ['', '../translation-tmp/x', 'not-a-uuid', null, undefined, 42,
                       '123e4567-e89b-12d3-a456-42661417400']) {
      expect(isUploadId(bad)).toBe(false);
    }
  });
});

describe('size limit', () => {
  it('puts the 23 MiB limit under Anthropic 32 MiB request ceiling once encoded', () => {
    // This is the reason the limit is 23 and not 24: base64 of 24 MiB is exactly
    // 32 MiB, leaving no room for the system prompt or the JSON around it. The
    // bytes arrive raw, but the job still base64s them for the API call, so the
    // ceiling is unchanged.
    const ANTHROPIC_MAX = 32 * 1024 * 1024;
    const encodedSize   = Math.ceil(MAX_PDF_BYTES / 3) * 4;

    expect(encodedSize).toBeLessThan(ANTHROPIC_MAX);
    // and enough headroom left for a prompt measured in kilobytes
    expect(ANTHROPIC_MAX - encodedSize).toBeGreaterThan(512 * 1024);

    const atTwentyFour = Math.ceil((24 * 1024 * 1024) / 3) * 4;
    expect(atTwentyFour).toBeGreaterThanOrEqual(ANTHROPIC_MAX);
  });

  it('says the actual size and what to do about it', () => {
    // A number with no instruction is the opaque failure this replaced.
    const msg = tooLargeMessage(30 * 1024 * 1024);
    expect(msg).toContain('30.0 MB');
    expect(msg).toContain('23.0 MB');
    expect(msg).toMatch(/split/i);
  });
});
