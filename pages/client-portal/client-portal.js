// Client Portal page — client-facing view of their own matter.
// Only loaded for users with the Client role.
'use strict';

(async function ClientPortalPage() {

  const CASE_LABELS = {
    divorce: 'Divorce', custody_modification: 'Custody Modification',
    child_support: 'Child Support', child_support_modification: 'Child Support Modification',
    sapcr_original: 'SAPCR – Original', sapcr_modification: 'SAPCR – Modification',
    enforcement: 'Enforcement', prenuptial_agreement: 'Prenuptial Agreement',
    postnuptial_agreement: 'Postnuptial Agreement', adoption: 'Adoption',
    guardianship: 'Guardianship', other: 'Other',
  };
  const DATE_LABELS = {
    hearing: 'Hearing', filing: 'Filing', deadline: 'Deadline',
    divorce_final: 'Divorce Final', next_court_date: 'Next Court Date',
    mediation: 'Mediation', deposition: 'Deposition', other: 'Other',
  };
  const STATUS_LABELS = { intake: 'Intake', active: 'Active', on_hold: 'On Hold', closed: 'Closed' };
  const STATUS_BADGE  = { intake: 'normal', active: 'active', on_hold: 'pending', closed: 'closed' };

  const loadingEl  = document.getElementById('cp-loading');
  const errorEl    = document.getElementById('cp-error');
  const matterCard = document.getElementById('cp-matter-card');
  const datesCard  = document.getElementById('cp-dates-card');
  const docsCard   = document.getElementById('cp-docs-card');

  let pendingUpload   = null;
  let currentMatterId = null;

  function showError(msg) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  const TABS = ['overview', 'profile', 'messages'];
  let activeTab = 'overview';
  let cpMsgPollTimer = null;

  function switchTab(tab) {
    if (!TABS.includes(tab)) return;

    if (activeTab === 'messages' && tab !== 'messages') {
      clearInterval(cpMsgPollTimer);
      cpMsgPollTimer = null;
    }

    activeTab = tab;
    TABS.forEach(t => {
      const btn = document.getElementById(`cp-tab-btn-${t}`);
      const pane = document.getElementById(`cp-tab-${t}`);
      const isActive = t === tab;
      if (btn) {
        btn.style.color      = isActive ? 'var(--color-primary)' : 'var(--color-text-muted)';
        btn.style.borderBottomColor = isActive ? 'var(--color-primary)' : 'transparent';
      }
      if (pane) pane.classList.toggle('hidden', !isActive);
    });

    if (tab === 'messages') {
      loadClientMessages();
      cpMsgPollTimer = setInterval(loadClientMessages, 15000);
    }
  }

  document.querySelectorAll('.cp-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Set initial active style
  switchTab('overview');

  // ── Load data ─────────────────────────────────────────────────────────────

  async function load() {
    const { data: clientRows, error: clientErr } = await db
      .from('clients')
      .select(`
        id, first_name, last_name, email,
        phone, home_phone, work_phone, cell_phone, preferred_contact,
        address_line1, address_line2, city, state, zip, county,
        employer, employer_city, employer_state,
        emergency_contact_name, emergency_contact_phone,
        profile_completed_at
      `);

    if (clientErr || !clientRows?.length) {
      showError('Your account is not linked to a client record. Please contact the firm.');
      return;
    }
    const client = clientRows[0];
    document.getElementById('cp-title').textContent    = `Welcome, ${client.first_name}`;
    document.getElementById('cp-subtitle').textContent = 'Your matter information';

    // Load matters (RLS limits to their own)
    const { data: matters } = await db
      .from('matters')
      .select('id, case_type, case_number, status, court_county, assigned_attorney_id, users:assigned_attorney_id(first_name, last_name)')
      .order('created_at', { ascending: false });

    if (!matters?.length) {
      loadingEl.classList.add('hidden');
      matterCard.classList.remove('hidden');
      document.getElementById('cp-matter-body').innerHTML =
        '<p class="text-muted">No active matter on file. Please contact the firm.</p>';
      populateProfileForm(client);
      return;
    }

    const matter = matters[0];
    currentMatterId = matter.id;

    const [{ data: keyDates }, { data: documents }, { data: sigRequests }] = await Promise.all([
      db.from('key_dates')
        .select('id, date_type, date_value, notes, is_milestone')
        .eq('matter_id', matter.id)
        .gte('date_value', new Date().toISOString().slice(0, 10))
        .order('date_value'),
      db.from('documents')
        .select('id, name, file_name, status, r2_key, created_at, doc_type')
        .eq('matter_id', matter.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      db.from('signature_requests')
        .select('id, status, message, expires_at, document:documents(id, file_name)')
        .eq('matter_id', matter.id)
        .eq('status', 'pending_client')
        .order('created_at', { ascending: false }),
    ]);

    loadingEl.classList.add('hidden');
    renderMatter(matter);
    renderDates(keyDates || []);
    renderEsign(sigRequests || []);
    renderDocuments(matter.id, documents || []);
    populateProfileForm(client);
  }

  // ── Render matter card ────────────────────────────────────────────────────

  function renderMatter(m) {
    const attorney = m.users ? `${m.users.first_name} ${m.users.last_name}`.trim() : '—';
    const fields = [
      ['Case type',         CASE_LABELS[m.case_type] || Utils.titleCase(m.case_type)],
      ['Status',            `<span class="badge badge--${STATUS_BADGE[m.status] || 'normal'}">${STATUS_LABELS[m.status] || m.status}</span>`],
      ['Case number',       m.case_number || '—'],
      ['Court / county',    m.court_county || '—'],
      ['Assigned attorney', attorney],
    ];
    document.getElementById('cp-matter-body').innerHTML = fields.map(([label, val]) => `
      <div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">${label}</div>
        <div style="font-weight:500">${val}</div>
      </div>`).join('');
    matterCard.classList.remove('hidden');
  }

  // ── Render key dates ──────────────────────────────────────────────────────

  function renderDates(dates) {
    if (!dates.length) return;
    document.getElementById('cp-dates-body').innerHTML = dates.map(d => {
      const label = DATE_LABELS[d.date_type] || Utils.titleCase(d.date_type);
      const fmt   = Utils.formatDate(d.date_value);
      const soon  = d.date_value <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      return `<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:1px solid var(--color-border)">
        <div style="width:8px;height:8px;border-radius:50%;background:${soon ? 'var(--color-danger)' : 'var(--color-primary)'};flex-shrink:0"></div>
        <div style="flex:1">
          <span style="font-weight:500">${label}</span>
          ${d.notes ? `<span class="text-muted text-sm" style="margin-left:var(--space-2)">— ${Utils.esc(d.notes)}</span>` : ''}
        </div>
        <div style="font-size:var(--text-sm);color:${soon ? 'var(--color-danger)' : 'var(--color-text-muted)'};font-weight:${soon ? '600' : '400'}">${fmt}</div>
      </div>`;
    }).join('');
    datesCard.classList.remove('hidden');
  }

  // ── Render pending signatures ─────────────────────────────────────────────

  function renderEsign(requests) {
    const card = document.getElementById('cp-esign-card');
    const body = document.getElementById('cp-esign-body');
    if (!requests.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    body.innerHTML = requests.map(r => `
      <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:var(--space-3)">
        <svg style="width:20px;height:20px;flex-shrink:0;color:var(--color-primary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${Utils.esc(r.document?.file_name || 'Document')}</div>
          ${r.message ? `<div class="text-sm text-muted" style="margin-top:2px">${Utils.esc(r.message)}</div>` : ''}
        </div>
        <button class="btn btn--primary btn--sm cp-sign-btn" data-req-id="${r.id}" data-doc-name="${Utils.esc(r.document?.file_name || 'Document')}">
          Review &amp; Sign
        </button>
      </div>`).join('');
  }

  // ── Client signing modal ──────────────────────────────────────────────────

  async function openSignModal(reqId, docName) {
    const overlay = document.getElementById('cp-sign-modal');
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;padding:var(--space-6)">
        <h2 class="modal-title" style="margin-bottom:var(--space-2)">Sign Document</h2>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">Document: <strong>${Utils.esc(docName)}</strong></p>
        <div style="margin-bottom:var(--space-4)">
          <a id="cp-sign-download" href="#" target="_blank" class="btn btn--secondary btn--sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Review document before signing
          </a>
        </div>
        <div style="margin-bottom:var(--space-3)">
          <label style="display:block;margin-bottom:var(--space-2);font-size:var(--text-sm);font-weight:600">Draw your signature</label>
          <canvas id="cp-sig-canvas" width="460" height="160"
            style="border:1px solid var(--color-border);border-radius:var(--radius-md);width:100%;touch-action:none;cursor:crosshair;background:#fafafa"></canvas>
          <button type="button" class="btn btn--ghost btn--sm" id="cp-sig-clear" style="margin-top:var(--space-2)">Clear</button>
        </div>
        <div style="margin-bottom:var(--space-4);padding:var(--space-3) var(--space-4);background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md)">
          <label style="display:flex;align-items:flex-start;gap:var(--space-3);cursor:pointer;font-size:var(--text-sm)">
            <input type="checkbox" id="cp-sign-confirm" style="width:auto;margin-top:2px;flex-shrink:0">
            <span>I confirm that I have read and reviewed the document above and understand what I am signing.</span>
          </label>
        </div>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
          By clicking "Sign document" you agree that your electronic signature is legally binding under the Texas Uniform Electronic Transactions Act (UETA).
        </p>
        <div id="cp-sign-err" class="form-error hidden" style="margin-bottom:var(--space-3)"></div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end">
          <button class="btn btn--secondary btn--sm" id="cp-sign-decline">Decline</button>
          <button class="btn btn--secondary btn--sm" id="cp-sign-cancel">Cancel</button>
          <button class="btn btn--primary btn--sm" id="cp-sign-submit">Sign document</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    try {
      const session = await Auth.getSession();
      const res = await fetch(`/api/get-signature-request?id=${reqId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.download_url) overlay.querySelector('#cp-sign-download').href = data.download_url;
    } catch { /* non-fatal */ }

    const canvas = overlay.querySelector('#cp-sig-canvas');
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

    overlay.querySelector('#cp-sig-clear').addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
    overlay.querySelector('#cp-sign-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    overlay.querySelector('#cp-sign-decline').addEventListener('click', async () => {
      if (!await Utils.confirm('Are you sure you want to decline to sign this document? Your attorney will be notified.', { confirmLabel: 'Decline to Sign', danger: true })) return;
      try {
        const session = await Auth.getSession();
        await fetch('/api/decline-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ request_id: reqId }),
        });
        overlay.classList.add('hidden');
        Utils.toast('Signature declined. Your attorney has been notified.', 'info');
        await load();
      } catch {
        Utils.toast('Failed to decline. Please try again.', 'error');
      }
    });

    overlay.querySelector('#cp-sign-submit').addEventListener('click', async () => {
      const submitBtn = overlay.querySelector('#cp-sign-submit');
      const errEl     = overlay.querySelector('#cp-sign-err');

      const confirmed = overlay.querySelector('#cp-sign-confirm').checked;
      if (!confirmed) { errEl.textContent = 'Please confirm that you have read and reviewed the document before signing.'; errEl.classList.remove('hidden'); return; }

      const blank = !ctx.getImageData(0, 0, canvas.width, canvas.height).data.some(v => v !== 0);
      if (blank) { errEl.textContent = 'Please draw your signature above.'; errEl.classList.remove('hidden'); return; }

      errEl.classList.add('hidden');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      try {
        const session  = await Auth.getSession();
        const sigImage = canvas.toDataURL('image/png');
        const res = await fetch('/api/sign-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ request_id: reqId, signature_image: sigImage }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Signing failed.');
        overlay.classList.add('hidden');
        const msg = data.status === 'pending_attorney'
          ? 'Document signed. Your attorney will review and counter-sign.'
          : 'Document fully signed. Thank you!';
        Utils.toast(msg, 'success');
        await load();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign document';
      }
    });
  }

  // ── Render documents ──────────────────────────────────────────────────────

  function renderDocuments(matterId, docs) {
    const checklist = docs.filter(d => d.r2_key?.startsWith('pending/'));
    const uploaded  = docs.filter(d => !d.r2_key?.startsWith('pending/'));
    docsCard.classList.remove('hidden');

    if (!checklist.length && !uploaded.length) {
      document.getElementById('cp-docs-empty').classList.remove('hidden');
      return;
    }

    if (checklist.length) {
      document.getElementById('cp-checklist-section').classList.remove('hidden');
      document.getElementById('cp-checklist-body').innerHTML = checklist.map(d => {
        const done = d.status !== 'pending';
        return `<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--color-border)">
          <div style="width:20px;height:20px;border-radius:4px;border:2px solid ${done ? 'var(--color-success)' : 'var(--color-border-mid)'};background:${done ? 'var(--color-success)' : 'transparent'};display:grid;place-items:center;flex-shrink:0">
            ${done ? '<svg style="width:11px;height:11px" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </div>
          <div style="flex:1;font-weight:500">${Utils.esc(d.name)}</div>
          ${!done ? `<button class="btn btn--primary btn--sm cp-upload-btn" data-document-id="${d.id}" data-matter-id="${matterId}" data-doc-name="${Utils.esc(d.name)}" style="flex-shrink:0">Upload</button>` : `<span class="badge badge--active" style="flex-shrink:0">Received</span>`}
        </div>`;
      }).join('');
    }

    if (uploaded.length) {
      document.getElementById('cp-uploaded-section').classList.remove('hidden');
      document.getElementById('cp-uploaded-body').innerHTML = uploaded.map(d => `
        <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--color-border)">
          <svg style="width:16px;height:16px;flex-shrink:0;color:var(--color-text-muted)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${Utils.esc(d.name)}</div>
            <div class="text-muted text-sm">${Utils.formatDate(d.created_at?.slice(0, 10))}</div>
          </div>
          <button class="btn btn--ghost btn--sm cp-download-btn" data-r2-key="${d.r2_key}" title="Download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>`).join('');
    }
  }

  // ── Upload flow ───────────────────────────────────────────────────────────

  const fileInput = document.getElementById('cp-file-input');

  document.getElementById('cp-esign-card').addEventListener('click', e => {
    const signBtn = e.target.closest('.cp-sign-btn');
    if (signBtn) openSignModal(signBtn.dataset.reqId, signBtn.dataset.docName);
  });

  docsCard.addEventListener('click', async e => {
    const uploadBtn   = e.target.closest('.cp-upload-btn');
    const downloadBtn = e.target.closest('.cp-download-btn');

    if (uploadBtn) {
      pendingUpload = {
        documentId: uploadBtn.dataset.documentId,
        matterId:   uploadBtn.dataset.matterId,
        docName:    uploadBtn.dataset.docName,
      };
      fileInput.value = '';
      fileInput.click();
      return;
    }

    if (downloadBtn) {
      const r2Key = downloadBtn.dataset.r2Key;
      try {
        const session = await Auth.getSession();
        const res = await fetch('/api/get-download-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ r2_key: r2Key }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Download failed.');
        window.open(result.download_url, '_blank');
      } catch (err) {
        Utils.toast(err.message, 'error');
      }
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !pendingUpload) return;

    const { documentId, matterId, docName } = pendingUpload;
    pendingUpload = null;

    const btn = docsCard.querySelector(`[data-document-id="${documentId}"]`);
    if (btn) { btn.textContent = 'Uploading…'; btn.disabled = true; }

    try {
      const session = await Auth.getSession();
      const token   = session.access_token;

      const urlRes = await fetch('/api/get-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          fulfill_document_id: documentId,
          matter_id:           matterId,
          file_name:           file.name,
          file_size:           file.size,
          content_type:        file.type || 'application/octet-stream',
          name:                docName,
        }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Could not prepare upload.');

      const putRes = await fetch(urlData.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed. Please try again.');

      if (btn) btn.textContent = 'Scanning…';
      const confirmRes = await fetch('/api/confirm-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ document_id: urlData.document_id, file_size: file.size, was_placeholder: true }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || 'Upload confirmation failed.');

      Utils.toast('Document uploaded successfully.', 'success');
      await load();
    } catch (err) {
      if (btn) { btn.textContent = 'Upload'; btn.disabled = false; }
      Utils.toast(err.message, 'error');
    }
  });

  // ── Freeform upload modal ─────────────────────────────────────────────────

  function openFreeUploadModal() {
    const overlay = document.getElementById('cp-upload-modal');
    overlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2 class="modal-title">Upload a document</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="cp-free-name">Document name <span class="required">*</span></label>
            <input type="text" id="cp-free-name" placeholder="e.g. Bank statement, W-2, Photo ID" autocomplete="off">
          </div>
          <div class="field">
            <label>File <span class="required">*</span></label>
            <div id="cp-free-drop" style="border:2px dashed var(--color-border);border-radius:var(--radius);padding:var(--space-8);text-align:center;cursor:pointer;transition:border-color 0.15s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:28px;height:28px;margin:0 auto var(--space-2);display:block;color:var(--color-text-muted)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p style="margin:0;color:var(--color-text-muted)" id="cp-free-label">Click or drag a file here</p>
              <p style="margin:var(--space-1) 0 0;font-size:var(--text-xs);color:var(--color-text-muted)">PDF, Word, Excel, JPEG, PNG</p>
            </div>
            <input type="file" id="cp-free-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.webp" style="display:none">
          </div>
          <div id="cp-free-error" class="form-error hidden"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn--secondary" id="cp-free-cancel">Cancel</button>
          <button type="button" class="btn btn--primary" id="cp-free-submit" disabled>Upload</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    const dropZone  = overlay.querySelector('#cp-free-drop');
    const freeInput = overlay.querySelector('#cp-free-file');
    const dropLabel = overlay.querySelector('#cp-free-label');
    const nameInput = overlay.querySelector('#cp-free-name');
    const submitBtn = overlay.querySelector('#cp-free-submit');
    const errEl     = overlay.querySelector('#cp-free-error');
    let selectedFile = null;

    function setFile(f) {
      selectedFile = f;
      dropLabel.textContent = `${f.name} (${Utils.fileSize(f.size)})`;
      dropZone.style.borderColor = 'var(--color-primary)';
      submitBtn.disabled = !nameInput.value.trim();
    }

    dropZone.addEventListener('click', () => freeInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--color-primary)'; });
    dropZone.addEventListener('dragleave', () => { if (!selectedFile) dropZone.style.borderColor = ''; });
    dropZone.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); });
    freeInput.addEventListener('change', e => { if (e.target.files[0]) setFile(e.target.files[0]); });
    nameInput.addEventListener('input', () => { submitBtn.disabled = !nameInput.value.trim() || !selectedFile; });

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.querySelector('#cp-free-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    submitBtn.addEventListener('click', async () => {
      if (!selectedFile || !currentMatterId) return;
      errEl.classList.add('hidden');
      Utils.setLoading(submitBtn, true);

      try {
        const session = await Auth.getSession();
        const token   = session.access_token;
        const docName = nameInput.value.trim();

        const urlRes = await fetch('/api/get-upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            matter_id:    currentMatterId,
            file_name:    selectedFile.name,
            file_size:    selectedFile.size,
            content_type: selectedFile.type || 'application/octet-stream',
            doc_type:     'other',
            name:         docName,
          }),
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok) throw new Error(urlData.error || 'Could not prepare upload.');

        const putRes = await fetch(urlData.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': selectedFile.type || 'application/octet-stream' },
          body: selectedFile,
        });
        if (!putRes.ok) throw new Error('Upload to storage failed. Please try again.');

        const confirmRes = await fetch('/api/confirm-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ document_id: urlData.document_id, file_size: selectedFile.size }),
        });
        const confirmData = await confirmRes.json();
        if (!confirmRes.ok) throw new Error(confirmData.error || 'Upload confirmation failed.');

        overlay.classList.add('hidden');
        Utils.toast('Document uploaded successfully.', 'success');
        await load();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        Utils.setLoading(submitBtn, false);
      }
    });
  }

  document.getElementById('cp-btn-upload').addEventListener('click', openFreeUploadModal);

  // ── My Profile tab ────────────────────────────────────────────────────────

  function populateProfileForm(client) {
    const fields = {
      'cp-cell-phone':       client.cell_phone,
      'cp-home-phone':       client.home_phone,
      'cp-work-phone':       client.work_phone,
      'cp-preferred-contact': client.preferred_contact,
      'cp-address1':         client.address_line1,
      'cp-address2':         client.address_line2,
      'cp-city':             client.city,
      'cp-state':            client.state,
      'cp-zip':              client.zip,
      'cp-employer':         client.employer,
      'cp-emp-city':         client.employer_city,
      'cp-emp-state':        client.employer_state,
      'cp-ec-name':          client.emergency_contact_name,
      'cp-ec-phone':         client.emergency_contact_phone,
    };
    for (const [id, val] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.tagName === 'SELECT') el.value = val || '';
      else el.value = val || '';
    }
  }

  document.getElementById('cp-profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl    = document.getElementById('cp-profile-error');
    const savedMsg = document.getElementById('cp-profile-saved');
    const saveBtn  = document.getElementById('cp-profile-save');

    errEl.classList.add('hidden');
    savedMsg.classList.add('hidden');
    Utils.setLoading(saveBtn, true);

    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/update-client-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          cell_phone:              document.getElementById('cp-cell-phone').value.trim() || null,
          home_phone:              document.getElementById('cp-home-phone').value.trim() || null,
          work_phone:              document.getElementById('cp-work-phone').value.trim() || null,
          preferred_contact:       document.getElementById('cp-preferred-contact').value || null,
          address_line1:           document.getElementById('cp-address1').value.trim() || null,
          address_line2:           document.getElementById('cp-address2').value.trim() || null,
          city:                    document.getElementById('cp-city').value.trim() || null,
          state:                   document.getElementById('cp-state').value.trim().toUpperCase() || null,
          zip:                     document.getElementById('cp-zip').value.trim() || null,
          employer:                document.getElementById('cp-employer').value.trim() || null,
          employer_city:           document.getElementById('cp-emp-city').value.trim() || null,
          employer_state:          document.getElementById('cp-emp-state').value.trim().toUpperCase() || null,
          emergency_contact_name:  document.getElementById('cp-ec-name').value.trim() || null,
          emergency_contact_phone: document.getElementById('cp-ec-phone').value.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      savedMsg.classList.remove('hidden');
      Utils.toast('Profile saved.', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      Utils.setLoading(saveBtn, false);
    }
  });

  // ── Messages tab (client) ─────────────────────────────────────────────────

  function cpRelTime(iso) {
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  }

  async function loadClientMessages() {
    const bubblesEl = document.getElementById('cp-msg-bubbles');
    if (!bubblesEl) return;
    try {
      const session = await Auth.getSession();
      const res  = await fetch('/api/get-messages', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!data.messages?.length) {
        bubblesEl.innerHTML = '<div class="msg-loading">No messages yet — send a message below and your legal team will respond.</div>';
        return;
      }
    const msgs = data.messages;
    bubblesEl.innerHTML = msgs.map(m => {
        // From the client's perspective: their own messages (inbound in DB) go right; firm's messages go left
        const cssDir      = m.direction === 'inbound' ? 'outbound' : 'inbound';
        const senderLabel = m.direction === 'outbound' && m.sender_name ? Utils.esc(m.sender_name) + ' · ' : '';
        return `<div class="msg-bubble ${cssDir}">
          <div class="msg-bubble-body">${Utils.esc(m.body).replace(/\n/g, '<br>')}</div>
          <div class="msg-bubble-meta">${senderLabel}${cpRelTime(m.created_at)}</div>
        </div>`;
      }).join('');
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    } catch { /* non-fatal */ }
  }

  async function sendClientMessage() {
    const inputEl = document.getElementById('cp-msg-input');
    const btnEl   = document.getElementById('cp-msg-send-btn');
    const body    = inputEl?.value.trim();
    if (!body) return;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Sending…'; }
    try {
      const session = await Auth.getSession();
      const res  = await fetch('/api/client-send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (data.message) {
        if (inputEl) { inputEl.value = ''; }
        const charsEl = document.getElementById('cp-msg-chars');
        if (charsEl) charsEl.textContent = '0 / 2000';
        await loadClientMessages();
      } else {
        Utils.toast(data.error || 'Failed to send message.', 'error');
      }
    } catch { Utils.toast('Failed to send. Please try again.', 'error'); }
    finally { if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Send'; } }
  }

  document.getElementById('cp-msg-send-btn')?.addEventListener('click', sendClientMessage);
  document.getElementById('cp-msg-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendClientMessage();
  });
  document.getElementById('cp-msg-input')?.addEventListener('input', function () {
    const c = document.getElementById('cp-msg-chars');
    if (c) c.textContent = `${this.value.length} / 2000`;
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  await load();

})();
