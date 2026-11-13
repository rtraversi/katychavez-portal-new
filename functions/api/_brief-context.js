// Bea-Bot — pure context assembly for the daily brief. No database, no network,
// so every rule here is testable without standing anything up.
//
// Reuses localDayOf from _booking-helpers.js rather than re-deriving timezone
// maths: the portal already got that right, including the DST edges.

import { localDayOf } from './_booking-helpers.js';

// Section 2 of the spec: the brief reads the last 24 hours, or 72 on a Monday so
// the weekend is not lost.
const WEEKDAY_HOURS = 24;
const MONDAY_HOURS = 72;

// Section 4.4: upcoming deadlines inside this horizon go into the context.
export const DEADLINE_HORIZON_DAYS = 30;

/**
 * The window of Telegram history this morning's brief should read.
 *
 * "Monday" means Monday where Katy is, not in UTC. She is often in Querétaro,
 * which is Central with no daylight saving, so a UTC-based answer is wrong for
 * part of the year and silently drops the weekend.
 */
export function briefWindow(nowMs, timeZone) {
  const { date, dayOfWeek } = localDayOf(nowMs, timeZone);
  const isMonday = dayOfWeek === 1;
  const hours = isMonday ? MONDAY_HOURS : WEEKDAY_HOURS;
  return {
    localDate: date,
    isMonday,
    hours,
    sinceIso: new Date(nowMs - hours * 3_600_000).toISOString(),
  };
}

/**
 * Whether the hourly cron should actually produce a brief on this tick.
 *
 * Cron expressions are UTC, so a fixed one cannot be the configurable local
 * time section 4.4 asks for -- it would be correct in Querétaro and an hour off
 * in US Central for half the year. The job therefore runs every hour and gates
 * here on the firm's configured local hour.
 */
export function shouldRunNow(nowMs, timeZone, sendHourLocal) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false })
      .format(new Date(nowMs)),
  );
  return hour === Number(sendHourLocal);
}

/** The latest date a deadline can have and still be worth mentioning. */
export function deadlineCutoff(nowMs) {
  return new Date(nowMs + DEADLINE_HORIZON_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * A compact description of what went into a brief, stored on brief_log.
 *
 * This is what makes a bad morning diagnosable later: "the brief missed the RFE"
 * is a different problem depending on whether the message was in the window at
 * all. Counts only -- the messages themselves are already in tg_messages.
 */
export function summarizeInputs({ window, messages, openItems, dueSoon }) {
  const senders = new Set(messages.map((m) => m.sender_name).filter(Boolean));
  return {
    local_date: window.localDate,
    window_hours: window.hours,
    is_monday: window.isMonday,
    messages: messages.length,
    messages_with_text: messages.filter((m) => m.text).length,
    messages_with_media: messages.filter((m) => (m.media_paths || []).length).length,
    distinct_senders: senders.size,
    open_items: openItems.length,
    deadlines_within_30d: dueSoon.length,
  };
}

/**
 * Shape the gathered rows into the payload the prompt is given.
 *
 * Section 6: don't send more data than the call needs. So this passes the
 * message text and who said it, and drops the raw update, the R2 keys and the
 * Telegram user ids -- none of which help Claude rank anything.
 */
export function buildContext({ window, messages, openItems, dueSoon }) {
  return {
    today: window.localDate,
    window_hours: window.hours,
    covers_weekend: window.isMonday,
    messages: messages.map((m) => ({
      id: m.message_id,
      at: m.sent_at,
      from: m.sender_name,
      text: m.text,
      reply_to: m.reply_to_message_id ?? undefined,
      thread: m.message_thread_id ?? undefined,
      has_image: (m.media_paths || []).length > 0 || undefined,
      edited: m.edited_at ? true : undefined,
    })),
    open_items: openItems.map((i) => ({
      id: i.id,
      title: i.title,
      case_ref: i.case_ref ?? undefined,
      why_katy: i.why_katy,
      deadline: i.deadline ?? undefined,
      priority: i.priority,
      status: i.status,
      times_asked: i.times_asked,
      last_in_brief: i.last_mentioned_in_brief ?? undefined,
    })),
    upcoming_deadlines: dueSoon.map((i) => ({
      id: i.id, title: i.title, deadline: i.deadline, priority: i.priority,
    })),
  };
}
