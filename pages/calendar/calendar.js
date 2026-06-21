'use strict';

(async function CalendarPage() {

  const notConnected = document.getElementById('cal-not-connected');
  const tabsEl       = document.getElementById('cal-tabs');
  const loadingEl    = document.getElementById('cal-loading');
  const eventsEl     = document.getElementById('cal-events-container');
  const noEventsEl   = document.getElementById('cal-no-events');
  const noEventsMsg  = document.getElementById('cal-no-events-msg');
  const newEventBtn  = document.getElementById('cal-new-event-btn');
  const modal        = document.getElementById('cal-modal');
  const form         = document.getElementById('cal-event-form');

  const TZ = 'America/Chicago';
  let currentView = 'week';
  let canWrite    = false;

  // ── Auth ──────────────────────────────────────────────────────────────────────

  const profile  = await Auth.getProfile();
  const roleName = profile?.role?.name || '';
  canWrite = ['Owner', 'Attorney', 'Partner Attorney'].includes(roleName);

  // ── Date range helpers ────────────────────────────────────────────────────────

  function getRange(view) {
    const now   = new Date();
    const y     = now.getFullYear();
    const m     = now.getMonth();
    const d     = now.getDate();
    const day   = now.getDay(); // 0=Sun

    let start, end;

    if (view === 'today') {
      start = new Date(y, m, d, 0, 0, 0);
      end   = new Date(y, m, d, 23, 59, 59);
    } else if (view === 'week') {
      // Mon–Sun of current week
      const mon = d - (day === 0 ? 6 : day - 1);
      start = new Date(y, m, mon, 0, 0, 0);
      end   = new Date(y, m, mon + 6, 23, 59, 59);
    } else if (view === 'month') {
      start = new Date(y, m, 1, 0, 0, 0);
      end   = new Date(y, m + 1, 0, 23, 59, 59);
    } else {
      // upcoming — next 14 days
      start = now;
      end   = new Date(now.getTime() + 14 * 86_400_000);
    }

    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }

  const NO_EVENTS_LABELS = {
    today:    'No events today.',
    week:     'No events this week.',
    month:    'No events this month.',
    upcoming: 'No events in the next 14 days.',
  };

  // ── Settings + connect nav ────────────────────────────────────────────────────

  document.getElementById('cal-settings-btn').addEventListener('click', () => {
    window.location.hash = 'settings/calendar';
  });

  async function startOAuth(endpoint, btn, label) {
    btn.disabled    = true;
    btn.textContent = 'Connecting…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const data    = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      Utils.toast(err.message || 'Failed to start authorization.', 'error');
      btn.disabled    = false;
      btn.textContent = label;
    }
  }

  document.getElementById('cal-connect-google').addEventListener('click', function() {
    startOAuth('/api/calendar/oauth-url', this, 'Connect Google Calendar');
  });
  document.getElementById('cal-connect-outlook').addEventListener('click', function() {
    startOAuth('/api/calendar/outlook-oauth-url', this, 'Connect Outlook Calendar');
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────────

  function setActiveTab(view) {
    document.querySelectorAll('.cal-tab-btn').forEach(b => {
      const isActive = b.dataset.view === view;
      b.style.background  = isActive ? 'var(--color-bg, #fff)' : '';
      b.style.fontWeight  = isActive ? '600' : '';
      b.style.boxShadow   = isActive ? '0 1px 3px rgba(0,0,0,.1)' : '';
    });
  }

  document.querySelectorAll('.cal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentView = btn.dataset.view;
      setActiveTab(currentView);
      load();
    });
  });

  // ── Load events ───────────────────────────────────────────────────────────────

  async function load() {
    notConnected.classList.add('hidden');
    loadingEl.classList.remove('hidden');
    eventsEl.classList.add('hidden');
    noEventsEl.classList.add('hidden');

    const { timeMin, timeMax } = getRange(currentView);

    try {
      const session = await Auth.getSession();
      const res     = await fetch(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      loadingEl.classList.add('hidden');

      if (!res.ok) {
        if (data.notConnected) {
          notConnected.classList.remove('hidden');
          tabsEl.classList.add('hidden');
          return;
        }
        Utils.toast(data.error || 'Failed to load events.', 'error');
        return;
      }

      tabsEl.classList.remove('hidden');
      if (canWrite) newEventBtn.style.display = '';

      const events = data.events || [];
      if (!events.length) {
        noEventsMsg.textContent = NO_EVENTS_LABELS[currentView] || 'No events found.';
        noEventsEl.classList.remove('hidden');
        return;
      }

      render(events);
      eventsEl.classList.remove('hidden');

    } catch (err) {
      loadingEl.classList.add('hidden');
      Utils.toast('Failed to load calendar.', 'error');
      console.error('[calendar]', err);
    }
  }

  // ── Render event list ─────────────────────────────────────────────────────────

  function render(events) {
    const groups = {};

    for (const ev of events) {
      const start   = ev.start?.dateTime || ev.start?.date;
      const date    = new Date(start);
      const dateKey = date.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(ev);
    }

    const today = new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });

    eventsEl.innerHTML = Object.entries(groups).map(([day, evs]) => {
      const isToday = day === today;
      return `
        <div style="margin-bottom:var(--space-4)">
          <div style="font-size:var(--font-size-sm);font-weight:600;
                      color:${isToday ? 'var(--color-primary)' : 'var(--color-text-muted)'};
                      margin-bottom:var(--space-2);padding:0 var(--space-1)">
            ${isToday ? 'Today — ' : ''}${day}
          </div>
          <div class="card" style="padding:0;overflow:hidden">
            ${evs.map(ev => renderEvent(ev)).join('')}
          </div>
        </div>`;
    }).join('');

    eventsEl.querySelectorAll('.cal-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteEvent(btn.dataset.eventId));
    });
  }

  function renderEvent(ev) {
    const startDt = ev.start?.dateTime;
    const endDt   = ev.end?.dateTime;
    const allDay  = !startDt;

    const timeStr = allDay
      ? 'All day'
      : `${fmtTime(startDt)}–${fmtTime(endDt)}`;

    const desc   = ev.description ? `<div class="text-sm text-muted" style="margin-top:2px">${escHtml(ev.description.slice(0, 120))}</div>` : '';
    const loc    = ev.location    ? `<div class="text-sm text-muted" style="margin-top:2px">📍 ${escHtml(ev.location)}</div>` : '';
    const delBtn = canWrite
      ? `<button class="cal-delete-btn btn btn--ghost btn--sm" data-event-id="${ev.id}" style="color:var(--color-text-muted);padding:2px 8px;font-size:11px">Delete</button>`
      : '';

    return `
      <div style="display:flex;align-items:flex-start;gap:var(--space-4);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border)">
        <div style="min-width:80px;font-size:var(--font-size-sm);color:var(--color-text-muted);padding-top:2px;flex-shrink:0">${timeStr}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;font-size:var(--font-size-sm)">${escHtml(ev.summary || '(No title)')}</div>
          ${desc}${loc}
        </div>
        <div style="flex-shrink:0">${delBtn}</div>
      </div>`;
  }

  function fmtTime(dt) {
    return new Date(dt).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Delete event ──────────────────────────────────────────────────────────────

  async function deleteEvent(eventId) {
    if (!await Utils.confirm('Delete this event from your calendar?', { confirmLabel: 'Delete', danger: true })) return;
    try {
      const session = await Auth.getSession();
      const res     = await fetch(`/api/calendar/events?eventId=${encodeURIComponent(eventId)}`, {
        method:  'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Utils.toast('Event deleted.', 'success');
      load();
    } catch (err) {
      Utils.toast(err.message || 'Failed to delete event.', 'error');
    }
  }

  // ── New event modal ───────────────────────────────────────────────────────────

  newEventBtn.addEventListener('click', openModal);
  document.getElementById('cal-modal-close').addEventListener('click', closeModal);
  document.getElementById('cal-modal-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  function openModal() {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('cal-date').value        = today;
    document.getElementById('cal-start').value       = '09:00';
    document.getElementById('cal-end').value         = '10:00';
    document.getElementById('cal-title').value       = '';
    document.getElementById('cal-location').value    = '';
    document.getElementById('cal-description').value = '';
    document.getElementById('cal-form-error').classList.add('hidden');
    modal.classList.remove('hidden');
    document.getElementById('cal-title').focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl   = document.getElementById('cal-form-error');
    const saveBtn = document.getElementById('cal-save-btn');
    errEl.classList.add('hidden');

    const title = document.getElementById('cal-title').value.trim();
    const date  = document.getElementById('cal-date').value;
    const start = document.getElementById('cal-start').value;
    const end   = document.getElementById('cal-end').value;

    if (!title || !date || !start || !end) {
      errEl.textContent = 'Title, date, and times are required.';
      errEl.classList.remove('hidden');
      return;
    }

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Creating…';

    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/calendar/events', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          title,
          startDateTime: `${date}T${start}:00`,
          endDateTime:   `${date}T${end}:00`,
          location:      document.getElementById('cal-location').value.trim(),
          description:   document.getElementById('cal-description').value.trim(),
          timeZone:      TZ,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Utils.toast('Event created.', 'success');
      closeModal();
      load();
    } catch (err) {
      errEl.textContent = err.message || 'Failed to create event.';
      errEl.classList.remove('hidden');
    } finally {
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Create Event';
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────────

  currentView = 'week';
  setActiveTab(currentView);

  load();

})();
