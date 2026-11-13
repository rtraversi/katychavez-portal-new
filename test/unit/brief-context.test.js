// Bea-Bot context assembly (functions/api/_brief-context.js), Slice 1.
//
// Pure functions only -- no database, no Claude call. Runs in real workerd, so
// Intl timezone behaviour matches production, which is the point: the window
// rules are all about which local day it is where Katy is, not in UTC.
import { describe, it, expect } from 'vitest';
import {
  briefWindow, shouldRunNow, deadlineCutoff, summarizeInputs, buildContext,
  DEADLINE_HORIZON_DAYS,
} from '../../functions/api/_brief-context.js';

// Querétaro. Central, and no daylight saving since 2022.
const TZ = 'America/Mexico_City';

describe('briefWindow', () => {
  it('reads 24 hours on an ordinary weekday', () => {
    // Fri 2026-11-13, 09:00 local = 15:00 UTC
    const w = briefWindow(Date.UTC(2026, 10, 13, 15, 0), TZ);
    expect(w.localDate).toBe('2026-11-13');
    expect(w.isMonday).toBe(false);
    expect(w.hours).toBe(24);
  });

  it('reads 72 hours on a Monday so the weekend is not lost', () => {
    // Mon 2026-11-16, 09:00 local = 15:00 UTC
    const w = briefWindow(Date.UTC(2026, 10, 16, 15, 0), TZ);
    expect(w.localDate).toBe('2026-11-16');
    expect(w.isMonday).toBe(true);
    expect(w.hours).toBe(72);
    // 72h back from Monday 09:00 reaches Friday 09:00, so Friday afternoon
    // onwards is covered.
    expect(w.sinceIso).toBe(new Date(Date.UTC(2026, 10, 13, 15, 0)).toISOString());
  });

  it('uses the local day, not the UTC day', () => {
    // 2026-11-16T03:00Z is Monday in UTC but still Sunday 21:00 in Mexico City.
    // Getting this wrong would run a Monday brief on Sunday night and then a
    // 24-hour one on Monday morning, silently dropping the weekend -- which is
    // the exact thing the 72-hour rule exists to prevent.
    const w = briefWindow(Date.UTC(2026, 10, 16, 3, 0), TZ);
    expect(w.localDate).toBe('2026-11-15');
    expect(w.isMonday).toBe(false);
    expect(w.hours).toBe(24);
  });
});

describe('shouldRunNow', () => {
  it('fires only on the configured local hour', () => {
    expect(shouldRunNow(Date.UTC(2026, 10, 13, 15, 0), TZ, 9)).toBe(true);   // 09:00 local
    expect(shouldRunNow(Date.UTC(2026, 10, 13, 14, 0), TZ, 9)).toBe(false);  // 08:00 local
    expect(shouldRunNow(Date.UTC(2026, 10, 13, 16, 0), TZ, 9)).toBe(false);  // 10:00 local
  });

  it('accepts the hour as a string, since env vars are strings', () => {
    expect(shouldRunNow(Date.UTC(2026, 10, 13, 15, 0), TZ, '9')).toBe(true);
  });

  it('is correct for a US Central firm too, where DST does apply', () => {
    // 09:00 Chicago is 14:00 UTC in summer and 15:00 UTC in winter. A fixed UTC
    // cron would be an hour out for half the year; gating on the local hour is
    // right in both.
    const CHI = 'America/Chicago';
    expect(shouldRunNow(Date.UTC(2026, 6, 15, 14, 0), CHI, 9)).toBe(true);  // CDT
    expect(shouldRunNow(Date.UTC(2026, 0, 15, 15, 0), CHI, 9)).toBe(true);  // CST
    expect(shouldRunNow(Date.UTC(2026, 0, 15, 14, 0), CHI, 9)).toBe(false);
  });
});

describe('deadlineCutoff', () => {
  it('looks 30 days ahead', () => {
    expect(DEADLINE_HORIZON_DAYS).toBe(30);
    expect(deadlineCutoff(Date.UTC(2026, 10, 13, 15, 0))).toBe('2026-12-13');
  });
});

const MESSAGES = [
  { message_id: 1, sent_at: '2026-11-13T14:00:00Z', sender_name: 'Ana', text: 'RFE question', media_paths: [] },
  { message_id: 2, sent_at: '2026-11-13T14:05:00Z', sender_name: 'Ana', text: null, media_paths: ['bea-bot/x/2/a.jpg'] },
  { message_id: 3, sent_at: '2026-11-13T14:10:00Z', sender_name: 'Katy', text: 'use the 2026 edition', media_paths: [] },
];
const ITEMS = [
  { id: 'i1', title: 'RFE response', case_ref: 'AOS-RQ', why_katy: 'needs her signature', deadline: '2026-11-20', priority: 1, status: 'open', times_asked: 2, last_mentioned_in_brief: '2026-11-12' },
];

describe('summarizeInputs', () => {
  it('counts what went in, so a bad morning can be diagnosed later', () => {
    const window = briefWindow(Date.UTC(2026, 10, 13, 15, 0), TZ);
    const s = summarizeInputs({ window, messages: MESSAGES, openItems: ITEMS, dueSoon: ITEMS });
    expect(s).toMatchObject({
      local_date: '2026-11-13',
      window_hours: 24,
      is_monday: false,
      messages: 3,
      messages_with_text: 2,
      messages_with_media: 1,
      distinct_senders: 2,
      open_items: 1,
      deadlines_within_30d: 1,
    });
  });
});

describe('buildContext', () => {
  const window = briefWindow(Date.UTC(2026, 10, 13, 15, 0), TZ);
  const ctx = buildContext({ window, messages: MESSAGES, openItems: ITEMS, dueSoon: ITEMS });

  it('passes what the model needs to rank things', () => {
    expect(ctx.today).toBe('2026-11-13');
    expect(ctx.window_hours).toBe(24);
    expect(ctx.messages).toHaveLength(3);
    expect(ctx.messages[0]).toMatchObject({ id: 1, from: 'Ana', text: 'RFE question' });
    expect(ctx.open_items[0]).toMatchObject({ why_katy: 'needs her signature', priority: 1 });
  });

  it('does not ship the R2 keys or the raw update', () => {
    // Section 6: don't send more data than the call needs. An object key and a
    // verbatim Telegram payload help Claude rank nothing.
    const json = JSON.stringify(ctx);
    expect(json).not.toContain('bea-bot/');
    expect(json).not.toContain('media_paths');
    expect(json).not.toContain('raw');
    // The fact that there WAS an image still matters for ranking.
    expect(ctx.messages[1].has_image).toBe(true);
  });

  it('omits empty optional fields rather than sending nulls', () => {
    expect(ctx.messages[0].reply_to).toBeUndefined();
    expect(ctx.messages[0].edited).toBeUndefined();
    expect(ctx.messages[0].has_image).toBeUndefined();
  });
});
