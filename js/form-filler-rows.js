// The rules behind each row of the client page's USCIS Forms tab (Drafter
// 1.0.2). Plain script: sets window.FormFillerRows. No DOM, so the unit tests
// can load it too; pages/clients/detail/detail.js draws the rows.
//
//   needsAutofill   which forms the tab fills on its own (RT-10)
//   scopeFor        the request body naming some rows, for generate and reset
//   menuItems       what the "⋯" menu offers for one form (RT-11, D-5, D-15)
//   feeLabel        a G-1450 copy's amount chip, "$520" or "Set fee" (D-19)
//
// Drafter 1.0.4: a case can hold a form twice (two G-1450s), so a row is one
// copy, keyed by row_key (its matter_forms id once the case's list exists).
//   resetPrompt     the Reset confirm, in Max's words (D-13)
//   fileNameFromDisposition   the name the server gave a download
'use strict';

(function (root) {
  const keyOf = (f) => f.row_key || f.template_id;

  // Forms whose template is ready and that have no generated form yet, minus
  // any already being filled. Returns row keys.
  function needsAutofill(forms, busy = new Set()) {
    return (forms || [])
      .filter((f) => f.template_ready && !f.generated_form_id && !busy.has(keyOf(f)))
      .map(keyOf);
  }

  // { row_ids } once every row has one; before a case's list is seeded the
  // rows have none yet, and { template_ids } names every copy of those forms.
  function scopeFor(forms) {
    const list = forms || [];
    if (list.length && list.every((f) => f.row_id)) return { row_ids: list.map((f) => f.row_id) };
    return { template_ids: [...new Set(list.map((f) => f.template_id))] };
  }

  // D-19: only the amount, never which form it pays for.
  function feeLabel(f) {
    return Number.isInteger(f.fee_amount) ? `$${f.fee_amount}` : 'Set fee';
  }

  // A form with a finalized copy is part of a real filing: the API refuses to
  // remove it, so the menu shows Remove disabled with today's tooltip.
  const FINALIZED_REMOVE_TITLE = "Finalized forms can't be removed. Reset this form first if you really need to.";

  // [{ k, label, danger?, disabled?, title? }], with { k: 'hr' } as the divider.
  function menuItems(f) {
    const items = [];
    if (f.template_ready) items.push({ k: 'autofill', label: 'Autofill' });
    if (f.generated_form_id) items.push({ k: 'flatten', label: 'Flatten and download' });
    if (f.has_fee && f.row_id) items.push({ k: 'fee', label: Number.isInteger(f.fee_amount) ? 'Change fee' : 'Set fee' });
    if (f.finalized_form_id) items.push({ k: 'finalized', label: 'Download finalized copy' });
    if (f.has_signed) items.push({ k: 'signed', label: 'Open signed' });
    if (items.length) items.push({ k: 'hr' });
    if (f.generated_form_id) items.push({ k: 'reset', label: 'Reset', danger: true });
    items.push(f.has_finalized
      ? { k: 'remove', label: 'Remove', disabled: true, title: FINALIZED_REMOVE_TITLE }
      : { k: 'remove', label: 'Remove', danger: true });
    return items;
  }

  function resetPrompt(f) {
    return `Reset ${String(f.form_key || f.label || '').toUpperCase()}? Your edits are deleted and it autofills again from the client card.`;
  }

  // filename* carries the full name (any letter); filename is its plain copy.
  function fileNameFromDisposition(header) {
    const value = String(header || '');
    const star = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
    const plain = value.match(/filename="([^"]*)"/i);
    return plain ? plain[1] : null;
  }

  root.FormFillerRows = { needsAutofill, scopeFor, feeLabel, menuItems, resetPrompt, fileNameFromDisposition, FINALIZED_REMOVE_TITLE };
})(typeof window !== 'undefined' ? window : globalThis);
