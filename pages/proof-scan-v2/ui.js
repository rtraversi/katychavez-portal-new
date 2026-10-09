// ui.js: small shared helpers for Proof Scan v2, ported from the v2 Lab's ui.js.
//
// Text nodes only, never HTML (D-41). Every value that came from a file, the AI
// or the server reaches the page through textContent on a node made here. The
// few icons are fixed SVG shapes built element by element from the constants
// below, so there is no innerHTML anywhere in this page.

import { COPY, APPROVED, PORTAL } from './copy.js';

const doc = () => globalThis.document;
const SVG_NS = 'http://www.w3.org/2000/svg';

export const el = (tag, cls, text) => {
  const n = doc().createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// Every user-facing string comes from copy.js. A missing key shows the key
// itself, loudly, rather than a guessed sentence.
export function t(key, vars = {}) {
  const s = PORTAL[key] ?? COPY[key] ?? APPROVED[key];
  if (s == null) return `[${key}]`;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

export function button(label, cls = 'btn btn--secondary', onClick) {
  const b = el('button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function section(title, count) {
  const wrap = el('div', 'dk-sec');
  const head = el('div', 'dk-sec-head');
  head.appendChild(el('h2', null, title));
  if (count != null) head.appendChild(el('span', 'psr-count', String(count)));
  head.appendChild(el('span', 'dk-sec-rule'));
  wrap.appendChild(head);
  const body = el('div');
  wrap.appendChild(body);
  return { wrap, head, body };
}

export const clear = (node) => { node.textContent = ''; return node; };
export const reduceMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
export const scrollTo = (node) => node?.scrollIntoView?.({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });

// ── Fixed icons ──────────────────────────────────────────────────────────────
// [tag, attributes] per shape. Trusted constants only; nothing from data.

const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const ICONS = {
  doc: [STROKE, [['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }], ['polyline', { points: '14 2 14 8 20 8' }], ['line', { x1: 16, y1: 13, x2: 8, y2: 13 }], ['line', { x1: 16, y1: 17, x2: 8, y2: 17 }]]],
  file: [STROKE, [['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }], ['polyline', { points: '14 2 14 8 20 8' }]]],
  folder: [STROKE, [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]]],
  ead: [STROKE, [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ['circle', { cx: 9, cy: 11, r: 2.2 }], ['path', { d: 'M6 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14.5 10h3.5M14.5 13h3.5' }]]],
  intake: [STROKE, [['rect', { x: 5, y: 4, width: 14, height: 17, rx: 2 }], ['path', { d: 'M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4' }]]],
  birth_certificate: [STROKE, [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }], ['circle', { cx: 12, cy: 14, r: 2.6 }], ['path', { d: 'M10.6 16.2L10 20l2-1 2 1-.6-3.8' }]]],
  marriage_certificate: [STROKE, [['circle', { cx: 9, cy: 13, r: 4.5 }], ['circle', { cx: 15, cy: 13, r: 4.5 }], ['path', { d: 'M10.5 5l1.5-2 1.5 2' }]]],
  other: [STROKE, [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }]]],
  eye: [STROKE, [['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]]],
  eye_off: [STROKE, [['path', { d: 'M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2' }]]],
  mail: [STROKE, [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ['path', { d: 'M3.5 6.5l8.5 6.5 8.5-6.5' }]]],
  check: [{ fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [['path', { d: 'M3.5 8.5l3 3 6-7' }]], '0 0 16 16'],
  attention: [{}, [['path', { d: 'M8 3.5v5.5', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' }], ['circle', { cx: 8, cy: 12, r: 1.2, fill: 'currentColor' }]], '0 0 16 16'],
  locked: [{ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' }, [['rect', { x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }], ['path', { d: 'M5.5 7V5.5a2.5 2.5 0 015 0V7' }]], '0 0 16 16'],
};

export function icon(name, cls) {
  const [attrs, shapes, viewBox = '0 0 24 24'] = ICONS[name] || ICONS.other;
  const svg = doc().createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  if (cls) svg.setAttribute('class', cls);
  for (const [tag, a] of shapes) {
    const shape = doc().createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) shape.setAttribute(k, String(v));
    svg.appendChild(shape);
  }
  return svg;
}

// ── Formatting ───────────────────────────────────────────────────────────────

// Dates are stored as YYYY-MM-DD and always shown the USCIS way, MM/DD/YYYY.
export const fmtDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (v || '');
};
// The A- is format, not data (D-64).
export const fmtANumber = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d ? `A-${d}` : '';
};
export const maskSsn = (last4) => (last4 ? `•••-••-${String(last4).replace(/\D/g, '').slice(-4)}` : '');
// A server-masked SSN ("***-**-1234") in the page's own mask.
export const remask = (masked) => {
  const d = String(masked ?? '').replace(/\D/g, '');
  return d.length >= 4 ? maskSsn(d.slice(-4)) : '';
};
export const fmtMb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
export const fmtWhen = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.valueOf()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// The house pattern (N-023): the observed fact bold, the expectation normal.
export function findingText(title) {
  const text = el('span', 'psr-check-text');
  const s = String(title ?? '');
  const cut = s.search(/(?<=\.)\s+/);
  if (cut > 0) {
    text.appendChild(el('strong', null, s.slice(0, cut)));
    text.appendChild(el('span', 'psr-rest', ` ${s.slice(cut).trim()}`));
  } else {
    text.appendChild(el('strong', null, s));
  }
  return text;
}

// ── The 1.2 drop zone, with a real file picker ───────────────────────────────
// onFiles receives the dropped or picked File list. files: [{ name, meta, tags,
// onRemove }] are listed inside the zone once added (Max 2026-10-02).

export function dropZone({ title, meta, note, files = [], ready = false, landed = false, busy = false,
  multiple = true, accept = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp',
  chooseLabel, onFiles, extra = [], secondary = false }) {
  const zone = el('div', `ps-drop v2-drop${secondary ? ' v2-drop--secondary' : ''}${ready ? ' is-ready' : ''}${landed ? ' is-landed' : ''}${files.length ? ' has-files' : ''}${busy ? ' is-busy' : ''}`);
  zone.appendChild(icon('doc', 'ps-drop-icon'));
  zone.appendChild(el('p', 'ps-drop-title', title));
  if (meta) zone.appendChild(el('p', 'ps-drop-meta', meta));

  if (files.length) {
    const list = el('ul', 'v2-files');
    files.forEach((f, i) => {
      const li = el('li', 'v2-file');
      li.style.setProperty?.('--i', String(i));
      li.appendChild(icon('file', 'v2-file-icon'));
      const main = el('div', 'v2-file-main');
      main.appendChild(el('span', 'v2-file-name', f.name));
      if (f.meta) main.appendChild(el('span', 'v2-file-meta', f.meta));
      li.appendChild(main);
      if (f.tags?.length) {
        const tags = el('div', 'v2-file-tags');
        f.tags.forEach((x) => tags.appendChild(el('span', 'v2-file-tag', x)));
        li.appendChild(tags);
      }
      if (f.onRemove) li.appendChild(button(t('files.remove'), 'v2-link v2-file-remove', (ev) => { ev?.stopPropagation?.(); return f.onRemove(); }));
      list.appendChild(li);
    });
    zone.appendChild(list);
  }

  const input = el('input', 'v2-file-input');
  input.type = 'file';
  input.multiple = multiple;
  input.accept = accept;
  input.hidden = true;
  const pick = button(chooseLabel || t(multiple ? 'files.choose' : 'files.choose_one'),
    files.length ? 'btn btn--ghost v2-btn-sm' : 'btn btn--secondary', (ev) => { ev?.stopPropagation?.(); input.click?.(); });
  pick.disabled = busy;
  pick.classList.add('v2-file-pick');
  const row = el('div', 'v2-drop-choices');
  row.appendChild(pick);
  extra.forEach((b) => row.appendChild(b));
  zone.append(row, input);
  input.addEventListener('change', () => {
    const list = [...(input.files || [])];
    input.value = '';
    if (list.length) return onFiles(list);
  });
  if (note) zone.appendChild(el('p', 'v2-drop-note', note));

  zone.addEventListener('dragover', (e) => { e.preventDefault?.(); if (!busy) zone.classList.add('is-dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault?.();
    zone.classList.remove('is-dragover');
    if (busy) return undefined;
    const list = [...(e.dataTransfer?.files || [])];
    if (list.length) return onFiles(multiple ? list : list.slice(0, 1));
    return undefined;
  });
  return zone;
}

// The 1.2 scan moment: the button sweeps for as long as the request runs, then
// settles into "complete". onRun returns a promise; a false result means failed.
export function scanButton(label, onRun, disabled = false) {
  const b = button(label, 'btn btn--primary ps-scan-btn');
  b.disabled = disabled;
  b.addEventListener('click', async () => {
    if (b.classList.contains('is-scanning')) return;
    b.classList.remove('is-complete');
    b.classList.add('is-scanning');
    b.setAttribute('aria-busy', 'true');
    b.disabled = true;
    b.textContent = t('scan.running');
    let ok = false;
    try { ok = (await onRun()) !== false; } finally {
      b.classList.remove('is-scanning');
      b.removeAttribute('aria-busy');
      b.disabled = false;
      if (ok) { b.classList.add('is-complete'); b.textContent = t('scan.done'); } else b.textContent = label;
    }
  });
  return b;
}

// The report opens like a reviewed page being unsealed.
export function reveal(node) {
  node.classList.remove('v2-reveal');
  void node.offsetWidth;
  node.classList.add('v2-reveal');
}

export function notice(status, title, facts = [], severity, extra) {
  const wrap = el('details', `psr-notice psr-notice--${status}`);
  const sum = el('summary', 'psr-notice-head');
  sum.appendChild(el('span', 'psr-check-mark', status === 'not_checked' ? '?' : '!'));
  sum.appendChild(findingText(title));
  if (severity && status === 'needs_attention') sum.appendChild(el('span', `psr-sev psr-sev--${severity}`, severity));
  wrap.appendChild(sum);
  const body = el('div', 'psr-notice-body');
  facts.filter(([, v]) => v).forEach(([k, v]) => {
    const r = el('div', 'psr-nf');
    r.appendChild(el('span', 'psr-nf-k', k));
    r.appendChild(el('span', 'psr-nf-v', v));
    body.appendChild(r);
  });
  if (extra) body.appendChild(extra);
  wrap.appendChild(body);
  return wrap;
}

export function block(label, count, cls) {
  const wrap = el('section', `psr-block${cls ? ` ${cls}` : ''}`);
  const head = el('h3', 'psr-block-head');
  head.appendChild(el('span', null, label));
  if (count != null) head.appendChild(el('span', 'psr-count', String(count)));
  wrap.appendChild(head);
  return wrap;
}

export function infoRow(mark, text) {
  const row = el('div', 'v2-info-row');
  row.appendChild(el('span', 'v2-info-mark', mark));
  row.appendChild(findingText(text));
  return row;
}

export function errorLine(message) {
  const p = el('p', 'v2-error', message);
  p.setAttribute('role', 'alert');
  return p;
}
