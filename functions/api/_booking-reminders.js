// Scheduled reminder emails for booked consults (scheduling module).
// Wired into the */5 cron in _worker.js — cheap no-op unless the module is
// enabled AND reminders are on. Each booked appointment gets exactly one
// reminder when it enters the reminder window (reminder_sent_at stamps it);
// appointments booked inside the window are skipped — their confirmation
// email just went out.

import { makeAdminClient } from './_helpers.js';
import { reminderDue } from './_booking-helpers.js';
import { notifyBookingReminder } from './_notifications.js';

export async function runBookingReminders(env) {
  const admin = makeAdminClient(env);

  const { data: mod } = await admin
    .from('enabled_modules').select('module_key')
    .eq('module_key', 'scheduling').maybeSingle();
  if (!mod) return;

  const { data: settings } = await admin
    .from('booking_settings').select('*').eq('id', 1).maybeSingle();
  if (!settings || !settings.reminders_enabled) return;

  const hoursBefore = settings.reminder_hours_before || 24;
  const nowMs = Date.now();

  // Candidates: booked, un-reminded, inside the window but not yet started.
  const { data: appts, error } = await admin
    .from('appointments')
    .select('id, prospect_name, prospect_email, starts_at, created_at, user_id, consult_types(name), attorney:users(first_name, last_name)')
    .eq('status', 'booked')
    .is('reminder_sent_at', null)
    .gt('starts_at', new Date(nowMs).toISOString())
    .lte('starts_at', new Date(nowMs + hoursBefore * 3_600_000).toISOString());
  if (error) {
    console.error('[booking-reminders] query:', error.message);
    return;
  }

  for (const a of (appts || [])) {
    if (!reminderDue({
      nowMs,
      startsAtMs:  new Date(a.starts_at).getTime(),
      createdAtMs: new Date(a.created_at).getTime(),
      hoursBefore,
    })) continue;

    // Stamp FIRST so a crash mid-send can't double-email; a lost email is the
    // cheaper failure (the confirmation already carries the details).
    const { error: stampErr } = await admin
      .from('appointments')
      .update({ reminder_sent_at: new Date(nowMs).toISOString() })
      .eq('id', a.id).is('reminder_sent_at', null);
    if (stampErr) {
      console.error('[booking-reminders] stamp:', a.id, stampErr.message);
      continue;
    }

    const whenText = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone || 'America/Chicago',
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(a.starts_at));

    const attorneyName = [a.attorney?.first_name, a.attorney?.last_name].filter(Boolean).join(' ');
    try {
      await notifyBookingReminder(env, {
        toEmail: a.prospect_email,
        prospectName: a.prospect_name,
        consultTypeName: a.consult_types?.name || 'Consultation',
        attorneyName,
        whenText,
      });
    } catch (err) {
      console.error('[booking-reminders] send:', a.id, err.message);
    }
  }
}
