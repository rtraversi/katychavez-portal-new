// ssn.js: the one SSN eye for the whole page (D-80, D-97).
//
// The server only ever sends the last four digits. The full number exists in
// the browser only after staff press an eye, which calls the audited reveal
// route once for each SSN on the page (every reveal is logged). Pressing the
// eye again hides them all and forgets the full numbers. Nothing is revealed
// on load, on render, or by any other control.

import { el, t, icon, maskSsn } from './ui.js';

export function createSsnToggle(api, { onError } = {}) {
  let shown = false;
  let busy = false;
  const plain = new Map();
  let views = [];
  const listeners = new Set();

  const keyOf = (target) => (target.suggestion_id ? `s:${target.suggestion_id}` : `p:${target.person_id}`);

  function sync() {
    views = views.filter((v) => v.node.isConnected !== false);
    for (const v of views) v.sync();
    listeners.forEach((fn) => fn(shown));
  }

  async function toggle() {
    if (busy) return;
    if (shown) {
      shown = false;
      plain.clear();
      sync();
      return;
    }
    busy = true;
    try {
      views = views.filter((v) => v.node.isConnected !== false);
      const targets = new Map();
      for (const v of views) if (v.target.last4) targets.set(keyOf(v.target), v.target);
      for (const [key, target] of targets) {
        if (plain.has(key)) continue;
        const res = await api.revealSsn(target);
        if (res.ok && typeof res.data.ssn === 'string') plain.set(key, res.data.ssn);
        else onError?.(res);
      }
      shown = true;
    } finally {
      busy = false;
      sync();
    }
  }

  const value = (target) => (shown ? plain.get(keyOf(target)) || null : null);

  // A masked SSN with the eye beside it. target: { person_id | suggestion_id, last4 }.
  function view(target) {
    const wrap = el('span', 'v2-ssn');
    const text = el('span', 'v2-ssn-text');
    const eye = el('button', 'v2-ssn-eye');
    eye.type = 'button';
    eye.addEventListener('click', toggle);
    wrap.append(text, eye);
    const entry = {
      node: wrap,
      target,
      sync() {
        const full = value(target);
        text.textContent = full || (target.last4 ? maskSsn(target.last4) : '–');
        eye.hidden = !target.last4;
        eye.textContent = '';
        eye.appendChild(icon(shown ? 'eye_off' : 'eye'));
        eye.setAttribute('aria-label', t(shown ? 'ssn.hide' : 'ssn.show'));
        eye.setAttribute('aria-pressed', String(shown));
      },
    };
    views.push(entry);
    entry.sync();
    return wrap;
  }

  // For the reference-record input: registers the person's SSN for a reveal
  // without drawing a second masked value.
  function register(target, node, onSync) {
    const entry = { node, target, sync: onSync };
    views.push(entry);
    return entry;
  }

  return {
    toggle,
    view,
    register,
    value,
    remember: (target, full) => { if (shown && full) plain.set(keyOf(target), full); },
    get shown() { return shown; },
    get busy() { return busy; },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
