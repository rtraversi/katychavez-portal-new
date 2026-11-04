// js/case-type-picker.js — global CaseTypePicker.
//
// One matter can be several case types (migration 2301): a will AND an irrevocable
// trust AND a financial POA. This is the picker for that: it looks like the select it
// replaces, opens a checklist, and lists what's chosen as chips underneath.
//
//   The FIRST chosen case type is the matter's primary (matters.case_type_id — what
//   the form filler, Case Builder packages, trust, booking… read). The rest go to
//   matters.additional_case_type_ids. Any chip can be made primary.
//
// It writes ordinary form fields, so callers read it like any other input:
//   <input type="hidden" name="case_type_id">                (primary)
//   <input type="hidden" name="additional_case_type_ids">    (one per extra)
// and a visually-hidden required input carries native "please choose" validation.
//
//   const p = CaseTypePicker.mount(el, { options:[{id,name}], primaryId, extraIds, required, onChange })
//   p.setOptions(options)        // practice area changed — clears the selection
//   p.value()                    // { primaryId, extraIds }
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let seq = 0;

  function mount(root, opts = {}) {
    const id = 'ctp' + (++seq);
    let options = opts.options || [];
    let chosen = [];   // ordered ids; [0] = primary
    const placeholder = opts.placeholder || '— Select —';

    function setChosen(primaryId, extraIds) {
      const known = new Set(options.map(o => o.id));
      chosen = [primaryId, ...(extraIds || [])].filter((v, i, a) => v && known.has(v) && a.indexOf(v) === i);
    }
    setChosen(opts.primaryId, opts.extraIds);

    root.classList.add('dk-ctp');
    root.innerHTML = `
      <div class="dk-ctp-field">
        <button type="button" class="dk-ctp-btn" id="${id}-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-panel"></button>
        <input class="dk-ctp-req" tabindex="-1" aria-hidden="true" ${opts.required ? 'required' : ''}>
        <div class="dk-ctp-panel" id="${id}-panel" role="listbox" aria-multiselectable="true" hidden></div>
      </div>
      <div class="dk-ctp-hidden"></div>
      <div class="dk-ctp-chips" aria-live="polite"></div>`;

    const btn = root.querySelector('.dk-ctp-btn');
    const panel = root.querySelector('.dk-ctp-panel');
    const req = root.querySelector('.dk-ctp-req');
    const hidden = root.querySelector('.dk-ctp-hidden');
    const chips = root.querySelector('.dk-ctp-chips');
    const nameOf = (cid) => options.find(o => o.id === cid)?.name || '';

    function render() {
      const n = chosen.length;
      btn.innerHTML = n
        ? `<span class="dk-ctp-val">${esc(nameOf(chosen[0]))}</span>${n > 1 ? `<span class="dk-ctp-more">+${n - 1} more</span>` : ''}`
        : `<span class="dk-ctp-ph">${esc(options.length ? placeholder : 'Select a practice area first')}</span>`;
      btn.disabled = !options.length;

      panel.innerHTML = options.map(o => {
        const on = chosen.includes(o.id);
        return `<button type="button" class="dk-ctp-opt${on ? ' is-on' : ''}" role="option" aria-selected="${on}" data-id="${esc(o.id)}">
          <span class="dk-ctp-box" aria-hidden="true"></span><span>${esc(o.name)}</span>
          ${on && chosen[0] === o.id && n > 1 ? '<span class="dk-ctp-prim">Primary</span>' : ''}</button>`;
      }).join('');

      hidden.innerHTML = `<input type="hidden" name="case_type_id" value="${esc(chosen[0] || '')}">` +
        chosen.slice(1).map(cid => `<input type="hidden" name="additional_case_type_ids" value="${esc(cid)}">`).join('');

      chips.innerHTML = n ? chosen.map((cid, i) => `
        <span class="dk-ctp-chip${i === 0 && n > 1 ? ' is-primary' : ''}">
          <span>${esc(nameOf(cid))}</span>
          ${i === 0 ? (n > 1 ? '<span class="dk-ctp-prim">Primary</span>' : '')
                    : `<button type="button" class="dk-ctp-mk" data-primary="${esc(cid)}" title="Make this the primary case type">Make primary</button>`}
          <button type="button" class="dk-ctp-x" data-remove="${esc(cid)}" aria-label="Remove ${esc(nameOf(cid))}">×</button>
        </span>`).join('') : '';

      req.value = chosen[0] || '';
      req.setCustomValidity(opts.required && !chosen.length ? 'Choose a case type.' : '');
    }

    function changed() { render(); if (opts.onChange) opts.onChange(api.value()); }
    function open(on) {
      panel.hidden = !on;
      btn.setAttribute('aria-expanded', String(on));
      if (on) panel.querySelector('.dk-ctp-opt')?.focus();
    }

    btn.addEventListener('click', () => open(panel.hidden));
    panel.addEventListener('click', (e) => {
      const o = e.target.closest('.dk-ctp-opt');
      if (!o) return;
      const cid = o.dataset.id;
      chosen = chosen.includes(cid) ? chosen.filter(x => x !== cid) : [...chosen, cid];
      changed();
      panel.querySelector(`.dk-ctp-opt[data-id="${CSS.escape(cid)}"]`)?.focus();
    });
    chips.addEventListener('click', (e) => {
      const mk = e.target.closest('[data-primary]');
      const rm = e.target.closest('[data-remove]');
      if (mk) chosen = [mk.dataset.primary, ...chosen.filter(x => x !== mk.dataset.primary)];
      else if (rm) chosen = chosen.filter(x => x !== rm.dataset.remove);
      else return;
      changed();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); open(false); btn.focus(); }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !panel.hidden) {
        const items = [...panel.querySelectorAll('.dk-ctp-opt')];
        const i = items.indexOf(document.activeElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    });
    // Close when clicking anywhere else. Removed with the element on re-render.
    const outside = (e) => { if (!root.isConnected) return document.removeEventListener('mousedown', outside); if (!root.contains(e.target)) open(false); };
    document.addEventListener('mousedown', outside);
    // A failed required check focuses the hidden input — send it to the button instead.
    req.addEventListener('invalid', () => { btn.focus(); open(true); });

    const api = {
      setOptions(next) { options = next || []; chosen = []; open(false); render(); },
      value() { return { primaryId: chosen[0] || null, extraIds: chosen.slice(1) }; },
    };
    render();
    return api;
  }

  window.CaseTypePicker = { mount };
})();
