// Shared helpers for the Scheduling module — availability engine + attorney
// calendar resolution. The slot math is pure (unit-tested in test/unit); the
// impure pieces (token lookup, free/busy fetch) live at the bottom.
//
// All computation is done in UTC milliseconds; working-hour windows are defined
// in the firm's timezone and converted per-day via localToUtc (DST-safe).

import { makeAdminClient } from './_helpers.js';
import {
  getValidGoogleToken, getValidOutlookToken,
  getGoogleFreeBusy, getOutlookFreeBusy,
} from './_calendar-helpers.js';

// ── Timezone math (no external tz library in workerd) ────────────────────────

/** Offset of `timeZone` from UTC, in ms, at the instant `utcMs`. */
export function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date(utcMs))) p[type] = value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC instant (ms).
 * dateStr 'YYYY-MM-DD', timeStr 'HH:MM'. Two-pass offset correction handles
 * DST transitions (spring-forward gaps resolve to the post-transition offset).
 */
export function localToUtc(dateStr, timeStr, timeZone) {
  const [y, mo, d]  = dateStr.split('-').map(Number);
  const [hh, mm]    = timeStr.split(':').map(Number);
  const guess       = Date.UTC(y, mo - 1, d, hh, mm);
  let   utc         = guess - tzOffsetMs(guess, timeZone);
  utc = guess - tzOffsetMs(utc, timeZone);
  return utc;
}

/** The wall-clock date ('YYYY-MM-DD') and day-of-week (0=Sun) of `utcMs` in `timeZone`. */
export function localDayOf(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date(utcMs))) p[type] = value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, dayOfWeek: dow };
}

// ── Slot generation (pure) ────────────────────────────────────────────────────

/**
 * Compute bookable slots.
 *
 * @param {object} args
 *   timezone          firm tz, e.g. 'America/Chicago'
 *   windowsByDay      { [dayOfWeek 0-6]: [['09:00','17:00'], ...] } — the attorney's
 *                     effective working hours (availability_rules override or firm default)
 *   busy              [{ start, end }] UTC ISO busy intervals from the calendar
 *   fromMs, toMs      UTC range to search (already clamped to lead/max-out by caller)
 *   durationMin       appointment length
 *   bufferBeforeMin / bufferAfterMin   padding that must also be conflict-free
 *   granularityMin    slot start step
 * @returns [{ start, end }] UTC ISO slots, ascending
 */
export function generateSlots({
  timezone, windowsByDay, busy, fromMs, toMs,
  durationMin, bufferBeforeMin = 0, bufferAfterMin = 0, granularityMin = 30,
}) {
  const busyMs = (busy || []).map(b => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  const durMs  = durationMin * 60_000;
  const befMs  = bufferBeforeMin * 60_000;
  const aftMs  = bufferAfterMin * 60_000;
  const stepMs = granularityMin * 60_000;
  const slots  = [];

  // Walk each wall-clock day the range touches. Dates advance by pure calendar
  // arithmetic (UTC day counter) so DST can neither skip nor repeat a day; the
  // tz only enters when converting each day's windows to instants.
  const firstDate = localDayOf(fromMs, timezone).date;
  const [fy, fm, fd] = firstDate.split('-').map(Number);
  const dayCounter = Date.UTC(fy, fm - 1, fd);

  for (let i = 0; ; i++) {
    const d    = new Date(dayCounter + i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    if (localToUtc(date, '00:00', timezone) > toMs) break;
    const dayOfWeek = d.getUTCDay();

    for (const [startHm, endHm] of windowsByDay[dayOfWeek] || []) {
      const winStart = localToUtc(date, startHm, timezone);
      const winEnd   = localToUtc(date, endHm, timezone);

      for (let s = winStart; s + durMs <= winEnd; s += stepMs) {
        if (s < fromMs || s > toMs) continue;
        const padStart = s - befMs;
        const padEnd   = s + durMs + aftMs;
        const clash    = busyMs.some(([bs, be]) => padStart < be && bs < padEnd);
        if (!clash) slots.push({ start: new Date(s).toISOString(), end: new Date(s + durMs).toISOString() });
      }
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));
  return slots;
}

/**
 * Clamp a requested search range to the firm's booking window:
 * [now + min_lead_hours, now + max_days_out], additionally capped at
 * maxSpanDays per query (bounds the free/busy fetch; Graph getSchedule
 * rejects windows > 62 days anyway).
 * Returns { fromMs, toMs } or null when the clamped range is empty.
 */
export function clampBookingWindow({
  nowMs, minLeadHours = 0, maxDaysOut = 30, fromMs = null, toMs = null, maxSpanDays = 31,
}) {
  const min = nowMs + minLeadHours * 3_600_000;
  const max = nowMs + maxDaysOut * 86_400_000;
  const f = fromMs == null ? min : Math.max(fromMs, min);
  let   t = toMs == null ? max : Math.min(toMs, max);
  t = Math.min(t, f + maxSpanDays * 86_400_000);
  return f < t ? { fromMs: f, toMs: t } : null;
}

/**
 * Should a reminder be sent for this appointment right now?
 * True once the appointment enters the reminder window — EXCEPT when it was
 * booked inside that window already (the confirmation email just went out;
 * a same-minute "reminder" would read as a duplicate).
 */
export function reminderDue({ nowMs, startsAtMs, createdAtMs, hoursBefore }) {
  const windowStart = startsAtMs - hoursBefore * 3_600_000;
  if (nowMs < windowStart) return false;     // too early
  if (nowMs >= startsAtMs) return false;     // already started/past
  if (createdAtMs >= windowStart) return false; // booked inside the window
  return true;
}

// ── Impure orchestration ──────────────────────────────────────────────────────

/**
 * Resolve the attorney's connected calendar: portal users.id → auth_id →
 * oauth token. Prefers Outlook (SSL reality), falls back to Google.
 * Returns { provider, token, accountEmail } or null if nothing connected.
 */
export async function resolveAttorneyCalendar(env, portalUserId) {
  const admin = makeAdminClient(env);

  const { data: user } = await admin
    .from('users').select('auth_id').eq('id', portalUserId).single();
  if (!user) return null;

  const { data: tokenRows } = await admin
    .from('oauth_tokens').select('provider, account_email')
    .eq('user_id', user.auth_id);

  const outlookRow = (tokenRows || []).find(r => r.provider === 'outlook');
  if (outlookRow) {
    const token = await getValidOutlookToken(user.auth_id, env);
    if (token) return { provider: 'outlook', token, accountEmail: outlookRow.account_email };
  }
  if ((tokenRows || []).some(r => r.provider === 'google')) {
    const token = await getValidGoogleToken(user.auth_id, env);
    if (token) return { provider: 'google', token, accountEmail: null };
  }
  return null;
}

/**
 * Busy intervals for a resolved calendar over [fromIso, toIso].
 * Returns null on API failure — callers MUST fail closed (no slots), never open.
 */
export async function getBusyIntervals(cal, fromIso, toIso) {
  if (cal.provider === 'outlook') return getOutlookFreeBusy(cal.token, cal.accountEmail, fromIso, toIso);
  return getGoogleFreeBusy(cal.token, fromIso, toIso);
}

/**
 * Effective working hours for an attorney: availability_rules rows override the
 * firm default entirely; no rows → booking_settings.default_hours.
 * Returns { [dayOfWeek]: [['HH:MM','HH:MM'], ...] }.
 */
export function effectiveWindows(rules, defaultHours) {
  if (!rules || rules.length === 0) {
    const out = {};
    for (const [dow, wins] of Object.entries(defaultHours || {})) out[+dow] = wins;
    return out;
  }
  const out = {};
  for (const r of rules) {
    (out[r.day_of_week] ||= []).push([r.start_time.slice(0, 5), r.end_time.slice(0, 5)]);
  }
  return out;
}
