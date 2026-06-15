// Shared utilities.
'use strict';

window.Utils = (function () {

  // ── Toast notifications ──────────────────────────────────────────────────────

  function toast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.setAttribute('role', 'alert');
    t.textContent = message;
    container.appendChild(t);

    requestAnimationFrame(() => t.classList.add('toast--visible'));

    setTimeout(() => {
      t.classList.remove('toast--visible');
      t.addEventListener('transitionend', () => t.remove(), { once: true });
    }, duration);
  }

  // ── Date formatting ──────────────────────────────────────────────────────────

  function formatDate(dateStr, opts = {}) {
    if (!dateStr) return '—';
    // Append T00:00:00 only for bare date strings (YYYY-MM-DD) to avoid TZ shift.
    // Full ISO timestamps already carry time/tz — don't append or the string becomes invalid.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))
      ? new Date(dateStr + 'T00:00:00')
      : new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...opts });
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function relativeDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const diff = Math.round((d - Date.now()) / 86400000);
    if (diff === 0)  return 'Today';
    if (diff === 1)  return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 0)    return `In ${diff} days`;
    return `${Math.abs(diff)} days ago`;
  }

  // ── String helpers ───────────────────────────────────────────────────────────

  function fullName(obj) {
    if (!obj) return '';
    return [obj.first_name, obj.last_name].filter(Boolean).join(' ');
  }

  function initials(obj) {
    if (!obj) return '?';
    return [(obj.first_name || '')[0], (obj.last_name || '')[0]].filter(Boolean).join('').toUpperCase();
  }

  function titleCase(str) {
    if (!str) return '';
    return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function truncate(str, max = 60) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max) + '…';
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────────

  function qs(selector, parent = document) { return parent.querySelector(selector); }
  function qsa(selector, parent = document) { return [...parent.querySelectorAll(selector)]; }

  function show(el) { el && el.classList.remove('hidden'); }
  function hide(el) { el && el.classList.add('hidden'); }

  function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.setAttribute('aria-busy', loading);
    if (loading) {
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Working…';
    } else {
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  // ── Error handling ───────────────────────────────────────────────────────────

  function handleError(err, context = '') {
    console.error(`[${context || 'error'}]`, err);
    const msg = err?.message || String(err) || 'Something went wrong';
    toast(msg, 'error');
  }

  // ── Escape HTML ──────────────────────────────────────────────────────────────

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  // ── Custom confirm dialog ────────────────────────────────────────────────────
  // Usage: if (!await Utils.confirm('Are you sure?')) return;
  // Options: { confirmLabel, cancelLabel, danger }

  function confirm(message, opts = {}) {
    const { confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = opts;
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9999',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,.45)', 'backdrop-filter:blur(2px)',
        'animation:fadeIn .12s ease',
      ].join(';');

      overlay.innerHTML = `
        <div role="alertdialog" aria-modal="true" style="
          background:var(--color-bg,#fff);
          border-radius:var(--radius-lg,10px);
          box-shadow:0 20px 60px rgba(0,0,0,.25);
          padding:var(--space-6,24px);
          max-width:420px;
          width:calc(100vw - 48px);
          animation:slideUp .15s ease;
        ">
          <p style="
            margin:0 0 var(--space-6,24px);
            font-size:var(--font-size-base,14px);
            line-height:1.55;
            color:var(--color-text,#111);
          ">${esc(message)}</p>
          <div style="display:flex;justify-content:flex-end;gap:var(--space-3,12px)">
            <button id="_confirm-cancel" class="btn btn--secondary" style="min-width:80px">${esc(cancelLabel)}</button>
            <button id="_confirm-ok" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" style="min-width:80px">${esc(confirmLabel)}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);
      overlay.querySelector('#_confirm-ok').focus();

      function finish(result) {
        overlay.remove();
        resolve(result);
      }

      overlay.querySelector('#_confirm-ok').addEventListener('click', () => finish(true));
      overlay.querySelector('#_confirm-cancel').addEventListener('click', () => finish(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter' && document.activeElement?.id === '_confirm-ok') finish(true);
      });
    });
  }

  // ── Debounce ─────────────────────────────────────────────────────────────────

  function debounce(fn, ms = 300) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ── File size ────────────────────────────────────────────────────────────────

  function fileSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
  }

  return {
    toast, confirm, formatDate, formatDateTime, relativeDate,
    fullName, initials, titleCase, truncate,
    qs, qsa, show, hide, setLoading,
    handleError, esc, debounce, fileSize,
  };
})();
