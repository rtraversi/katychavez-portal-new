// Public consult-booking API (scheduling module) — NO bearer auth. This is a
// deliberate public surface (like intake-public-submit): every endpoint is
// rate-limited in _worker.js, the mutation is Turnstile-gated, all DB access is
// service-role, and attorneys are only ever addressed by their opaque public
// slug (booking_provider_profiles.slug) — portal user ids never leave the API.
//
//   GET  /api/booking/attorneys                       — bookable attorneys (slug/name/photo/blurb)
//   GET  /api/booking/consult-types?attorney=<slug>   — active types that attorney offers
//   GET  /api/booking/availability?attorney=&consult_type_id=&from=&to=
//   POST /api/booking/book                            — Turnstile + fail-closed free/busy
//                                                       re-check + DB exclusion race guard
//
// Fail-closed rule: if the attorney's calendar can't be read (not connected,
// token refresh failed, Graph/Google error) we show NO slots and refuse to
// book — never guess.

import { makeAdminClient, json, verifyTurnstile } from './_helpers.js';
import { validate, BookingBookSchema } from './_schemas.js';
import {
  generateSlots, effectiveWindows, clampBookingWindow,
  resolveAttorneyCalendar, getBusyIntervals,
} from './_booking-helpers.js';
import { callGraph, callGoogle } from './_calendar-helpers.js';
import { notifyBookingProspect, notifyBookingAttorney } from './_notifications.js';

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  switch (url.pathname) {
    case '/api/booking/attorneys':     return getAttorneys(ctx);
    case '/api/booking/consult-types': return getConsultTypes(ctx, url);
    case '/api/booking/case-types':    return getCaseTypes(ctx);
    case '/api/booking/offer':         return getOffer(ctx, url);
    case '/api/booking/availability':  return getAvailability(ctx, url);
    case '/api/booking/book':          return book(ctx);
  }
  return json(404, { error: 'Not found' });
}

// Premium gate — the module must be enabled for this firm. 404 (not 403) so
// deployments without scheduling don't advertise that the endpoints exist.
async function schedulingEnabled(admin) {
  const { data } = await admin
    .from('enabled_modules').select('module_key')
    .eq('module_key', 'scheduling').maybeSingle();
  return !!data;
}

const NOT_AVAILABLE = () => json(404, { error: 'Online booking is not available.' });

async function loadSettings(admin) {
  const { data } = await admin.from('booking_settings').select('*').eq('id', 1).maybeSingle();
  return data || {
    timezone: 'America/Chicago', min_lead_hours: 24, max_days_out: 30,
    slot_granularity_min: 30, default_hours: {},
  };
}

/** user_id → account avatar (users.avatar_url, a data URL) for the given
 *  providers. The attorney's account photo is the booking photo; the
 *  profile's pasted photo_url is only a fallback. */
async function loadAvatars(admin, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await admin.from('users').select('id, avatar_url').in('id', ids);
  return new Map((data || []).filter(u => u.avatar_url).map(u => [u.id, u.avatar_url]));
}

/** Profile by public slug; null unless bookable. photo_url resolves to the
 *  attorney's account avatar, falling back to any pasted profile photo. */
async function loadProfile(admin, slug) {
  if (!slug) return null;
  const { data } = await admin
    .from('booking_provider_profiles')
    .select('user_id, slug, display_name, photo_url, blurb')
    .eq('slug', slug).eq('is_bookable', true).maybeSingle();
  if (!data) return null;
  const avatars = await loadAvatars(admin, [data.user_id]);
  return { ...data, photo_url: avatars.get(data.user_id) || data.photo_url || null };
}

/** Active PUBLIC consult type, only if this attorney offers it. Staff-only
 *  types (public_bookable=false) are attorney-offered — never self-bookable,
 *  even by direct API call, UNLESS the caller holds a live private offer for
 *  exactly this attorney + type (allowPrivate). */
async function loadOfferedType(admin, consultTypeId, userId, allowPrivate = false) {
  let q = admin
    .from('consult_types')
    .select('id, name, description, duration_min, fee_type, price_cents, buffer_before_min, buffer_after_min')
    .eq('id', consultTypeId).eq('is_active', true);
  if (!allowPrivate) q = q.eq('public_bookable', true);
  const { data: ct } = await q.maybeSingle();
  if (!ct) return null;
  const { data: link } = await admin
    .from('consult_type_providers').select('consult_type_id')
    .eq('consult_type_id', consultTypeId).eq('user_id', userId).maybeSingle();
  return link ? ct : null;
}

/** Live (unused, unexpired) private offer by token; null otherwise. */
async function loadOffer(admin, token) {
  if (!token) return null;
  const { data } = await admin
    .from('booking_offers')
    .select('id, consult_type_id, user_id, expires_at, used_appointment_id')
    .eq('token', token).maybeSingle();
  if (!data || data.used_appointment_id) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

/** True when a live offer authorizes this exact attorney + consult type. */
const offerAuthorizes = (offer, userId, consultTypeId) =>
  !!offer && offer.user_id === userId && offer.consult_type_id === consultTypeId;

/** Booked appointments as busy intervals — covers rows whose calendar event
 *  failed to create (they'd be invisible to free/busy alone). */
async function appointmentBusy(admin, userId, fromIso, toIso) {
  const { data } = await admin
    .from('appointments').select('starts_at, ends_at')
    .eq('user_id', userId).eq('status', 'booked')
    .lt('starts_at', toIso).gt('ends_at', fromIso);
  return (data || []).map(a => ({ start: a.starts_at, end: a.ends_at }));
}

// ── GET /api/booking/attorneys ────────────────────────────────────────────────

async function getAttorneys({ env }) {
  const admin = makeAdminClient(env);
  if (!await schedulingEnabled(admin)) return NOT_AVAILABLE();

  const { data: profiles, error } = await admin
    .from('booking_provider_profiles')
    .select('user_id, slug, display_name, photo_url, blurb')
    .eq('is_bookable', true)
    .order('sort_order');
  if (error) {
    console.error('[booking] attorneys query:', error.message);
    return json(500, { error: 'Server error' });
  }

  // Only expose attorneys who offer at least one active PUBLIC consult type.
  const { data: offerings } = await admin
    .from('consult_type_providers')
    .select('user_id, consult_types!inner(id)')
    .eq('consult_types.is_active', true)
    .eq('consult_types.public_bookable', true);
  const offering = new Set((offerings || []).map(o => o.user_id));

  const shown = (profiles || []).filter(p => offering.has(p.user_id));
  // Prefer each attorney's account avatar; fall back to a pasted photo_url.
  const avatars = await loadAvatars(admin, shown.map(p => p.user_id));
  const attorneys = shown.map(({ user_id, slug, display_name, photo_url, blurb }) => ({
    slug, display_name, blurb,
    photo_url: avatars.get(user_id) || photo_url || null,
  }));

  // Branding rides along on the page's first API call.
  const settings = await loadSettings(admin);
  return json(200, {
    attorneys,
    branding: { logo_url: settings.logo_url || null, brand_color: settings.brand_color || null },
  });
}

// ── GET /api/booking/consult-types?attorney= ─────────────────────────────────

async function getConsultTypes({ env }, url) {
  const admin = makeAdminClient(env);
  if (!await schedulingEnabled(admin)) return NOT_AVAILABLE();

  const profile = await loadProfile(admin, url.searchParams.get('attorney'));
  if (!profile) return json(404, { error: 'Attorney not found.' });

  const { data, error } = await admin
    .from('consult_type_providers')
    .select('consult_types(id, name, description, duration_min, fee_type, price_cents, is_active, public_bookable, sort_order)')
    .eq('user_id', profile.user_id);
  if (error) {
    console.error('[booking] consult-types query:', error.message);
    return json(500, { error: 'Server error' });
  }

  const consult_types = (data || [])
    .map(r => r.consult_types)
    .filter(ct => ct && ct.is_active && ct.public_bookable)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ id, name, description, duration_min, fee_type, price_cents }) =>
      ({ id, name, description, duration_min, fee_type, price_cents }));

  return json(200, {
    attorney: { slug: profile.slug, display_name: profile.display_name },
    consult_types,
  });
}

// ── GET /api/booking/case-types ───────────────────────────────────────────────
// "What's this regarding" dropdown — the same case-type list the client card
// uses: case types belonging to the firm's enabled practice areas. An empty
// list is a valid answer (no areas enabled yet) — the page hides the dropdown.

async function getCaseTypes({ env }) {
  const admin = makeAdminClient(env);
  if (!await schedulingEnabled(admin)) return NOT_AVAILABLE();

  const { data: enabled } = await admin
    .from('enabled_practice_areas').select('practice_area_key');
  const keys = (enabled || []).map(r => r.practice_area_key);
  if (!keys.length) return json(200, { case_types: [] });

  const { data: pas } = await admin
    .from('practice_areas').select('id, name, sort_order')
    .in('key', keys).order('sort_order');
  const paName = new Map((pas || []).map(p => [p.id, p.name]));
  if (!paName.size) return json(200, { case_types: [] });

  const { data: cts, error } = await admin
    .from('case_types').select('id, name, practice_area_id, sort_order')
    .in('practice_area_id', [...paName.keys()])
    .order('sort_order');
  if (error) {
    console.error('[booking] case-types query:', error.message);
    return json(500, { error: 'Server error' });
  }

  return json(200, {
    case_types: (cts || []).map(ct => ({
      id: ct.id, name: ct.name, practice_area: paName.get(ct.practice_area_id),
    })),
  });
}

// ── GET /api/booking/offer?token= ─────────────────────────────────────────────
// Resolves a private booking link: returns the attorney + consult type the
// offer is for, so /book can skip straight to the time picker. One generic
// error for every failure mode — a token probe learns nothing.

async function getOffer({ env }, url) {
  const admin = makeAdminClient(env);
  if (!await schedulingEnabled(admin)) return NOT_AVAILABLE();

  const OFFER_INVALID = () =>
    json(404, { error: 'This booking link is no longer valid. Please contact our office.' });

  const offer = await loadOffer(admin, url.searchParams.get('token'));
  if (!offer) return OFFER_INVALID();

  const { data: profile } = await admin
    .from('booking_provider_profiles')
    .select('user_id, slug, display_name, photo_url, blurb')
    .eq('user_id', offer.user_id).eq('is_bookable', true).maybeSingle();
  if (!profile) return OFFER_INVALID();

  const ct = await loadOfferedType(admin, offer.consult_type_id, offer.user_id, true);
  if (!ct) return OFFER_INVALID();

  const settings = await loadSettings(admin);
  return json(200, {
    attorney: { slug: profile.slug, display_name: profile.display_name, photo_url: profile.photo_url, blurb: profile.blurb },
    consult_type: {
      id: ct.id, name: ct.name, description: ct.description,
      duration_min: ct.duration_min, fee_type: ct.fee_type, price_cents: ct.price_cents,
    },
    branding: { logo_url: settings.logo_url || null, brand_color: settings.brand_color || null },
  });
}

// ── GET /api/booking/availability ─────────────────────────────────────────────

const parseMs = (s) => {
  if (!s) return null;
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? ms : null;
};

async function getAvailability({ env }, url) {
  const admin = makeAdminClient(env);
  if (!await schedulingEnabled(admin)) return NOT_AVAILABLE();

  const profile = await loadProfile(admin, url.searchParams.get('attorney'));
  if (!profile) return json(404, { error: 'Attorney not found.' });

  const consultTypeId = url.searchParams.get('consult_type_id');
  if (!consultTypeId) return json(400, { error: 'consult_type_id is required.' });
  const offer = await loadOffer(admin, url.searchParams.get('offer'));
  const consultType = await loadOfferedType(admin, consultTypeId, profile.user_id,
    offerAuthorizes(offer, profile.user_id, consultTypeId));
  if (!consultType) return json(404, { error: 'Consultation type not found.' });

  const settings = await loadSettings(admin);
  const range = clampBookingWindow({
    nowMs: Date.now(),
    minLeadHours: settings.min_lead_hours,
    maxDaysOut:   settings.max_days_out,
    fromMs: parseMs(url.searchParams.get('from')),
    toMs:   parseMs(url.searchParams.get('to')),
  });
  if (!range) return json(200, { timezone: settings.timezone, slots: [] });

  const slots = await computeSlots(admin, env, { profile, consultType, settings, ...range });
  if (slots === null) return json(200, { timezone: settings.timezone, slots: [] }); // fail closed

  return json(200, {
    timezone: settings.timezone,
    from: new Date(range.fromMs).toISOString(),
    to:   new Date(range.toMs).toISOString(),
    slots,
  });
}

/**
 * Shared slot computation for availability + the book-time re-check.
 * Returns the slot list, or null when the calendar can't be read (fail closed).
 */
async function computeSlots(admin, env, { profile, consultType, settings, fromMs, toMs }) {
  const cal = await resolveAttorneyCalendar(env, profile.user_id);
  if (!cal) return null;

  // Over-fetch busy by a day each side so buffers/edges never miss a conflict.
  const padMs   = 86_400_000;
  const fromIso = new Date(fromMs - padMs).toISOString();
  const toIso   = new Date(toMs + padMs).toISOString();

  const busy = await getBusyIntervals(cal, fromIso, toIso);
  if (busy === null) return null;
  busy.push(...await appointmentBusy(admin, profile.user_id, fromIso, toIso));

  const { data: rules } = await admin
    .from('availability_rules')
    .select('day_of_week, start_time, end_time')
    .eq('user_id', profile.user_id);

  return generateSlots({
    timezone:        settings.timezone,
    windowsByDay:    effectiveWindows(rules || [], settings.default_hours),
    busy, fromMs, toMs,
    durationMin:     consultType.duration_min,
    bufferBeforeMin: consultType.buffer_before_min,
    bufferAfterMin:  consultType.buffer_after_min,
    granularityMin:  settings.slot_granularity_min,
  });
}

// ── POST /api/booking/book ────────────────────────────────────────────────────

async function book({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const v = validate(BookingBookSchema, body);
  if (v.error) return v.error;
  const { attorney, consult_type_id, prospect_name, prospect_email } = v.data;

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const human = await verifyTurnstile(env, v.data.turnstile_token, ip, 'booking');
  if (!human) return json(403, { error: 'Verification failed. Please refresh and try again.' });

  const admin = makeAdminClient(env);
  if (!await schedulingEnabled(admin)) return NOT_AVAILABLE();

  const profile = await loadProfile(admin, attorney);
  if (!profile) return json(404, { error: 'Attorney not found.' });
  const offer = await loadOffer(admin, v.data.offer);
  const consultType = await loadOfferedType(admin, consult_type_id, profile.user_id,
    offerAuthorizes(offer, profile.user_id, consult_type_id));
  if (!consultType) return json(404, { error: 'Consultation type not found.' });

  const startMs = parseMs(v.data.start);
  if (startMs === null) return json(400, { error: 'start must be a valid ISO datetime.' });
  const startIso = new Date(startMs).toISOString();
  const endMs    = startMs + consultType.duration_min * 60_000;
  const endIso   = new Date(endMs).toISOString();

  // Optional "what's this regarding" — must be a real case type if provided.
  let caseTypeName = null;
  if (v.data.case_type_id) {
    const { data: ct } = await admin
      .from('case_types').select('id, name').eq('id', v.data.case_type_id).maybeSingle();
    if (!ct) return json(400, { error: 'Invalid case type.' });
    caseTypeName = ct.name;
  }

  // Re-check availability at book time (race guard #1). The requested start
  // must exactly match a currently-open slot — this enforces lead time,
  // max-days-out, working hours, granularity alignment, and fresh free/busy
  // in one pass. The day-walk is bounded to the slot's own day.
  const settings = await loadSettings(admin);
  const range = clampBookingWindow({
    nowMs: Date.now(),
    minLeadHours: settings.min_lead_hours,
    maxDaysOut:   settings.max_days_out,
  });
  if (!range || startMs < range.fromMs || startMs > range.toMs) {
    return json(409, { error: 'That time is no longer available. Please pick another slot.' });
  }

  const slots = await computeSlots(admin, env, {
    profile, consultType, settings,
    fromMs: Math.max(range.fromMs, startMs - 86_400_000),
    toMs:   startMs,
  });
  if (slots === null) {
    return json(503, { error: 'We could not verify availability. Please try again in a moment.' });
  }
  if (!slots.some(s => s.start === startIso)) {
    return json(409, { error: 'That time is no longer available. Please pick another slot.' });
  }

  // Insert (race guard #2): the appointments_no_overlap exclusion constraint
  // (migration 1011) rejects a concurrent booking of the same slot with 23P01.
  const { data: appt, error: insertErr } = await admin
    .from('appointments')
    .insert({
      consult_type_id: consultType.id,
      user_id:         profile.user_id,
      prospect_name,
      prospect_email,
      prospect_phone:  v.data.prospect_phone || null,
      case_type_id:    v.data.case_type_id || null,
      starts_at:       startIso,
      ends_at:         endIso,
      notes:           v.data.notes || null,
    })
    .select('id, manage_token')
    .single();
  if (insertErr) {
    if (insertErr.code === '23P01') {
      return json(409, { error: 'That time was just booked. Please pick another slot.' });
    }
    console.error('[booking] insert:', insertErr.message);
    return json(500, { error: 'Failed to book. Please try again.' });
  }

  // Consume the private offer — single-use. (The slot itself is already
  // protected by the exclusion constraint; this only closes the link.)
  if (offer) {
    await admin.from('booking_offers')
      .update({ used_appointment_id: appt.id })
      .eq('id', offer.id).is('used_appointment_id', null);
  }

  // Create the event on the attorney's calendar. Best-effort: the appointment
  // row is the source of truth (and blocks the slot via the exclusion
  // constraint + appointmentBusy), so a Graph/Google hiccup must not unwind
  // the prospect's confirmed booking.
  const whenText = new Intl.DateTimeFormat('en-US', {
    timeZone: settings.timezone, weekday: 'long', month: 'long', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(startMs));

  try {
    const event = await createCalendarEvent(env, profile.user_id, {
      subject: `${consultType.name} — ${prospect_name}`,
      details: [
        `Booked online via the firm's booking page.`,
        `Prospect: ${prospect_name}`,
        `Email: ${prospect_email}`,
        v.data.prospect_phone ? `Phone: ${v.data.prospect_phone}` : null,
        caseTypeName ? `Regarding: ${caseTypeName}` : null,
        v.data.notes ? `Notes: ${v.data.notes}` : null,
      ].filter(Boolean).join('\n'),
      startIso, endIso,
    });
    if (event) {
      await admin.from('appointments')
        .update({ calendar_event_id: event.id, calendar_provider: event.provider })
        .eq('id', appt.id);
    }
  } catch (err) {
    console.error('[booking] calendar event create:', err.message);
  }

  // Confirmation emails — best-effort, never fail the booking.
  try {
    const feeText =
      consultType.price_cents > 0
        ? `$${(consultType.price_cents / 100).toFixed(2)}${consultType.fee_type === 'reduced' ? ' (special rate)' : ''}`
        : (consultType.fee_type === 'free' ? 'Free' : null);
    await notifyBookingProspect(env, {
      toEmail: prospect_email, prospectName: prospect_name,
      attorneyName: profile.display_name, consultTypeName: consultType.name,
      whenText, feeText,
    });
    const { data: attorneyUser } = await admin
      .from('users').select('email').eq('id', profile.user_id).single();
    if (attorneyUser?.email) {
      await notifyBookingAttorney(env, {
        toEmail: attorneyUser.email, prospectName: prospect_name,
        prospectEmail: prospect_email, prospectPhone: v.data.prospect_phone || null,
        consultTypeName: consultType.name, whenText,
        caseTypeName, notes: v.data.notes || null,
      });
    }
  } catch (err) {
    console.error('[booking] confirmation emails:', err.message);
  }

  return json(200, {
    ok: true,
    manage_token: appt.manage_token,
    appointment: {
      starts_at: startIso,
      ends_at: endIso,
      timezone: settings.timezone,
      attorney: profile.display_name,
      consult_type: consultType.name,
    },
  });
}

/** Create the consult event on the attorney's connected calendar.
 *  Returns { id, provider } or null when nothing is connected / create failed. */
async function createCalendarEvent(env, portalUserId, { subject, details, startIso, endIso }) {
  const cal = await resolveAttorneyCalendar(env, portalUserId);
  if (!cal) return null;

  if (cal.provider === 'outlook') {
    const res = await callGraph(cal.token, 'POST', '/me/events', {
      subject,
      body:  { contentType: 'text', content: details },
      start: { dateTime: startIso, timeZone: 'UTC' },
      end:   { dateTime: endIso,   timeZone: 'UTC' },
    });
    if (!res.ok) {
      console.error('[booking] outlook event create:', res.status, await res.text());
      return null;
    }
    return { id: (await res.json()).id, provider: 'outlook' };
  }

  const res = await callGoogle(cal.token, 'POST', '/calendars/primary/events', {
    summary: subject,
    description: details,
    start: { dateTime: startIso },
    end:   { dateTime: endIso },
  });
  if (!res.ok) {
    console.error('[booking] google event create:', res.status, await res.text());
    return null;
  }
  return { id: (await res.json()).id, provider: 'google' };
}
