'use strict';

(async function TranslationPage() {

  // Escape user-controlled strings (uploaded filenames) before innerHTML.
  const esc = (s) => (window.Utils?.esc
    ? window.Utils.esc(s)
    : String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

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

  document.querySelectorAll('input[name="trFormat"]').forEach(r => {
    r.addEventListener('change', updateDownloadLabel);
  });

  // Translator name only feeds the certification block — hide it when cert is off.
  const certCheckbox    = document.getElementById('tr-include-cert');
  const translatorWrap  = document.getElementById('tr-translator-wrap');
  certCheckbox?.addEventListener('change', () => {
    if (translatorWrap) translatorWrap.style.display = certCheckbox.checked ? '' : 'none';
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
          include_certification: document.getElementById('tr-include-cert')?.checked !== false,
        }),
      });

      if (res.status !== 202) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Unexpected status ${res.status}`);
      }

      // Kick off the actual translation work. That request stays open for the
      // whole generation (which is what keeps long documents alive) — the
      // poller below drives the UI, so we deliberately don't await it.
      fetch('/api/translation-process', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ translation_id: translationId }),
      }).catch(() => { /* poller reports the stored error/timeout */ });

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
    const TIMEOUT  = 600000; // 10-min hard stop (multi-page docs generate for several minutes)

    submitBtn.innerHTML = '<span class="spinner"></span> Translating… <span id="tr-elapsed">0s</span>';

    pollTimer = setInterval(async () => {
      elapsed += INTERVAL;
      const elapsedEl = document.getElementById('tr-elapsed');
      if (elapsedEl) elapsedEl.textContent = `${Math.round(elapsed / 1000)}s`;

      if (elapsed >= TIMEOUT) {
        clearInterval(pollTimer);
        contentEl.textContent = 'Translation timed out after 10 minutes. Please try again.';
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

  // Map a stored job status to a Docket tag (label + kind).
  function statusTag(status) {
    const st = String(status || 'done').toLowerCase();
    if (st === 'error' || st === 'failed')                          return { label: 'Error',       kind: 'crit' };
    if (st === 'queued' || st === 'pending')                        return { label: 'Queued',      kind: 'mut'  };
    if (st === 'processing' || st === 'in_progress' || st === 'in-progress')
                                                                    return { label: 'In progress', kind: 'acc'  };
    return { label: 'Done', kind: 'ok' };
  }

  const dkTag = (label, kind) =>
    (window.DK ? window.DK.tag(label, kind) : `<span class="dk-tag ${kind}">${esc(label)}</span>`);

  function renderHistory(items) {
    if (!items.length) {
      historyEl.innerHTML = '<div class="dk-empty">No translations yet.</div>';
      return;
    }
    historyEl.innerHTML = `<div class="dk-register">${items.map(t => {
      const s     = statusTag(t.status);
      const langs = t.source_lang ? `${esc(t.source_lang)} → English` : 'English';
      const parts = [`<span>${langs}</span>`];
      if (t.pages) parts.push(`<span class="sep">·</span><span>${esc(String(t.pages))} ${Number(t.pages) === 1 ? 'page' : 'pages'}</span>`);
      parts.push(`<span class="sep">·</span><span>${esc(new Date(t.created_at).toLocaleString())}</span>`);
      return `
      <div class="dk-reg-row">
        <div style="min-width:0">
          <div class="dk-reg-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;color:var(--ink-faint);flex:none" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:38ch">${esc(t.filename)}</span>
            ${dkTag(s.label, s.kind)}
          </div>
          <div class="dk-reg-meta">${parts.join('')}</div>
        </div>
        <div class="dk-reg-act">
          <button class="dk-linkbtn" data-redownload="${esc(t.id)}" data-filename="${esc(t.filename)}">Download</button>
        </div>
      </div>`;
    }).join('')}</div>`;

    historyEl.querySelectorAll('[data-redownload]').forEach(btn => {
      btn.addEventListener('click', () => handleDownload(btn.dataset.redownload, btn.dataset.filename));
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  await loadHistory();

})();
