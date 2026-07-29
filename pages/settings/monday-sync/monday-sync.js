(async function () {
  'use strict';

  // Settings pages bypass MODULE_REGISTRY's automatic premium/role filtering, so the
  // same two checks are made here by hand — matching pages/settings/storage-sync.
  const _profile = await Auth.getProfile();
  if (!_profile || _profile.role?.name === 'Client') { window.location.hash = '#client-portal'; return; }
  const [_accessible, { data: _enabledRow }] = await Promise.all([
    Auth.getAccessibleModules('read'),
    db.from('enabled_modules').select('module_key').eq('module_key', 'monday_sync').maybeSingle(),
  ]);
  if (!_accessible.has('monday_sync') || !_enabledRow) {
    document.getElementById('page-content').innerHTML =
      `<div class="page-error"><h2>Monday Sync</h2><p>This module isn't enabled for your firm, or your role doesn't have access to it.</p></div>`;
    return;
  }

  const esc = Utils.esc;
  const $ = (id) => document.getElementById(id);

  // Importing is admin-only server-side; reflect that in the UI rather than letting a
  // paralegal click a button that will 403.
  const canImport = (await Auth.getAccessibleModules('admin')).has('monday_sync');

  let preview = null;
  const selected = new Set();

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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const personName = (p) =>
    p ? [p.first_name, p.last_name, p.suffix].filter(Boolean).join(' ') : '—';

  // ── Last run ────────────────────────────────────────────────────────────────

  function renderState(state) {
    const el = $('ms-state');
    if (!state?.last_run_at) {
      el.innerHTML = `<div class="dk-empty" style="margin-top:0">Never run. Preview an import to see what would be brought across.</div>`;
      return;
    }
    const when = new Date(state.last_run_at).toLocaleString();
    el.innerHTML = `<div class="dk-register">
      <div class="dk-reg-row">
        <div>
          <div class="dk-reg-title">Last run ${esc(when)} ${state.last_error ? DK.tag('had errors', 'warn') : DK.tag('clean', 'ok')}</div>
          <div class="dk-reg-meta">
            <span>${state.last_run_created} created</span><span class="sep">·</span>
            <span>${state.last_run_skipped} skipped</span>
            ${state.last_error ? `<span class="sep">·</span><span>${esc(state.last_error)}</span>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── Preview ─────────────────────────────────────────────────────────────────

  function renderPreview() {
    const sec = $('ms-preview-sec');
    sec.classList.remove('hidden');

    const c = preview.counts;
    $('ms-preview-count').textContent = `${c.total} on the board`;
    $('ms-preview-summary').textContent =
      `${c.create} new to create, ${c.link} to link to an existing client, ` +
      `${c.review} needing review, ${c.ignored} not clients.` +
      (c.departed ? ` ${c.departed} previously imported client${c.departed === 1 ? '' : 's'} no longer on the board.` : '');

    const rows = [
      ...preview.create.map((e) => ({ e, kind: 'create' })),
      ...preview.link.map((e) => ({ e, kind: 'link' })),
    ];

    if (!rows.length) {
      $('ms-preview-body').innerHTML =
        `<div class="dk-empty" style="margin-top:0">Nothing new to import — everything on the board is already in the portal or needs review.</div>`;
      $('ms-preview-confirm').disabled = true;
      return;
    }

    $('ms-preview-body').innerHTML = `<div class="dk-register">${rows.map(({ e, kind }) => {
      const id = String(e.item.id);
      const b = e.parsed.beneficiary;
      const petitioners = (e.parsed.others || []).filter((o) => o.role === 'petitioner');
      return `
        <div class="dk-reg-row" data-id="${esc(id)}">
          <div>
            <div class="dk-reg-title">
              <label style="display:inline-flex;align-items:center;gap:var(--space-2);cursor:pointer">
                <input type="checkbox" data-sel="${esc(id)}" ${canImport ? 'checked' : 'disabled'}>
                <span>${esc(personName(b))}</span>
              </label>
              ${kind === 'link' ? DK.tag('link to existing', 'mut') : DK.tag('new client', 'ok')}
            </div>
            <div class="dk-reg-meta">
              <span>${esc(e.item.name)}</span>
              ${e.caseTypeKey ? `<span class="sep">·</span><span>${esc(e.caseTypeKey)}</span>` : ''}
              ${petitioners.length ? `<span class="sep">·</span><span>petitioner: ${esc(personName(petitioners[0]))}</span>` : ''}
              ${kind === 'link' ? `<span class="sep">·</span><span>${esc(e.reason)}</span>` : ''}
            </div>
            ${(e.notes || []).length ? `<div class="dk-reg-meta"><span>${esc(e.notes.join(' · '))}</span></div>` : ''}
          </div>
        </div>`;
    }).join('')}</div>`;

    selected.clear();
    if (canImport) rows.forEach(({ e }) => selected.add(String(e.item.id)));

    $('ms-preview-body').querySelectorAll('input[data-sel]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.sel);
        else selected.delete(cb.dataset.sel);
        updateConfirm();
      });
    });
    updateConfirm();
  }

  function updateConfirm() {
    const btn = $('ms-preview-confirm');
    btn.disabled = !canImport || selected.size === 0;
    btn.textContent = selected.size ? `Import ${selected.size} selected` : 'Import selected';
  }

  async function loadPreview(btn) {
    Utils.setLoading?.(btn, true);
    btn.disabled = true;
    try {
      preview = await api('/api/monday-sync-preview');
      renderPreview();
    } catch (err) {
      Utils.toast(err.message, 'error');
    } finally {
      Utils.setLoading?.(btn, false);
      btn.disabled = false;
    }
  }

  async function confirmImport(btn) {
    if (!confirm(`Create ${selected.size} client record${selected.size === 1 ? '' : 's'} from monday.com? This cannot be undone in bulk.`)) return;
    btn.disabled = true;
    try {
      const r = await api('/api/monday-sync-import', {
        method: 'POST',
        body: JSON.stringify({ item_ids: [...selected] }),
      });
      const parts = [`${r.counts.created} created`, `${r.counts.linked} linked`];
      if (r.counts.failed) parts.push(`${r.counts.failed} failed`);
      Utils.toast(parts.join(', '), r.counts.failed ? 'error' : 'success');
      $('ms-preview-sec').classList.add('hidden');
      preview = null;
      await load();
    } catch (err) {
      Utils.toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  // ── Queues ──────────────────────────────────────────────────────────────────

  function queueRow(row, actions) {
    return `
      <div class="dk-reg-row" data-id="${esc(row.id)}">
        <div>
          <div class="dk-reg-title">${esc(row.item_name)}</div>
          <div class="dk-reg-meta"><span>${esc(row.reason || '—')}</span></div>
        </div>
        <div class="dk-reg-act">
          ${actions.map((a) => `<button class="dk-linkbtn" data-act="${a.act}" type="button">${esc(a.label)}</button>`).join('')}
        </div>
      </div>`;
  }

  function renderQueue(elId, countId, rows, actions, emptyText) {
    $(countId).textContent = rows.length ? String(rows.length) : '';
    const el = $(elId);
    if (!rows.length) {
      el.innerHTML = `<div class="dk-empty" style="margin-top:0">${esc(emptyText)}</div>`;
      return;
    }
    el.innerHTML = `<div class="dk-register">${rows.map((r) => queueRow(r, actions)).join('')}</div>`;
    el.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id;
        btn.disabled = true;
        try {
          await api('/api/monday-sync-items', {
            method: 'POST',
            body: JSON.stringify({ id, action: btn.dataset.act }),
          });
          await load();
        } catch (err) {
          Utils.toast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  }

  async function load() {
    try {
      const d = await api('/api/monday-sync-items');
      renderState(d.state);
      const acts = canImport ? [{ act: 'ignore', label: 'Ignore' }] : [];
      renderQueue('ms-review', 'ms-review-count', d.review, acts,
        'Nothing waiting. Run a preview to check the board.');
      renderQueue('ms-departed', 'ms-departed-count', d.departed,
        canImport ? [{ act: 'dismiss', label: 'Dismiss' }] : [],
        'No one has left the board group.');
      renderQueue('ms-ignored', 'ms-ignored-count', d.ignored,
        canImport ? [{ act: 'unignore', label: 'Put back' }] : [],
        'Nothing ignored yet.');
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  $('ms-preview-btn').addEventListener('click', (e) => loadPreview(e.currentTarget));
  $('ms-preview-confirm').addEventListener('click', (e) => confirmImport(e.currentTarget));
  $('ms-preview-cancel').addEventListener('click', () => {
    $('ms-preview-sec').classList.add('hidden');
    preview = null;
  });

  if (!canImport) $('ms-preview-btn').disabled = true;

  await load();
})();
