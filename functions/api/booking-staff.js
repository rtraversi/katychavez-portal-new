// Staff-side booking actions that can't be plain RLS table writes:
//
//   POST /api/booking/staff/cancel        — { appointment_id }
//     Cancels a booked appointment, deletes the event from the ATTORNEY's
//     calendar (needs their token via service role — the acting staffer may
//     not be the attorney), and emails the prospect.
//
//   POST /api/booking/staff/payment-link  — { appointment_id, amount? }
//     Creates a payment link via the configured payment adapter, emails it to
//     the prospect, sets payment_status='link_sent'. Amount defaults to the
//     consult type's price. NOTE: routed to the OPERATING account for now —
//     the consult-billing mechanism (trust vs operating, webhook auto-mark)
//     is a deferred decision; staff mark paid manually in Phase 1.
//
// Simple status flips (completed / no_show / mark-paid) go straight through
// RLS from the Appointments page and don't need endpoints.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { getPaymentAdapter } from './_adapters/payment/index.js';
import { resolveAttorneyCalendar } from './_booking-helpers.js';
import { callGraph, callGoogle } from './_calendar-helpers.js';
import { notifyBookingCancelled, notifyBookingPaymentLink } from './_notifications.js';

export async function onRequest(ctx) {
  const { request, env } = ctx;
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'scheduling');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!body.appointment_id) return json(400, { error: 'appointment_id is required' });

  const admin = makeAdminClient(env);
  const { data: appt, error } = await admin
    .from('appointments')
    .select('*, consult_types(name, fee_type, price_cents)')
    .eq('id', body.appointment_id)
    .maybeSingle();
  if (error) {
    console.error('[booking-staff] load:', error.message);
    return json(500, { error: 'Server error' });
  }
  if (!appt) return json(404, { error: 'Appointment not found' });

  const url = new URL(request.url);
  if (url.pathname === '/api/booking/staff/cancel')       return cancel(env, admin, appt);
  if (url.pathname === '/api/booking/staff/payment-link') return paymentLink(env, admin, appt, body);
  return json(404, { error: 'Not found' });
}

async function cancel(env, admin, appt) {
  if (appt.status !== 'booked') return json(409, { error: `Appointment is already ${appt.status}.` });

  const { error } = await admin
    .from('appointments').update({ status: 'cancelled' }).eq('id', appt.id);
  if (error) {
    console.error('[booking-staff] cancel update:', error.message);
    return json(500, { error: 'Failed to cancel.' });
  }

  // Remove the hold from the attorney's calendar — best-effort.
  if (appt.calendar_event_id) {
    try {
      const cal = await resolveAttorneyCalendar(env, appt.user_id);
      if (cal && cal.provider === appt.calendar_provider) {
        const res = cal.provider === 'outlook'
          ? await callGraph(cal.token, 'DELETE', `/me/events/${encodeURIComponent(appt.calendar_event_id)}`)
          : await callGoogle(cal.token, 'DELETE', `/calendars/primary/events/${encodeURIComponent(appt.calendar_event_id)}`);
        if (!res.ok && res.status !== 204 && res.status !== 404) {
          console.error('[booking-staff] event delete:', res.status, await res.text());
        }
      }
    } catch (err) {
      console.error('[booking-staff] event delete:', err.message);
    }
  }

  const { data: settings } = await admin
    .from('booking_settings').select('timezone').eq('id', 1).maybeSingle();
  const whenText = new Intl.DateTimeFormat('en-US', {
    timeZone: settings?.timezone || 'America/Chicago',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(appt.starts_at));
  await notifyBookingCancelled(env, {
    toEmail: appt.prospect_email,
    prospectName: appt.prospect_name,
    consultTypeName: appt.consult_types?.name || 'Consultation',
    whenText,
  }).catch(err => console.error('[booking-staff] cancel email:', err.message));

  return json(200, { ok: true });
}

async function paymentLink(env, admin, appt, body) {
  if (appt.status === 'cancelled') return json(409, { error: 'Appointment is cancelled.' });
  if (appt.payment_status === 'paid') return json(409, { error: 'Already paid.' });

  const defaultAmount = (appt.consult_types?.price_cents || 0) / 100;
  const amount = Number(body.amount ?? defaultAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json(400, { error: 'A payment amount greater than zero is required (set a price on the consult type or pass one).' });
  }
  const amountRounded = Math.round(amount * 100) / 100;
  const desc = `${appt.consult_types?.name || 'Consultation'} — ${new Date(appt.starts_at).toLocaleDateString('en-US')}`;

  const adapter = getPaymentAdapter(env);
  if (!adapter) {
    return json(400, { error: 'No payment provider is configured. Set PAYMENT_PROVIDER to enable payment links.' });
  }

  let link;
  try {
    link = await adapter.createPaymentRequest({
      amount:      amountRounded,
      clientEmail: appt.prospect_email,
      clientName:  appt.prospect_name,
      description: desc,
      accountType: 'operating',
    });
  } catch (err) {
    console.error('[booking-staff] payment adapter:', err.message);
    return json(502, { error: `Payment provider error: ${err.message}` });
  }

  const { error } = await admin
    .from('appointments')
    .update({ payment_status: 'link_sent', payment_link: link.paymentLink })
    .eq('id', appt.id);
  if (error) {
    console.error('[booking-staff] payment update:', error.message);
    return json(500, { error: 'Failed to save payment link.' });
  }

  await notifyBookingPaymentLink(env, {
    toEmail: appt.prospect_email,
    prospectName: appt.prospect_name,
    consultTypeName: appt.consult_types?.name || 'Consultation',
    amount: amountRounded,
    link: link.paymentLink,
  }).catch(err => console.error('[booking-staff] payment email:', err.message));

  return json(200, { ok: true, payment_link: link.paymentLink });
}
