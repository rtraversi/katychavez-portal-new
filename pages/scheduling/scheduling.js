'use strict';

// Scheduling → Appointments. Lists consults booked through the public page.
// Status flips (completed / no-show / mark-paid) are direct RLS writes;
// cancel and send-payment-link go through /api/booking/staff/* because they
// touch the attorney's calendar / the payment provider.
(async function AppointmentsPage() {

  const list    = document.getElementById('appt-list');
  const tabsEl  = document.getElementById('appt-tabs');
  const countEl = document.getElementById('appt-count');
  const esc     = Utils.esc;

  let appointments = [];
  let timezone     = 'America/Chicago';
  let activeTab    = 'upcoming';

  const TABS = [
    { key: 'upcoming',  label: 'Upcoming'  },
    { key: 'past',      label: 'Past'      },
    { key: 'cancelled', label: 'Cancelled' },
    { key: 'all',       label: 'All'       },
  ];

  // Status → Docket tag kind (see .dk-tag.* in portal.css).
  const STATUS_TAG = {
    booked:    ['Booked',    'acc'],
    completed: ['Completed', 'ok'],
    no_show:   ['No-show',   'warn'],
    cancelled: ['Cancelled', 'mut'],
  };

  // Group heading (calendar day, in the firm's timezone) + a per-row time.
  function dayKey(iso) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
  }
  function dayHeading(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(iso));
  }
  function timeText(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  }

  async function apiPost(path, payload) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  async function load() {
    const [{ data: appts, error }, { data: settings }] = await Promise.all([
      db.from('appointments')
        .select('*, consult_types(name, fee_type, price_cents), attorney:users(first_name, last_name), case_types(name)')
        .order('starts_at', { ascending: false }),
      db.from('booking_settings').select('timezone').eq('id', 1).maybeSingle(),
    ]);
    if (error) { list.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">${esc(error.message)}</div>`; return; }
    appointments = appts || [];
    timezone = settings?.timezone || timezone;
    render();
  }

  function filtered() {
    const now = Date.now();
    switch (activeTab) {
      case 'upcoming':  return appointments.filter(a => a.status === 'booked' && new Date(a.starts_at).getTime() >= now)
                                            .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      case 'past':      return appointments.filter(a => a.status !== 'cancelled' && new Date(a.starts_at).getTime() < now);
      case 'cancelled': return appointments.filter(a => a.status === 'cancelled');
      default:          return appointments;
    }
  }

  function render() {
    tabsEl.innerHTML = TABS.map(t => {
      const on = t.key === activeTab;
      return `<button class="appt-tab" data-tab="${t.key}" type="button" style="padding:6px 15px;border-radius:999px;border:1px solid var(--line);background:${on ? 'var(--daily-tint)' : 'var(--surface)'};color:${on ? 'var(--daily)' : 'var(--ink-soft)'};font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-sans)">${t.label}</button>`;
    }).join('');
    Utils.qsa('[data-tab]', tabsEl).forEach(b => b.addEventListener('click', () => { activeTab = b.dataset.tab; render(); }));

    const rows = filtered();
    countEl.textContent = `${rows.length} appointment${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      list.innerHTML = '<div class="dk-empty">Nothing here yet. Appointments booked on your public page appear automatically.</div>';
      return;
    }

    // Group rows by calendar day (order within each group is preserved from filtered()).
    const groups = [];
    const byKey = {};
    for (const a of rows) {
      const key = dayKey(a.starts_at);
      if (!(key in byKey)) { byKey[key] = groups.length; groups.push({ heading: dayHeading(a.starts_at), items: [] }); }
      groups[byKey[key]].items.push(a);
    }

    list.innerHTML = `<div class="dk-register">${groups.map(g =>
      `<div class="dk-reg-group">${esc(g.heading)} <span class="n">· ${g.items.length}</span></div>${g.items.map(rowHtml).join('')}`
    ).join('')}</div>`;
    wireRowActions();
  }

  function paymentTag(a) {
    const fee = a.consult_types?.fee_type;
    if (!fee || fee === 'free') return '';
    const price = a.consult_types?.price_cents ? ' $' + (a.consult_types.price_cents / 100).toFixed(2) : '';
    if (a.payment_status === 'paid')      return DK.tag('Paid' + price, 'ok');
    if (a.payment_status === 'link_sent') return DK.tag('Link sent' + price, 'warn');
    return DK.tag('Unpaid' + price, 'mut');
  }

  function rowHtml(a) {
    const [label, kind] = STATUS_TAG[a.status] || [a.status, 'mut'];

    const actions = [];
    if (a.status === 'booked') {
      actions.push(`<button class="dk-linkbtn" data-act="complete" data-id="${a.id}" type="button">Complete</button>`);
      actions.push(`<button class="dk-linkbtn" data-act="no_show" data-id="${a.id}" type="button">No-show</button>`);
      actions.push(`<button class="dk-linkbtn d" data-act="cancel" data-id="${a.id}" type="button">Cancel</button>`);
    }
    const fee = a.consult_types?.fee_type;
    if (fee && fee !== 'free' && a.payment_status !== 'paid' && a.status !== 'cancelled') {
      actions.push(`<button class="dk-linkbtn" data-act="pay_link" data-id="${a.id}" type="button">${a.payment_status === 'link_sent' ? 'Resend link' : 'Send payment link'}</button>`);
      actions.push(`<button class="dk-linkbtn" data-act="mark_paid" data-id="${a.id}" type="button">Mark paid</button>`);
    }

    const meta = [
      `<span>${esc(timeText(a.starts_at))}</span>`,
      a.consult_types?.name ? `<span class="sep">·</span><span>${esc(a.consult_types.name)}</span>` : '',
      `<span class="sep">·</span><span>${esc(Utils.fullName(a.attorney) || 'Unassigned')}</span>`,
      a.case_types?.name ? `<span class="sep">·</span><span>Re: ${esc(a.case_types.name)}</span>` : '',
    ].join('');
    const contact = [a.prospect_email, a.prospect_phone].filter(Boolean).map(esc).join(' · ');

    return `<div class="dk-reg-row" style="align-items:start">
      <div style="min-width:0">
        <div class="dk-reg-title"><span>${esc(a.prospect_name)}</span>${DK.tag(label, kind)}${paymentTag(a)}</div>
        <div class="dk-reg-meta">${meta}</div>
        ${contact ? `<div class="dk-reg-meta">${contact}</div>` : ''}
        ${a.notes ? `<div class="dk-reg-meta" style="font-style:italic">“${esc(Utils.truncate(a.notes, 140))}”</div>` : ''}
      </div>
      <div class="dk-reg-act" style="flex-wrap:wrap;justify-content:flex-end;max-width:340px">${actions.join('') || '<span style="color:var(--ink-faint);font-size:12px">—</span>'}</div>
    </div>`;
  }

  // ── Private booking links ("invite to book") ───────────────────────────────
  // Staff picks attorney + consult type (including staff-offered-only types),
  // gets a single-use expiring /book?offer=<token> link to send the prospect.

  const offerSlot = document.getElementById('offer-slot');
  let offerData = null; // { profiles, types, offers } — loaded on first open

  async function toggleOfferPanel() {
    if (offerSlot.innerHTML) { offerSlot.innerHTML = ''; return; }
    offerSlot.innerHTML = '<div class="card" style="margin-bottom:var(--space-4);color:var(--ink-soft)">Loading…</div>';
    const [prof, ct, off] = await Promise.all([
      db.from('booking_provider_profiles').select('user_id, display_name').eq('is_bookable', true).order('sort_order'),
      db.from('consult_types').select('id, name, public_bookable, fee_type, price_cents, duration_min').eq('is_active', true).order('sort_order'),
      db.from('booking_offers').select('*, consult_types(name)')
        .is('used_appointment_id', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
    ]);
    offerData = { profiles: prof.data || [], types: ct.data || [], offers: off.data || [] };
    renderOfferPanel();
  }

  function renderOfferPanel(createdLink) {
    const { profiles, types, offers } = offerData;
    if (!profiles.length || !types.length) {
      offerSlot.innerHTML = '<div class="card" style="margin-bottom:var(--space-4);color:var(--ink-soft)">Add a bookable attorney and at least one active consultation type in Booking settings first.</div>';
      return;
    }
    const openRows = offers.map(o => `
      <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;border-top:1px solid var(--line);font-size:var(--text-sm)">
        <div style="flex:1;min-width:0">
          <span style="font-weight:600">${esc(o.consult_types?.name || '?')}</span>
          with ${esc(profiles.find(p => p.user_id === o.user_id)?.display_name || '?')}
          ${o.label ? `<span style="color:var(--ink-soft)"> · ${esc(o.label)}</span>` : ''}
          <span style="color:var(--ink-soft)"> · expires ${new Date(o.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
        <button class="dk-linkbtn" data-offer-copy="${esc(o.token)}" type="button">Copy link</button>
        <button class="dk-linkbtn d" data-offer-revoke="${o.id}" type="button">Revoke</button>
      </div>`).join('');

    offerSlot.innerHTML = `<div class="card" style="margin-bottom:var(--space-4)">
      <h2 style="font-family:var(--font-serif);font-size:19px;font-weight:600;margin-bottom:var(--space-1);color:var(--ink)">Private booking link</h2>
      <p style="font-size:var(--text-sm);color:var(--ink-soft);margin-bottom:var(--space-3);line-height:1.6">
        For consultations you offer a specific prospect — free or special-rate types that aren't on the public page.
        The link books that exact consultation, works once, and expires.
      </p>
      <form id="offer-form" style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end">
        <div class="field field-stack" style="flex:1;min-width:170px">
          <label class="field-label">Attorney</label>
          <select class="field-input" id="of-attorney">${profiles.map(p => `<option value="${p.user_id}">${esc(p.display_name)}</option>`).join('')}</select>
        </div>
        <div class="field field-stack" style="flex:1;min-width:200px">
          <label class="field-label">Consultation</label>
          <select class="field-input" id="of-type">${types.map(t =>
            `<option value="${t.id}">${esc(t.name)}${t.public_bookable === false ? ' (staff-offered)' : ''}</option>`).join('')}</select>
        </div>
        <div class="field field-stack" style="flex:1;min-width:180px">
          <label class="field-label">For (your records, optional)</label>
          <input class="field-input" id="of-label" maxlength="200" placeholder="e.g. Jane Smith">
        </div>
        <div class="field field-stack" style="min-width:110px">
          <label class="field-label">Expires (days)</label>
          <input class="field-input" id="of-days" type="number" min="1" max="90" value="30">
        </div>
        <button class="btn btn--primary" type="submit">Create link</button>
      </form>
      ${createdLink ? `
      <div style="display:flex;gap:var(--space-2);align-items:center;margin-top:var(--space-3);background:var(--paper-deep);border:1px solid var(--line);border-radius:var(--radius,8px);padding:var(--space-3)">
        <input class="field-input" readonly id="of-created" value="${esc(createdLink)}" style="flex:1">
        <button class="btn btn--primary" data-offer-copy-input="of-created" type="button">Copy</button>
      </div>
      <p style="font-size:var(--text-xs);color:var(--ink-soft);margin-top:var(--space-1)">Email this link to the prospect — they pick their own time.</p>` : ''}
      ${openRows ? `<div style="margin-top:var(--space-3)"><div style="font-size:var(--text-xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:var(--space-1)">Open links</div>${openRows}</div>` : ''}
    </div>`;
    wireOfferPanel();
  }

  function wireOfferPanel() {
    document.getElementById('offer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const days = Math.min(90, Math.max(1, parseInt(document.getElementById('of-days').value, 10) || 30));
      try {
        const { data, error } = await db.from('booking_offers').insert({
          consult_type_id: document.getElementById('of-type').value,
          user_id:         document.getElementById('of-attorney').value,
          label:           document.getElementById('of-label').value.trim() || null,
          expires_at:      new Date(Date.now() + days * 86400000).toISOString(),
        }).select('*, consult_types(name)').single();
        if (error) throw error;
        offerData.offers.unshift(data);
        renderOfferPanel(`${window.location.origin}/book?offer=${data.token}`);
        Utils.toast('Link created — copy it below.', 'success');
      } catch (err) { Utils.handleError(err, 'booking-offers'); }
    });
    Utils.qsa('[data-offer-copy]', offerSlot).forEach(b => b.addEventListener('click', () => {
      navigator.clipboard.writeText(`${window.location.origin}/book?offer=${b.dataset.offerCopy}`)
        .then(() => Utils.toast('Link copied.', 'success'));
    }));
    Utils.qsa('[data-offer-copy-input]', offerSlot).forEach(b => b.addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById(b.dataset.offerCopyInput).value)
        .then(() => Utils.toast('Link copied.', 'success'));
    }));
    Utils.qsa('[data-offer-revoke]', offerSlot).forEach(b => b.addEventListener('click', async () => {
      if (!await Utils.confirm('Revoke this booking link? Anyone holding it can no longer use it.', { danger: true, confirmLabel: 'Revoke' })) return;
      try {
        const { error } = await db.from('booking_offers').delete().eq('id', b.dataset.offerRevoke);
        if (error) throw error;
        offerData.offers = offerData.offers.filter(o => o.id !== b.dataset.offerRevoke);
        renderOfferPanel();
        Utils.toast('Link revoked.', 'success');
      } catch (err) { Utils.handleError(err, 'booking-offers'); }
    }));
  }

  document.getElementById('offer-new')?.addEventListener('click', toggleOfferPanel);

  function wireRowActions() {
    Utils.qsa('[data-act]', list).forEach(btn => btn.addEventListener('click', async () => {
      const id   = btn.dataset.id;
      const appt = appointments.find(a => a.id === id);
      if (!appt) return;
      Utils.setLoading(btn, true);
      try {
        switch (btn.dataset.act) {
          case 'complete':
          case 'no_show': {
            const status = btn.dataset.act === 'complete' ? 'completed' : 'no_show';
            const { error } = await db.from('appointments').update({ status }).eq('id', id);
            if (error) throw error;
            Utils.toast(`Marked ${status === 'completed' ? 'completed' : 'no-show'}.`, 'success');
            break;
          }
          case 'mark_paid': {
            const { error } = await db.from('appointments').update({ payment_status: 'paid' }).eq('id', id);
            if (error) throw error;
            Utils.toast('Marked paid.', 'success');
            break;
          }
          case 'cancel': {
            if (!await Utils.confirm(`Cancel ${appt.prospect_name}'s ${appt.consult_types?.name || 'consultation'}? They'll be emailed, and the calendar hold is removed.`, { danger: true, confirmLabel: 'Cancel appointment', cancelLabel: 'Keep it' })) break;
            await apiPost('/api/booking/staff/cancel', { appointment_id: id });
            Utils.toast('Appointment cancelled.', 'success');
            break;
          }
          case 'pay_link': {
            if (!await Utils.confirm(`Email ${appt.prospect_name} a payment link for this consultation?`, { confirmLabel: 'Send link' })) break;
            await apiPost('/api/booking/staff/payment-link', { appointment_id: id });
            Utils.toast('Payment link sent.', 'success');
            break;
          }
        }
        await load();
      } catch (err) {
        Utils.setLoading(btn, false);
        Utils.handleError(err, 'appointments');
      }
    }));
  }

  await load();
})();
