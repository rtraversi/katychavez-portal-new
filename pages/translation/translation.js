'use strict';

(async function TranslationPage() {

  // ── DOM refs ──────────────────────────────────────────────────────────────────

  const dropZone    = document.getElementById('tr-drop-zone');
  const fileInput   = document.getElementById('tr-file-input');
  const chooseBtn   = document.getElementById('tr-choose-file-btn');
  const fileNameEl  = document.getElementById('tr-filename');
  const submitBtn   = document.getElementById('tr-submit-btn');
  const resultsWrap = document.getElementById('tr-results-wrap');
  const contentEl   = document.getElementById('tr-results-content');
  const downloadBtn = document.getElementById('tr-download-btn');
  const clearBtn    = document.getElementById('tr-clear-btn');
  const historyEl   = document.getElementById('tr-history-list');

  // ── State ─────────────────────────────────────────────────────────────────────

  let selectedFile         = null;
  let pendingTranslationId = null;
  let pendingFilename      = null;
  let pollTimer            = null;

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function getFormat() {
    return document.querySelector('input[name="trFormat"]:checked')?.value || 'docx';
  }

  function updateDownloadLabel() {
    downloadBtn.textContent = getFormat() === 'pdf' ? 'Download PDF' : 'Download DOCX';
  }

  function selectFile(file) {
    selectedFile         = file;
    fileNameEl.textContent = file.name;
    submitBtn.disabled   = false;
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── File selection ────────────────────────────────────────────────────────────

  chooseBtn.addEventListener('click', () => fileInput.click());

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

  document.querySelectorAll('input[name="trFormat"]').forEach(r => {
    r.addEventListener('change', updateDownloadLabel);
  });

  // ── Submit ────────────────────────────────────────────────────────────────────

  submitBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    submitBtn.innerHTML = '<span class="spinner"></span> Reading file…';
    submitBtn.disabled  = true;
    pendingTranslationId = null;
    downloadBtn.style.display = 'none';

    try {
      const file_base64   = await readAsBase64(selectedFile);
      const session       = await Auth.getSession();
      const translationId = crypto.randomUUID();

      submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';

      const res = await fetch('/api/translation-start', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          file_base64,
          filename:        selectedFile.name,
          translator_name: document.getElementById('tr-translator-name')?.value.trim() || '_________________________',
          translation_id:  translationId,
        }),
      });

      if (res.status !== 202) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Unexpected status ${res.status}`);
      }

      startPolling(translationId);

    } catch (err) {
      contentEl.textContent = `Error: ${err.message}`;
      resultsWrap.style.display = 'block';
      submitBtn.textContent = 'Translate Document';
      submitBtn.disabled    = false;
    }
  });

  // ── Polling ───────────────────────────────────────────────────────────────────

  function startPolling(translationId) {
    let elapsed = 0;
    const INTERVAL = 2500;
    const TIMEOUT  = 300000; // 5-min hard stop

    submitBtn.innerHTML = '<span class="spinner"></span> Translating… <span id="tr-elapsed">0s</span>';

    pollTimer = setInterval(async () => {
      elapsed += INTERVAL;
      const elapsedEl = document.getElementById('tr-elapsed');
      if (elapsedEl) elapsedEl.textContent = `${Math.round(elapsed / 1000)}s`;

      if (elapsed >= TIMEOUT) {
        clearInterval(pollTimer);
        contentEl.textContent = 'Translation timed out after 5 minutes. Please try again.';
        resultsWrap.style.display = 'block';
        submitBtn.textContent = 'Translate Document';
        submitBtn.disabled    = false;
        return;
      }

      try {
        const session = await Auth.getSession();
        const pollRes = await fetch(`/api/translation-poll?id=${translationId}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (!pollRes.ok) return;

        const data = await pollRes.json();
        if (data.status === 'pending') return;

        clearInterval(pollTimer);

        if (data.status === 'error') {
          contentEl.textContent = 'Translation failed. Please try again.';
        } else {
          contentEl.textContent = data.preview || 'Translation complete.';
          pendingTranslationId  = data.translation_id;
          pendingFilename       = data.filename;
          updateDownloadLabel();
          downloadBtn.style.display = 'inline-flex';
          await loadHistory();
        }

        resultsWrap.style.display = 'block';
        resultsWrap.scrollIntoView({ behavior: 'smooth' });
        submitBtn.textContent = 'Translate Document';
        submitBtn.disabled    = false;

      } catch (_) { /* network hiccup — keep polling */ }
    }, INTERVAL);
  }

  // ── Download ──────────────────────────────────────────────────────────────────

  downloadBtn.addEventListener('click', async () => {
    if (!pendingTranslationId) return;
    await handleDownload(pendingTranslationId, pendingFilename);
  });

  async function handleDownload(translationId, filename) {
    const label = downloadBtn.textContent;
    downloadBtn.innerHTML = '<span class="spinner"></span> Preparing…';
    downloadBtn.disabled  = true;

    try {
      const session = await Auth.getSession();
      const res = await fetch(`/api/translation-download?id=${translationId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.docx_base64) throw new Error('No file data returned');

      if (getFormat() === 'pdf') {
        await downloadAsPdf(data.docx_base64, filename, session);
      } else {
        const bytes = base64ToBytes(data.docx_base64);
        triggerDownload(
          new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
          (filename || 'document').replace(/\.pdf$/i, '') + '_translated.docx'
        );
      }
    } catch (err) {
      Utils.toast('Download failed: ' + err.message, 'error');
    } finally {
      updateDownloadLabel();
      downloadBtn.disabled = false;
    }
  }

  async function downloadAsPdf(docxBase64, filename, session) {
    downloadBtn.innerHTML = '<span class="spinner"></span> Converting…';
    const res = await fetch('/api/translation-topdf', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ docx_base64: docxBase64, filename }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Conversion error ${res.status}`);
    }
    const data = await res.json();
    if (data.pdf_base64) {
      const bytes = base64ToBytes(data.pdf_base64);
      triggerDownload(
        new Blob([bytes], { type: 'application/pdf' }),
        (filename || 'document').replace(/\.pdf$/i, '') + '_translated.pdf'
      );
    }
  }

  // ── Clear ─────────────────────────────────────────────────────────────────────

  clearBtn.addEventListener('click', () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    resultsWrap.style.display = 'none';
    contentEl.textContent     = '';
    selectedFile              = null;
    pendingTranslationId      = null;
    fileNameEl.textContent    = '';
    fileInput.value           = '';
    submitBtn.disabled        = true;
    downloadBtn.style.display = 'none';
    submitBtn.textContent     = 'Translate Document';
    dropZone.style.borderColor = '';
    dropZone.style.background  = '';
  });

  // ── History ───────────────────────────────────────────────────────────────────

  async function loadHistory() {
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/translation-history', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ limit: 10 }),
      });
      const data = await res.json();
      renderHistory(data.translations || []);
    } catch (_) {}
  }

  function renderHistory(items) {
    if (!items.length) {
      historyEl.innerHTML = '<p style="font-size:var(--text-sm);color:var(--color-text-muted)">No translations yet.</p>';
      return;
    }
    historyEl.innerHTML = items.map(t => `
      <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:1px solid var(--color-border)">
        <div style="flex-shrink:0;width:32px;height:32px;border-radius:var(--radius);background:var(--color-bg-subtle);
                    display:flex;align-items:center;justify-content:center;color:var(--color-text-muted)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:var(--text-sm);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.filename}</div>
          <div style="font-size:var(--text-xs,0.75rem);color:var(--color-text-muted)">${new Date(t.created_at).toLocaleString()}</div>
        </div>
        <button class="btn btn--secondary" data-redownload="${t.id}" data-filename="${t.filename}"
          style="font-size:12px;padding:6px 10px;white-space:nowrap;flex-shrink:0">Download</button>
      </div>`).join('');

    historyEl.querySelectorAll('[data-redownload]').forEach(btn => {
      btn.addEventListener('click', () => handleDownload(btn.dataset.redownload, btn.dataset.filename));
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  await loadHistory();

})();
