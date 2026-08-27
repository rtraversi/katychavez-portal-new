'use strict';

(async function ProofScanPage() {

  // ── DOM refs ─────────────────────────────────────────────────────────────────

  const dropZone        = document.getElementById('ps-drop-zone');
  const fileInput       = document.getElementById('ps-file-input');
  const chooseFileBtn   = document.getElementById('ps-choose-file-btn');
  const runBtn          = document.getElementById('ps-run-btn');
  const filenameEl      = document.getElementById('ps-filename');
  const sizeNoteEl      = document.getElementById('ps-size-note');

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
  const clearResultsBtn = document.getElementById('ps-clear-results');

  const historyList     = document.getElementById('ps-history-list');

  const modal           = document.getElementById('ps-modal');
  const modalTitle      = document.getElementById('ps-modal-title');
  const modalBody       = document.getElementById('ps-modal-body');
  const modalClose      = document.getElementById('ps-modal-close');

  // ── State ────────────────────────────────────────────────────────────────────

  let selectedFile        = null;
  let rulesOpen           = false;
  let rulesOriginal       = '';
  let notifyEmailOriginal = '';
  let rulesChanged        = false;

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
    // type: 'success' | 'error' — token-driven so it stays readable in dark mode.
    const accent = type === 'success' ? 'var(--color-success)' : 'var(--color-danger)';
    rulesFeedback.style.display    = 'block';
    rulesFeedback.style.background = type === 'success'
      ? 'var(--color-success-bg)' : 'var(--color-danger-bg)';
    rulesFeedback.style.color  = accent;
    rulesFeedback.style.border = `1px solid color-mix(in srgb, ${accent} 32%, transparent)`;
    rulesFeedback.textContent = msg;
  }

  // ── Drop zone / file input ───────────────────────────────────────────────────

  chooseFileBtn.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--daily)';
    dropZone.style.background  = 'var(--daily-tint)';
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

  // Mirrors MAX_PDF_BYTES in functions/api/proof-scan-upload.js. The Worker is
  // the authority — this copy exists so an oversized package is refused before
  // the browser spends time pushing 20 MB it can't send.
  const MAX_PDF_BYTES  = 23 * 1024 * 1024;
  // Not a limit, a warning line. Packages this size have taken long enough that
  // the edge gives up mid-scan; below it, scans have been completing.
  const SLOW_PDF_BYTES = 8 * 1024 * 1024;
  const mib = bytes => (bytes / 1024 / 1024).toFixed(1);

  function selectFile(file) {
    filenameEl.textContent = file.name;

    if (file.size > MAX_PDF_BYTES) {
      selectedFile    = null;
      runBtn.disabled = true;
      showSizeNote(
        `This package is ${mib(file.size)} MB, over the ${mib(MAX_PDF_BYTES)} MB a single scan can accept. `
        + 'Split it — scanning the forms and the evidence separately works — and run each part.',
        'danger',
      );
      return;
    }

    selectedFile    = file;
    runBtn.disabled = false;

    if (file.size > SLOW_PDF_BYTES) {
      showSizeNote(
        `${mib(file.size)} MB is a large package. The scan may take several minutes, and very large `
        + 'packages can time out before finishing — if that happens, split the forms from the evidence '
        + 'and scan each separately.',
        'warn',
      );
    } else {
      hideSizeNote();
    }
  }

  function showSizeNote(text, tone) {
    sizeNoteEl.textContent = text;
    sizeNoteEl.style.color = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-warning)';
    sizeNoteEl.classList.remove('hidden');
  }

  function hideSizeNote() {
    sizeNoteEl.classList.add('hidden');
    sizeNoteEl.textContent = '';
  }

  // ── Run Proof Scan ───────────────────────────────────────────────────────────

  runBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    runBtn.disabled    = true;
    runBtn.textContent = 'Uploading…';
    filenameEl.textContent = selectedFile.name;

    try {
      const session = await getSession();

      // 1. Stage the package in R2. The bytes go up as the request body — no
      //    base64, no JSON wrapper — so the browser never builds a 27 MB string
      //    out of a 20 MB file.
      const upRes = await fetch('/api/proof-scan-upload', {
        method:  'PUT',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/pdf',
        },
        body: selectedFile,
      });
      const upData = await upRes.json().catch(() => null);
      if (!upRes.ok) throw new Error(upData?.error || `Upload failed (HTTP ${upRes.status})`);
      if (!upData?.upload_id) throw new Error('The upload did not complete. Please try again.');

      // 2. Queue the scan. This request carries an id, not a file, and returns
      //    at once — the scan is a job now, so there is nothing here to time out.
      const res = await fetch('/api/proof-scan', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ upload_id: upData.upload_id, filename: selectedFile.name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (!data?.scan_id) throw new Error('The scan could not be queued. Please try again.');

      // 3. Start it now rather than waiting for the cron to notice. This request
      //    stays open for the whole scan, so we deliberately don't await it —
      //    the poller drives the UI, and if this request dies with the tab the
      //    sweeper picks the job up regardless.
      if (!data.demo) {
        fetch('/api/proof-scan-process', {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ scan_id: data.scan_id }),
        }).catch(() => { /* the poller reports whatever the row ends up saying */ });
      }

      await loadHistory();
      startPolling(data.scan_id);

    } catch (err) {
      Utils.toast('Scan failed: ' + err.message, 'error');
      console.error('[proof-scan] run:', err);
      runBtn.disabled    = false;
      runBtn.textContent = 'Run Proof Scan';
    }
  });

  // ── Polling ──────────────────────────────────────────────────────────────────
  // The scan runs server-side whether or not this page is open. Polling is how
  // the page finds out; the emailed result is how anyone who left finds out.

  let pollTimer = null;

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    runBtn.disabled    = false;
    runBtn.textContent = 'Run Proof Scan';
  }

  function startPolling(scanId) {
    const INTERVAL = 2500;
    const TIMEOUT  = 600000;   // 10 min — matches the server's generation cap
    let elapsed = 0;

    const tick = async () => {
      runBtn.textContent = `Scanning… ${Math.round(elapsed / 1000)}s`;
      elapsed += INTERVAL;

      // Giving up watching is not giving up on the scan: the job keeps running
      // and the result still lands in Recent Scans and in the email.
      if (elapsed >= TIMEOUT) {
        stopPolling();
        showSizeNote(
          'This scan is taking longer than 10 minutes. It is still running — the result will '
          + 'appear under Recent Scans and be emailed when it finishes.',
          'warn',
        );
        await loadHistory();
        return;
      }

      try {
        const session = await getSession();
        const res = await fetch(`/api/proof-scan-poll?id=${encodeURIComponent(scanId)}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;                       // transient — try again next tick
        const data = await res.json();

        if (data.status === 'queued' || data.status === 'processing') return;

        stopPolling();
        await loadHistory();

        if (data.status === 'error') {
          Utils.toast('Scan failed: ' + (data.error || 'The scan did not complete.'), 'error');
          return;
        }

        resultsContent.innerHTML = themeResultHtml(data.html);
        resultsWrap.classList.remove('hidden');
        resultsWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        console.error('[proof-scan] poll:', err);  // keep polling; the row is the truth
      }
    };

    runBtn.disabled    = true;
    runBtn.textContent = 'Scanning… 0s';
    pollTimer = setInterval(tick, INTERVAL);
    tick();   // DEMO_MODE finishes instantly — don't sit on a spinner for 2.5s
  }

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

  // kinds are the .dk-tag variants in portal.css: warn | ok | mut | acc | crit
  const STATUS_TAG = {
    queued:           { kind: 'mut',  label: 'Queued' },
    processing:       { kind: 'acc',  label: 'Scanning…' },
    pass:             { kind: 'ok',   label: 'Pass' },
    needs_correction: { kind: 'warn', label: 'Needs Correction' },
    error:            { kind: 'crit', label: 'Did Not Finish' },
  };

  async function loadHistory() {
    historyList.innerHTML = '<div class="dk-empty">Loading…</div>';
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
        historyList.innerHTML = '<div class="dk-empty">No scans yet.</div>';
        return;
      }

      const rows = scans.map(s => {
        // A scan is a job, so this list carries in-flight rows too — a queued or
        // running scan appears here the moment it is submitted, including one
        // started in a tab that has since been closed.
        const { kind, label } = STATUS_TAG[s.status] || STATUS_TAG.needs_correction;
        return `
          <div class="dk-reg-row ps-history-item" data-scan-id="${s.id}"
               data-scan-filename="${escHtml(s.filename)}" style="cursor:pointer">
            <div style="min-width:0">
              <div class="dk-reg-title" style="font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">
                ${escHtml(s.filename)}
              </div>
              <div class="dk-reg-meta">${formatDate(s.created_at)}</div>
            </div>
            ${DK.tag(label, kind)}
          </div>`;
      }).join('');
      historyList.innerHTML = `<div class="dk-register">${rows}</div>`;

      // Attach click handlers to load full result
      historyList.querySelectorAll('.ps-history-item').forEach(el => {
        el.addEventListener('click', () => loadScanResult(el.dataset.scanId, el));
      });

    } catch (err) {
      historyList.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">${escHtml(err.message)}</div>`;
    }
  }

  // Open one scan from Recent Scans. The same poll endpoint the live scan uses
  // answers this: a finished row returns its report, and an unfinished one says
  // so — which matters now that a row appears here the moment it is queued.
  async function loadScanResult(scanId, rowEl) {
    const filename = rowEl.dataset.scanFilename || '';
    modalTitle.textContent = filename;
    modalBody.innerHTML    = '<p style="color:var(--ink-soft)">Loading…</p>';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    try {
      const session = await getSession();
      const res = await fetch(`/api/proof-scan-poll?id=${encodeURIComponent(scanId)}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      if (data.status === 'completed') {
        modalBody.innerHTML = themeResultHtml(data.html);
      } else if (data.status === 'error') {
        modalBody.innerHTML =
          `<p style="color:var(--color-danger)">This scan did not finish.</p>`
          + `<p style="color:var(--ink-soft)">${escHtml(data.error || '')}</p>`;
      } else {
        modalBody.innerHTML =
          '<p style="color:var(--ink-soft)">This scan is still running. The report will appear '
          + 'here when it finishes, and is emailed if a result address is configured.</p>';
      }
    } catch (err) {
      modalBody.innerHTML = `<p style="color:var(--color-danger)">Could not load result: ${escHtml(err.message)}</p>`;
    }
  }

  // Neutralize light-mode colors baked into AI-generated result HTML so it inherits
  // the theme tokens (readable in dark mode), and tag the status column so Pass /
  // Needs-Correction keep a theme-aware green/red. Also fixes older stored scans.
  function themeResultHtml(raw) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(raw || '');

    // Drop hardcoded color / background declarations from inline styles.
    tpl.content.querySelectorAll('[style]').forEach(el => {
      const kept = el.getAttribute('style')
        .split(';')
        .filter(d => d.trim() && !/^\s*(color|background(-color)?)\s*:/i.test(d))
        .join(';');
      if (kept.trim()) el.setAttribute('style', kept);
      else el.removeAttribute('style');
    });

    // Tag the status column (first cell of each row) for theme-aware recoloring.
    tpl.content.querySelectorAll('tr').forEach(tr => {
      const cell = tr.querySelector('td, th');
      if (!cell) return;
      const t = (cell.textContent || '').trim().toUpperCase();
      if (/\bPASS\b/.test(t)) cell.classList.add('ps-status', 'ps-pass');
      else if (/NEEDS CORRECTION|\bFAIL\b|\bERROR\b|✗|✕/.test(t)) cell.classList.add('ps-status', 'ps-fail');
    });

    return tpl.innerHTML;
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
