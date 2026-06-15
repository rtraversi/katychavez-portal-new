// GET    /api/calendar/events              — list events (all connected providers)
// POST   /api/calendar/events              — create a new event
// DELETE /api/calendar/events?eventId=xxx  — delete an event

import { verifyAuth, json } from './_helpers.js';
import {
  getValidGoogleToken, callGoogle,
  getValidOutlookToken, callGraph,
} from './_calendar-helpers.js';

export async function onRequest({ request, env }) {
  const minLevel = request.method === 'GET' ? 'read' : 'write';
  const auth = await verifyAuth(request, env, minLevel, 'calendar');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  // Fetch tokens for all providers in parallel
  const [googleToken, outlookToken] = await Promise.all([
    getValidGoogleToken(auth.user.id, env),
    getValidOutlookToken(auth.user.id, env),
  ]);

  if (!googleToken && !outlookToken) {
    return json(401, { error: 'Calendar not connected.', notConnected: true });
  }

  if (request.method === 'GET')    return listEvents(request, googleToken, outlookToken);
  if (request.method === 'POST')   return createEvent(request, googleToken, outlookToken);
  if (request.method === 'PATCH')  return updateEvent(request, googleToken, outlookToken);
  if (request.method === 'DELETE') return deleteEvent(request, googleToken, outlookToken);

  return json(405, { error: 'Method not allowed' });
}

// Normalize a Microsoft Graph event to Google Calendar field names so the
// frontend (calendar.js) works without any changes.
// Outlook event IDs are prefixed with "outlook::" so DELETE can route correctly.
function normalizeOutlookEvent(ev) {
  const allDay  = ev.isAllDay;
  const startDt = ev.start?.dateTime || '';
  const endDt   = ev.end?.dateTime   || '';
  // Graph returns UTC datetimes without Z when Prefer:UTC is set — add the suffix.
  const toIso = dt => dt ? (dt.endsWith('Z') ? dt : dt + 'Z') : '';
  // Strip any HTML markup from body content (Graph returns HTML even for plain text notes).
  const desc = (ev.body?.content || '').replace(/<[^>]+>/g, '').trim();

  return {
    id:          `outlook::${ev.id}`,
    summary:     ev.subject || '',
    description: desc,
    location:    ev.location?.displayName || '',
    start: allDay ? { date: startDt.slice(0, 10) } : { dateTime: toIso(startDt) },
    end:   allDay ? { date: endDt.slice(0, 10) }   : { dateTime: toIso(endDt) },
  };
}

// ── List ────────────────────────────────────────────────────────────────────

async function listEvents(request, googleToken, outlookToken) {
  const url     = new URL(request.url);
  const now     = new Date();
  const timeMin = url.searchParams.get('timeMin') || now.toISOString();
  const timeMax = url.searchParams.get('timeMax') || new Date(now.getTime() + 14 * 86_400_000).toISOString();

  const fetches = [];

  if (googleToken) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '100',
    });
    fetches.push(
      callGoogle(googleToken, 'GET', `/calendars/primary/events?${params}`)
        .then(r => r.ok ? r.json().then(d => d.items || []) : [])
        .catch(() => [])
    );
  } else {
    fetches.push(Promise.resolve([]));
  }

  if (outlookToken) {
    // /me/calendarView expands recurring events and accepts a straight time range.
    const params = new URLSearchParams({
      startDateTime: timeMin,
      endDateTime:   timeMax,
      '$orderby':    'start/dateTime',
      '$top':        '100',
      '$select':     'id,subject,body,start,end,isAllDay,location',
    });
    fetches.push(
      callGraph(outlookToken, 'GET', `/me/calendarView?${params}`)
        .then(r => r.ok ? r.json().then(d => (d.value || []).map(normalizeOutlookEvent)) : [])
        .catch(() => [])
    );
  } else {
    fetches.push(Promise.resolve([]));
  }

  const [googleEvents, outlookEvents] = await Promise.all(fetches);

  // Merge and sort chronologically
  const all = [...googleEvents, ...outlookEvents].sort((a, b) => {
    const aStart = a.start?.dateTime || a.start?.date || '';
    const bStart = b.start?.dateTime || b.start?.date || '';
    return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
  });

  return json(200, { events: all });
}

// ── Create ──────────────────────────────────────────────────────────────────

async function createEvent(request, googleToken, outlookToken) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON.' }); }
  if (!body.title) return json(400, { error: 'title is required.' });

  const tz = body.timeZone || 'America/Chicago';

  if (googleToken) {
    return createGoogleEvent(body, googleToken, tz);
  }
  return createOutlookEvent(body, outlookToken, tz);
}

async function createGoogleEvent(body, token, tz) {
  const event = { summary: body.title, description: body.description || '' };

  if (body.allDay && body.startDate) {
    const endDate = new Date(body.startDate + 'T12:00:00Z');
    endDate.setDate(endDate.getDate() + 1);
    event.start = { date: body.startDate };
    event.end   = { date: endDate.toISOString().slice(0, 10) };
  } else {
    if (!body.startDateTime || !body.endDateTime) {
      return json(400, { error: 'startDateTime and endDateTime are required for timed events.' });
    }
    event.start = { dateTime: body.startDateTime, timeZone: tz };
    event.end   = { dateTime: body.endDateTime,   timeZone: tz };
  }

  if (body.location) event.location = body.location;

  const res = await callGoogle(token, 'POST', '/calendars/primary/events', event);
  if (!res.ok) {
    console.error('[calendar-events] google create:', res.status, await res.text());
    return json(res.status, { error: 'Failed to create event.' });
  }
  return json(200, { event: await res.json() });
}

async function createOutlookEvent(body, token, tz) {
  const event = {
    subject: body.title,
    body:    { contentType: 'text', content: body.description || '' },
  };

  if (body.allDay && body.startDate) {
    const endDate = new Date(body.startDate + 'T12:00:00Z');
    endDate.setDate(endDate.getDate() + 1);
    event.isAllDay = true;
    event.start = { dateTime: body.startDate + 'T00:00:00', timeZone: tz };
    event.end   = { dateTime: endDate.toISOString().slice(0, 10) + 'T00:00:00', timeZone: tz };
  } else {
    if (!body.startDateTime || !body.endDateTime) {
      return json(400, { error: 'startDateTime and endDateTime are required for timed events.' });
    }
    event.start = { dateTime: body.startDateTime, timeZone: tz };
    event.end   = { dateTime: body.endDateTime,   timeZone: tz };
  }

  if (body.location) event.location = { displayName: body.location };

  const res = await callGraph(token, 'POST', '/me/events', event);
  if (!res.ok) {
    console.error('[calendar-events] outlook create:', res.status, await res.text());
    return json(res.status, { error: 'Failed to create event.' });
  }
  return json(200, { event: normalizeOutlookEvent(await res.json()) });
}

// ── Update (PATCH) ───────────────────────────────────────────────────────────
// Body: { eventId, title?, description?, date? }
// date changes the event to all-day on the new date (time preserved if fetchable).

async function updateEvent(request, googleToken, outlookToken) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON.' }); }
  const { eventId } = body;
  if (!eventId) return json(400, { error: 'eventId is required.' });

  if (eventId.startsWith('outlook::')) {
    if (!outlookToken) return json(401, { error: 'Calendar not connected.', notConnected: true });
    return updateOutlookEvent(body, outlookToken);
  }
  if (!googleToken) return json(401, { error: 'Calendar not connected.', notConnected: true });
  return updateGoogleEvent(body, googleToken);
}

async function updateGoogleEvent({ eventId, title, description, date }, token) {
  const patch = {};
  if (title       !== undefined) patch.summary     = title;
  if (description !== undefined) patch.description = description || '';

  if (date) {
    // Try to preserve the existing event time; fall back to all-day.
    const existing = await callGoogle(token, 'GET', `/calendars/primary/events/${encodeURIComponent(eventId)}`);
    if (existing.ok) {
      const ev  = await existing.json();
      const tz  = ev.start?.timeZone || 'America/Chicago';
      if (ev.start?.dateTime && ev.end?.dateTime) {
        const startTime = ev.start.dateTime.substring(11, 19); // HH:MM:SS
        const endTime   = ev.end.dateTime.substring(11, 19);
        patch.start = { dateTime: `${date}T${startTime}`, timeZone: tz };
        patch.end   = { dateTime: `${date}T${endTime}`,   timeZone: tz };
      } else {
        const next = new Date(date + 'T12:00:00Z'); next.setDate(next.getDate() + 1);
        patch.start = { date };
        patch.end   = { date: next.toISOString().slice(0, 10) };
      }
    } else {
      const next = new Date(date + 'T12:00:00Z'); next.setDate(next.getDate() + 1);
      patch.start = { date };
      patch.end   = { date: next.toISOString().slice(0, 10) };
    }
  }

  const res = await callGoogle(token, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}`, patch);
  if (!res.ok) {
    console.error('[calendar-events] google patch:', res.status, await res.text());
    return json(res.status, { error: 'Failed to update calendar event.' });
  }
  return json(200, { ok: true });
}

async function updateOutlookEvent({ eventId, title, description, date }, token) {
  const realId = eventId.slice('outlook::'.length);
  const patch  = {};
  if (title       !== undefined) patch.subject = title;
  if (description !== undefined) patch.body = { contentType: 'text', content: description || '' };

  if (date) {
    const existing = await callGraph(token, 'GET', `/me/events/${encodeURIComponent(realId)}`);
    if (existing.ok) {
      const ev = await existing.json();
      const tz = ev.start?.timeZone || 'America/Chicago';
      if (!ev.isAllDay && ev.start?.dateTime && ev.end?.dateTime) {
        const startTime = ev.start.dateTime.substring(11, 19);
        const endTime   = ev.end.dateTime.substring(11, 19);
        patch.isAllDay = false;
        patch.start = { dateTime: `${date}T${startTime}`, timeZone: tz };
        patch.end   = { dateTime: `${date}T${endTime}`,   timeZone: tz };
      } else {
        const next = new Date(date + 'T12:00:00Z'); next.setDate(next.getDate() + 1);
        patch.isAllDay = true;
        patch.start = { dateTime: `${date}T00:00:00`, timeZone: tz };
        patch.end   = { dateTime: `${next.toISOString().slice(0, 10)}T00:00:00`, timeZone: tz };
      }
    } else {
      const next = new Date(date + 'T12:00:00Z'); next.setDate(next.getDate() + 1);
      patch.isAllDay = true;
      patch.start = { dateTime: `${date}T00:00:00`, timeZone: 'America/Chicago' };
      patch.end   = { dateTime: `${next.toISOString().slice(0, 10)}T00:00:00`, timeZone: 'America/Chicago' };
    }
  }

  const res = await callGraph(token, 'PATCH', `/me/events/${encodeURIComponent(realId)}`, patch);
  if (!res.ok) {
    console.error('[calendar-events] outlook patch:', res.status, await res.text());
    return json(res.status, { error: 'Failed to update calendar event.' });
  }
  return json(200, { ok: true });
}

// ── Delete ──────────────────────────────────────────────────────────────────

async function deleteEvent(request, googleToken, outlookToken) {
  const url     = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  if (!eventId) return json(400, { error: 'eventId is required.' });

  if (eventId.startsWith('outlook::')) {
    if (!outlookToken) return json(401, { error: 'Outlook Calendar not connected.' });
    const realId = eventId.slice('outlook::'.length);
    const res = await callGraph(outlookToken, 'DELETE', `/me/events/${encodeURIComponent(realId)}`);
    if (!res.ok && res.status !== 204) {
      return json(res.status, { error: 'Failed to delete event.' });
    }
    return json(200, { ok: true });
  }

  // Google event
  if (!googleToken) return json(401, { error: 'Google Calendar not connected.' });
  const res = await callGoogle(googleToken, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}`);
  if (!res.ok && res.status !== 204) {
    return json(res.status, { error: 'Failed to delete event.' });
  }
  return json(200, { ok: true });
}
