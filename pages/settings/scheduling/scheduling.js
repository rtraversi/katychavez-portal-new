'use strict';

// Settings → Scheduling. All booking knobs are staff-editable here
// (settings-first principle): consultation types + which attorney offers
// them, bookable-attorney profiles + per-attorney hours, and the firm-wide
// booking window. RLS (can_write('scheduling')) enforces who can save.
(async function SchedulingSettings() {

  const root = document.getElementById('sched-root');
  const esc  = Utils.esc;

  const DAYS = [
    { d: 1, label: 'Mon' }, { d: 2, label: 'Tue' }, { d: 3, label: 'Wed' },
    { d: 4, label: 'Thu' }, { d: 5, label: 'Fri' }, { d: 6, label: 'Sat' }, { d: 0, label: 'Sun' },
  ];
  const TIMEZONES = [
    'America/Chicago', 'America/New_York', 'America/Denver', 'America/Phoenix',
    'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  ];

  // ── State ──────────────────────────────────────────────────────────────────
  let consultTypes = [];   // consult_types rows
  let providers    = [];   // consult_type_providers rows
  let profiles     = [];   // booking_provider_profiles rows
  let rules        = [];   // availability_rules rows
  let settings     = null; // booking_settings row
  let staffUsers   = [];   // portal users eligible to become bookable
  let editingTypeId = null;    // consult_types.id being edited, '' = new
  let editingProfileId = null; // booking_provider_profiles.user_id being edited, '' = new
  let moduleEnabled = false;   // scheduling in enabled_modules? drives the "live" chip + preview

  // ── Load ───────────────────────────────────────────────────────────────────
  async function load() {
    const [ct, ctp, prof, ar, st, users, mod] = await Promise.all([
      db.from('consult_types').select('*').order('sort_order'),
      db.from('consult_type_providers').select('*'),
      db.from('booking_provider_profiles').select('*').order('sort_order'),
      db.from('availability_rules').select('*').order('day_of_week'),
      db.from('booking_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('users').select('id, first_name, last_name, active, roles(name)').eq('active', true).order('first_name'),
      db.from('enabled_modules').select('module_key').eq('module_key', 'scheduling').maybeSingle(),
    ]);
    consultTypes = ct.data   || [];
    providers    = ctp.data  || [];
    profiles     = prof.data || [];
    rules        = ar.data   || [];
    settings     = st.data   || {
      id: 1, timezone: 'America/Chicago', min_lead_hours: 24, max_days_out: 30,
      slot_granularity_min: 30, default_hours: {}, reminders_enabled: true, reminder_hours_before: 24,
    };
    staffUsers   = (users.data || []).filter(u => u.roles?.name !== 'Client');
    moduleEnabled = !!mod.data;
    Utils[mod.data ? 'hide' : 'show'](document.getElementById('sched-disabled-note'));
    render();
  }

  // ── Docket-kit helpers ──────────────────────────────────────────────────────
  const initialsOf = (name) => String(name || '').trim().split(/\s+/).slice(0, 2)
    .map(w => w[0] || '').join('').toUpperCase() || '—';
  // Deterministic avatar hue from an id — same person, same color across the page.
  const AV_COLORS = ['#2f6db0', '#5b7d3a', '#8a5a9b', '#93402f', '#22757c', '#b06f14', '#3a6ea5'];
  const avatarColor = (id) => {
    const s = String(id); let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  };
  const brandColor = () =>
    /^#[0-9a-fA-F]{6}$/.test(settings.brand_color || '') ? settings.brand_color : '#1a3a5c';
  // Which weekdays an attorney is bookable — their custom rules, else firm default.
  const attorneyDays = (userId) => {
    const own = rules.filter(r => r.user_id === userId);
    return own.length
      ? new Set(own.map(r => r.day_of_week))
      : new Set(Object.keys(settings.default_hours || {}).map(Number));
  };
  const weekStrip = (userId) => {
    const days = attorneyDays(userId);
    return `<div class="dk-week">${DAYS.map(({ d, label }) =>
      `<div class="dk-wd${days.has(d) ? ' on' : ''}"><span>${label[0]}</span><i></i></div>`).join('')}</div>`;
  };

  const userName = (id) => {
    const u = staffUsers.find(x => x.id === id);
    return u ? Utils.fullName(u) : '(unknown user)';
  };
  const feeLabel = (t) => {
    if (t.price_cents > 0) {
      const amt = '$' + (t.price_cents / 100).toFixed(t.price_cents % 100 === 0 ? 0 : 2);
      return t.fee_type === 'reduced' ? amt + ' special rate' : amt;
    }
    return t.fee_type === 'free' ? 'Free' : Utils.titleCase(t.fee_type);
  };
  const slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    root.innerHTML = [
      renderDeskChips(),
      '<div class="dk-cols">',
        '<div>',
          renderTypes(),
          renderAttorneys(),
          renderWindow(),
        '</div>',
        '<aside class="dk-rail">',
          renderPreview(),
          renderBookingLink(),
        '</aside>',
      '</div>',
    ].join('');
    wire();
  }

  // ---- Desk chips: at-a-glance status --------------------------------------
  function renderDeskChips() {
    const bookable = consultTypes.filter(t => t.is_active !== false && t.public_bookable !== false).length;
    const attCount = profiles.filter(p => p.is_bookable !== false).length;
    const live = moduleEnabled
      ? '<span class="dk-chip is-live static"><span class="beat"></span> Booking is live</span>'
      : '<span class="dk-chip is-warn static">Offline — module not enabled</span>';
    return `<div class="dk-deskbar">
      ${live}
      <button type="button" class="dk-chip" data-jump="dk-sec-types"><span class="n">${bookable}</span> bookable online</button>
      <button type="button" class="dk-chip" data-jump="dk-sec-attorneys"><span class="n">${attCount}</span> ${attCount === 1 ? 'attorney' : 'attorneys'}</button>
      <span class="dk-chip static">${esc(settings.timezone || 'America/Chicago')}</span>
    </div>`;
  }

  // ---- Docket rail: LIVE preview of the public /book page -------------------
  function renderPreview() {
    const firm = (window.APP_CONFIG && window.APP_CONFIG.firmName) || 'Your firm';
    const bookables = profiles.filter(p => p.is_bookable !== false).slice(0, 3);
    const logo = settings.logo_url
      ? `<img src="${esc(settings.logo_url)}" alt="">`
      : `<span>${esc((firm.trim()[0] || 'B').toUpperCase())}</span>`;
    const atts = bookables.length
      ? bookables.map(pr => `<div class="dk-bf-att">
          <span class="dk-avatar" style="width:30px;height:30px;font-size:12px;background:${avatarColor(pr.user_id)}">${initialsOf(pr.display_name)}</span>
          <div><b>${esc(pr.display_name)}</b><span>${esc(pr.blurb || 'Attorney')}</span></div>
          <span class="pick">Select</span></div>`).join('')
      : '<p style="font-size:12px;color:var(--ink-faint);margin:0">No bookable attorneys yet — add one to populate the page.</p>';
    return `<div style="margin-bottom:26px">
      <div class="dk-rail-cap"><span class="live">●</span> Live preview · what prospects see</div>
      <div class="dk-bookframe" style="--dk-brand:${brandColor()}">
        <div class="dk-bf-top"><i></i><i></i><i></i></div>
        <div class="dk-bf-hero"><div class="dk-bf-logo">${logo}</div>
          <h4>Book with ${esc(firm)}</h4><p>Choose an attorney to see available times</p></div>
        <div class="dk-bf-body"><div class="dk-bf-lbl">Available attorneys</div>${atts}</div>
      </div>
      <p class="dk-rail-hint">Reflects your logo, brand color, and who's bookable. Save the settings below and this updates.</p>
    </div>`;
  }

  // ---- Docket rail: booking link + web-builder snippet ---------------------
  function renderBookingLink() {
    const url = `${window.location.origin}/book`;
    const snippet =
`<a href="${url}" target="_blank" rel="noopener"
   style="display:inline-block;padding:12px 24px;background:${brandColor()};color:#ffffff;
          text-decoration:none;border-radius:6px;font-weight:600;
          font-family:Arial,sans-serif;font-size:15px">
  Book a Consultation
</a>`;
    return `<div>
      <div class="dk-rail-cap">Your booking page</div>
      <div style="display:flex;gap:var(--space-2);align-items:center;margin-bottom:var(--space-2)">
        <input class="field-input" readonly value="${esc(url)}" style="flex:1;min-width:0" id="bk-url">
        <button class="btn btn--secondary btn--sm" data-copy="bk-url" type="button">Copy</button>
      </div>
      <a class="btn btn--secondary btn--sm" href="${esc(url)}" target="_blank" rel="noopener"
         style="width:100%;justify-content:center;margin-bottom:var(--space-3)">Open booking page ↗</a>
      <details>
        <summary style="font-size:12.5px;color:var(--color-text-muted);cursor:pointer;font-weight:600">
          Website button snippet
        </summary>
        <p style="font-size:12px;color:var(--color-text-light);margin:6px 0 8px;line-height:1.5">
          Give this to whoever manages the firm's website — they paste it anywhere and it just works.
        </p>
        <textarea class="field-input" id="bk-snippet" rows="6" readonly
          style="font-family:monospace;font-size:11px;resize:vertical">${esc(snippet)}</textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:var(--space-2)">
          <button class="btn btn--secondary btn--sm" data-copy="bk-snippet" type="button">Copy snippet</button>
        </div>
      </details>
    </div>`;
  }

  // ---- Section: consultation register ----------------------------------------
  function renderTypes() {
    const rows = consultTypes.map(t => {
      const own = providers.filter(p => p.consult_type_id === t.id);
      const avatars = own.map(p => {
        const pr = profiles.find(x => x.user_id === p.user_id);
        const nm = pr?.display_name || userName(p.user_id);
        return `<span class="dk-avatar" style="width:24px;height:24px;font-size:10px;background:${avatarColor(p.user_id)}" title="${esc(nm)}">${initialsOf(nm)}</span>`;
      }).join('');
      const tags = [
        t.is_active === false ? '<span class="dk-tag mut">Inactive</span>' : '',
        t.public_bookable === false ? '<span class="dk-tag warn" title="Never shown on the public booking page — offered by staff only">Staff-offered only</span>' : '',
      ].join(' ');
      return `<div class="dk-reg-row">
        <div>
          <div class="dk-reg-title">${esc(t.name)} ${tags}</div>
          <div class="dk-reg-meta">
            <span>${t.duration_min} min</span><span class="sep">·</span>
            <span class="fee">${esc(feeLabel(t))}</span>
            ${t.buffer_before_min || t.buffer_after_min ? `<span class="sep">·</span><span>buffer ${t.buffer_before_min}/${t.buffer_after_min} min</span>` : ''}
            <span class="sep">·</span>
            ${own.length ? `<span>Offered by</span><span class="dk-stack">${avatars}</span>` : '<span class="danger">no attorney attached</span>'}
          </div>
        </div>
        <div class="dk-reg-act">
          <button class="dk-linkbtn" data-edit-type="${t.id}" type="button">Edit</button>
          <button class="dk-linkbtn d" data-del-type="${t.id}" type="button">Delete</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="dk-sec" id="dk-sec-types">
      <div class="dk-sec-head">
        <h2>Consultation register</h2><span class="dk-sec-rule"></span>
        <button class="dk-sec-add" id="ct-add" type="button">＋ Add type</button>
      </div>
      <div id="ct-list">${rows ? `<div class="dk-register">${rows}</div>` : '<div class="dk-empty">No consultation types yet — add the first one.</div>'}</div>
      <div id="ct-form-slot"></div>
    </div>`;
  }

  function typeFormHtml(t) {
    const isNew = !t.id;
    const offered = new Set(providers.filter(p => p.consult_type_id === t.id).map(p => p.user_id));
    const attorneyChecks = profiles.length
      ? profiles.map(pr => `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:var(--space-4);font-size:var(--text-sm)">
          <input type="checkbox" data-ct-provider value="${pr.user_id}" ${offered.has(pr.user_id) ? 'checked' : ''}>
          ${esc(pr.display_name)}</label>`).join('')
      : '<span style="font-size:var(--text-sm);color:var(--color-text-muted)">Add a bookable attorney below first — then attach them here.</span>';

    return `<form id="ct-form" style="background:var(--color-bg-subtle,#f9fafb);border:1px solid var(--color-border);border-radius:var(--radius,8px);padding:var(--space-4);margin-top:var(--space-3)">
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end">
        <div class="field field-stack" style="flex:2;min-width:200px">
          <label class="field-label">Name</label>
          <input class="field-input" id="ctf-name" maxlength="120" value="${esc(t.name || '')}" required>
        </div>
        <div class="field field-stack" style="flex:1;min-width:110px">
          <label class="field-label">Duration (min)</label>
          <input class="field-input" id="ctf-duration" type="number" min="5" max="480" value="${t.duration_min ?? 30}">
        </div>
      </div>
      <div class="field field-stack">
        <label class="field-label">Description (shown on the booking page)</label>
        <input class="field-input" id="ctf-desc" maxlength="300" value="${esc(t.description || '')}">
      </div>
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end">
        <div class="field field-stack" style="flex:1;min-width:130px">
          <label class="field-label">Fee type</label>
          <select class="field-input" id="ctf-fee">
            <option value="free" ${t.fee_type === 'free' ? 'selected' : ''}>Free</option>
            <option value="paid" ${t.fee_type === 'paid' ? 'selected' : ''}>Paid</option>
            <option value="reduced" ${t.fee_type === 'reduced' ? 'selected' : ''}>Special rate</option>
          </select>
        </div>
        <div class="field field-stack" style="flex:1;min-width:110px">
          <label class="field-label">Price ($)</label>
          <input class="field-input" id="ctf-price" type="number" min="0" step="0.01" value="${((t.price_cents || 0) / 100).toFixed(2)}">
        </div>
        <div class="field field-stack" style="flex:1;min-width:150px">
          <label class="field-label">Buffer before (min)</label>
          <input class="field-input" id="ctf-buf-before" type="number" min="0" max="240" value="${t.buffer_before_min ?? 0}">
        </div>
        <div class="field field-stack" style="flex:1;min-width:110px">
          <label class="field-label">Buffer after (min)</label>
          <input class="field-input" id="ctf-buf-after" type="number" min="0" max="240" value="${t.buffer_after_min ?? 0}">
        </div>
        <div class="field field-stack" style="flex:1;min-width:90px">
          <label class="field-label">Sort</label>
          <input class="field-input" id="ctf-sort" type="number" value="${t.sort_order ?? 100}">
        </div>
      </div>
      <div class="field field-stack">
        <label class="field-label">Offered by</label>
        <div>${attorneyChecks}</div>
      </div>
      <div style="display:flex;gap:var(--space-5);flex-wrap:wrap;margin:var(--space-3) 0">
        <label style="display:inline-flex;align-items:center;gap:9px;font-size:var(--text-sm)">
          <span class="dk-toggle"><input type="checkbox" id="ctf-active" ${t.is_active !== false ? 'checked' : ''}><span class="dk-toggle-track"></span></span> Active
        </label>
        <label style="display:inline-flex;align-items:center;gap:9px;font-size:var(--text-sm)" title="Off = staff-offered only: the type never appears on the public booking page — you offer it to a prospect yourselves.">
          <span class="dk-toggle"><input type="checkbox" id="ctf-public" ${t.public_bookable !== false ? 'checked' : ''}><span class="dk-toggle-track"></span></span> Prospects can book this online
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-2)">
        <button class="btn btn--secondary" type="button" id="ctf-cancel">Cancel</button>
        <button class="btn btn--primary" type="submit">${isNew ? 'Add type' : 'Save type'}</button>
      </div>
    </form>`;
  }

  async function saveType(e) {
    e.preventDefault();
    const name = document.getElementById('ctf-name').value.trim();
    if (!name) return Utils.toast('Name is required.', 'error');
    const row = {
      name,
      description:       document.getElementById('ctf-desc').value.trim() || null,
      duration_min:      Math.max(5, parseInt(document.getElementById('ctf-duration').value, 10) || 30),
      fee_type:          document.getElementById('ctf-fee').value,
      price_cents:       Math.max(0, Math.round(parseFloat(document.getElementById('ctf-price').value || '0') * 100)),
      buffer_before_min: Math.max(0, parseInt(document.getElementById('ctf-buf-before').value, 10) || 0),
      buffer_after_min:  Math.max(0, parseInt(document.getElementById('ctf-buf-after').value, 10) || 0),
      sort_order:        parseInt(document.getElementById('ctf-sort').value, 10) || 100,
      is_active:         document.getElementById('ctf-active').checked,
      public_bookable:   document.getElementById('ctf-public').checked,
    };
    const providerIds = Utils.qsa('[data-ct-provider]:checked').map(el => el.value);
    try {
      let typeId = editingTypeId;
      if (typeId) {
        const { error } = await db.from('consult_types').update(row).eq('id', typeId);
        if (error) throw error;
      } else {
        const { data, error } = await db.from('consult_types').insert(row).select('id').single();
        if (error) throw error;
        typeId = data.id;
      }
      // Replace the offered-by set wholesale (small table, simplest correct form).
      const { error: delErr } = await db.from('consult_type_providers').delete().eq('consult_type_id', typeId);
      if (delErr) throw delErr;
      if (providerIds.length) {
        const { error: insErr } = await db.from('consult_type_providers')
          .insert(providerIds.map(uid => ({ consult_type_id: typeId, user_id: uid })));
        if (insErr) throw insErr;
      }
      Utils.toast('Consultation type saved.', 'success');
      editingTypeId = null;
      await load();
    } catch (err) { Utils.handleError(err, 'scheduling-settings'); }
  }

  async function deleteType(id) {
    const t = consultTypes.find(x => x.id === id);
    if (!await Utils.confirm(`Delete "${t?.name || 'this type'}"? Existing appointments keep their history.`, { danger: true, confirmLabel: 'Delete' })) return;
    try {
      const { error } = await db.from('consult_types').delete().eq('id', id);
      if (error) throw error;
      Utils.toast('Deleted.', 'success');
      await load();
    } catch (err) {
      // FK from appointments blocks deletion once booked — deactivate instead.
      if (String(err.message || '').includes('violates foreign key')) {
        Utils.toast('This type has appointments — deactivate it instead of deleting.', 'error');
      } else Utils.handleError(err, 'scheduling-settings');
    }
  }

  // ---- Section: bookable attorneys (roster) ----------------------------------
  function renderAttorneys() {
    const rows = profiles.map(pr => {
      const userRules = rules.filter(r => r.user_id === pr.user_id);
      return `<div class="dk-att">
        <span class="dk-avatar" style="width:42px;height:42px;font-size:15px;background:${avatarColor(pr.user_id)}">${initialsOf(pr.display_name)}</span>
        <div class="who">
          <b>${esc(pr.display_name)}</b>${pr.is_bookable === false ? ' <span class="dk-tag mut">Hidden</span>' : ''}
          <div class="slug"><code>/book/${esc(pr.slug)}</code> · ${userRules.length ? 'custom hours' : 'firm default hours'} · ${esc(userName(pr.user_id))}</div>
        </div>
        ${weekStrip(pr.user_id)}
        <div class="dk-reg-act">
          <button class="dk-linkbtn" data-edit-prof="${pr.user_id}" type="button">Edit</button>
          <button class="dk-linkbtn d" data-del-prof="${pr.user_id}" type="button">Remove</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="dk-sec" id="dk-sec-attorneys">
      <div class="dk-sec-head">
        <h2>Bookable attorneys</h2><span class="dk-sec-rule"></span>
        <button class="dk-sec-add" id="pr-add" type="button">＋ Add attorney</button>
      </div>
      <p class="dk-sub" style="margin:0 0 16px;font-size:13.5px">
        Who appears as a "Book with…" choice on the public page. <strong>Each attorney must connect their
        calendar in Settings → Calendar Sync</strong> — without it their page shows no times.
      </p>
      <div id="pr-list">${rows ? `<div class="dk-roster">${rows}</div>` : '<div class="dk-empty">No bookable attorneys yet.</div>'}</div>
      <div id="pr-form-slot"></div>
    </div>`;
  }

  function hoursEditorHtml(prefix, windows) {
    // windows: { dayOfWeek: [ [start, end] ] } — UI edits the first window per day.
    return `<div class="dk-hours">${DAYS.map(({ d, label }) => {
      const w = (windows[d] || [])[0];
      return `<div class="dk-hours-row">
        <label class="dk-toggle"><input type="checkbox" data-${prefix}-day="${d}" ${w ? 'checked' : ''}><span class="dk-toggle-track"></span></label>
        <span class="dk-hours-day">${label}</span>
        <input class="field-input" type="time" data-${prefix}-start="${d}" value="${w ? w[0] : '09:00'}">
        <span class="dk-hours-to">to</span>
        <input class="field-input" type="time" data-${prefix}-end="${d}" value="${w ? w[1] : '17:00'}">
      </div>`;
    }).join('')}</div>`;
  }

  function readHoursEditor(prefix) {
    const out = {};
    for (const { d } of DAYS) {
      const on = Utils.qs(`[data-${prefix}-day="${d}"]`)?.checked;
      if (!on) continue;
      const start = Utils.qs(`[data-${prefix}-start="${d}"]`)?.value;
      const end   = Utils.qs(`[data-${prefix}-end="${d}"]`)?.value;
      if (!start || !end) continue;
      if (start >= end) throw new Error(`${DAYS.find(x => x.d === d).label}: start must be before end.`);
      out[d] = [[start, end]];
    }
    return out;
  }

  function profileFormHtml(pr) {
    const isNew = !pr.user_id;
    const taken = new Set(profiles.map(p => p.user_id));
    const userOptions = staffUsers
      .filter(u => isNew ? !taken.has(u.id) : true)
      .map(u => `<option value="${u.id}" ${u.id === pr.user_id ? 'selected' : ''}>${esc(Utils.fullName(u))} (${esc(u.roles?.name || '')})</option>`)
      .join('');
    const userRules = rules.filter(r => r.user_id === pr.user_id);
    const windows = {};
    userRules.forEach(r => { (windows[r.day_of_week] ||= []).push([r.start_time.slice(0, 5), r.end_time.slice(0, 5)]); });

    return `<form id="pr-form" style="background:var(--color-bg-subtle,#f9fafb);border:1px solid var(--color-border);border-radius:var(--radius,8px);padding:var(--space-4);margin-top:var(--space-3)">
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end">
        <div class="field field-stack" style="flex:1;min-width:200px">
          <label class="field-label">Portal user</label>
          <select class="field-input" id="prf-user" ${isNew ? '' : 'disabled'}>
            ${isNew ? '<option value="">Select…</option>' : ''}${userOptions}
          </select>
        </div>
        <div class="field field-stack" style="flex:1;min-width:180px">
          <label class="field-label">Display name (public)</label>
          <input class="field-input" id="prf-name" maxlength="120" value="${esc(pr.display_name || '')}">
        </div>
        <div class="field field-stack" style="flex:1;min-width:140px">
          <label class="field-label">Slug (in the booking URL)</label>
          <input class="field-input" id="prf-slug" maxlength="60" value="${esc(pr.slug || '')}" placeholder="auto from name">
        </div>
      </div>
      <div class="field field-stack">
        <label class="field-label">Short blurb (shown under their name on the booking page)</label>
        <input class="field-input" id="prf-blurb" maxlength="240" value="${esc(pr.blurb || '')}">
      </div>
      <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end">
        <div class="field field-stack" style="flex:2;min-width:220px">
          <label class="field-label">Photo URL (optional — the attorney's account photo is used automatically; set this only to override it)</label>
          <input class="field-input" id="prf-photo" maxlength="500" value="${esc(pr.photo_url || '')}">
        </div>
        <div class="field field-stack" style="flex:1;min-width:90px">
          <label class="field-label">Sort</label>
          <input class="field-input" id="prf-sort" type="number" value="${pr.sort_order ?? 100}">
        </div>
      </div>
      <label style="display:inline-flex;align-items:center;gap:9px;font-size:var(--text-sm);margin:var(--space-3) 0">
        <span class="dk-toggle"><input type="checkbox" id="prf-bookable" ${pr.is_bookable !== false ? 'checked' : ''}><span class="dk-toggle-track"></span></span> Visible on the public booking page
      </label>
      <div class="field field-stack" style="margin-top:var(--space-2)">
        <label style="display:inline-flex;align-items:center;gap:9px;font-size:var(--text-sm);margin-bottom:var(--space-2)">
          <span class="dk-toggle"><input type="checkbox" id="prf-custom-hours" ${userRules.length ? 'checked' : ''}><span class="dk-toggle-track"></span></span> Custom hours (otherwise the firm default below applies)
        </label>
        <div id="prf-hours" class="${userRules.length ? '' : 'hidden'}">${hoursEditorHtml('prf', windows)}</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-3)">
        <button class="btn btn--secondary" type="button" id="prf-cancel">Cancel</button>
        <button class="btn btn--primary" type="submit">${isNew ? 'Add attorney' : 'Save attorney'}</button>
      </div>
    </form>`;
  }

  async function saveProfile(e) {
    e.preventDefault();
    const isNew  = !editingProfileId;
    const userId = isNew ? document.getElementById('prf-user').value : editingProfileId;
    if (!userId) return Utils.toast('Pick a portal user.', 'error');
    const displayName = document.getElementById('prf-name').value.trim()
      || Utils.fullName(staffUsers.find(u => u.id === userId));
    const slug = slugify(document.getElementById('prf-slug').value || displayName);
    if (!slug) return Utils.toast('Slug is required.', 'error');

    const row = {
      user_id:      userId,
      slug,
      display_name: displayName,
      blurb:        document.getElementById('prf-blurb').value.trim() || null,
      photo_url:    document.getElementById('prf-photo').value.trim() || null,
      sort_order:   parseInt(document.getElementById('prf-sort').value, 10) || 100,
      is_bookable:  document.getElementById('prf-bookable').checked,
    };

    let hours = null;
    if (document.getElementById('prf-custom-hours').checked) {
      try { hours = readHoursEditor('prf'); }
      catch (err) { return Utils.toast(err.message, 'error'); }
    }

    try {
      const { error } = await db.from('booking_provider_profiles').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      // Replace this attorney's availability_rules wholesale.
      const { error: delErr } = await db.from('availability_rules').delete().eq('user_id', userId);
      if (delErr) throw delErr;
      if (hours) {
        const inserts = [];
        for (const [d, wins] of Object.entries(hours)) {
          for (const [start, end] of wins) {
            inserts.push({ user_id: userId, day_of_week: +d, start_time: start, end_time: end });
          }
        }
        if (inserts.length) {
          const { error: insErr } = await db.from('availability_rules').insert(inserts);
          if (insErr) throw insErr;
        }
      }
      Utils.toast('Attorney saved.', 'success');
      editingProfileId = null;
      await load();
    } catch (err) {
      if (String(err.message || '').includes('duplicate key') && String(err.message).includes('slug')) {
        Utils.toast('That slug is already used by another attorney.', 'error');
      } else Utils.handleError(err, 'scheduling-settings');
    }
  }

  async function deleteProfile(userId) {
    const pr = profiles.find(p => p.user_id === userId);
    if (!await Utils.confirm(`Remove "${pr?.display_name}" from online booking? Their appointments are kept.`, { danger: true, confirmLabel: 'Remove' })) return;
    try {
      const { error } = await db.from('booking_provider_profiles').delete().eq('user_id', userId);
      if (error) throw error;
      await db.from('availability_rules').delete().eq('user_id', userId);
      Utils.toast('Removed.', 'success');
      await load();
    } catch (err) { Utils.handleError(err, 'scheduling-settings'); }
  }

  // ---- Card 4: booking window + firm default hours ----------------------------
  function renderWindow() {
    const s = settings;
    const windows = {};
    for (const [d, wins] of Object.entries(s.default_hours || {})) windows[+d] = wins;
    return `<div class="dk-sec" style="margin-bottom:0">
      <div class="dk-sec-head"><h2>Booking window &amp; hours</h2><span class="dk-sec-rule"></span></div>
      <div class="card">
      <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3);line-height:1.6">
        Firm-wide rules for the public page. Attorneys without custom hours use the default hours below.
      </p>
      <form id="bw-form">
        <div class="dk-fieldrow lead">
          <div class="field field-stack">
            <label class="field-label">Timezone</label>
            <select class="field-input" id="bw-tz">
              ${TIMEZONES.map(tz => `<option value="${tz}" ${tz === s.timezone ? 'selected' : ''}>${tz}</option>`).join('')}
            </select>
          </div>
          <div class="field field-stack">
            <label class="field-label">Min notice (hours)</label>
            <input class="field-input" id="bw-lead" type="number" min="0" max="336" value="${s.min_lead_hours}">
          </div>
          <div class="field field-stack">
            <label class="field-label">Book up to (days out)</label>
            <input class="field-input" id="bw-maxout" type="number" min="1" max="180" value="${s.max_days_out}">
          </div>
          <div class="field field-stack">
            <label class="field-label">Slot step (minutes)</label>
            <select class="field-input" id="bw-gran">
              ${[15, 30, 60].map(g => `<option value="${g}" ${g === s.slot_granularity_min ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field field-stack" style="margin-top:var(--space-4)">
          <label class="field-label">Default working hours</label>
          ${hoursEditorHtml('bw', windows)}
        </div>
        <div style="display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap;margin-top:var(--space-4)">
          <label style="display:inline-flex;align-items:center;gap:9px;font-size:var(--text-sm)">
            <span class="dk-toggle"><input type="checkbox" id="bw-reminders" ${s.reminders_enabled ? 'checked' : ''}><span class="dk-toggle-track"></span></span>
            Send reminder emails to prospects
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:var(--text-sm)">
            <input class="field-input" id="bw-rem-hours" type="number" min="1" max="168" value="${s.reminder_hours_before}" style="width:80px">
            hours before the appointment
          </label>
        </div>
        <div class="dk-fieldrow" style="grid-template-columns:2.4fr 1fr;margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--color-border)">
          <div class="field field-stack">
            <label class="field-label">Booking page logo URL (optional — an image on this portal, e.g. an uploaded file)</label>
            <input class="field-input" id="bw-logo" maxlength="500" value="${esc(s.logo_url || '')}" placeholder="/images/firm-logo.png">
          </div>
          <div class="field field-stack">
            <label class="field-label">Booking page color</label>
            <div style="display:flex;gap:var(--space-2);align-items:center">
              <input id="bw-color" type="color" value="${/^#[0-9a-fA-F]{6}$/.test(s.brand_color || '') ? s.brand_color : '#1a3a5c'}" style="width:44px;height:34px;padding:2px;border:1px solid var(--color-border);border-radius:var(--radius-md,6px);background:#fff;cursor:pointer">
              <span style="font-size:var(--text-xs);color:var(--color-text-muted)">header &amp; buttons on /book</span>
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:var(--space-4)">
          <button class="btn btn--primary" type="submit">Save booking settings</button>
        </div>
      </form>
      </div>
    </div>`;
  }

  async function saveWindow(e) {
    e.preventDefault();
    let defaultHours;
    try { defaultHours = readHoursEditor('bw'); }
    catch (err) { return Utils.toast(err.message, 'error'); }
    const row = {
      id: 1,
      timezone:              document.getElementById('bw-tz').value,
      min_lead_hours:        Math.max(0, parseInt(document.getElementById('bw-lead').value, 10) || 0),
      max_days_out:          Math.max(1, parseInt(document.getElementById('bw-maxout').value, 10) || 30),
      slot_granularity_min:  parseInt(document.getElementById('bw-gran').value, 10) || 30,
      default_hours:         defaultHours,
      reminders_enabled:     document.getElementById('bw-reminders').checked,
      reminder_hours_before: Math.max(1, parseInt(document.getElementById('bw-rem-hours').value, 10) || 24),
      logo_url:              document.getElementById('bw-logo').value.trim() || null,
      brand_color:           document.getElementById('bw-color').value,
    };
    try {
      const { error } = await db.from('booking_settings').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      Utils.toast('Booking settings saved.', 'success');
      await load();
    } catch (err) { Utils.handleError(err, 'scheduling-settings'); }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  function wire() {
    Utils.qsa('[data-copy]').forEach(btn => btn.addEventListener('click', () => {
      const el = document.getElementById(btn.dataset.copy);
      navigator.clipboard.writeText(el.value).then(
        () => Utils.toast('Copied to clipboard.', 'success'),
        () => { el.select(); Utils.toast('Press Ctrl+C to copy.', 'info'); },
      );
    }));

    document.getElementById('ct-add')?.addEventListener('click', () => openTypeForm(''));
    Utils.qsa('[data-edit-type]').forEach(b => b.addEventListener('click', () => openTypeForm(b.dataset.editType)));
    Utils.qsa('[data-del-type]').forEach(b => b.addEventListener('click', () => deleteType(b.dataset.delType)));

    document.getElementById('pr-add')?.addEventListener('click', () => openProfileForm(''));
    Utils.qsa('[data-edit-prof]').forEach(b => b.addEventListener('click', () => openProfileForm(b.dataset.editProf)));
    Utils.qsa('[data-del-prof]').forEach(b => b.addEventListener('click', () => deleteProfile(b.dataset.delProf)));

    document.getElementById('bw-form')?.addEventListener('submit', saveWindow);

    // Desk chips jump to their section
    Utils.qsa('[data-jump]').forEach(c => c.addEventListener('click', () => {
      document.getElementById(c.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function openTypeForm(id) {
    editingTypeId = id;
    const t = consultTypes.find(x => x.id === id) || {};
    document.getElementById('ct-form-slot').innerHTML = typeFormHtml(t);
    document.getElementById('ct-form').addEventListener('submit', saveType);
    document.getElementById('ctf-cancel').addEventListener('click', () => {
      editingTypeId = null;
      document.getElementById('ct-form-slot').innerHTML = '';
    });
    document.getElementById('ctf-name').focus();
  }

  function openProfileForm(userId) {
    editingProfileId = userId;
    const pr = profiles.find(x => x.user_id === userId) || {};
    document.getElementById('pr-form-slot').innerHTML = profileFormHtml(pr);
    document.getElementById('pr-form').addEventListener('submit', saveProfile);
    document.getElementById('prf-cancel').addEventListener('click', () => {
      editingProfileId = null;
      document.getElementById('pr-form-slot').innerHTML = '';
    });
    document.getElementById('prf-custom-hours').addEventListener('change', (e) => {
      document.getElementById('prf-hours').classList.toggle('hidden', !e.target.checked);
    });
    // Auto-suggest slug + display name from the picked user.
    document.getElementById('prf-user')?.addEventListener('change', (e) => {
      const u = staffUsers.find(x => x.id === e.target.value);
      if (!u) return;
      const nameEl = document.getElementById('prf-name');
      const slugEl = document.getElementById('prf-slug');
      if (!nameEl.value.trim()) nameEl.value = Utils.fullName(u);
      if (!slugEl.value.trim()) slugEl.value = slugify(u.first_name || Utils.fullName(u));
    });
  }

  await load();
})();
