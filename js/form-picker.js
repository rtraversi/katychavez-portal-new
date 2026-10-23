'use strict';
// Shared form-library picker (Docket kit). One component, two callers:
//   • Case Builder package editor  (pages/draft-forms/draft-forms.js)
//   • Client-card add-form control  (pages/clients/detail/detail.js)
//
// Multi-select modal with hyphen-insensitive search so "i130", "i-130" and
// "I 130" all find i-130 (mirrors functions/api/_case-builder.js matchesQuery),
// plus an optional practice-area filter. The caller owns the actual write via
// onConfirm(selectedIds); the picker just gathers the selection.
(function () {

  // Strip every non-alphanumeric on both sides so a form code matches however
  // it's typed. Kept identical to the server-side normalizeSearch.
  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function matches(t, q) {
    const nq = normalize(q);
    if (!nq) return true;
    return normalize([t.form_key, t.label, t.agency].filter(Boolean).join(' ')).includes(nq);
  }

  // opts: { title, templates:[{id, form_key, label, agency, active, uploaded, practice_area_id}],
  //         excludeIds:[], practiceAreas:[{id,name}], confirmLabel, onConfirm(ids)->Promise }
  function open(opts) {
    const {
      title = 'Add forms',
      templates = [],
      excludeIds = [],
      practiceAreas = [],
      confirmLabel = 'Add',
      onConfirm,
    } = opts || {};

    const exclude  = new Set((excludeIds || []).map(String));
    const pool     = templates.filter(t => !exclude.has(String(t.id)));
    const selected = new Set();
    let paFilter   = ''; // '' = all practice areas

    let overlay = document.getElementById('form-picker-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'form-picker-modal';
      overlay.className = 'modal-overlay hidden';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      document.body.appendChild(overlay);
    }

    const paChips = (practiceAreas || []).length > 1 ? `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        <button type="button" class="dk-tag acc fp-pa" data-pa="">All</button>
        ${practiceAreas.map(pa => `<button type="button" class="dk-tag mut fp-pa" data-pa="${Utils.esc(String(pa.id))}">${Utils.esc(pa.name)}</button>`).join('')}
      </div>` : '';

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">${Utils.esc(title)}</h2>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <input type="search" id="fp-search" placeholder="Search by form number or name… (e.g. i130)" autocomplete="off">
          </div>
          ${paChips}
          <div id="fp-results" style="max-height:360px;overflow-y:auto"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn--secondary" id="fp-cancel">Cancel</button>
          <button type="button" class="btn btn--primary" id="fp-confirm" disabled>${Utils.esc(confirmLabel)}</button>
        </div>
      </div>`;

    const results    = overlay.querySelector('#fp-results');
    const search     = overlay.querySelector('#fp-search');
    const confirmBtn = overlay.querySelector('#fp-confirm');

    function close() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }

    function updateConfirm() {
      confirmBtn.disabled = selected.size === 0;
      confirmBtn.textContent = selected.size ? `${confirmLabel} (${selected.size})` : confirmLabel;
    }

    function draw() {
      const list = pool.filter(t =>
        (!paFilter || String(t.practice_area_id) === paFilter) && matches(t, search.value));

      if (!list.length) {
        results.innerHTML = `<div class="dk-empty">No forms match.</div>`;
        return;
      }

      results.innerHTML = `<div class="dk-register">${list.map(t => {
        const id       = Utils.esc(String(t.id));
        const checked  = selected.has(String(t.id)) ? 'checked' : '';
        const warn     = t.uploaded === false ? DK.tag('No PDF', 'warn') : '';
        const inactive = t.active === false ? DK.tag('Inactive', 'mut') : '';
        return `
          <label class="dk-reg-row" style="cursor:pointer">
            <div style="min-width:0;display:flex;align-items:center;gap:10px">
              <input type="checkbox" class="fp-pick" value="${id}" ${checked}>
              <div style="min-width:0">
                <div class="dk-reg-title"><span>${Utils.esc(t.label)}</span>${warn}${inactive}</div>
                <div class="dk-reg-meta"><span>${Utils.esc(String(t.form_key || '').toUpperCase())}</span>${t.agency ? `<span class="sep">&middot;</span><span>${Utils.esc(t.agency)}</span>` : ''}</div>
              </div>
            </div>
          </label>`;
      }).join('')}</div>`;

      results.querySelectorAll('.fp-pick').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
          updateConfirm();
        });
      });
    }

    draw();
    updateConfirm();
    overlay.classList.remove('hidden');

    search.addEventListener('input', draw);
    overlay.querySelectorAll('.fp-pa').forEach(chip => chip.addEventListener('click', () => {
      paFilter = chip.dataset.pa;
      overlay.querySelectorAll('.fp-pa').forEach(c => {
        c.classList.toggle('acc', c === chip);
        c.classList.toggle('mut', c !== chip);
      });
      draw();
    }));
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#fp-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    confirmBtn.addEventListener('click', async () => {
      if (!selected.size) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Working…';
      try {
        await onConfirm(Array.from(selected));
        close();
      } catch (err) {
        Utils.toast(err.message || 'Something went wrong.', 'error');
        confirmBtn.disabled = false;
        updateConfirm();
      }
    });

    search.focus();
  }

  window.FormPicker = { open, normalize, matches };
})();
