// Storage Sync module page — per-provider sync status, reconciliation report,
// unmatched file review queue. All mutations go through the Worker endpoints;
// direct db reads are limited to client/matter pickers (RLS-gated).

(async function () {
  'use strict';

  // Moved out of the sidebar into Settings — no longer gated by MODULE_REGISTRY's
  // automatic premium/role filtering, so self-guard the same two checks here.
  const _profile = await Auth.getProfile();
  if (!_profile || _profile.role?.name === 'Client') { window.location.hash = '#client-portal'; return; }
  const [_accessible, { data: _enabledRow }] = await Promise.all([
    Auth.getAccessibleModules('read'),
    db.from('enabled_modules').select('module_key').eq('module_key', 'storage_sync').maybeSingle(),
  ]);
  if (!_accessible.has('storage_sync') || !_enabledRow) {
    document.getElementById('page-content').innerHTML =
      `<div class="page-error"><h2>Storage Sync</h2><p>This module isn't enabled for your firm, or your role doesn't have access to it.</p></div>`;
    return;
  }

  const esc = (s) => (window.Utils?.esc ? Utils.esc(s) : String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

  const $ = (id) => document.getElementById(id);

  const PROVIDER_LABELS = {
    dropbox: 'Dropbox', google_drive: 'Google Drive', onedrive: 'OneDrive', idrive: 'iDrive',
  };
  const providerLabel = (p) => PROVIDER_LABELS[p] || p;

  let unmatchedRows = [];
  let resolveRow = null;      // row being resolved in the modal
  let chosenMatterId = null;

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

  // ── Status card ──────────────────────────────────────────────────────────

  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  async function loadStatus() {
    const el = $('ss-status');
    try {
      const s = await api('/api/storage-sync-status');
      if (!s.configured || !s.providers.length) {
        el.innerHTML = `<div class="dk-empty" style="margin-top:0">No storage provider is configured on this deployment yet.</div>`;
        return;
      }

      const rows = s.providers.map((p) => `
        <div class="dk-reg-row">
          <div>
            <div class="dk-reg-title">${esc(p.label || providerLabel(p.provider))} ${p.configured ? DK.tag('Configured', 'ok') : DK.tag('Not configured', 'mut')}</div>
            <div class="dk-reg-meta">
              <span>Last run ${esc(fmtTime(p.last_run_at))}</span><span class="sep">·</span>
              <span>${esc(String(p.files_pulled))} pulled</span><span class="sep">·</span>
              <span${p.backlog ? ' class="danger"' : ''}>${esc(String(p.backlog))} backlog</span>
              ${p.last_error ? `<span class="sep">·</span><span class="danger">${esc(p.last_error)}</span>` : ''}
            </div>
          </div>
        </div>`).join('');

      el.innerHTML = `<div class="dk-register">${rows}</div>
        <p class="dk-sub" style="margin:14px 0 0;font-size:13px">
          <strong>${esc(String(s.unmatched_pending))}</strong> file${s.unmatched_pending === 1 ? '' : 's'} awaiting review</p>`;
    } catch (err) {
      el.innerHTML = `<p style="color:var(--color-danger,#dc2626);font-size:var(--text-sm)">${esc(err.message)}</p>`;
    }
  }

  // ── Reconciliation ───────────────────────────────────────────────────────

  async function runRecon() {
    const btn = $('ss-recon-btn');
    const out = $('ss-recon-results');
    btn.disabled = true; btn.textContent = 'Running…';
    try {
      const r = await api('/api/storage-sync-recon');
      const section = (title, rows, render, tone) => rows.length ? `
        <div style="margin-bottom:var(--space-3)">
          <div style="font-size:var(--text-sm);font-weight:600;margin-bottom:var(--space-1);color:${tone || 'inherit'}">
            ${title} (${rows.length})
          </div>
          <ul style="font-size:var(--text-sm);color:var(--color-text-muted);padding-left:var(--space-4);margin:0">
            ${rows.map(render).join('')}
          </ul>
        </div>` : '';
      out.innerHTML =
        `<p style="font-size:var(--text-sm);margin-bottom:var(--space-3)">
          ${esc(providerLabel(r.provider))}: ${r.folder_count} folders · ${r.portal_client_count} portal clients</p>` +
        section('Needs a client card (in storage, not in portal)', r.unmatched_folders,
          (f) => `<li>${esc(f.folder)}</li>`, 'var(--color-danger,#dc2626)') +
        section('Ambiguous (multiple clients share the name)', r.ambiguous,
          (f) => `<li>${esc(f.folder)}</li>`, 'var(--color-warning,#b45309)') +
        section('Matched', r.matched,
          (f) => `<li>${esc(f.folder)} → ${esc(f.client_name)}${f.via === 'alias' ? ' (alias)' : ''}</li>`) +
        section('Portal clients with no storage folder', r.clients_without_folder,
          (c) => `<li>${esc(c.client_name)}${c.active ? '' : ' (inactive)'}</li>`);
      if (!r.unmatched_folders.length && !r.ambiguous.length) {
        out.innerHTML += `<p style="font-size:var(--text-sm);color:var(--color-success,#16a34a);font-weight:600">
          ✓ Report is clean — every folder resolves. Safe to backfill.</p>`;
      }
    } catch (err) {
      out.innerHTML = `<p style="color:var(--color-danger,#dc2626);font-size:var(--text-sm)">${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Run report';
    }
  }

  // ── Unmatched queue ──────────────────────────────────────────────────────

  const REASON_LABELS = {
    no_client_match:  'No matching client',
    multiple_matters: 'Multiple active matters',
    no_active_matter: 'Client has no active matter',
    conflicted_copy:  'Conflicted copy',
    over_size:        'Over the 25MB limit',
    infected:         'Failed malware scan',
    error:            'Import error',
  };

  async function loadUnmatched() {
    const el = $('ss-unmatched-list');
    const badge = $('ss-unmatched-count');
    try {
      const { files } = await api('/api/storage-sync-unmatched');
      unmatchedRows = files;
      if (files.length) {
        badge.textContent = String(files.length);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
      if (!files.length) {
        el.innerHTML = `<div class="dk-empty" style="margin-top:0">Nothing to review 🎉</div>`;
        return;
      }
      el.innerHTML = `<div class="dk-register">${files.map((f) => `
        <div class="dk-reg-row" data-id="${esc(f.id)}">
          <div>
            <div class="dk-reg-title" style="word-break:break-all">${esc(f.file_name)} ${DK.tag(REASON_LABELS[f.reason] || f.reason, f.reason === 'infected' ? 'warn' : 'mut')}</div>
            <div class="dk-reg-meta">
              <span style="word-break:break-all">${esc(f.remote_path)}</span><span class="sep">·</span>
              <span>${esc(providerLabel(f.provider))}</span><span class="sep">·</span>
              <span>${f.file_size ? (f.file_size / 1024 / 1024).toFixed(1) + ' MB' : '—'}</span>
              ${f.detail ? `<span class="sep">·</span><span>${esc(f.detail)}</span>` : ''}
            </div>
          </div>
          <div class="dk-reg-act">
            ${['infected'].includes(f.reason) ? '' : `<button class="dk-linkbtn" data-act="resolve" type="button">Assign…</button>`}
            <button class="dk-linkbtn" data-act="ignore" type="button">Ignore</button>
          </div>
        </div>`).join('')}</div>`;
      el.querySelectorAll('button[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.closest('[data-id]').dataset.id;
          const row = unmatchedRows.find((r) => r.id === id);
          if (!row) return;
          if (btn.dataset.act === 'resolve') openResolveModal(row);
          else ignoreRow(row, btn);
        });
      });
    } catch (err) {
      el.innerHTML = `<p style="color:var(--color-danger,#dc2626);font-size:var(--text-sm)">${esc(err.message)}</p>`;
    }
  }

  async function ignoreRow(row, btn) {
    if (!confirm(`Ignore "${row.file_name}"? It won't be asked about again.`)) return;
    btn.disabled = true;
    try {
      await api('/api/storage-sync-unmatched', { method: 'POST', body: JSON.stringify({ id: row.id, action: 'ignore' }) });
      Utils.toast('Ignored.', 'success');
      await Promise.all([loadUnmatched(), loadStatus()]);
    } catch (err) {
      Utils.toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  // ── Resolve modal ────────────────────────────────────────────────────────

  function topFolderOf(row) {
    return String(row.remote_path || '').replace(/^\/+/, '').split('/')[0] || '';
  }

  function openResolveModal(row) {
    resolveRow = row;
    chosenMatterId = null;
    $('ss-resolve-file').textContent = row.remote_path;
    $('ss-alias-folder').textContent = topFolderOf(row);
    $('ss-client-search').value = '';
    $('ss-client-results').innerHTML = '';
    $('ss-matter-select').innerHTML = '<option value="">Select a client first</option>';
    $('ss-matter-select').disabled = true;
    $('ss-create-alias').checked = false;
    $('ss-resolve-confirm').disabled = true;
    $('ss-resolve-modal').classList.remove('hidden');
    $('ss-client-search').focus();
  }

  function closeResolveModal() {
    $('ss-resolve-modal').classList.add('hidden');
    resolveRow = null;
  }

  let searchTimer = null;
  async function searchClients(q) {
    const out = $('ss-client-results');
    if (!q || q.length < 2) { out.innerHTML = ''; return; }
    const { data, error } = await db
      .from('clients')
      .select('id, first_name, last_name')
      .or(`last_name.ilike.%${q}%,first_name.ilike.%${q}%`)
      .order('last_name')
      .limit(8);
    if (error) { out.innerHTML = `<p style="color:var(--color-danger,#dc2626);font-size:var(--text-xs)">${esc(error.message)}</p>`; return; }
    out.innerHTML = (data || []).map((c) => `
      <button type="button" class="btn btn--ghost btn--sm" style="display:block;width:100%;text-align:left" data-cid="${esc(c.id)}">
        ${esc(c.last_name)}, ${esc(c.first_name)}
      </button>`).join('') || `<p style="font-size:var(--text-xs);color:var(--color-text-muted)">No clients found</p>`;
    out.querySelectorAll('button[data-cid]').forEach((b) => {
      b.addEventListener('click', () => pickClient(b.dataset.cid, b.textContent.trim()));
    });
  }

  async function pickClient(clientId, label) {
    $('ss-client-search').value = label;
    $('ss-client-results').innerHTML = '';
    const sel = $('ss-matter-select');
    sel.innerHTML = '<option value="">Loading matters…</option>';
    sel.disabled = true;
    const { data, error } = await db
      .from('matters')
      .select('id, case_type, status, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (error || !data?.length) {
      sel.innerHTML = '<option value="">No matters for this client</option>';
      return;
    }
    sel.innerHTML = '<option value="">Choose a matter…</option>' + data.map((m) => `
      <option value="${esc(m.id)}">${esc(m.case_type || 'Matter')} — ${esc(m.status)} (${new Date(m.created_at).toLocaleDateString()})</option>`).join('');
    sel.disabled = false;
  }

  async function confirmResolve() {
    if (!resolveRow || !chosenMatterId) return;
    const btn = $('ss-resolve-confirm');
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      await api('/api/storage-sync-unmatched', {
        method: 'POST',
        body: JSON.stringify({
          id: resolveRow.id,
          action: 'resolve',
          matter_id: chosenMatterId,
          create_alias: $('ss-create-alias').checked,
        }),
      });
      Utils.toast('File imported.', 'success');
      closeResolveModal();
      await Promise.all([loadUnmatched(), loadStatus()]);
    } catch (err) {
      Utils.toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Import File';
    }
  }

  // ── Wire up ──────────────────────────────────────────────────────────────

  $('ss-refresh-btn').addEventListener('click', async () => {
    const btn = $('ss-refresh-btn');
    btn.disabled = true; btn.textContent = 'Refreshing…';
    try {
      await Promise.all([loadStatus(), loadUnmatched()]);
    } finally {
      btn.disabled = false; btn.textContent = 'Refresh';
    }
  });
  $('ss-recon-btn').addEventListener('click', runRecon);
  $('ss-resolve-cancel').addEventListener('click', closeResolveModal);
  $('ss-resolve-confirm').addEventListener('click', confirmResolve);
  $('ss-client-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchClients(e.target.value.trim()), 250);
  });
  $('ss-matter-select').addEventListener('change', (e) => {
    chosenMatterId = e.target.value || null;
    $('ss-resolve-confirm').disabled = !chosenMatterId;
  });
  $('ss-resolve-modal').addEventListener('click', (e) => {
    if (e.target === $('ss-resolve-modal')) closeResolveModal();
  });

  loadStatus();
  loadUnmatched();
})();
