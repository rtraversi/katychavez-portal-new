// Unit tests for the proof-scan size guard.
//
// The scan had no size limit anywhere — not in the UI, not in the Worker — so an
// oversized package failed as an opaque gateway error with nothing to act on. The
// guard's whole job is to fail in words instead, which makes the byte arithmetic
// behind it worth pinning: get the padding term wrong and the limit silently
// shifts, which is the kind of bug that only shows up on a package that is
// exactly on the line.
import { describe, it, expect } from 'vitest';
import { base64Bytes } from '../../functions/api/proof-scan.js';

// btoa is available in workerd, where these tests run.
const b64 = str => btoa(str);

describe('base64Bytes', () => {
  it('is exact across all three padding cases', () => {
    // Length mod 3 decides the padding: 0 -> none, 1 -> '==', 2 -> '='.
    expect(base64Bytes(b64('abc'))).toBe(3);    // no padding
    expect(base64Bytes(b64('a'))).toBe(1);      // '=='
    expect(base64Bytes(b64('ab'))).toBe(2);     // '='
  });

  it('agrees with the real encoder over a run of lengths', () => {
    for (let n = 0; n <= 64; n++) {
      const raw = 'x'.repeat(n);
      expect(base64Bytes(b64(raw))).toBe(n);
    }
  });

  it('treats junk as zero rather than throwing', () => {
    expect(base64Bytes('')).toBe(0);
    expect(base64Bytes(undefined)).toBe(0);
    expect(base64Bytes(null)).toBe(0);
    expect(base64Bytes(12345)).toBe(0);
  });

  it('puts the 23 MiB limit under Anthropic 32 MiB request ceiling once encoded', () => {
    // This is the reason the limit is 23 and not 24: base64 of 24 MiB is exactly
    // 32 MiB, leaving no room for the system prompt or the JSON around it.
    const MAX_PDF_BYTES  = 23 * 1024 * 1024;
    const ANTHROPIC_MAX  = 32 * 1024 * 1024;
    const encodedSize    = Math.ceil(MAX_PDF_BYTES / 3) * 4;

    expect(encodedSize).toBeLessThan(ANTHROPIC_MAX);
    // and enough headroom left for a prompt measured in kilobytes
    expect(ANTHROPIC_MAX - encodedSize).toBeGreaterThan(512 * 1024);

    const atTwentyFour = Math.ceil((24 * 1024 * 1024) / 3) * 4;
    expect(atTwentyFour).toBeGreaterThanOrEqual(ANTHROPIC_MAX);
  });
});
