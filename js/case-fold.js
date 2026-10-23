// "More details" fold for case fields an immigration case rarely uses (Drafter
// 1.0.3, D-17). Plain script: sets window.CaseFold. pages/clients/clients.js
// (new-client form) and pages/clients/detail/detail.js (client card) use it.
//
// Max: "hide not disappear". For Immigration the fields move into a closed
// <details> labelled "More details": one click shows them, and they stay in
// the form, so they still save. Any other practice area sees today's layout.
// Changing the practice area moves them in or out; nothing is deleted.
'use strict';

(function (root) {
  // The case fields that fold, by input name, in the order the fold shows them.
  const FIELDS = ['case_number', 'court_county', 'judge_name', 'date_filed', 'billing_type',
    'conflict_check_notes', 'is_dv_confidential'];

  function isFolded(practiceAreaKey) {
    return practiceAreaKey === 'immigration';
  }

  // The element that holds one field: its .field (or the checkbox's .flag-row).
  function holder(formEl, name) {
    const input = formEl.querySelector(`[name="${name}"]`);
    return input ? (input.closest('.field, .flag-row') || input) : null;
  }

  // Moves the named fields inside formEl into the fold (folded) or back to
  // where the page drew them (not folded). The fold is created the first time,
  // just before `anchor` (or at the end of formEl), and is hidden while empty.
  function apply(formEl, folded, { names = FIELDS, anchor = null } = {}) {
    if (!formEl) return null;
    const doc = formEl.ownerDocument;
    let box = formEl.querySelector('[data-case-fold]');
    if (!box) {
      box = doc.createElement('details');
      box.className = 'dk-formfold';
      box.setAttribute('data-case-fold', '');
      const summary = doc.createElement('summary');
      summary.textContent = 'More details';
      const inner = doc.createElement('div');
      inner.className = 'dk-formfold-body';
      box.appendChild(summary);
      box.appendChild(inner);
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor);
      else formEl.appendChild(box);
    }
    const body = box.querySelector('.dk-formfold-body');

    for (const name of names) {
      const el = holder(formEl, name);
      if (!el) continue;
      // A placeholder marks the field's home, once, so it can go back.
      let slot = formEl.querySelector(`[data-fold-slot="${name}"]`);
      if (!slot) {
        slot = doc.createElement('span');
        slot.setAttribute('data-fold-slot', name);
        slot.hidden = true;
        el.parentNode.insertBefore(slot, el);
      }
      if (folded) body.appendChild(el);
      else if (slot.nextSibling !== el) slot.parentNode.insertBefore(el, slot.nextSibling);
    }

    const wasHidden = box.hidden;
    box.hidden = !folded || !body.children.length;
    if (folded && wasHidden !== false) box.open = false;   // folding starts closed
    // A row whose fields all moved would leave an empty gap.
    formEl.querySelectorAll('.field-row').forEach((row) => {
      row.hidden = !row.querySelector('.field, .flag-row, input, select, textarea');
    });
    return box;
  }

  root.CaseFold = { FIELDS, isFolded, apply };
})(typeof window !== 'undefined' ? window : globalThis);
