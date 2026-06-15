// Module: esign — staff page logic (signature request queue + counter-sign)
// Migration range: 500–599. Branch: module/esign
'use strict';

(async function EsignPage() {

  const profile = await Auth.getProfile();
  const isAtty  = ['Owner','Attorney','Partner Attorney'].includes(profile?.role?.name);

  const STATUS_LABELS = {
    pending_client:   'Awaiting client',
    pending_attorney: 'Awaiting attorney',
    completed:        'Completed',
    declined:         'Declined',
    expired:          'Expired',
  };

  // ── Function caller ──────────────────────────────────────────────────────────

  async function callFunction(endpoint, body) {
    let res;
    try {
      const session = await Auth.getSession();
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      });
    } catch { throw new Error('Network error — check your connection and try again.'); }

    if (res.status === 401) {
      sessionStorage.setItem('login_message', 'Your session expired. Please log in again.');
      setTimeout(() => window.location.replace('/'), 1200);
      throw new Error('Session expired. Redirecting…');
    }

    const rawText = await res.text();
    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error(`Unexpected server response (${res.status})`); }
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    return data;
  }

  async function getRequest(id) {
    const session = await Auth.getSession();
    const res = await fetch(`/api/get-signature-request?id=${id}`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load request');
    return data;
  }

  // ── Load all requests ────────────────────────────────────────────────────────

  let allRequests = [];

  async function loadRequests() {
    const { data, error } = await db
      .from('signature_requests')
      .select(`
        id, status, requires_countersign, created_at, expires_at,
        document:documents(id, file_name),
        matter:matters(id, client_id, clients(first_name, last_name)),
        requested_by_user:users!requested_by(first_name, last_name)
      `)
      .order('created_at', { ascending: false });

    if (error) { Utils.toast('Failed to load signature requests.', 'error'); return; }
    allRequests = data || [];
    renderAll();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function renderAll() {
    renderCountersignQueue();
    renderTable();
  }

  function renderCountersignQueue() {
    const card     = document.getElementById('esign-countersign-card');
    const list     = document.getElementById('esign-countersign-list');
    const countEl  = document.getElementById('esign-countersign-count');
    const pending  = allRequests.filter(r => r.status === 'pending_attorney');

    if (!isAtty) { card.style.display = 'none'; return; }

    if (!pending.length) {
      list.innerHTML = `<p class="text-muted text-sm" style="text-align:center;padding:var(--space-6)">No documents awaiting your counter-signature.</p>`;
      countEl.style.display = 'none';
      return;
    }

    countEl.textContent = pending.length;
    countEl.style.display = '';

    list.innerHTML = pending.map(r => {
      const client = r.matter?.clients;
      const clientName = client ? `${client.first_name} ${client.last_name}`.trim() : '—';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:var(--space-3)">
        <div>
          <div style="font-weight:500">${Utils.esc(r.document?.file_name || '—')}</div>
          <div class="text-sm text-muted">${Utils.esc(clientName)} · Client signed</div>
        </div>
        <button class="btn btn--primary btn--sm btn-countersign" data-req-id="${r.id}" data-doc-name="${Utils.esc(r.document?.file_name || '')}">
          Counter-sign
        </button>
      </div>`;
    }).join('');
  }

  function renderTable() {
    const tbody    = document.getElementById('esign-tbody');
    const filter   = document.getElementById('esign-filter-status').value;
    const filtered = filter ? allRequests.filter(r => r.status === filter) : allRequests;

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:var(--space-8);color:var(--color-text-muted)">No signature requests found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(r => {
      const client = r.matter?.clients;
      const clientName = client ? `${client.first_name} ${client.last_name}`.trim() : '—';
      const expired = new Date(r.expires_at) < new Date();
      return `<tr>
        <td style="font-weight:500">${Utils.esc(r.document?.file_name || '—')}</td>
        <td>${Utils.esc(clientName)}</td>
        <td><span class="badge badge--${r.status === 'completed' ? 'active' : r.status === 'declined' || r.status === 'expired' ? 'inactive' : 'pending'}">${STATUS_LABELS[r.status] || r.status}</span></td>
        <td class="text-sm text-muted">${Utils.formatDateTime(r.created_at)}</td>
        <td class="text-sm ${expired && r.status.startsWith('pending') ? '' : 'text-muted'}" ${expired && r.status.startsWith('pending') ? 'style="color:var(--color-danger)"' : ''}>${Utils.formatDate(r.expires_at)}</td>
        <td style="white-space:nowrap">
          <button class="btn btn--ghost btn--sm btn-view-details" data-req-id="${r.id}" style="margin-right:var(--space-2)">Details</button>
          ${r.status === 'pending_attorney' && isAtty
            ? `<button class="btn btn--sm btn--primary btn-countersign" data-req-id="${r.id}" data-doc-name="${Utils.esc(r.document?.file_name || '')}">Counter-sign</button>`
            : ''}
        </td>
      </tr>`;
    }).join('');
  }

  // ── Counter-sign modal ───────────────────────────────────────────────────────

  let signatureCanvas, signatureCtx, drawing = false;

  function openCountersignModal(reqId, docName) {
    const overlay = document.getElementById('esign-sign-modal');
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;padding:var(--space-6)">
        <h2 class="modal-title" style="margin-bottom:var(--space-2)">Counter-Sign Document</h2>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">Document: <strong>${Utils.esc(docName)}</strong></p>
        <div style="margin-bottom:var(--space-4)">
          <a id="countersign-download" href="#" target="_blank" class="btn btn--secondary btn--sm" style="margin-bottom:var(--space-3)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Review signed document
          </a>
          <p class="text-sm text-muted">Review the client-signed document above before counter-signing.</p>
        </div>
        <div style="margin-bottom:var(--space-4)">
          <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:600">Draw your signature</label>
          <canvas id="sig-canvas" width="460" height="160"
            style="border:1px solid var(--color-border);border-radius:var(--radius-md);width:100%;touch-action:none;cursor:crosshair;background:#fafafa"></canvas>
          <button type="button" class="btn btn--ghost btn--sm" id="sig-clear" style="margin-top:var(--space-2)">Clear</button>
        </div>
        <div id="countersign-err" class="form-error hidden" style="margin-bottom:var(--space-3)"></div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end">
          <button class="btn btn--secondary btn--sm" id="countersign-cancel">Cancel</button>
          <button class="btn btn--primary btn--sm" id="countersign-submit">Submit counter-signature</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    // Load download URL
    getRequest(reqId).then(data => {
      if (data.download_url) {
        overlay.querySelector('#countersign-download').href = data.download_url;
      }
    }).catch(() => {});

    // Wire canvas
    const canvas = overlay.querySelector('#sig-canvas');
    const ctx    = canvas.getContext('2d');
    ctx.strokeStyle = '#1a3a5c';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const src = e.touches ? e.touches[0] : e;
      return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
    }

    let isDrawing = false;
    canvas.addEventListener('mousedown',  e => { isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('mousemove',  e => { if (!isDrawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    canvas.addEventListener('mouseup',    () => { isDrawing = false; });
    canvas.addEventListener('mouseleave', () => { isDrawing = false; });
    canvas.addEventListener('touchstart', e => { e.preventDefault(); isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); if (!isDrawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
    canvas.addEventListener('touchend',   () => { isDrawing = false; });

    overlay.querySelector('#sig-clear').addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));

    overlay.querySelector('#countersign-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    overlay.querySelector('#countersign-submit').addEventListener('click', async () => {
      const submitBtn = overlay.querySelector('#countersign-submit');
      const errEl     = overlay.querySelector('#countersign-err');

      // Check canvas isn't blank
      const blank = !ctx.getImageData(0, 0, canvas.width, canvas.height).data.some(v => v !== 0);
      if (blank) { errEl.textContent = 'Please draw your signature before submitting.'; errEl.classList.remove('hidden'); return; }

      errEl.classList.add('hidden');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      try {
        const sigImage = canvas.toDataURL('image/png');
        await callFunction('/api/sign-document', { request_id: reqId, signature_image: sigImage });
        overlay.classList.add('hidden');
        Utils.toast('Counter-signature submitted. Document is now fully executed.', 'success');
        await loadRequests();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit counter-signature';
      }
    });
  }

  // ── Audit trail modal ────────────────────────────────────────────────────────

  async function openAuditModal(reqId) {
    const overlay = document.getElementById('esign-sign-modal');
    overlay.innerHTML = `
      <div class="modal" style="max-width:640px">
        <h2 class="modal-title" style="padding:var(--space-5) var(--space-6) var(--space-4)">Signature Audit Trail</h2>
        <div id="audit-loading" style="padding:var(--space-8);text-align:center;color:var(--color-text-muted)">Loading…</div>
        <div id="audit-content"></div>
        <div style="display:flex;justify-content:flex-end;padding:var(--space-4) var(--space-6)">
          <button class="btn btn--secondary btn--sm" id="audit-close">Close</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');
    overlay.querySelector('#audit-close').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    try {
      const data = await getRequest(reqId);
      renderAuditContent(data);
    } catch (err) {
      document.getElementById('audit-loading').textContent = 'Failed to load audit trail. Please try again.';
    }
  }

  function renderAuditContent(data) {
    document.getElementById('audit-loading').classList.add('hidden');
    const content = document.getElementById('audit-content');
    const sigs = data.signatures || [];
    const requestedBy = data.requested_by
      ? `${data.requested_by.first_name} ${data.requested_by.last_name}`.trim() : '—';

    const hashBlock = (label, hash) => hash ? `
      <div style="margin-top:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--color-bg);border-radius:var(--radius-md)">
        <div style="font-size:10px;font-weight:700;color:var(--color-text-muted);letter-spacing:.06em;margin-bottom:2px">${label}</div>
        <code style="font-size:9.5px;word-break:break-all;color:var(--color-text-muted)">${Utils.esc(hash)}</code>
      </div>` : '';

    const sigBlocks = sigs.length === 0
      ? `<p class="text-sm text-muted">No signatures recorded yet.</p>`
      : sigs.map(s => {
          const signerName = s.audit_log?.signer_name || '—';
          const roleLabel  = s.signer_role === 'attorney' ? 'Attorney Counter-Signature' : 'Client Signature';
          const ua         = s.user_agent ? s.user_agent.slice(0, 100) + (s.user_agent.length > 100 ? '…' : '') : null;
          return `
          <div style="padding:var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:var(--space-3)">
            <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-3)">
              <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" style="width:15px;height:15px;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>
              <span style="font-weight:600;font-size:var(--text-sm)">${roleLabel}</span>
              <span class="text-muted text-sm">— ${Utils.esc(signerName)}</span>
            </div>
            <div style="display:grid;gap:var(--space-1);font-size:var(--text-sm)">
              <div><span class="text-muted">Signed:</span> ${Utils.formatDateTime(s.signed_at)} (CT)</div>
              ${s.ip_address ? `<div><span class="text-muted">IP address:</span> <code style="font-size:var(--text-xs)">${Utils.esc(s.ip_address)}</code></div>` : ''}
              ${ua ? `<div><span class="text-muted">Browser:</span> <span style="font-size:var(--text-xs);color:var(--color-text-muted)">${Utils.esc(ua)}</span></div>` : ''}
            </div>
            ${hashBlock('SHA-256 BEFORE SIGNING', s.document_hash_before)}
            ${hashBlock('SHA-256 AFTER SIGNING',  s.document_hash_after)}
          </div>`;
        }).join('');

    content.innerHTML = `
      <div style="padding:var(--space-4) var(--space-6);border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);background:var(--color-bg)">
        <div style="display:grid;gap:var(--space-3);grid-template-columns:1fr 1fr">
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Document</div>
            <div style="font-weight:600">${Utils.esc(data.document?.file_name || '—')}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Status</div>
            <span class="badge badge--${data.status === 'completed' ? 'active' : data.status === 'declined' || data.status === 'expired' ? 'inactive' : 'pending'}">${STATUS_LABELS[data.status] || data.status}</span>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Requested by</div>
            <div>${Utils.esc(requestedBy)}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Requested</div>
            <div>${Utils.formatDateTime(data.created_at)}</div>
          </div>
        </div>
        ${data.message ? `<div style="margin-top:var(--space-3);padding:var(--space-3);background:var(--color-surface);border-radius:var(--radius-md);font-size:var(--text-sm);font-style:italic">"${Utils.esc(data.message)}"</div>` : ''}
      </div>
      <div style="padding:var(--space-5) var(--space-6)">
        <div style="font-weight:600;margin-bottom:var(--space-4)">Signature Chain</div>
        ${sigBlocks}
      </div>
      ${data.download_url ? `
      <div style="padding:0 var(--space-6) var(--space-4)">
        <a href="${data.download_url}" target="_blank" class="btn btn--secondary btn--sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:var(--space-2)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download signed document
        </a>
      </div>` : ''}`;
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  document.getElementById('esign-filter-status').addEventListener('change', renderTable);

  document.addEventListener('click', e => {
    const detailsBtn = e.target.closest('.btn-view-details');
    if (detailsBtn) { openAuditModal(detailsBtn.dataset.reqId); return; }
    const btn = e.target.closest('.btn-countersign');
    if (btn) openCountersignModal(btn.dataset.reqId, btn.dataset.docName);
  });

  // ── Init ─────────────────────────────────────────────────────────────────────

  await loadRequests();

})();
