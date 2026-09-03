'use strict';

// Proof Scan page controller.
//
// Batch 3 connected the approved lab experience to the structured API. The flow:
// staff pick a scan type explicitly, choose a PDF, and press Run Proof Scan. The
// request goes to the authenticated /api/proof-scan, which loads the profile,
// asks Claude for observations, validates them, and returns composed data. This
// file hands that data to report.js, which draws it with text nodes only.
//
// Batch 4 finished history. Both the list and every result body now come from the
// authenticated /api/proof-scan-history endpoint; the browser no longer queries
// Supabase for scan content. Reopening a structured scan runs the SAME report
// model and renderer a fresh scan uses, against a result the server re-validated.
// Legacy result_html rows open labelled as legacy and displayed as one inert
// text node by legacy-html.js — the stored markup is never parsed or injected.
//
// There is no assignment to innerHTML anywhere in this file.

(async function ProofScanPage() {

  // ── DOM refs ─────────────────────────────────────────────────────────────────

  const scanTypeSelect  = document.getElementById('ps-scan-type');
  const dropZone        = document.getElementById('ps-drop-zone');
  const dropTitle       = document.getElementById('ps-drop-title');
  const dropMeta        = document.getElementById('ps-drop-meta');
  const fileInput       = document.getElementById('ps-file-input');
  const chooseFileBtn   = document.getElementById('ps-choose-file-btn');
  const runBtn          = document.getElementById('ps-run-btn');
  const filenameEl      = document.getElementById('ps-filename');
  const scanStatus      = document.getElementById('ps-scan-status');

  const rulesToggle     = document.getElementById('ps-rules-toggle');
  const rulesToggleLabel = document.getElementById('ps-rules-toggle-label');
  const rulesChevron    = document.getElementById('ps-rules-chevron');
  const rulesBody       = document.getElementById('ps-rules-body');
  const rulesFeedback   = document.getElementById('ps-rules-feedback');
  const rulesTextarea   = document.getElementById('ps-rules-textarea');
  const rulesSaveBtn    = document.getElementById('ps-rules-save-btn');
  const rulesResetBtn   = document.getElementById('ps-rules-reset-btn');
  const notifyEmailInput = document.getElementById('ps-notify-email');

  const resultsWrap     = document.getElementById('ps-results-wrap');
  const resultsContent  = document.getElementById('ps-results-content');
  const storageWarning  = document.getElementById('ps-storage-warning');
  const clearResultsBtn = document.getElementById('ps-clear-results');

  const historyList     = document.getElementById('ps-history-list');

  const modal           = document.getElementById('ps-modal');
  const modalTitle      = document.getElementById('ps-modal-title');
  const modalBody       = document.getElementById('ps-modal-body');
  const modalClose      = document.getElementById('ps-modal-close');

  // Listeners on nodes inside #page-content die with the nodes when the SPA swaps
  // routes. Document-level ones do not, so they hang off an AbortController that
  // the next run of this script aborts before wiring its own.
  window.__psAbort?.abort();
  const pageAbort = new AbortController();
  window.__psAbort = pageAbort;
  const onDocument = (type, fn) =>
    document.addEventListener(type, fn, { signal: pageAbort.signal });

  // ── Report modules ───────────────────────────────────────────────────────────
  //
  // Loaded on demand, both stamped with the deploy version so a released build can
  // never pair a new renderer with a cached model (or the reverse).

  const v = window.APP_CONFIG?.deployVersion || '';
  let reportModules = null;
  async function loadReport() {
    if (!reportModules) {
      const [model, view, legacy] = await Promise.all([
        import(`/pages/proof-scan/report-model.js?v=${v}`),
        import(`/pages/proof-scan/report.js?v=${v}`),
        import(`/pages/proof-scan/legacy-html.js?v=${v}`),
      ]);
      reportModules = {
        ...model,
        renderReport:       view.renderReport,
        renderLegacyReport: view.renderLegacyReport,
        renderUnavailable:  view.renderUnavailable,
        sanitizeLegacyHtml: legacy.sanitizeLegacyHtml,
      };
    }
    return reportModules;
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let selectedFile        = null;
  let scanning            = false;
  let rulesOpen           = false;
  let rulesOriginal       = '';
  let notifyEmailOriginal = '';
  let rulesChanged        = false;

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const announce = (msg) => { if (scanStatus) scanStatus.textContent = msg; };

  async function getSession() {
    return Auth.getSession();
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function setRulesFeedback(msg, type) {
    // type: 'success' | 'error' — token-driven so it stays readable in dark mode.
    const accent = type === 'success' ? 'var(--color-success)' : 'var(--color-danger)';
    rulesFeedback.style.display    = 'block';
    rulesFeedback.style.background = type === 'success'
      ? 'var(--color-success-bg)' : 'var(--color-danger-bg)';
    rulesFeedback.style.color  = accent;
    rulesFeedback.style.border = `1px solid color-mix(in srgb, ${accent} 32%, transparent)`;
    rulesFeedback.textContent = msg;
  }

  // ── Scan type gate ───────────────────────────────────────────────────────────
  //
  // The only thing that unlocks upload. Nothing infers it — not the filename, not
  // the forms in the package, not the model.

  function scanTypeValue() {
    return scanTypeSelect?.value || '';
  }

  function applyScanTypeGate() {
    const chosen = Boolean(scanTypeValue());
    dropZone.classList.toggle('is-locked', !chosen);
    dropZone.setAttribute('aria-disabled', String(!chosen));
    dropZone.tabIndex = chosen ? 0 : -1;
    chooseFileBtn.disabled = !chosen;
    dropZone.setAttribute('aria-label', chosen
      ? 'Drop a PDF here to scan'
      : 'Choose a scan type before adding a PDF');
    if (!chosen) resetDropZone('Choose a scan type first', 'PDF packages only, up to 12 MB');
  }

  function resetDropZone(title, meta) {
    dropZone.classList.remove('is-ready', 'is-dragover');
    dropTitle.textContent = title;
    dropMeta.textContent  = meta;
    chooseFileBtn.textContent = 'Choose PDF';
  }

  // Changing or clearing the scan type drops the file and the report with it: a
  // report always belongs to the scan type that produced it.
  scanTypeSelect.addEventListener('change', () => {
    clearSelectedFile();
    clearResults();
    applyScanTypeGate();
    if (scanTypeValue()) {
      resetDropZone('Drop a PDF here', 'PDF packages only, up to 12 MB');
    }
  });

  // ── File selection ───────────────────────────────────────────────────────────

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    filenameEl.textContent = '';
    runBtn.disabled = true;
    runBtn.classList.remove('is-scanning', 'is-complete');
    runBtn.textContent = 'Run Proof Scan';
  }

  async function selectFile(file) {
    if (!scanTypeValue()) return;
    const { checkSelectedFile } = await loadReport();

    // A courtesy check so staff hear about an obviously wrong file before a
    // multi-megabyte base64 read. The server re-checks all of it and is the
    // authority — this never widens what the API will accept.
    const problem = checkSelectedFile(file);
    if (problem) {
      clearSelectedFile();
      resetDropZone('Drop a PDF here', problem);
      dropMeta.style.color = 'var(--color-danger)';
      Utils.toast(problem, 'error');
      announce(problem);
      return;
    }

    dropMeta.style.color = '';
    selectedFile = file;
    dropZone.classList.remove('is-dragover');
    dropZone.classList.add('is-ready');
    dropTitle.textContent = 'Package ready';
    dropMeta.textContent  = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    chooseFileBtn.textContent = 'Choose another PDF';
    filenameEl.textContent = 'Ready for review';
    runBtn.disabled = false;
    runBtn.classList.remove('is-complete');
    runBtn.textContent = 'Run Proof Scan';
    announce(`${file.name} ready for review.`);
  }

  chooseFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (scanTypeValue()) fileInput.click();
  });

  dropZone.addEventListener('click', () => { if (scanTypeValue()) fileInput.click(); });

  dropZone.addEventListener('keydown', (e) => {
    if (!scanTypeValue()) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  dropZone.addEventListener('dragover', (e) => {
    if (!scanTypeValue()) return;
    e.preventDefault();
    dropZone.classList.add('is-dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-dragover');
    if (!scanTypeValue()) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) selectFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) selectFile(fileInput.files[0]);
  });

  // ── Run Proof Scan ───────────────────────────────────────────────────────────

  function scanFailed(message) {
    runBtn.classList.remove('is-scanning', 'is-complete');
    runBtn.removeAttribute('aria-busy');
    runBtn.textContent = 'Run Proof Scan';
    runBtn.disabled = !selectedFile;
    filenameEl.textContent = selectedFile ? 'Ready for review' : '';
    Utils.toast(message, 'error');
    announce(message);
  }

  runBtn.addEventListener('click', async () => {
    if (!selectedFile || scanning) return;
    const scanProfile = scanTypeValue();
    if (!scanProfile) return;

    const { renderReport, buildReportModel, scanErrorMessage } = await loadReport();

    scanning = true;
    runBtn.disabled = true;
    runBtn.classList.remove('is-complete');
    runBtn.classList.add('is-scanning');          // sweeps for as long as the request runs
    runBtn.setAttribute('aria-busy', 'true');
    runBtn.textContent = 'Reviewing package…';
    filenameEl.textContent = selectedFile.name;
    announce('Reviewing package. This can take a minute.');

    try {
      const file_base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('That file could not be read.'));
        reader.readAsDataURL(selectedFile);
      });

      const session = await getSession();
      let res;
      try {
        res = await fetch('/api/proof-scan', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          // The scan type is sent explicitly. It is never derived from the file.
          body: JSON.stringify({
            scan_profile: scanProfile,
            filename:     selectedFile.name,
            file_base64,
          }),
        });
      } catch {
        throw new Error('Could not reach the portal. Check your connection and try again.');
      }

      let data = null;
      try { data = await res.json(); } catch { data = null; }

      // 400 request errors, 500 unavailable profile, 502 model/validation failure —
      // all end here. A failed scan is never rendered as a result.
      if (!res.ok) throw new Error(scanErrorMessage(res.status, data));

      renderReport(buildReportModel(data), resultsContent);

      // A completed scan that did not persist is still a real report. Say so
      // plainly, and never claim Recent Scans has it.
      if (data.stored === false) {
        storageWarning.textContent = data.storage_error
          || 'This scan completed but could not be saved. It will not appear in Recent Scans — keep this page open or run it again.';
        storageWarning.classList.remove('hidden');
      } else {
        storageWarning.classList.add('hidden');
        storageWarning.textContent = '';
      }

      resultsWrap.classList.remove('hidden', 'ps-results-reveal');
      void resultsWrap.offsetWidth;                 // restart the reveal animation
      resultsWrap.classList.add('ps-results-reveal');

      runBtn.classList.remove('is-scanning');
      runBtn.classList.add('is-complete');
      runBtn.removeAttribute('aria-busy');
      runBtn.textContent = 'Scan complete';
      filenameEl.textContent = selectedFile.name;
      announce(data.primary_report_language || 'Scan complete.');

      resultsWrap.scrollIntoView({
        block: 'start',
        behavior: reduceMotion() ? 'auto' : 'smooth',
      });

      if (data.stored !== false) await loadHistory();

    } catch (err) {
      console.error('[proof-scan] run failed');
      scanFailed(err.message || 'The scan failed. Nothing was saved.');
    } finally {
      scanning = false;
      runBtn.disabled = !selectedFile;
    }
  });

  // ── Clear results ────────────────────────────────────────────────────────────
  //
  // Removes the rendered nodes and the unsaved warning. The chosen scan type
  // survives — only the user changes that — and so does the selected PDF, so the
  // same package can be re-run without picking it again.

  function clearResults() {
    resultsWrap.classList.add('hidden');
    resultsWrap.classList.remove('ps-results-reveal');
    resultsContent.textContent = '';
    storageWarning.classList.add('hidden');
    storageWarning.textContent = '';
    runBtn.classList.remove('is-complete');
    if (!scanning) runBtn.textContent = 'Run Proof Scan';
  }

  clearResultsBtn.addEventListener('click', clearResults);

  // ── Rules toggle ─────────────────────────────────────────────────────────────
  //
  // Unchanged from before this batch. The API already limits this free text to
  // context: it cannot create a rule ID, a severity, or a report section.

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
      rulesOriginal           = data.custom_instructions || '';
      notifyEmailOriginal     = data.notify_email        || '';
      rulesTextarea.value     = rulesOriginal;
      notifyEmailInput.value  = notifyEmailOriginal;
      rulesTextarea.disabled = false;
      rulesChanged           = false;
    } catch (err) {
      rulesTextarea.value = '';
      rulesTextarea.disabled = false;
      setRulesFeedback('Could not load saved rules: ' + err.message, 'error');
    }
  }

  rulesTextarea.addEventListener('input', () => {
    rulesChanged          = rulesTextarea.value !== rulesOriginal ||
                            notifyEmailInput.value.trim() !== notifyEmailOriginal;
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
        body: JSON.stringify({
          custom_instructions: rulesTextarea.value,
          notify_email:        notifyEmailInput.value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      rulesOriginal       = rulesTextarea.value;
      notifyEmailOriginal = notifyEmailInput.value.trim();
      rulesChanged        = false;
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
  //
  // Batch 4. The list and every result body now come from the authenticated
  // /api/proof-scan-history endpoint. The browser no longer touches Supabase for
  // scan content — there is no window.db query left in this file.
  //
  // A row shows the deterministic language the server composed from the stored
  // report state ("N items need attention", "Review incomplete", "No issues
  // found"), a legacy label, or "Result unavailable". Nothing here composes a
  // phrase, and a row with missing or unusable metadata is never drawn as clean.

  function renderHistoryEmpty(message, danger) {
    historyList.textContent = '';
    const box = document.createElement('div');
    box.className = 'dk-empty';
    if (danger) box.style.color = 'var(--color-danger)';
    box.textContent = message;
    historyList.appendChild(box);
  }

  // Built with DOM nodes rather than an HTML string so a filename or a stored
  // phrase can never be parsed as markup on its way into the list.
  function historyRowEl(model) {
    const el = document.createElement('div');
    el.className = 'dk-reg-row ps-history-item';
    el.dataset.scanId = model.id;
    el.dataset.scanKind = model.kind;
    el.style.cursor = 'pointer';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');

    const left = document.createElement('div');
    left.style.minWidth = '0';
    const title = document.createElement('div');
    title.className = 'dk-reg-title ps-history-name';
    title.textContent = model.filename;
    const meta = document.createElement('div');
    meta.className = 'dk-reg-meta';
    meta.textContent = formatDate(model.created_at);
    left.appendChild(title);
    left.appendChild(meta);
    el.appendChild(left);

    const tag = document.createElement('span');
    tag.className = `ps-history-tag ps-history-tag--${model.tone}`;
    tag.textContent = model.label;
    el.appendChild(tag);

    const open = () => openScan(model);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return el;
  }

  async function loadHistory() {
    renderHistoryEmpty('Loading…');
    try {
      const { historyRowModel } = await loadReport();
      const session = await getSession();
      const res = await fetch('/api/proof-scan-history', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load recent scans.');

      const scans = Array.isArray(data.scans) ? data.scans : [];
      if (!scans.length) { renderHistoryEmpty('No scans yet.'); return; }

      historyList.textContent = '';
      const register = document.createElement('div');
      register.className = 'dk-register';
      for (const row of scans) register.appendChild(historyRowEl(historyRowModel(row)));
      historyList.appendChild(register);

    } catch (err) {
      renderHistoryEmpty(err.message || 'Could not load recent scans.', true);
    }
  }

  // ── Opening a saved scan ─────────────────────────────────────────────────────
  //
  // Three outcomes, decided by the server, never by this file:
  //
  //   structured  re-validated stored result_json, drawn by the SAME report model
  //               and renderer a fresh scan uses. Reopening a scan cannot show
  //               anything a fresh scan could not.
  //   legacy      pre-structured result_html, labelled, and displayed as inert
  //               source text by legacy-html.js. It is never parsed as HTML.
  //   unavailable corrupt, truncated, unknown schema version, or a profile this
  //               build does not configure — a neutral message, never a result.

  async function openScan(model) {
    modalTitle.textContent = model.filename;
    modalBody.textContent = 'Loading…';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    try {
      const report = await loadReport();
      const session = await getSession();
      const res = await fetch('/api/proof-scan-history', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ scan_id: model.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load that scan.');

      if (data.kind === 'structured') {
        report.renderReport(report.buildReportModel(data.result), modalBody);
        return;
      }

      if (data.kind === 'legacy') {
        report.renderLegacyReport(
          { filename: model.filename, created_at: data.created_at, result_html: data.result_html },
          modalBody,
          // Turned into one text node. The stored string is never parsed or
          // assigned to an HTML insertion sink.
          (raw) => report.sanitizeLegacyHtml(raw),
        );
        return;
      }

      report.renderUnavailable(data.message, modalBody);

    } catch (err) {
      const box = document.createElement('p');
      box.style.color = 'var(--color-danger)';
      box.textContent = 'Could not load result: ' + (err.message || 'unknown error');
      modalBody.textContent = '';
      modalBody.appendChild(box);
    }
  }

  // ── Modal close ──────────────────────────────────────────────────────────────

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  onDocument('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    modalBody.textContent = '';
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  applyScanTypeGate();
  await loadHistory();

})();
