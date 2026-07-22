// Unit tests for the scheduling availability engine (functions/api/_booking-helpers.js).
// Pure slot math only — no live calendar/supabase calls. Runs in real workerd,
// so Intl timezone behavior matches production.
import { describe, it, expect } from 'vitest';
import {
  tzOffsetMs, localToUtc, localDayOf, generateSlots, effectiveWindows,
  clampBookingWindow, reminderDue,
} from '../../functions/api/_booking-helpers.js';

const TZ = 'America/Chicago';
const WEEKDAYS_9_5 = { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] };

describe('timezone math', () => {
  it('converts CST (winter) wall clock to UTC', () => {
    // 2026-01-15 09:00 America/Chicago = 15:00 UTC (CST = UTC-6)
    expect(localToUtc('2026-01-15', '09:00', TZ)).toBe(Date.UTC(2026, 0, 15, 15, 0));
  });
  it('converts CDT (summer) wall clock to UTC', () => {
    // 2026-07-15 09:00 America/Chicago = 14:00 UTC (CDT = UTC-5)
    expect(localToUtc('2026-07-15', '09:00', TZ)).toBe(Date.UTC(2026, 6, 15, 14, 0));
  });
  it('handles the spring-forward day (2026-03-08)', () => {
    // 09:00 local on the transition day is unambiguous CDT = 14:00 UTC
    expect(localToUtc('2026-03-08', '09:00', TZ)).toBe(Date.UTC(2026, 2, 8, 14, 0));
  });
  it('tzOffsetMs flips at the DST boundary', () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 15), TZ)).toBe(-6 * 3_600_000);
    expect(tzOffsetMs(Date.UTC(2026, 6, 15), TZ)).toBe(-5 * 3_600_000);
  });
  it('localDayOf returns the wall-clock date across midnight', () => {
    // 2026-07-15 03:00 UTC is still 2026-07-14 22:00 in Chicago
    const { date, dayOfWeek } = localDayOf(Date.UTC(2026, 6, 15, 3, 0), TZ);
    expect(date).toBe('2026-07-14');
    expect(dayOfWeek).toBe(2); // Tuesday
  });
});

describe('generateSlots', () => {
  // Wed 2026-07-15, one 9–5 CDT day, 60-min slots on 60-min steps → 8 slots.
  const fromMs = Date.UTC(2026, 6, 15, 0, 0);
  const toMs   = Date.UTC(2026, 6, 16, 0, 0);

  it('fills an empty day at the given granularity', () => {
    const slots = generateSlots({
      timezone: TZ, windowsByDay: WEEKDAYS_9_5, busy: [],
      fromMs, toMs, durationMin: 60, granularityMin: 60,
    });
    expect(slots).toHaveLength(8);
    expect(slots[0].start).toBe('2026-07-15T14:00:00.000Z'); // 09:00 CDT
    expect(slots[7].start).toBe('2026-07-15T21:00:00.000Z'); // 16:00 CDT (last that fits by 17:00)
  });

  it('drops slots overlapping busy time', () => {
    const slots = generateSlots({
      timezone: TZ, windowsByDay: WEEKDAYS_9_5,
      busy: [{ start: '2026-07-15T15:30:00.000Z', end: '2026-07-15T16:30:00.000Z' }], // 10:30–11:30 CDT
      fromMs, toMs, durationMin: 60, granularityMin: 60,
    });
    const starts = slots.map(s => s.start);
    expect(starts).not.toContain('2026-07-15T15:00:00.000Z'); // 10:00 overlaps
    expect(starts).not.toContain('2026-07-15T16:00:00.000Z'); // 11:00 overlaps
    expect(starts).toContain('2026-07-15T14:00:00.000Z');     // 09:00 clear
    expect(starts).toContain('2026-07-15T17:00:00.000Z');     // 12:00 clear
  });

  it('buffers extend the conflict window but not the slot', () => {
    const slots = generateSlots({
      timezone: TZ, windowsByDay: WEEKDAYS_9_5,
      busy: [{ start: '2026-07-15T16:00:00.000Z', end: '2026-07-15T17:00:00.000Z' }], // 11:00–12:00 CDT
      fromMs, toMs, durationMin: 60, granularityMin: 60,
      bufferBeforeMin: 30, bufferAfterMin: 30,
    });
    const starts = slots.map(s => s.start);
    // 12:00 CDT slot needs 11:30 pre-buffer clear — 11:00–12:00 busy blocks it
    expect(starts).not.toContain('2026-07-15T17:00:00.000Z');
    // 13:00 CDT slot's pre-buffer starts 12:30 — clear
    expect(starts).toContain('2026-07-15T18:00:00.000Z');
    // slot end stays duration-long (buffer isn't part of the appointment)
    const one = slots.find(s => s.start === '2026-07-15T18:00:00.000Z');
    expect(one.end).toBe('2026-07-15T19:00:00.000Z');
  });

  it('respects fromMs as a lead-time clamp mid-day', () => {
    const slots = generateSlots({
      timezone: TZ, windowsByDay: WEEKDAYS_9_5, busy: [],
      fromMs: Date.UTC(2026, 6, 15, 17, 30), // 12:30 CDT
      toMs, durationMin: 60, granularityMin: 60,
    });
    expect(slots[0].start).toBe('2026-07-15T18:00:00.000Z'); // first slot ≥ 12:30 is 13:00 CDT
  });

  it('generates nothing on days without windows (weekend)', () => {
    const slots = generateSlots({
      timezone: TZ, windowsByDay: WEEKDAYS_9_5, busy: [],
      fromMs: Date.UTC(2026, 6, 18, 0, 0), // Sat
      toMs:   Date.UTC(2026, 6, 20, 0, 0), // through Sun
      durationMin: 60, granularityMin: 60,
    });
    expect(slots).toHaveLength(0);
  });

  it('does not skip days when the range starts late in the evening', () => {
    // Regression: a naive 25h day-walk starting Mon 23:30 CDT skipped Tuesday.
    const slots = generateSlots({
      timezone: TZ, windowsByDay: WEEKDAYS_9_5, busy: [],
      fromMs: Date.UTC(2026, 6, 14, 4, 30), // Mon 23:30 CDT
      toMs:   Date.UTC(2026, 6, 16, 4, 0),  // Wed 23:00 CDT
      durationMin: 60, granularityMin: 60,
    });
    const days = new Set(slots.map(s => localDayOf(new Date(s.start).getTime(), TZ).date));
    expect(days).toContain('2026-07-14'); // Tuesday present
    expect(days).toContain('2026-07-15'); // Wednesday present
  });

  it('slot count is stable across the fall-back day (2026-11-01)', () => {
    // 9–5 on the repeated-hour day must still be 8 one-hour slots, all CST-anchored after 2am.
    const slots = generateSlots({
      timezone: TZ, windowsByDay: { 0: [['09:00', '17:00']] }, busy: [],
      fromMs: Date.UTC(2026, 10, 1, 0, 0),
      toMs:   Date.UTC(2026, 10, 2, 6, 0),
      durationMin: 60, granularityMin: 60,
    });
    expect(slots).toHaveLength(8);
    expect(slots[0].start).toBe('2026-11-01T15:00:00.000Z'); // 09:00 CST (UTC-6)
  });
});

describe('clampBookingWindow', () => {
  const NOW = Date.UTC(2026, 6, 15, 12, 0); // Wed 2026-07-15 12:00 UTC
  const H = 3_600_000, D = 86_400_000;

  it('defaults to [now+lead, now+maxOut] when no range is requested', () => {
    const r = clampBookingWindow({ nowMs: NOW, minLeadHours: 24, maxDaysOut: 30 });
    expect(r.fromMs).toBe(NOW + 24 * H);
    expect(r.toMs).toBe(NOW + 30 * D);
  });

  it('clamps a requested from that is inside the lead window', () => {
    const r = clampBookingWindow({ nowMs: NOW, minLeadHours: 24, maxDaysOut: 30, fromMs: NOW + 2 * H });
    expect(r.fromMs).toBe(NOW + 24 * H); // can't book sooner than the lead time
  });

  it('clamps a requested to beyond max-days-out', () => {
    const r = clampBookingWindow({ nowMs: NOW, minLeadHours: 24, maxDaysOut: 30, toMs: NOW + 90 * D });
    expect(r.toMs).toBe(NOW + 30 * D);
  });

  it('caps the span at maxSpanDays per query', () => {
    const r = clampBookingWindow({ nowMs: NOW, minLeadHours: 0, maxDaysOut: 365, maxSpanDays: 31 });
    expect(r.toMs - r.fromMs).toBe(31 * D);
  });

  it('returns null when the clamped range is empty', () => {
    // Asking entirely inside the lead window
    const r = clampBookingWindow({ nowMs: NOW, minLeadHours: 48, maxDaysOut: 30, fromMs: NOW, toMs: NOW + 24 * H });
    expect(r).toBeNull();
  });

  it('returns null when maxDaysOut is not beyond the lead time', () => {
    const r = clampBookingWindow({ nowMs: NOW, minLeadHours: 72, maxDaysOut: 2 });
    expect(r).toBeNull();
  });
});

describe('reminderDue', () => {
  const H = 3_600_000;
  const START = Date.UTC(2026, 6, 20, 15, 0); // appointment start
  const base = { startsAtMs: START, hoursBefore: 24, createdAtMs: START - 72 * H };

  it('is false before the window opens', () => {
    expect(reminderDue({ ...base, nowMs: START - 25 * H })).toBe(false);
  });
  it('fires once inside the window', () => {
    expect(reminderDue({ ...base, nowMs: START - 23 * H })).toBe(true);
    expect(reminderDue({ ...base, nowMs: START - 1 * H })).toBe(true);
  });
  it('is false at/after the appointment start', () => {
    expect(reminderDue({ ...base, nowMs: START })).toBe(false);
    expect(reminderDue({ ...base, nowMs: START + H })).toBe(false);
  });
  it('skips appointments booked inside the reminder window (confirmation just went out)', () => {
    expect(reminderDue({ ...base, createdAtMs: START - 3 * H, nowMs: START - 2 * H })).toBe(false);
  });
  it('fires exactly at the window boundary', () => {
    expect(reminderDue({ ...base, nowMs: START - 24 * H })).toBe(true);
  });
});

describe('effectiveWindows', () => {
  it('falls back to firm default when the attorney has no rules', () => {
    const w = effectiveWindows([], { 1: [['09:00', '17:00']] });
    expect(w[1]).toEqual([['09:00', '17:00']]);
  });
  it('attorney rules override the default entirely', () => {
    const w = effectiveWindows(
      [{ day_of_week: 2, start_time: '10:00:00', end_time: '14:00:00' }],
      { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']] },
    );
    expect(w[1]).toBeUndefined();          // default Monday gone — override is total
    expect(w[2]).toEqual([['10:00', '14:00']]);
  });
  it('supports multiple windows per day', () => {
    const w = effectiveWindows(
      [
        { day_of_week: 3, start_time: '09:00:00', end_time: '12:00:00' },
        { day_of_week: 3, start_time: '13:00:00', end_time: '17:00:00' },
      ],
      {},
    );
    expect(w[3]).toHaveLength(2);
  });
});
