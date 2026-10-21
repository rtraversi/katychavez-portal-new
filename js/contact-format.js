// Contact field formatting for the client and petitioner forms (Drafter 1.0.1).
// Plain script: sets window.ContactFormat. No DOM until wire() is called, so
// the unit tests can load it too.
//
//   State: a dropdown of 2-letter codes, empty by default (no more 'TX').
//   ZIP:   digits only, at most 9; 9 digits show as 12345-6789 (ZIP+4).
//   Phone: a US number shows as (919) 388-8328; anything else stays as typed.
'use strict';

(function (root) {
  // The 50 states, DC and the territories (USPS codes).
  const STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
    'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
    'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'AS', 'GU', 'MP', 'PR', 'VI',
  ];

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // <option>s for a State select: an empty first choice, selected unless a
  // value is saved. A saved value not in the list stays, as its own option.
  function stateOptions(current) {
    const cur = current == null ? '' : String(current).trim().toUpperCase();
    const codes = cur && !STATES.includes(cur) ? [cur, ...STATES] : STATES;
    return `<option value=""${cur ? '' : ' selected'}></option>`
      + codes.map((c) => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }

  // What a State select saves: the code, or null when nothing is picked.
  function stateValue(v) {
    const s = v == null ? '' : String(v).trim().toUpperCase();
    return s || null;
  }

  function formatZip(v) {
    const d = String(v ?? '').replace(/\D/g, '').slice(0, 9);
    return d.length === 9 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  }

  function formatPhone(v) {
    const s = String(v ?? '');
    let d = s.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    else if (d.length !== 10) return s;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  // Formats inputs marked data-fmt="zip" | "phone" inside root as they are
  // typed or pasted. Delegated, so it survives re-rendered fields; once per root.
  function wire(rootEl) {
    if (!rootEl || rootEl.dataset.contactFormat) return;
    rootEl.dataset.contactFormat = '1';
    rootEl.addEventListener('input', (e) => {
      const el = e.target;
      const fmt = el?.dataset?.fmt;
      const next = fmt === 'zip' ? formatZip(el.value) : fmt === 'phone' ? formatPhone(el.value) : null;
      if (next != null && next !== el.value) el.value = next;
    });
  }

  root.ContactFormat = { STATES, stateOptions, stateValue, formatZip, formatPhone, wire };
})(typeof window !== 'undefined' ? window : globalThis);
