// ui.js: small shared helpers for the v2 Lab. Text nodes only, never HTML (D-41).
import { COPY, APPROVED } from '/v2-lab/copy.js';
import { state } from '/v2-lab/state.js';

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// Every user-facing string comes from copy.js. A missing key shows the key
// itself, loudly, rather than a guessed sentence.
export function t(key, vars = {}) {
  const s = COPY[key] ?? APPROVED[key];
  if (s == null) { console.warn('[v2-lab] missing copy', key); return `[${key}]`; }
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

export function button(label, cls = 'btn btn--secondary', onClick) {
  const b = el('button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// A visible placeholder for an undecided question. Never a guess.
export function openTag(q, text) {
  const wrap = el('span', 'v2-open');
  wrap.appendChild(el('span', 'v2-open-q', t('open.label', { q })));
  if (text) wrap.appendChild(el('span', 'v2-open-text', text));
  return wrap;
}

const cache = {};
export const loadJSON = async (path) => (cache[path] ||= await (await fetch(path)).json());

export const loadRules = () => Promise.all([
  loadJSON('/ui-lab/checklists/base-rules.json'),
  loadJSON('/ui-lab/checklists/daca-renewal.json'),
]);

// The checklist composition mixes forms and evidence. Only the EAD card is
// evidence today; a USCIS form is recognised by its G-/I- number.
export const isEvidence = (c) => !/^[GI]-\d/.test(c.form);
export const itemKey = (c) => `${c.form}${c.instance ? ' ' + c.instance : ''}`;

// D-23, exactly, derived the way the portal contract does: attention first,
// then anything unchecked, and only then a clean result.
export function reportState(attention, notChecked) {
  if (attention > 0) {
    return { key: 'attention', phrase: attention === 1 ? t('state.attention_one') : t('state.attention_many', { n: attention }) };
  }
  if (notChecked > 0) return { key: 'incomplete', phrase: t('state.incomplete') };
  return { key: 'clear', phrase: t('state.clear') };
}

// The house pattern (N-023): the observed fact bold, the expectation normal.
export function findingText(title) {
  const text = el('span', 'psr-check-text');
  const cut = title.search(/(?<=\.)\s+/);
  if (cut > 0) {
    text.appendChild(el('strong', null, title.slice(0, cut)));
    text.appendChild(el('span', 'psr-rest', ' ' + title.slice(cut).trim()));
  } else {
    text.appendChild(el('strong', null, title));
  }
  return text;
}

// ── 1.2 interaction pieces, reused (Max 2026-10-02) ─────────────────────────
// The drop zone, the scan sweep and the report "unseal" are the portal's own
// .ps-drop / .ps-scan-btn / ps-report-unseal styles from portal.css.
const DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ps-drop-icon" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

// choices: [{ label, onPick, pressed }]. A dropped file is never read; it only
// triggers the first sample choice.
const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="v2-file-icon" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

// files: [{ name, meta, tags }] are shown as a list once something is added, so
// one combined PDF and seven separate files both read clearly (Max 2026-10-02).
export function dropZone({ title, meta, choices = [], note, ready = false, landed = false, files = [] }) {
  const zone = el('div', `ps-drop v2-drop${ready ? ' is-ready' : ''}${landed ? ' is-landed' : ''}${files.length ? ' has-files' : ''}`);
  zone.insertAdjacentHTML('afterbegin', DOC_ICON); // fixed trusted markup, no data
  zone.appendChild(el('p', 'ps-drop-title', title));
  if (meta) zone.appendChild(el('p', 'ps-drop-meta', meta));
  if (files.length) {
    const list = el('ul', 'v2-files');
    files.forEach((f, i) => {
      const li = el('li', 'v2-file');
      li.style.setProperty('--i', String(i));
      li.insertAdjacentHTML('afterbegin', FILE_ICON); // fixed trusted markup
      const main = el('div', 'v2-file-main');
      main.appendChild(el('span', 'v2-file-name', f.name));
      if (f.meta) main.appendChild(el('span', 'v2-file-meta', f.meta));
      li.appendChild(main);
      if (f.tags?.length) {
        const tags = el('div', 'v2-file-tags');
        f.tags.forEach((x) => tags.appendChild(el('span', 'v2-file-tag', x)));
        li.appendChild(tags);
      }
      list.appendChild(li);
    });
    zone.appendChild(list);
  }
  if (choices.length) {
    const row = el('div', 'v2-drop-choices');
    choices.forEach((c) => {
      const b = button(c.label, files.length ? 'btn btn--ghost v2-btn-sm' : 'btn btn--secondary', (ev) => { ev.stopPropagation(); c.onPick(); });
      if (c.pressed != null) b.setAttribute('aria-pressed', String(Boolean(c.pressed)));
      row.appendChild(b);
    });
    zone.appendChild(row);
  }
  if (note) zone.appendChild(el('p', 'v2-drop-note', note));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-dragover'); choices[0]?.onPick(); });
  return zone;
}

// The 1.2 scan moment: a short sweep, then a settled "complete" state.
export function scanButton(label, onRun, disabled = false) {
  const b = button(label, 'btn btn--primary ps-scan-btn');
  b.disabled = disabled;
  b.addEventListener('click', () => {
    if (b.classList.contains('is-scanning')) return;
    b.classList.remove('is-complete');
    b.classList.add('is-scanning');
    b.setAttribute('aria-busy', 'true');
    b.textContent = t('scan.running');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      b.classList.remove('is-scanning');
      b.removeAttribute('aria-busy');
      b.classList.add('is-complete');
      b.textContent = t('scan.done');
      onRun();
    }, reduce ? 0 : 900);
  });
  return b;
}

// The report opens like a reviewed page being unsealed.
export function reveal(node) {
  node.classList.remove('v2-reveal');
  void node.offsetWidth;
  node.classList.add('v2-reveal');
}

// Max 2026-10-02: staff can sign a stage off once its issues are corrected, so the
// tracker moves on without "needs attention" hanging over it. The report itself
// is never changed by this.
const NEXT = { draft_review: ['preflight', 'physical_scan'], preflight: ['physical_scan'], physical_scan: [] };

export function signOff(stageKey) {
  const wrap = el('div', 'v2-signoff');
  const draw = () => {
    wrap.textContent = '';
    const on = Boolean(state.signedOff[stageKey]);
    wrap.classList.toggle('is-on', on);
    const lab = el('label', 'v2-signoff-label');
    const cb = el('input', 'v2-signoff-input');
    cb.type = 'checkbox';
    cb.checked = on;
    const box = el('span', 'v2-signoff-box');
    box.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    const words = el('span', 'v2-signoff-words');
    words.appendChild(el('span', 'v2-signoff-title', t(on ? 'signoff.on' : 'signoff.title')));
    words.appendChild(el('span', 'v2-signoff-sub', t('signoff.sub')));
    lab.append(cb, box, words);
    cb.addEventListener('change', () => {
      state.signedOff[stageKey] = cb.checked;
      draw();
      document.dispatchEvent(new CustomEvent('v2-progress'));
    });
    wrap.appendChild(lab);
    if (on && NEXT[stageKey].length) {
      const go = el('div', 'v2-signoff-next');
      NEXT[stageKey].forEach((k, i) => go.appendChild(button(t('signoff.next', { stage: t(`stage.${k}`) }),
        i === NEXT[stageKey].length - 1 ? 'btn btn--primary' : 'btn btn--secondary',
        () => document.dispatchEvent(new CustomEvent('v2-open-stage', { detail: k })))));
      wrap.appendChild(go);
    }
  };
  draw();
  return wrap;
}

// Dates are stored as YYYY-MM-DD and always shown the USCIS way, MM/DD/YYYY.
export const fmtDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (v || '');
};
export const parseDate = (v) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((v || '').trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};

// Max 2026-10-06: the full SSN is hidden by default. One eye toggle shows or
// hides it everywhere on the page at once.
const EYE_SHOW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_HIDE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
export const maskSsn = (v) => (v ? `\u2022\u2022\u2022-\u2022\u2022-${String(v).replace(/\D/g, '').slice(-4)}` : '');
export const shownSsn = (v) => (state.showSsn ? v : maskSsn(v));

const ssnValues = new WeakMap();
function syncSsn(node) {
  const v = ssnValues.get(node);
  node.querySelector('.v2-ssn-text').textContent = v ? shownSsn(v) : '\u2013';
  const eye = node.querySelector('.v2-ssn-eye');
  eye.hidden = !v;
  eye.innerHTML = state.showSsn ? EYE_HIDE : EYE_SHOW; // fixed trusted markup
  eye.setAttribute('aria-label', t(state.showSsn ? 'ssn.hide' : 'ssn.show'));
  eye.setAttribute('aria-pressed', String(state.showSsn));
}
export function toggleSsn() {
  state.showSsn = !state.showSsn;
  document.querySelectorAll('.v2-ssn').forEach((n) => { if (ssnValues.has(n)) syncSsn(n); });
  document.dispatchEvent(new CustomEvent('v2-ssn-toggle'));
}
export function ssnView(value) {
  const wrap = el('span', 'v2-ssn');
  wrap.appendChild(el('span', 'v2-ssn-text'));
  const eye = el('button', 'v2-ssn-eye');
  eye.type = 'button';
  eye.addEventListener('click', toggleSsn);
  wrap.appendChild(eye);
  ssnValues.set(wrap, value);
  syncSsn(wrap);
  return wrap;
}
export const eyeMarkup = () => (state.showSsn ? EYE_HIDE : EYE_SHOW);
