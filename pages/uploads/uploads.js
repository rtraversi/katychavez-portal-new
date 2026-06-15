// Module: uploads — page logic.
// Migration range: 400-499. Branch: module/uploads.
// Requires: db (supabase-client), Auth, Utils globals.
'use strict';

(async function UploadsPage() {

  // ── State ────────────────────────────────────────────────────────────────────
  let matters   = [];
  let users     = [];
  let documents = [];
  let selectedMatterId = null;
  let selectedMatter   = null;
  let userProfile      = null;

  const matterMeta     = document.getElementById('matter-meta');
  const docsTbody      = document.getElementById('docs-tbody');
  const docCount       = document.getElementById('doc-count');
  const btnUpload      = document.getElementById('btn-upload-doc');
  const btnChecklist   = document.getElementById('btn-apply-checklist');
  const btnRefresh     = document.getElementById('btn-refresh-docs');
  const missingCard    = document.getElementById('missing-docs-card');
  const missingList    = document.getElementById('missing-docs-list');
  const uploadModal    = document.getElementById('upload-modal');
  const statusModal    = document.getElementById('status-modal');

  const DOC_TYPES = {
    pleading:       'Pleading',
    agreement:      'Agreement',
    correspondence: 'Correspondence',
    financial:      'Financial',
    id:             'ID',
    court_order:    'Court Order',
    other:          'Other',
  };

  const STATUS_LABELS = {
    pending:  'Pending',
    received: 'Received',
    reviewed: 'Reviewed',
    filed:    'Filed',
    signed:   'Signed',
    expired:  'Expired',
  };

  // ── Auth ────────────────────────────────────────────────────────────────────

  userProfile = await Auth.getProfile();

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadMatters() {
    const { data, error } = await db
      .from('matters')
      .select('id, case_type, case_number, status, clients(id, first_name, last_name)')
      .order('status')
      .order('created_at', { ascending: false });

    if (error) { Utils.handleError(error, 'load matters'); return; }
    matters = data || [];
  }

  async function loadUsers() {
    const { data } = await db.from('users').select('id, first_name, last_name').eq('active', true);
    users = data || [];
  }

  async function loadDocuments(matterId) {
    docsTbody.innerHTML = `<tr><td colspan="6" style="padding:var(--space-10);text-align:center;color:var(--color-text-muted)">Loading…</td></tr>`;

    const { data, error } = await db
      .from('documents')
      .select('*')
      .eq('matter_id', matterId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) { Utils.handleError(error, 'load documents'); return; }
    documents = data || [];
    renderDocuments();
    renderMissingDocs();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function renderDocuments() {
    // Show uploaded docs + placeholders that have been actioned offline (received, reviewed, etc.)
    // Pure pending/ placeholders stay hidden — they live in the missing-docs panel instead.
    const active = documents.filter(d =>
      !d.r2_key?.startsWith('pending/') || d.status !== 'pending'
    );

    docCount.textContent = active.length ? `${active.length} document${active.length !== 1 ? 's' : ''}` : '';

    if (!active.length) {
      docsTbody.innerHTML = `
        <tr><td colspan="6">
          <div class="empty-state">
            <p class="empty-state-title">No documents yet</p>
            <p>Upload the first document for this matter.</p>
          </div>
        </td></tr>`;
      return;
    }

    docsTbody.innerHTML = active.map(doc => {
      const uploader  = users.find(u => u.id === doc.uploaded_by);
      const uploaderName = uploader ? Utils.fullName(uploader) : '—';
      const canDelete = userProfile?.role?.name !== 'Paralegal';

      return `<tr data-doc-id="${doc.id}">
        <td>
          <div style="font-weight:500">${Utils.esc(doc.name)}</div>
          <div class="text-muted text-sm">${Utils.esc(doc.file_name)}${doc.file_size ? ' · ' + Utils.fileSize(doc.file_size) : ''}</div>
        </td>
        <td>${Utils.esc(DOC_TYPES[doc.doc_type] || doc.doc_type || '—')}</td>
        <td>
          <button class="btn-status-change" data-doc-id="${doc.id}" data-status="${doc.status}" title="Click to change status">
            <span class="badge badge--${doc.status}">${STATUS_LABELS[doc.status] || doc.status}</span>
          </button>
        </td>
        <td class="text-sm">${Utils.formatDateTime(doc.created_at)}</td>
        <td class="text-sm text-muted">${Utils.esc(uploaderName)}</td>
        <td>
          <div class="flex gap-2">
            ${!doc.r2_key?.startsWith('pending/') ? `
              <button class="btn btn--ghost btn--sm btn-download" data-doc-id="${doc.id}" title="Download">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button class="btn btn--ghost btn--sm btn-request-sig" data-doc-id="${doc.id}" data-doc-name="${Utils.esc(doc.name)}" title="Request e-signature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 19.5v.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8.5L18 5.5"/><path d="M8 18h1l12.5-12.5-1-1L8 17v1z"/></svg>
              </button>` : `
              <button class="btn btn--ghost btn--sm btn-fulfill-doc" data-doc-id="${doc.id}" data-doc-name="${Utils.esc(doc.name)}" data-doc-type="${doc.doc_type || 'other'}" title="Upload file for this document">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </button>`}
            ${canDelete ? `
              <button class="btn btn--ghost btn--sm btn-delete-doc" data-doc-id="${doc.id}" data-doc-name="${Utils.esc(doc.name)}" title="Delete" style="color:var(--color-danger)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function renderMissingDocs() {
    const missing = documents.filter(d => d.is_required && d.status === 'pending');

    if (!missing.length) {
      missingCard.style.display = 'none';
      return;
    }

    missingCard.style.display = '';
    missingList.innerHTML = missing.map(doc => {
      const overdue = doc.required_by_date && doc.required_by_date < new Date().toISOString().slice(0, 10);
      const reminded = doc.last_reminded_at
        ? `<span class="text-sm text-muted" style="margin-left:var(--space-2)">Reminded ${Utils.formatDate(doc.last_reminded_at.slice(0,10))}</span>`
        : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3) 0;border-top:1px solid var(--color-border);gap:var(--space-3);flex-wrap:wrap">
        <div>
          <span style="font-weight:500">${Utils.esc(doc.name)}</span>
          ${doc.doc_type ? `<span class="badge" style="margin-left:var(--space-2)">${DOC_TYPES[doc.doc_type] || doc.doc_type}</span>` : ''}
          ${doc.required_by_date ? `<span class="text-sm ${overdue ? '' : 'text-muted'}" style="${overdue ? 'color:var(--color-danger)' : ''};margin-left:var(--space-2)">Due ${Utils.formatDate(doc.required_by_date)}${overdue ? ' — OVERDUE' : ''}</span>` : ''}
          ${reminded}
        </div>
        <div style="display:flex;gap:var(--space-2);flex-shrink:0">
          <button class="btn btn--sm btn--primary btn-fulfill-doc" data-doc-id="${doc.id}" data-doc-name="${Utils.esc(doc.name)}" data-doc-type="${doc.doc_type || 'other'}">Upload</button>
          <button class="btn btn--info btn--sm btn-mark-received" data-doc-id="${doc.id}" data-doc-name="${Utils.esc(doc.name)}" title="Mark as received offline">Mark Received</button>
          <button class="btn btn--neutral btn--sm btn-na-doc" data-doc-id="${doc.id}" title="Mark not applicable">N/A</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── Upload modal ─────────────────────────────────────────────────────────────

  function openUploadModal() {
    uploadModal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title" id="upload-modal-title">Upload document</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="upload-doc-name">Document name <span class="required">*</span></label>
            <input type="text" id="upload-doc-name" placeholder="e.g. Financial Affidavit" autocomplete="off">
          </div>
          <div class="field">
            <label for="upload-doc-type">Document type</label>
            <select id="upload-doc-type">
              ${Object.entries(DOC_TYPES).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>File <span class="required">*</span></label>
            <div id="drop-zone" style="border:2px dashed var(--color-border);border-radius:var(--radius);padding:var(--space-8);text-align:center;cursor:pointer;transition:border-color 0.15s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;margin:0 auto var(--space-2);display:block;color:var(--color-text-muted)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p style="margin:0;color:var(--color-text-muted)" id="drop-label">Click or drag a file here</p>
              <p style="margin:var(--space-1) 0 0;font-size:var(--text-xs);color:var(--color-text-muted)">PDF, Word, Excel, JPEG, PNG, TIFF — any size</p>
            </div>
            <input type="file" id="upload-file-input" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.webp" style="display:none">
          </div>
          <div id="upload-progress" style="display:none">
            <div style="background:var(--color-border);border-radius:999px;height:6px;overflow:hidden">
              <div id="upload-progress-bar" style="background:var(--color-primary);height:100%;width:0%;transition:width 0.2s"></div>
            </div>
            <p class="text-sm text-muted" id="upload-progress-label" style="margin-top:var(--space-2)">Uploading…</p>
          </div>
          <div id="upload-error" class="form-error hidden"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn--secondary" id="upload-cancel">Cancel</button>
          <button type="button" class="btn btn--primary" id="upload-submit" disabled>Upload</button>
        </div>
      </div>`;

    uploadModal.classList.remove('hidden');

    const dropZone   = document.getElementById('drop-zone');
    const fileInput  = document.getElementById('upload-file-input');
    const dropLabel  = document.getElementById('drop-label');
    const submitBtn  = document.getElementById('upload-submit');
    let   selectedFile = null;

    function setFile(file) {
      selectedFile = file;
      dropLabel.textContent = `${file.name} (${Utils.fileSize(file.size)})`;
      dropZone.style.borderColor = 'var(--color-primary)';
      submitBtn.disabled = !document.getElementById('upload-doc-name').value.trim();
    }

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--color-primary)'; });
    dropZone.addEventListener('dragleave', () => { if (!selectedFile) dropZone.style.borderColor = ''; });
    dropZone.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) setFile(e.target.files[0]); });

    document.getElementById('upload-doc-name').addEventListener('input', e => {
      submitBtn.disabled = !e.target.value.trim() || !selectedFile;
    });

    uploadModal.querySelector('.modal-close').addEventListener('click', closeUploadModal);
    document.getElementById('upload-cancel').addEventListener('click', closeUploadModal);
    uploadModal.addEventListener('click', e => { if (e.target === uploadModal) closeUploadModal(); });

    document.getElementById('upload-submit').addEventListener('click', async () => {
      if (!selectedFile) return;
      await doUpload(selectedFile, submitBtn);
    });
  }

  function closeUploadModal() {
    uploadModal.classList.add('hidden');
    uploadModal.innerHTML = '';
  }

  function openFulfillModal(docId, docName, docType) {
    uploadModal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">Upload: ${Utils.esc(docName)}</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="fulfill-doc-type">Document type</label>
            <select id="fulfill-doc-type">
              ${Object.entries(DOC_TYPES).map(([v,l]) => `<option value="${v}"${v === docType ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>File <span class="required">*</span></label>
            <div id="drop-zone" style="border:2px dashed var(--color-border);border-radius:var(--radius);padding:var(--space-8);text-align:center;cursor:pointer;transition:border-color 0.15s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;margin:0 auto var(--space-2);display:block;color:var(--color-text-muted)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p style="margin:0;color:var(--color-text-muted)" id="drop-label">Click or drag a file here</p>
              <p style="margin:var(--space-1) 0 0;font-size:var(--text-xs);color:var(--color-text-muted)">PDF, Word, Excel, JPEG, PNG, TIFF — any size</p>
            </div>
            <input type="file" id="upload-file-input" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.tiff,.tif,.webp" style="display:none">
          </div>
          <div id="upload-progress" style="display:none">
            <div style="background:var(--color-border);border-radius:999px;height:6px;overflow:hidden">
              <div id="upload-progress-bar" style="background:var(--color-primary);height:100%;width:0%;transition:width 0.2s"></div>
            </div>
            <p class="text-sm text-muted" id="upload-progress-label" style="margin-top:var(--space-2)">Uploading…</p>
          </div>
          <div id="upload-error" class="form-error hidden"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn--secondary" id="upload-cancel">Cancel</button>
          <button type="button" class="btn btn--primary" id="upload-submit" disabled>Upload</button>
        </div>
      </div>`;

    uploadModal.classList.remove('hidden');

    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('upload-file-input');
    const dropLabel = document.getElementById('drop-label');
    const submitBtn = document.getElementById('upload-submit');
    let selectedFile = null;

    function setFile(file) {
      selectedFile = file;
      dropLabel.textContent = `${file.name} (${Utils.fileSize(file.size)})`;
      dropZone.style.borderColor = 'var(--color-primary)';
      submitBtn.disabled = false;
    }

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--color-primary)'; });
    dropZone.addEventListener('dragleave', () => { if (!selectedFile) dropZone.style.borderColor = ''; });
    dropZone.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) setFile(e.target.files[0]); });

    uploadModal.querySelector('.modal-close').addEventListener('click', closeUploadModal);
    document.getElementById('upload-cancel').addEventListener('click', closeUploadModal);
    uploadModal.addEventListener('click', e => { if (e.target === uploadModal) closeUploadModal(); });

    document.getElementById('upload-submit').addEventListener('click', async () => {
      if (!selectedFile) return;
      const resolvedType = document.getElementById('fulfill-doc-type').value;
      await doUpload(selectedFile, submitBtn, { name: docName, docType: resolvedType, fulfillDocId: docId });
    });
  }

  async function doUpload(file, submitBtn, opts = {}) {
    const docName   = opts.name    != null ? opts.name    : document.getElementById('upload-doc-name').value.trim();
    const docType   = opts.docType != null ? opts.docType : document.getElementById('upload-doc-type').value;
    const errEl     = document.getElementById('upload-error');
    const progress  = document.getElementById('upload-progress');
    const progBar   = document.getElementById('upload-progress-bar');
    const progLabel = document.getElementById('upload-progress-label');

    errEl.classList.add('hidden');
    Utils.setLoading(submitBtn, true);

    // 1. Get presigned upload URL
    progLabel.textContent = 'Requesting upload URL…';
    progress.style.display = '';
    progBar.style.width = '10%';

    let uploadData;
    try {
      const uploadPayload = {
        matter_id:    selectedMatterId,
        file_name:    file.name,
        file_size:    file.size,
        content_type: file.type || 'application/octet-stream',
        doc_type:     docType,
        name:         docName,
      };
      if (opts.fulfillDocId) uploadPayload.fulfill_document_id = opts.fulfillDocId;
      uploadData = await callFunction('/api/get-upload-url', uploadPayload);
    } catch (err) {
      showUploadError(err.message, errEl, submitBtn);
      progress.style.display = 'none';
      return;
    }

    // 2. PUT directly to R2
    progLabel.textContent = 'Uploading file…';
    progBar.style.width = '40%';

    try {
      const putRes = await fetch(uploadData.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error(`R2 upload failed (${putRes.status})`);
    } catch (err) {
      showUploadError(err.message, errEl, submitBtn);
      progress.style.display = 'none';
      return;
    }

    // 3. Confirm upload (server runs a malware scan before accepting)
    progLabel.textContent = 'Scanning for malware…';
    progBar.style.width = '85%';

    try {
      await callFunction('/api/confirm-upload', {
        document_id:     uploadData.document_id,
        file_size:       file.size,
        was_placeholder: !!opts.fulfillDocId,
      });
    } catch (err) {
      showUploadError(err.message, errEl, submitBtn);
      progress.style.display = 'none';
      return;
    }

    progBar.style.width = '100%';
    progLabel.textContent = 'Done!';

    setTimeout(() => {
      closeUploadModal();
      Utils.toast('Document uploaded.', 'success');
      loadDocuments(selectedMatterId);
    }, 400);
  }

  function showUploadError(message, errEl, submitBtn) {
    errEl.textContent = message;
    errEl.classList.remove('hidden');
    Utils.setLoading(submitBtn, false);
  }

  // Wraps all Netlify function calls. Detects infrastructure 5xx (Cloudflare/Netlify
  // returns an HTML page, not JSON) and shows a friendly retry message instead of raw HTML.
  async function callFunction(endpoint, body) {
    let res;
    try {
      const session = await Auth.getSession();
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Network error — check your connection and try again.');
    }

    const rawText = await res.text();

    // Session expired — redirect to login rather than showing a confusing error.
    if (res.status === 401) {
      sessionStorage.setItem('login_message', 'Your session expired. Please log in again.');
      setTimeout(() => window.location.replace('/'), 1200);
      throw new Error('Your session has expired. Redirecting to login…');
    }

    // Infrastructure errors (502/503/504) return an HTML page, not our JSON.
    if (res.status >= 500 && !rawText.trimStart().startsWith('{')) {
      throw new Error(
        'A temporary service interruption occurred (provider issue). ' +
        'Please wait a moment and try again.'
      );
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error(`Unexpected server response (${res.status}). Please try again.`); }

    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    return data;
  }

  // ── Status change modal ───────────────────────────────────────────────────────

  function openStatusModal(docId, currentStatus) {
    const doc = documents.find(d => d.id === docId);
    if (!doc) return;

    statusModal.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <h2 class="modal-title">Update status</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="text-muted text-sm" style="margin-bottom:var(--space-4)">${Utils.esc(doc.name)}</p>
          <div class="field" style="margin:0">
            <label for="new-status">Status</label>
            <select id="new-status">
              ${Object.entries(STATUS_LABELS).map(([v,l]) =>
                `<option value="${v}"${v === currentStatus ? ' selected' : ''}>${l}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn--secondary" id="status-cancel">Cancel</button>
          <button type="button" class="btn btn--primary" id="status-save">Save</button>
        </div>
      </div>`;

    statusModal.classList.remove('hidden');
    statusModal.querySelector('.modal-close').addEventListener('click', closeStatusModal);
    document.getElementById('status-cancel').addEventListener('click', closeStatusModal);
    statusModal.addEventListener('click', e => { if (e.target === statusModal) closeStatusModal(); });

    document.getElementById('status-save').addEventListener('click', async () => {
      const newStatus = document.getElementById('new-status').value;
      if (newStatus === currentStatus) { closeStatusModal(); return; }

      const saveBtn = document.getElementById('status-save');
      Utils.setLoading(saveBtn, true);

      const { error } = await db.from('documents').update({ status: newStatus }).eq('id', docId);
      if (error) {
        Utils.handleError(error, 'update status');
        Utils.setLoading(saveBtn, false);
        return;
      }
      closeStatusModal();
      Utils.toast('Status updated.', 'success');
      loadDocuments(selectedMatterId);
    });
  }

  function closeStatusModal() {
    statusModal.classList.add('hidden');
    statusModal.innerHTML = '';
  }

  // ── Download ──────────────────────────────────────────────────────────────────

  async function downloadDoc(docId) {
    try {
      const data = await callFunction('/api/get-download-url', { document_id: docId });
      const a = document.createElement('a');
      a.href = data.download_url;
      a.download = data.file_name || 'document';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      Utils.handleError(err, 'download');
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function deleteDoc(docId, docName) {
    if (!await Utils.confirm(`Delete "${docName}"? This cannot be undone.`, { confirmLabel: 'Delete', danger: true })) return;

    try {
      await callFunction('/api/delete-document', { document_id: docId });
      Utils.toast('Document deleted.', 'success');
      loadDocuments(selectedMatterId);
    } catch (err) {
      Utils.handleError(err, 'delete');
    }
  }

  // ── Apply checklist ───────────────────────────────────────────────────────────

  async function applyChecklist() {
    if (!selectedMatter) return;

    const btn = document.getElementById('btn-apply-checklist');
    Utils.setLoading(btn, true);

    // Fetch checklist items for this case type + universal items
    const { data: items, error } = await db
      .from('document_checklists')
      .select('*')
      .or(`case_types.is.null,case_types.cs.{${selectedMatter.case_type}}`)
      .order('sort_order');

    if (error) { Utils.handleError(error, 'load checklist'); Utils.setLoading(btn, false); return; }

    // Filter out docs already in the matter (by name match)
    const existingNames = new Set(documents.map(d => d.name.toLowerCase()));
    const toCreate = (items || []).filter(item => !existingNames.has(item.doc_name.toLowerCase()));

    if (!toCreate.length) {
      Utils.toast('All checklist items are already present.', 'info');
      Utils.setLoading(btn, false);
      return;
    }

    // Bulk-insert pending rows (one per checklist item)
    // Only create placeholder rows for required items — optional items don't clutter the table
    const rows = toCreate.filter(item => item.is_required_by_default).map(item => ({
      matter_id:        selectedMatterId,
      uploaded_by:      userProfile?.id || null,
      name:             item.doc_name,
      file_name:        item.doc_name,
      r2_key:           `pending/${selectedMatterId}/${crypto.randomUUID()}`,
      content_type:     'application/octet-stream',
      doc_type:         item.doc_category || 'other',
      status:           'pending',
      is_required:      true,
    }));

    const { error: insertErr } = await db.from('documents').insert(rows);
    if (insertErr) { Utils.handleError(insertErr, 'apply checklist'); Utils.setLoading(btn, false); return; }

    Utils.toast(`Added ${toCreate.length} required document${toCreate.length !== 1 ? 's' : ''} to the checklist.`, 'success');
    Utils.setLoading(btn, false);
    loadDocuments(selectedMatterId);
  }

  // ── Mark received (offline) ───────────────────────────────────────────────────

  function openMarkReceivedModal(docId, docName) {
    const overlay = document.getElementById('mark-received-modal');
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h2 class="modal-title">Mark as Received</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">${Utils.esc(docName)}</p>
          <div class="field">
            <label for="mr-source">How was it received? <span class="required">*</span></label>
            <select id="mr-source">
              <option value="Email">Email</option>
              <option value="In person">In person</option>
              <option value="Text / MMS">Text / MMS</option>
              <option value="Fax">Fax</option>
              <option value="Mail">Mail</option>
              <option value="On file — other matter">On file — other matter</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="field" style="margin:0">
            <label for="mr-note">Note <span style="color:var(--color-text-muted);font-weight:400">(optional)</span></label>
            <input type="text" id="mr-note" placeholder="e.g. Received via email on 6/4/2026">
          </div>
          <div id="mr-error" class="form-error hidden" style="margin-top:var(--space-3)"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" id="mr-cancel">Cancel</button>
          <button class="btn btn--primary" id="mr-save">Mark Received</button>
        </div>
      </div>`;

    overlay.classList.remove('hidden');
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.classList.add('hidden'));
    document.getElementById('mr-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    document.getElementById('mr-save').addEventListener('click', async () => {
      const saveBtn = document.getElementById('mr-save');
      const source  = document.getElementById('mr-source').value;
      const note    = document.getElementById('mr-note').value.trim();
      const errEl   = document.getElementById('mr-error');

      errEl.classList.add('hidden');
      Utils.setLoading(saveBtn, true);

      const receivedNote = note ? `${source}: ${note}` : source;
      const { error } = await db
        .from('documents')
        .update({
          status:        'received',
          received_note: receivedNote,
          received_by:   userProfile?.id || null,
        })
        .eq('id', docId);

      if (error) {
        errEl.textContent = error.message || 'Failed to update document.';
        errEl.classList.remove('hidden');
        Utils.setLoading(saveBtn, false);
        return;
      }

      overlay.classList.add('hidden');
      Utils.toast(`"${docName}" marked as received.`, 'success');
      loadDocuments(selectedMatterId);
    });
  }

  // ── Send reminder ─────────────────────────────────────────────────────────────

  function sendReminder() {
    const missing = documents.filter(d => d.is_required && d.status === 'pending');
    if (!missing.length) { Utils.toast('No pending required documents.', 'info'); return; }

    const overlay = document.getElementById('mark-received-modal'); // reuse existing overlay slot
    overlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2 class="modal-title">Send Document Reminder</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted" style="margin-bottom:var(--space-3)">
            Select which documents to include in the reminder email to the client.
          </p>
          <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3)">
            <button class="btn btn--ghost btn--xs" id="reminder-select-all">Select all</button>
            <button class="btn btn--ghost btn--xs" id="reminder-deselect-all">Deselect all</button>
          </div>
          <div id="reminder-doc-list" style="display:flex;flex-direction:column;gap:var(--space-2);max-height:280px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius);padding:var(--space-3)">
            ${missing.map(d => `
              <label style="display:flex;align-items:flex-start;gap:var(--space-3);cursor:pointer;font-size:var(--text-sm);padding:var(--space-1) 0">
                <input type="checkbox" class="reminder-doc-cb" value="${d.id}" checked style="width:auto;margin-top:2px;flex-shrink:0">
                <span>
                  <span style="font-weight:500">${Utils.esc(d.name)}</span>
                  ${d.required_by_date ? `<span class="text-muted" style="margin-left:var(--space-2);font-size:var(--text-xs)">Due ${Utils.formatDate(d.required_by_date)}</span>` : ''}
                </span>
              </label>`).join('')}
          </div>
          <p id="reminder-none-msg" class="text-muted text-sm" style="display:none;margin-top:var(--space-3);text-align:center">Select at least one document to send.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" id="reminder-cancel">Cancel</button>
          <button class="btn btn--primary" id="reminder-send">Send Reminder</button>
        </div>
      </div>`;

    overlay.classList.remove('hidden');

    const checkboxes  = () => [...overlay.querySelectorAll('.reminder-doc-cb')];
    const sendBtn     = document.getElementById('reminder-send');
    const noneMsg     = document.getElementById('reminder-none-msg');

    function updateSendBtn() {
      const anyChecked = checkboxes().some(cb => cb.checked);
      sendBtn.disabled = !anyChecked;
      noneMsg.style.display = anyChecked ? 'none' : '';
    }

    overlay.querySelectorAll('.reminder-doc-cb').forEach(cb => cb.addEventListener('change', updateSendBtn));
    document.getElementById('reminder-select-all').addEventListener('click', () => { checkboxes().forEach(cb => cb.checked = true); updateSendBtn(); });
    document.getElementById('reminder-deselect-all').addEventListener('click', () => { checkboxes().forEach(cb => cb.checked = false); updateSendBtn(); });
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.classList.add('hidden'));
    document.getElementById('reminder-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    sendBtn.addEventListener('click', async () => {
      const selectedIds = checkboxes().filter(cb => cb.checked).map(cb => cb.value);
      if (!selectedIds.length) return;

      Utils.setLoading(sendBtn, true);
      try {
        const data = await callFunction('/api/send-doc-reminder', {
          matter_id:    selectedMatterId,
          document_ids: selectedIds,
        });
        overlay.classList.add('hidden');
        if (data.sent) {
          Utils.toast(`Reminder sent (${data.count} document${data.count !== 1 ? 's' : ''} listed).`, 'success');
          loadDocuments(selectedMatterId);
        } else {
          Utils.toast(data.reason || 'Reminder not sent.', 'info');
        }
      } catch (err) {
        Utils.toast(err.message, 'error');
        Utils.setLoading(sendBtn, false);
      }
    });
  }

  // ── Smart Intake ──────────────────────────────────────────────────────────────
  // 3-step flow: (1) pick client + matter  (2) drop file + AI analysis  (3) confirm + upload
  // PDF and image files only — Word/Excel must be converted to PDF first.

  let siClient = null;   // { id, name }
  let siMatter = null;   // { id, case_type, case_number, status }
  let siFile   = null;   // File object

  const siOverlay = document.getElementById('smart-intake-modal');

  function closeSI() {
    siOverlay.classList.add('hidden');
    siOverlay.innerHTML = '';
    siClient = null;
    siMatter = null;
    siFile   = null;
  }

  function openSmartIntake() {
    siOverlay.innerHTML = buildSIStep1();
    siOverlay.classList.remove('hidden');
    wireSIStep1();
  }

  // ── Step 1: client + matter selection ────────────────────────────────────────

  function buildSIStep1() {
    return `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2 class="modal-title">Smart Document Intake</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted" style="margin-bottom:var(--space-5)">Step 1 of 3 — Select the client this document belongs to.</p>

          <div class="field" style="position:relative;margin-bottom:var(--space-4)">
            <label>Client</label>
            <div id="si-search-wrap">
              <input type="text" id="si-search" placeholder="Type a name to search…" autocomplete="off">
              <div id="si-results" style="position:absolute;top:100%;left:0;right:0;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:1002;max-height:200px;overflow-y:auto;display:none"></div>
            </div>
            <div id="si-selected-wrap" style="display:none;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--color-bg-subtle);border-radius:var(--radius)">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5" style="width:13px;height:13px;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>
              <span id="si-selected-name" style="font-weight:500;font-size:var(--text-sm)"></span>
              <button id="si-change-client" class="btn btn--ghost btn--xs" style="margin-left:auto;font-size:var(--text-xs)">Change</button>
            </div>
          </div>

          <div id="si-matter-wrap" style="display:none">
            <div class="field" style="margin:0">
              <label for="si-matter-select">Matter</label>
              <select id="si-matter-select"></select>
            </div>
          </div>

          <div id="si-no-matters" class="form-error hidden" style="margin-top:var(--space-3)">
            This client has no matters. Please create a matter first.
          </div>
          <div id="si-step1-err" class="form-error hidden"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" id="si-cancel1">Cancel</button>
          <button class="btn btn--primary" id="si-next1" disabled>Next →</button>
        </div>
      </div>`;
  }

  function wireSIStep1() {
    siOverlay.querySelector('.modal-close').addEventListener('click', closeSI);
    document.getElementById('si-cancel1').addEventListener('click', closeSI);
    siOverlay.addEventListener('click', e => { if (e.target === siOverlay) closeSI(); });

    const searchWrap   = document.getElementById('si-search-wrap');
    const selectedWrap = document.getElementById('si-selected-wrap');
    const searchInput  = document.getElementById('si-search');
    const resultsDiv   = document.getElementById('si-results');
    const selectedName = document.getElementById('si-selected-name');
    const matterWrap   = document.getElementById('si-matter-wrap');
    const matterSel    = document.getElementById('si-matter-select');
    const noMatters    = document.getElementById('si-no-matters');
    const nextBtn      = document.getElementById('si-next1');

    // Restore state if coming back from Step 2
    if (siClient) {
      searchWrap.style.display = 'none';
      selectedName.textContent = siClient.name;
      selectedWrap.style.display = 'flex';
      if (siMatter) nextBtn.disabled = false;
    }

    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = searchInput.value.trim();
      if (q.length < 2) { resultsDiv.style.display = 'none'; return; }
      debounce = setTimeout(() => doClientSearch(q), 280);
    });

    async function doClientSearch(q) {
      resultsDiv.innerHTML = `<div style="padding:var(--space-3);font-size:var(--text-sm);color:var(--color-text-muted)">Searching…</div>`;
      resultsDiv.style.display = '';
      const { data } = await db
        .from('clients')
        .select('id, first_name, last_name')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .eq('active', true)
        .order('last_name')
        .limit(10);

      const list = data || [];
      if (!list.length) {
        resultsDiv.innerHTML = `<div style="padding:var(--space-3);font-size:var(--text-sm);color:var(--color-text-muted)">No clients found</div>`;
        return;
      }
      resultsDiv.innerHTML = list.map(c => `
        <div class="si-opt" data-id="${c.id}" data-name="${Utils.esc(Utils.fullName(c))}"
          style="padding:var(--space-3) var(--space-4);cursor:pointer;font-size:var(--text-sm);border-bottom:1px solid var(--color-border)">
          ${Utils.esc(Utils.fullName(c))}
        </div>`).join('');
      resultsDiv.querySelectorAll('.si-opt').forEach(el => {
        el.addEventListener('mouseenter', () => el.style.background = 'var(--color-bg-subtle)');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('click', () => selectSIClient(el.dataset.id, el.dataset.name));
      });
    }

    async function selectSIClient(id, name) {
      resultsDiv.style.display = 'none';
      searchWrap.style.display = 'none';
      selectedName.textContent = name;
      selectedWrap.style.display = 'flex';
      siClient = { id, name };
      siMatter = null;
      noMatters.classList.add('hidden');
      matterWrap.style.display = 'none';
      nextBtn.disabled = true;

      const { data } = await db
        .from('matters')
        .select('id, case_type, case_number, status')
        .eq('client_id', id)
        .order('created_at', { ascending: false });

      const list = data || [];
      if (!list.length) { noMatters.classList.remove('hidden'); return; }

      if (list.length === 1) {
        siMatter = list[0];
      } else {
        matterWrap.style.display = '';
        matterSel.innerHTML = list.map(m =>
          `<option value="${m.id}">${Utils.titleCase(m.case_type)}${m.case_number ? ' (' + m.case_number + ')' : ''} · ${Utils.titleCase(m.status)}</option>`
        ).join('');
        siMatter = list[0];
        matterSel.addEventListener('change', () => {
          siMatter = list.find(m => m.id === matterSel.value) || null;
        });
      }
      nextBtn.disabled = false;
    }

    document.getElementById('si-change-client').addEventListener('click', () => {
      siClient = null;
      siMatter = null;
      selectedWrap.style.display = 'none';
      searchWrap.style.display = '';
      searchInput.value = '';
      matterWrap.style.display = 'none';
      noMatters.classList.add('hidden');
      nextBtn.disabled = true;
    });

    nextBtn.addEventListener('click', () => {
      if (siClient && siMatter) renderSIStep2();
    });
  }

  // ── Step 2: drop file + AI analysis ──────────────────────────────────────────

  function renderSIStep2() {
    siOverlay.innerHTML = `
      <style>@keyframes si-spin{to{transform:rotate(360deg)}}</style>
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2 class="modal-title">Smart Document Intake</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted" style="margin-bottom:var(--space-5)">
            Step 2 of 3 — Drop the document for <strong>${Utils.esc(siClient.name)}</strong>.
          </p>
          <div id="si-dropzone" style="border:2px dashed var(--color-border);border-radius:var(--radius);padding:var(--space-8);text-align:center;cursor:pointer;transition:border-color 0.15s;position:relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;margin:0 auto var(--space-2);display:block;color:var(--color-text-muted)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p id="si-drop-label" style="margin:0;color:var(--color-text-muted)">Click or drag a file here</p>
            <p style="margin:var(--space-1) 0 0;font-size:var(--text-xs);color:var(--color-text-muted)">
              PDF and image files only. Word/Excel must be converted to PDF first.
            </p>
            <div id="si-analyzing" style="display:none;position:absolute;inset:0;background:rgba(255,255,255,.92);border-radius:var(--radius);flex-direction:column;align-items:center;justify-content:center;gap:var(--space-2)">
              <div style="width:22px;height:22px;border:3px solid var(--color-primary);border-top-color:transparent;border-radius:50%;animation:si-spin .7s linear infinite"></div>
              <p style="margin:0;font-size:var(--text-sm);color:var(--color-text-muted)">Analyzing document…</p>
            </div>
          </div>
          <input type="file" id="si-file-input" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tif,.tiff" style="display:none">
          <div id="si-step2-err" class="form-error hidden" style="margin-top:var(--space-3)"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" id="si-back1">← Back</button>
        </div>
      </div>`;

    siOverlay.querySelector('.modal-close').addEventListener('click', closeSI);
    siOverlay.addEventListener('click', e => { if (e.target === siOverlay) closeSI(); });
    document.getElementById('si-back1').addEventListener('click', () => {
      siFile = null;
      siOverlay.innerHTML = buildSIStep1();
      wireSIStep1();
    });

    const dropzone  = document.getElementById('si-dropzone');
    const fileInput = document.getElementById('si-file-input');
    const dropLabel = document.getElementById('si-drop-label');
    const analyzing = document.getElementById('si-analyzing');
    const errEl     = document.getElementById('si-step2-err');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--color-primary)'; });
    dropzone.addEventListener('dragleave', () => { if (!siFile) dropzone.style.borderColor = ''; });
    dropzone.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleSIFile(f); });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) handleSIFile(e.target.files[0]); });

    async function handleSIFile(file) {
      const accepted = ['application/pdf','image/jpeg','image/jpg','image/png','image/gif','image/webp','image/tiff','image/tif'];
      const mt = file.type.split(';')[0].trim();
      if (!accepted.includes(mt)) {
        errEl.textContent = 'Unsupported file type. Upload a PDF or image. Convert Word/Excel to PDF first.';
        errEl.classList.remove('hidden');
        return;
      }
      errEl.classList.add('hidden');
      siFile = file;
      dropLabel.textContent = `${file.name} (${Utils.fileSize(file.size)})`;
      dropzone.style.borderColor = 'var(--color-primary)';
      analyzing.style.display = 'flex';

      let aiResult = { doc_type: 'other', doc_name: '' };
      try { aiResult = await runAIAnalysis(file); } catch { /* silent — user fills in manually */ }

      analyzing.style.display = 'none';
      renderSIStep3(aiResult);
    }
  }

  async function runAIAnalysis(file) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return callFunction('/api/analyze-document', {
      file_base64:  base64,
      content_type: file.type,
      file_name:    file.name,
    });
  }

  // ── Step 3: confirm doc name + type, then upload ──────────────────────────────

  function renderSIStep3(aiResult) {
    const defaultName = aiResult.doc_name || siFile.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const caseLabel   = Utils.titleCase(siMatter.case_type || 'matter');

    siOverlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2 class="modal-title">Smart Document Intake</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
            Step 3 of 3 — Confirm details for <strong>${Utils.esc(siClient.name)}</strong> · ${Utils.esc(caseLabel)}.
          </p>
          ${aiResult.doc_name ? `
          <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--color-bg-subtle);border-radius:var(--radius);margin-bottom:var(--space-4);font-size:var(--text-sm)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2" style="width:13px;height:13px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            AI detected: <strong>${Utils.esc(DOC_TYPES[aiResult.doc_type] || 'Unknown')}</strong> — review and confirm below.
          </div>` : ''}
          <div class="field">
            <label for="si-doc-name">Document name <span class="required">*</span></label>
            <input type="text" id="si-doc-name" value="${Utils.esc(defaultName)}" placeholder="e.g. Financial Affidavit" autocomplete="off">
          </div>
          <div class="field" style="margin-bottom:0">
            <label for="si-doc-type">Document type</label>
            <select id="si-doc-type">
              ${Object.entries(DOC_TYPES).map(([v, l]) =>
                `<option value="${v}"${v === aiResult.doc_type ? ' selected' : ''}>${l}</option>`
              ).join('')}
            </select>
          </div>
          <div id="si-upload-progress" style="display:none;margin-top:var(--space-4)">
            <div style="background:var(--color-border);border-radius:999px;height:6px;overflow:hidden">
              <div id="si-prog-bar" style="background:var(--color-primary);height:100%;width:0%;transition:width .2s"></div>
            </div>
            <p class="text-sm text-muted" id="si-prog-label" style="margin-top:var(--space-2)">Uploading…</p>
          </div>
          <div id="si-step3-err" class="form-error hidden" style="margin-top:var(--space-3)"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" id="si-back2">← Back</button>
          <button class="btn btn--primary" id="si-submit">File Document</button>
        </div>
      </div>`;

    siOverlay.querySelector('.modal-close').addEventListener('click', closeSI);
    siOverlay.addEventListener('click', e => { if (e.target === siOverlay) closeSI(); });
    document.getElementById('si-back2').addEventListener('click', () => { siFile = null; renderSIStep2(); });

    document.getElementById('si-submit').addEventListener('click', async () => {
      const docName = document.getElementById('si-doc-name').value.trim();
      const docType = document.getElementById('si-doc-type').value;
      const errEl   = document.getElementById('si-step3-err');
      if (!docName) { errEl.textContent = 'Please enter a document name.'; errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      await doSIUpload(docName, docType);
    });
  }

  async function doSIUpload(docName, docType) {
    const submitBtn  = document.getElementById('si-submit');
    const errEl      = document.getElementById('si-step3-err');
    const progress   = document.getElementById('si-upload-progress');
    const progBar    = document.getElementById('si-prog-bar');
    const progLabel  = document.getElementById('si-prog-label');

    Utils.setLoading(submitBtn, true);
    progress.style.display = '';
    progBar.style.width = '10%';
    progLabel.textContent = 'Requesting upload URL…';

    try {
      const uploadData = await callFunction('/api/get-upload-url', {
        matter_id:    siMatter.id,
        file_name:    siFile.name,
        file_size:    siFile.size,
        content_type: siFile.type || 'application/octet-stream',
        doc_type:     docType,
        name:         docName,
      });

      progLabel.textContent = 'Uploading file…';
      progBar.style.width = '45%';

      const putRes = await fetch(uploadData.upload_url, {
        method:  'PUT',
        headers: { 'Content-Type': siFile.type || 'application/octet-stream' },
        body:    siFile,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      progLabel.textContent = 'Scanning for malware…';
      progBar.style.width = '85%';

      await callFunction('/api/confirm-upload', {
        document_id: uploadData.document_id,
        file_size:   siFile.size,
      });

      progBar.style.width = '100%';

      setTimeout(() => {
        const fName  = docName;
        const cName  = siClient.name;
        const matterId = siMatter.id;

        siOverlay.innerHTML = `
          <div class="modal" style="max-width:440px">
            <div class="modal-header"><h2 class="modal-title">Document Filed</h2></div>
            <div class="modal-body" style="text-align:center;padding:var(--space-8) var(--space-6)">
              <div style="width:48px;height:48px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-4)">
                <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" style="width:22px;height:22px"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <p style="font-weight:600;margin:0 0 var(--space-1)">${Utils.esc(fName)}</p>
              <p class="text-sm text-muted" style="margin:0 0 var(--space-6)">Filed for ${Utils.esc(cName)}</p>
              <div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap">
                <button class="btn btn--secondary" id="si-another">Add another document</button>
                <button class="btn btn--primary" id="si-view-matter">View in Document Intake</button>
              </div>
            </div>
          </div>`;

        document.getElementById('si-another').addEventListener('click', () => {
          siFile = null;
          renderSIStep2();
        });
        document.getElementById('si-view-matter').addEventListener('click', () => {
          closeSI();
          const m = matters.find(x => x.id === matterId);
          if (m) setComboboxSelection(m);
        });

        Utils.toast('Document filed successfully.', 'success');
      }, 350);

    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      Utils.setLoading(submitBtn, false);
      progress.style.display = 'none';
    }
  }

  // ── Mark not-applicable ───────────────────────────────────────────────────────

  async function markNotApplicable(docId) {
    const { error } = await db
      .from('documents')
      .update({ is_required: false })
      .eq('id', docId);

    if (error) { Utils.handleError(error, 'mark N/A'); return; }
    loadDocuments(selectedMatterId);
  }

  // ── Matter combobox ───────────────────────────────────────────────────────────

  function filterMatters(q) {
    const lower = q.toLowerCase();
    return matters.filter(m => {
      const client = m.clients;
      if (!client) return false;
      const name     = `${client.first_name} ${client.last_name}`.toLowerCase();
      const caseType = (m.case_type || '').toLowerCase().replace(/_/g, ' ');
      const caseNum  = (m.case_number || '').toLowerCase();
      return name.includes(lower) || caseType.includes(lower) || caseNum.includes(lower);
    });
  }

  function selectMatter(matter) {
    selectedMatterId = matter ? matter.id : null;
    selectedMatter   = matter || null;
    btnUpload.disabled    = !selectedMatterId;
    btnChecklist.disabled = !selectedMatterId;
    btnRefresh.disabled   = !selectedMatterId;

    if (!matter) {
      matterMeta.textContent    = '';
      docCount.textContent      = '';
      docsTbody.innerHTML       = `<tr><td colspan="6" style="padding:var(--space-12);text-align:center;color:var(--color-text-muted)">Select a matter above to view documents</td></tr>`;
      missingCard.style.display = 'none';
      return;
    }

    const client = matter.clients;
    matterMeta.textContent = client
      ? `${Utils.fullName(client)} · ${Utils.titleCase(matter.case_type)} · ${Utils.titleCase(matter.status)}`
      : '';
    loadDocuments(selectedMatterId);
  }

  function setComboboxSelection(matter) {
    const searchWrap    = document.getElementById('matter-search-wrap');
    const selectedWrap  = document.getElementById('matter-selected-wrap');
    const selectedLabel = document.getElementById('matter-selected-label');
    const resultsDiv    = document.getElementById('matter-results');

    if (!matter) {
      selectedWrap.style.display = 'none';
      searchWrap.style.display   = '';
      document.getElementById('matter-search').value = '';
      if (resultsDiv) resultsDiv.style.display = 'none';
      selectMatter(null);
      return;
    }

    const client = matter.clients;
    const name   = client ? Utils.fullName(client) : 'Unknown';
    selectedLabel.textContent = `${name} — ${Utils.titleCase(matter.case_type)}${matter.case_number ? ' (' + matter.case_number + ')' : ''}`;
    selectedWrap.style.display = 'flex';
    searchWrap.style.display   = 'none';
    if (resultsDiv) resultsDiv.style.display = 'none';
    selectMatter(matter);
  }

  function wireMatterCombobox() {
    const searchInput  = document.getElementById('matter-search');
    const resultsDiv   = document.getElementById('matter-results');
    const combobox     = document.getElementById('matter-combobox');

    function renderResults(list, footerMsg) {
      if (!list.length) {
        resultsDiv.innerHTML = `<div style="padding:var(--space-3) var(--space-4);font-size:var(--text-sm);color:var(--color-text-muted)">No matters found</div>`;
      } else {
        resultsDiv.innerHTML = list.map(m => {
          const client = m.clients;
          const name   = client ? Utils.fullName(client) : 'Unknown';
          const label  = `${Utils.titleCase(m.case_type)}${m.case_number ? ' (' + m.case_number + ')' : ''}`;
          return `<div class="matter-opt" data-id="${m.id}"
            style="padding:var(--space-3) var(--space-4);cursor:pointer;border-bottom:1px solid var(--color-border)">
            <div style="font-weight:500;font-size:var(--text-sm)">${Utils.esc(name)}</div>
            <div style="font-size:var(--text-xs);color:var(--color-text-muted)">${Utils.esc(label)} · ${Utils.titleCase(m.status)}</div>
          </div>`;
        }).join('');
        if (footerMsg) {
          resultsDiv.innerHTML += `<div style="padding:var(--space-2) var(--space-4);font-size:var(--text-xs);color:var(--color-text-muted);background:var(--color-bg-subtle);border-top:1px solid var(--color-border)">${footerMsg}</div>`;
        }
      }
      resultsDiv.style.display = '';
      resultsDiv.querySelectorAll('.matter-opt').forEach(el => {
        el.addEventListener('mouseenter', () => el.style.background = 'var(--color-bg-subtle)');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('click',      () => {
          const m = matters.find(x => x.id === el.dataset.id);
          if (m) setComboboxSelection(m);
        });
      });
    }

    function showResults() {
      const q = searchInput.value.trim();
      if (!q) {
        const top  = matters.slice(0, 10);
        const hint = matters.length > 10 ? `Showing 10 of ${matters.length} — type to search` : null;
        renderResults(top, hint);
      } else {
        const all  = filterMatters(q);
        const top  = all.slice(0, 50);
        const hint = all.length > 50 ? `Showing 50 of ${all.length} matches — type to narrow` : null;
        renderResults(top, hint);
      }
    }

    searchInput.addEventListener('focus', showResults);
    searchInput.addEventListener('input', showResults);

    document.getElementById('matter-clear').addEventListener('click', () => {
      setComboboxSelection(null);
      document.getElementById('matter-search').focus();
    });

    document.addEventListener('click', e => {
      if (!combobox.contains(e.target)) resultsDiv.style.display = 'none';
    });
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  document.getElementById('btn-smart-intake').addEventListener('click', openSmartIntake);
  btnUpload.addEventListener('click', openUploadModal);
  btnChecklist.addEventListener('click', applyChecklist);
  btnRefresh.addEventListener('click', () => { if (selectedMatterId) loadDocuments(selectedMatterId); });
  document.getElementById('btn-send-reminder').addEventListener('click', sendReminder);

  // Event delegation for table actions
  docsTbody.addEventListener('click', e => {
    const dlBtn      = e.target.closest('.btn-download');
    const delBtn     = e.target.closest('.btn-delete-doc');
    const statusBtn  = e.target.closest('.btn-status-change');
    const fulfillBtn = e.target.closest('.btn-fulfill-doc');
    const sigBtn     = e.target.closest('.btn-request-sig');

    if (dlBtn)      { downloadDoc(dlBtn.dataset.docId); return; }
    if (delBtn)     { deleteDoc(delBtn.dataset.docId, delBtn.dataset.docName); return; }
    if (statusBtn)  { openStatusModal(statusBtn.dataset.docId, statusBtn.dataset.status); return; }
    if (fulfillBtn) { openFulfillModal(fulfillBtn.dataset.docId, fulfillBtn.dataset.docName, fulfillBtn.dataset.docType); return; }
    if (sigBtn)     { openSigRequestModal(sigBtn.dataset.docId, sigBtn.dataset.docName); return; }
  });

  // Event delegation for missing-docs panel
  missingList.addEventListener('click', e => {
    const naBtn          = e.target.closest('.btn-na-doc');
    const fulfillBtn     = e.target.closest('.btn-fulfill-doc');
    const markReceivedBtn = e.target.closest('.btn-mark-received');
    if (naBtn)           markNotApplicable(naBtn.dataset.docId);
    if (fulfillBtn)      openFulfillModal(fulfillBtn.dataset.docId, fulfillBtn.dataset.docName, fulfillBtn.dataset.docType);
    if (markReceivedBtn) openMarkReceivedModal(markReceivedBtn.dataset.docId, markReceivedBtn.dataset.docName);
  });

  // ── Signature request modal ──────────────────────────────────────────────────

  function openSigRequestModal(docId, docName) {
    const overlay = document.getElementById('sig-request-modal');
    overlay.innerHTML = `
      <div class="modal" style="max-width:540px;padding:var(--space-6)">
        <h2 class="modal-title" style="margin-bottom:var(--space-2)">Request E-Signature</h2>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-5)">
          Document: <strong>${Utils.esc(docName)}</strong>
        </p>
        <div class="field" style="margin-bottom:var(--space-4)">
          <label style="display:flex;align-items:center;gap:var(--space-3);font-weight:400;cursor:pointer">
            <input type="checkbox" id="sig-countersign" checked style="width:auto">
            Require attorney counter-signature after client signs
          </label>
        </div>
        <div class="field" style="margin-bottom:var(--space-5)">
          <label>Message to client <span style="font-weight:400;color:var(--color-text-muted)">(optional)</span></label>
          <textarea id="sig-message" rows="4" placeholder="E.g. Please review and sign your retainer agreement."></textarea>
        </div>
        <div id="sig-request-err" class="form-error hidden" style="margin-bottom:var(--space-3)"></div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end">
          <button class="btn btn--secondary btn--sm" id="sig-cancel">Cancel</button>
          <button class="btn btn--primary btn--sm" id="sig-send">Send signature request</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.querySelector('#sig-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    overlay.querySelector('#sig-send').addEventListener('click', async () => {
      const sendBtn   = overlay.querySelector('#sig-send');
      const errEl     = overlay.querySelector('#sig-request-err');
      const countersign = overlay.querySelector('#sig-countersign').checked;
      const message   = overlay.querySelector('#sig-message').value.trim();

      errEl.classList.add('hidden');
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';

      try {
        await callFunction('/api/create-signature-request', {
          document_id:          docId,
          requires_countersign: countersign,
          message:              message || null,
        });
        overlay.classList.add('hidden');
        Utils.toast('Signature request sent to client.', 'success');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send signature request';
      }
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  await Promise.all([loadMatters(), loadUsers()]);
  wireMatterCombobox();

  // Pre-select matter if navigated from client detail page
  if (window._uploadsMatterId) {
    const preId = window._uploadsMatterId;
    window._uploadsMatterId = null;
    const preselect = matters.find(m => m.id === preId);
    if (preselect) setComboboxSelection(preselect);
  }

})();
