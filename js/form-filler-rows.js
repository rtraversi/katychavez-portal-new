// The rules behind each row of the client page's USCIS Forms tab (Drafter
// 1.0.2). Plain script: sets window.FormFillerRows. No DOM, so the unit tests
// can load it too; pages/clients/detail/detail.js draws the rows.
//
//   needsAutofill   which forms the tab fills on its own (RT-10)
//   menuItems       what the "⋯" menu offers for one form (RT-11, D-5, D-15)
//   resetPrompt     the Reset confirm, in Max's words (D-13)
//   fileNameFromDisposition   the name the server gave a download
'use strict';

(function (root) {
  // Forms whose template is ready and that have no generated form yet, minus
  // any already being filled.
  function needsAutofill(forms, busy = new Set()) {
    return (forms || [])
      .filter((f) => f.template_ready && !f.generated_form_id && !busy.has(f.template_id))
      .map((f) => f.template_id);
  }

  // A form with a finalized copy is part of a real filing: the API refuses to
  // remove it, so the menu shows Remove disabled with today's tooltip.
  const FINALIZED_REMOVE_TITLE = "Finalized forms can't be removed. Reset this form first if you really need to.";

  // [{ k, label, danger?, disabled?, title? }], with { k: 'hr' } as the divider.
  function menuItems(f) {
    const items = [];
    if (f.template_ready) items.push({ k: 'autofill', label: 'Autofill' });
    if (f.generated_form_id) items.push({ k: 'flatten', label: 'Flatten and download' });
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

  root.FormFillerRows = { needsAutofill, menuItems, resetPrompt, fileNameFromDisposition, FINALIZED_REMOVE_TITLE };
})(typeof window !== 'undefined' ? window : globalThis);
