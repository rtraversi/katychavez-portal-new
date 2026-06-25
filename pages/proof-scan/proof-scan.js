'use strict';

(async function ProofScanPage() {

  // ── DOM refs ─────────────────────────────────────────────────────────────────

  const dropZone        = document.getElementById('ps-drop-zone');
  const fileInput       = document.getElementById('ps-file-input');
  const chooseFileBtn   = document.getElementById('ps-choose-file-btn');
  const runBtn          = document.getElementById('ps-run-btn');
  const filenameEl      = document.getElementById('ps-filename');

  const rulesToggle     = document.getElementById('ps-rules-toggle');
  const rulesToggleLabel = document.getElementById('ps-rules-toggle-label');
  const rulesChevron    = document.getElementById('ps-rules-chevron');
  const rulesBody       = document.getElementById('ps-rules-body');
  const rulesFeedback   = document.getElementById('ps-rules-feedback');
  const rulesTextarea   = document.getElementById('ps-rules-textarea');
  const rulesSaveBtn    = document.getElementById('ps-rules-save-btn');
  const rulesResetBtn   = document.getElementById('ps-rules-reset-btn');

  const resultsWrap     = document.getElementById('ps-results-wrap');
  const resultsContent  = document.getElementById('ps-results-content');
  const clearResultsBtn = document.getElementById('ps-clear-results');

  const historyList     = document.getElementById('ps-history-list');

  const modal           = document.getElementById('ps-modal');
  const modalTitle      = document.getElementById('ps-modal-title');
  const modalBody       = document.getElementById('ps-modal-body');
  const modalClose      = document.getElementById('ps-modal-close');

  // ── State ────────────────────────────────────────────────────────────────────

  let selectedFile    = null;
  let rulesOpen       = false;
  let rulesOriginal   = '';
  let rulesChanged    = false;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function getSession() {
    return Auth.getSession();
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function setRulesFeedback(msg, type) {
    // type: 'success' | 'error'
    rulesFeedback.style.display    = 'block';
    rulesFeedback.style.background = type === 'success'
      ? 'var(--color-success-bg,#f0fdf4)' : 'var(--color-danger-bg,#fef2f2)';
    rulesFeedback.style.color = type === 'success'
      ? 'var(--color-success,#15803d)' : 'var(--color-danger,#dc2626)';
    rulesFeedback.style.border = type === 'success'
      ? '1px solid var(--color-success-border,#bbf7d0)' : '1px solid var(--color-danger-border,#fecaca)';
    rulesFeedback.textContent = msg;
  }

  // ── Drop zone / file input ───────────────────────────────────────────────────

  chooseFileBtn.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--color-primary)';
    dropZone.style.background  = 'var(--color-primary-bg,#eff6ff)';
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = '';
    dropZone.style.background  = '';
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    dropZone.style.background  = '';
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) selectFile(fileInput.files[0]);
  });

  function selectFile(file) {
    selectedFile     = file;
    filenameEl.textContent = file.name;
    runBtn.disabled  = false;
  }

  // ── Run Proof Scan ───────────────────────────────────────────────────────────

  runBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    runBtn.disabled    = true;
    runBtn.textContent = 'Scanning…';
    filenameEl.textContent = selectedFile.name;

    try {
      // Read file as base64
      const file_base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      const session = await getSession();
      const res = await fetch('/api/proof-scan', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ file_base64, filename: selectedFile.name }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error((data.detail || data.error) + (data.detail ? ` [${data.error}]` : '') || `HTTP ${res.status}`);

      // Show results
      resultsContent.innerHTML = data.html;
      resultsWrap.classList.remove('hidden');
      resultsWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Refresh history
      await loadHistory();

    } catch (err) {
      Utils.toast('Scan failed: ' + err.message, 'error');
      console.error('[proof-scan] run:', err);
    } finally {
      runBtn.disabled    = false;
      runBtn.textContent = 'Run Proof Scan';
    }
  });

  // ── Clear results ────────────────────────────────────────────────────────────

  clearResultsBtn.addEventListener('click', () => {
    resultsWrap.classList.add('hidden');
    resultsContent.innerHTML = '';
  });

  // ── Rules toggle ─────────────────────────────────────────────────────────────

  rulesToggle.addEventListener('click', async () => {
    rulesOpen = !rulesOpen;
    rulesBody.style.display = rulesOpen ? 'block' : 'none';
    rulesToggleLabel.textContent = rulesOpen ? 'Hide' : 'Show';
    rulesChevron.style.transform = rulesOpen ? 'rotate(180deg)' : '';

    if (rulesOpen) {
      await loadRules();
    }
  });

  async function loadRules() {
    rulesTextarea.value = 'Loading…';
    rulesTextarea.disabled = true;
    rulesSaveBtn.disabled  = true;
    rulesFeedback.style.display = 'none';

    try {
      const session = await getSession();
      const res = await fetch('/api/proof-scan-config', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      rulesOriginal          = data.custom_instructions || '';
      rulesTextarea.value    = rulesOriginal;
      rulesTextarea.disabled = false;
      rulesChanged           = false;
    } catch (err) {
      rulesTextarea.value = '';
      rulesTextarea.disabled = false;
      setRulesFeedback('Could not load saved rules: ' + err.message, 'error');
    }
  }

  rulesTextarea.addEventListener('input', () => {
    rulesChanged          = rulesTextarea.value !== rulesOriginal;
    rulesSaveBtn.disabled = !rulesChanged;
  });

  rulesSaveBtn.addEventListener('click', async () => {
    rulesSaveBtn.disabled    = true;
    rulesSaveBtn.textContent = 'Saving…';
    rulesFeedback.style.display = 'none';

    try {
      const session = await getSession();
      const res = await fetch('/api/proof-scan-config', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ custom_instructions: rulesTextarea.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      rulesOriginal = rulesTextarea.value;
      rulesChanged  = false;
      setRulesFeedback('Rules saved. They will apply to the next scan.', 'success');
    } catch (err) {
      setRulesFeedback('Save failed: ' + err.message, 'error');
    } finally {
      rulesSaveBtn.disabled    = false;
      rulesSaveBtn.textContent = 'Validate & Save';
    }
  });

  rulesResetBtn.addEventListener('click', async () => {
    if (!await Utils.confirm(
      'Reset to core rules only? Your custom instructions will be deleted.',
      { confirmLabel: 'Reset', danger: true }
    )) return;

    rulesTextarea.value = '';
    rulesSaveBtn.disabled = false;
    rulesSaveBtn.click(); // reuse save logic
  });

  // ── History ──────────────────────────────────────────────────────────────────

  async function loadHistory() {
    historyList.innerHTML = '<p style="font-size:var(--text-sm);color:var(--color-text-muted)">Loading…</p>';
    try {
      const session = await getSession();
      const res = await fetch('/api/proof-scan-history', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const scans = data.scans || [];
      if (!scans.length) {
        historyList.innerHTML = '<p style="font-size:var(--text-sm);color:var(--color-text-muted)">No scans yet.</p>';
        return;
      }

      historyList.innerHTML = scans.map(s => {
        const badgeColor = s.status === 'pass'
          ? 'background:#dcfce7;color:#15803d'
          : 'background:#fef9c3;color:#92400e';
        const badgeLabel = s.status === 'pass' ? 'Pass' : 'Needs Correction';
        return `
          <div data-scan-id="${s.id}" style="display:flex;align-items:center;gap:var(--space-3);
               padding:var(--space-3) 0;border-bottom:1px solid var(--color-border);cursor:pointer"
               class="ps-history-item">
            <div style="flex:1;min-width:0">
              <div style="font-weight:500;font-size:var(--text-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${escHtml(s.filename)}
              </div>
              <div style="font-size:var(--text-xs,0.75rem);color:var(--color-text-muted)">${formatDate(s.created_at)}</div>
            </div>
            <span style="${badgeColor};padding:2px 8px;border-radius:9999px;font-size:var(--text-xs,0.75rem);font-weight:600;white-space:nowrap">
              ${badgeLabel}
            </span>
          </div>`;
      }).join('');

      // Attach click handlers to load full result
      historyList.querySelectorAll('.ps-history-item').forEach(el => {
        el.addEventListener('click', () => loadScanResult(el.dataset.scanId, el));
      });

    } catch (err) {
      historyList.innerHTML = `<p style="font-size:var(--text-sm);color:var(--color-danger)">${escHtml(err.message)}</p>`;
    }
  }

  // Load a past scan result into the results area (we'd need a get-scan-by-id endpoint,
  // but since we have the result in the history row's data attribute we use the modal with
  // a re-fetch or show a note directing user to re-run if full HTML not cached).
  // We show the result_html if available via re-fetch of a dedicated endpoint, OR display
  // the results in the main results area. For MVP: show a modal with the scan summary.
  async function loadScanResult(scanId, rowEl) {
    // Fetch full scan result — we'll use a direct Supabase query via the existing client
    // or we can store result temporarily. Since we need the full HTML, we show it from
    // the most recent scan in-memory, or we create a lightweight fetch here.
    // For this implementation, when the user clicks history, we re-display using modal.
    // The result_html is not returned by the history endpoint (only metadata).
    // We need to fetch it — add a simple mechanism using the history row.

    const filename = rowEl.querySelector('[style*="font-weight:500"]').textContent.trim();
    modalTitle.textContent = filename;
    modalBody.innerHTML    = '<p style="color:var(--color-text-muted)">Loading…</p>';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    try {
      const session = await getSession();
      // Re-fetch from proof_scans by id using a simple POST to a generic query endpoint
      // Since we don't have a dedicated get-scan-by-id, use the supabase client directly
      const { data: rows } = await window.db
        .from('proof_scans')
        .select('result_html, filename, status')
        .eq('id', scanId)
        .limit(1);

      if (!rows?.length) throw new Error('Scan not found');
      modalBody.innerHTML = rows[0].result_html;
    } catch (err) {
      modalBody.innerHTML = `<p style="color:var(--color-danger)">Could not load result: ${escHtml(err.message)}</p>`;
    }
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Modal close ──────────────────────────────────────────────────────────────

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal(); });

  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    modalBody.innerHTML = '';
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  await loadHistory();

})();
