// Unit tests for the billing-increment rounding helpers (migration 1530).
//
// Correctness guarantees under test: billed time only ever rounds UP (never
// down, never past the next block), an increment of 1 means "bill actual
// time", zero stays zero, and float noise can't bump an exact boundary value
// into the next block (0.1h * 60 / 6 is 1.0000000000000002 in JS).
import { describe, it, expect } from 'vitest';
import { roundHoursUpToIncrement, secondsToBilledHours } from '../../functions/api/_billing-increment.js';

describe('secondsToBilledHours', () => {
  it('rounds raw seconds UP to 6-minute blocks', () => {
    expect(secondsToBilledHours(60,   6)).toBe(0.1);   // 1m  → 0.1h
    expect(secondsToBilledHours(240,  6)).toBe(0.1);   // 4m  → 0.1h
    expect(secondsToBilledHours(361,  6)).toBe(0.2);   // 6m01s → next block
    expect(secondsToBilledHours(1500, 6)).toBe(0.5);   // 25m → 0.5h
    expect(secondsToBilledHours(3540, 6)).toBe(1);     // 59m → 1.0h
  });

  it('leaves exact block boundaries unchanged', () => {
    expect(secondsToBilledHours(360,  6)).toBe(0.1);
    expect(secondsToBilledHours(720,  6)).toBe(0.2);
    expect(secondsToBilledHours(3600, 6)).toBe(1);
    expect(secondsToBilledHours(900, 15)).toBe(0.25);
  });

  it('supports 15-minute increments', () => {
    expect(secondsToBilledHours(60,   15)).toBe(0.25);
    expect(secondsToBilledHours(1200, 15)).toBe(0.5);  // 20m → 0.5h
  });

  it('increment 1 is the historical faithful conversion (nearest 0.01h)', () => {
    expect(secondsToBilledHours(240,  1)).toBe(0.07);
    expect(secondsToBilledHours(3600, 1)).toBe(1);
    expect(secondsToBilledHours(60,   1)).toBe(0.02);  // FB minute-quantization doc'd in adapter
  });

  it('zero and garbage input stay zero', () => {
    expect(secondsToBilledHours(0, 6)).toBe(0);
    expect(secondsToBilledHours(null, 6)).toBe(0);
    expect(secondsToBilledHours(undefined, 6)).toBe(0);
    expect(secondsToBilledHours(-300, 6)).toBe(0);
  });
});

describe('roundHoursUpToIncrement', () => {
  it('rounds decimal hours UP to 6-minute blocks', () => {
    expect(roundHoursUpToIncrement(0.05, 6)).toBe(0.1);  // 3m typed → 0.1h
    expect(roundHoursUpToIncrement(0.25, 6)).toBe(0.3);  // 15m → 0.3h
    expect(roundHoursUpToIncrement(1.01, 6)).toBe(1.1);
  });

  it('float noise cannot bump an exact boundary into the next block', () => {
    // 0.1 * 60 / 6 === 1.0000000000000002 — a naive ceil would return 0.2.
    expect(roundHoursUpToIncrement(0.1, 6)).toBe(0.1);
    expect(roundHoursUpToIncrement(0.2, 6)).toBe(0.2);
    expect(roundHoursUpToIncrement(0.3, 6)).toBe(0.3);
    expect(roundHoursUpToIncrement(0.7, 6)).toBe(0.7);
    expect(roundHoursUpToIncrement(1.2, 6)).toBe(1.2);
    expect(roundHoursUpToIncrement(0.25, 15)).toBe(0.25);
  });

  it('increment 1 (or missing) returns hours as entered', () => {
    expect(roundHoursUpToIncrement(0.05, 1)).toBe(0.05);
    expect(roundHoursUpToIncrement(0.05)).toBe(0.05);
    expect(roundHoursUpToIncrement(1.23, 1)).toBe(1.23);
  });

  it('zero and garbage input stay zero', () => {
    expect(roundHoursUpToIncrement(0, 6)).toBe(0);
    expect(roundHoursUpToIncrement(null, 6)).toBe(0);
    expect(roundHoursUpToIncrement(-1, 6)).toBe(0);
  });
});
