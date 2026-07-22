'use strict';

(async function BillingRatesPage() {

  const clientSel    = document.getElementById('rate-client');       // hidden input: chosen client id
  const clientSearch = document.getElementById('rate-client-search');
  const clientList   = document.getElementById('rate-client-list');
  const editor      = document.getElementById('rate-editor');
  const rowsBody    = document.getElementById('rate-rows');
  // NB the monthly admin-fee controls were removed from this page in the 2026-07
  // pare-back — the admin_fee expense category is the single path now. See the
  // comment in index.html; the cron and API handling are still live for firms
  // that already have a recurring charge configured.
  const btnSave     = document.getElementById('btn-save-rates');
  const saveStatus  = document.getElementById('rate-save-status');

  let staff = [];

  async function api(path, opts = {}) {
    const session = await Auth.getSession();
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function fullName(p) { return `${p.first_name || ''} ${p.last_name || ''}`.trim() || '(unnamed)'; }

  // ── Bootstrap: load clients + staff ─────────────────────────────────────────
  let clients = [];
  try {
    const boot = await api('/api/billing-rates');
    staff   = boot.staff || [];
    clients = (boot.clients || []).map(c => ({ id: c.id, name: fullName(c) }));
  } catch (err) {
    Utils.toast(err.message || 'Failed to load billing rates.', 'error');
    return;
  }

  // Searchable client picker — same type-to-filter .dk-combo as New Invoice's
  // matter picker. Writes the chosen id into the hidden #rate-client and fires
  // its 'change' event, so the rates-loading flow below is unchanged.
  (() => {
    let filtered  = [];
    let activeIdx = -1;

    const isOpen = () => !clientList.hidden;

    function setValue(id, text) {
      const changed = clientSel.value !== (id || '');
      clientSel.value    = id || '';
      clientSearch.value = text || '';
      if (changed) clientSel.dispatchEvent(new Event('change'));
    }

    function close() {
      clientList.hidden = true;
      activeIdx = -1;
      clientSearch.setAttribute('aria-expanded', 'false');
    }

    function mark(text, q) {
      if (!q) return Utils.esc(text);
      const i = text.toLowerCase().indexOf(q);
      if (i < 0) return Utils.esc(text);
      return Utils.esc(text.slice(0, i)) + '<mark>' + Utils.esc(text.slice(i, i + q.length)) +
        '</mark>' + Utils.esc(text.slice(i + q.length));
    }

    function render() {
      const q = clientSearch.value.trim().toLowerCase();
      filtered = q ? clients.filter(c => c.name.toLowerCase().includes(q)) : clients.slice();

      if (!clients.length) {
        clientList.innerHTML = '<div class="dk-combo-empty">No clients found.</div>';
      } else if (!filtered.length) {
        clientList.innerHTML = `<div class="dk-combo-empty">No matches for “${Utils.esc(clientSearch.value.trim())}”.</div>`;
      } else {
        clientList.innerHTML = filtered.map((c, i) => `
          <div class="dk-combo-opt${i === activeIdx ? ' active' : ''}" role="option" data-idx="${i}">
            <span class="co-name">${mark(c.name, q)}</span>
          </div>`).join('');
      }
      clientList.hidden = false;
      clientSearch.setAttribute('aria-expanded', 'true');
    }

    function choose(idx) {
      const c = filtered[idx];
      if (!c) return;
      setValue(c.id, c.name);
      close();
    }

    function scrollToActive() {
      clientList.querySelector('.dk-combo-opt.active')?.scrollIntoView({ block: 'nearest' });
    }

    clientSearch.addEventListener('input', () => {
      if (clientSel.value) setValue('', clientSearch.value); // editing invalidates the prior pick
      activeIdx = -1;
      render();
    });
    clientSearch.addEventListener('focus', () => { if (!isOpen()) render(); });
    // Element-scoped close — no global document listener to stack across navigations.
    clientSearch.addEventListener('blur', () => setTimeout(close, 120));
    clientSearch.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen()) { render(); return; }
        activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
        render(); scrollToActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        render(); scrollToActive();
      } else if (e.key === 'Enter') {
        if (isOpen() && activeIdx >= 0) { e.preventDefault(); choose(activeIdx); }
      } else if (e.key === 'Escape') {
        close();
      }
    });
    // mousedown (before the input's blur) so the pick registers before we close.
    clientList.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.dk-combo-opt');
      if (!opt) return;
      e.preventDefault();
      choose(Number(opt.dataset.idx));
    });
  })();

  function renderStaffRows(rateByUser) {
    rowsBody.innerHTML = '';
    if (!staff.length) {
      rowsBody.innerHTML = '<div class="dk-empty">No staff members to set rates for.</div>';
      return;
    }
    for (const s of staff) {
      const existing = rateByUser.get(s.id);
      const row = document.createElement('div');
      row.className = 'dk-reg-row';
      row.innerHTML = `
        <div>
          <div class="dk-reg-title">${Utils.esc(fullName(s))}</div>
          <div class="dk-reg-meta"><span>${s.role ? Utils.esc(s.role) : '—'}</span></div>
        </div>
        <div class="dk-reg-act" style="align-items:center">
          <span class="dk-reg-meta" style="margin-top:0">$</span>
          <input type="number" class="field-input rate-input" data-user="${Utils.esc(s.id)}" min="0" step="0.01"
                 value="${existing != null ? existing : ''}" placeholder="—"
                 style="width:110px;text-align:right">
          <span class="dk-reg-meta" style="margin-top:0">/hr</span>
        </div>`;
      rowsBody.appendChild(row);
    }
  }

  // ── Load a client's rates when selected ─────────────────────────────────────
  clientSel.addEventListener('change', async () => {
    const clientId = clientSel.value;
    saveStatus.textContent = '';
    if (!clientId) { editor.classList.add('hidden'); return; }

    try {
      const data = await api(`/api/billing-rates?client_id=${encodeURIComponent(clientId)}`);
      const rateByUser = new Map();
      for (const r of data.rates || []) {
        if (r.user_id) rateByUser.set(r.user_id, r.rate);
      }
      renderStaffRows(rateByUser);

      editor.classList.remove('hidden');
    } catch (err) {
      Utils.toast(err.message || 'Failed to load client rates.', 'error');
    }
  });

  // ── Save ────────────────────────────────────────────────────────────────────
  btnSave.addEventListener('click', async () => {
    const clientId = clientSel.value;
    if (!clientId) return;

    const rates = [...document.querySelectorAll('.rate-input')].map(inp => ({
      user_id: inp.dataset.user,
      rate:    inp.value.trim() === '' ? null : Number(inp.value),
    }));

    // recurring_charge is deliberately NOT sent: /api/billing-rates only touches
    // recurring_charges when the field is present, so an existing configured fee
    // survives a rate edit untouched.

    btnSave.disabled = true;
    saveStatus.textContent = 'Saving…';
    try {
      await api('/api/billing-rates', {
        method: 'POST',
        body:   JSON.stringify({ client_id: clientId, rates, recurring_charge }),
      });
      saveStatus.textContent = 'Saved ✓';
      Utils.toast('Billing rates saved.', 'success');
    } catch (err) {
      saveStatus.textContent = '';
      Utils.toast(err.message || 'Failed to save.', 'error');
    } finally {
      btnSave.disabled = false;
    }
  });

})();
