// charts.js: the two SVG charts on the Card Income page.
//
// Emphasis form: the selected year in the money accent, the year before in a
// recessive gray, on one shared axis. Colors come from CSS classes
// (.ci-cur / .ci-prev in index.html), never from here, so light/dark and every
// theme follow the tokens. Text is set with textContent only.

import { MONTHS, MONTHS_LONG, fmtCompact, fmtMoney, valueAt, isLeap } from './model.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}

// Clean round ticks from 0 to just past `max`.
export function niceTicks(max, target = 5) {
  if (!(max > 0)) return [0];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const ticks = [];
  for (let v = 0; v < max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

// One shared tooltip per chart wrapper. rows: [{ cls, value, label }]
function tooltip(wrap) {
  let tip = wrap.querySelector('.ci-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'ci-tip';
    tip.setAttribute('role', 'status');
    tip.hidden = true;
    wrap.appendChild(tip);
  }
  return {
    show(title, rows, x, y) {
      tip.textContent = '';
      const h = document.createElement('div');
      h.className = 'ci-tip-title';
      h.textContent = title;
      tip.appendChild(h);
      for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'ci-tip-row';
        const key = document.createElement('span');
        key.className = `ci-key ${r.cls}`;
        const val = document.createElement('b');
        val.textContent = r.value;
        const lab = document.createElement('span');
        lab.className = 'ci-tip-lab';
        lab.textContent = r.label;
        row.append(key, val, lab);
        tip.appendChild(row);
      }
      tip.hidden = false;
      const w = wrap.clientWidth;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(4, Math.min(w - tw - 4, x + 14))}px`;
      tip.style.top = `${Math.max(0, y - 10)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

const PAD = { top: 16, right: 92, bottom: 28, left: 52 };

function frame(wrap, height) {
  wrap.querySelector('svg')?.remove();
  const width = Math.max(260, wrap.clientWidth);
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, width, height, class: 'ci-svg', role: 'img',
  });
  wrap.prepend(svg);
  return { svg, width, height, iw: width - PAD.left - PAD.right, ih: height - PAD.top - PAD.bottom };
}

function yAxis(g, ticks, y, iw) {
  for (const t of ticks) {
    el('line', { x1: 0, x2: iw, y1: y(t), y2: y(t), class: t === 0 ? 'ci-base' : 'ci-grid' }, g);
    const lab = el('text', { x: -10, y: y(t), class: 'ci-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, g);
    lab.textContent = fmtCompact(t);
  }
}

// ── Cumulative year-to-date lines ──────────────────────────────────────────
// cur / prev: arrays of { x: dayOfYear, y: cumulative } (step series).
export function drawCumulative(wrap, { year, cur, prev, asOfX }) {
  const { svg, iw, ih } = frame(wrap, 290);
  const days = isLeap(year) ? 366 : 365;
  const maxY = Math.max(...cur.map(p => p.y), ...prev.map(p => p.y), 1);
  const ticks = niceTicks(maxY);
  const x = (d) => (d / days) * iw;
  const y = (v) => ih - (v / ticks[ticks.length - 1]) * ih;

  svg.setAttribute('aria-label',
    `Running total for ${year}${prev.length ? ` against ${year - 1}` : ''}. Values are in the month table below.`);
  const g = el('g', { transform: `translate(${PAD.left},${PAD.top})` }, svg);
  yAxis(g, ticks, y, iw);

  // Month ticks along the bottom.
  MONTHS.forEach((label, m) => {
    const d = Math.round(Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 86400000;
    const t = el('text', { x: x(d + 15), y: ih + 18, class: 'ci-tick', 'text-anchor': 'middle' }, g);
    t.textContent = label;
  });

  // Daily series step (the total jumps on the day money arrives); monthly-only
  // series join their month-end totals with straight lines (no day is known).
  const path = (pts) => {
    if (!pts.length) return '';
    const monthly = pts.some(p => p.monthEnd);
    let s = `M${x(pts[0].x)},${y(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) {
      s += monthly ? `L${x(pts[i].x)},${y(pts[i].y)}` : `H${x(pts[i].x)}V${y(pts[i].y)}`;
    }
    return s;
  };

  const series = [];
  if (prev.length) series.push({ pts: prev, cls: 'ci-prev', name: String(year - 1) });
  if (cur.length) series.push({ pts: cur, cls: 'ci-cur', name: String(year) });

  for (const s of series) {
    el('path', { d: path(s.pts), class: `ci-line ${s.cls}` }, g);
  }
  // End markers + direct labels (value at the end of each line).
  const ends = series.map(s => {
    const last = s.pts[s.pts.length - 1];
    el('circle', { cx: x(last.x), cy: y(last.y), r: 4, class: `ci-dot ${s.cls}` }, g);
    return { s, last, ly: y(last.y) };
  });
  // Keep the two end labels from colliding when the lines end close together.
  if (ends.length === 2 && Math.abs(ends[0].ly - ends[1].ly) < 30 && Math.abs(x(ends[0].last.x) - x(ends[1].last.x)) < 80) {
    const [a, b] = ends[0].ly < ends[1].ly ? [ends[0], ends[1]] : [ends[1], ends[0]];
    const mid = (a.ly + b.ly) / 2;
    a.ly = mid - 15; b.ly = mid + 15;
  }
  for (const e of ends) {
    const lx = x(e.last.x) + 9;
    const t1 = el('text', { x: lx, y: e.ly - 2, class: 'ci-end-val' }, g);
    t1.textContent = fmtCompact(e.last.y);
    const t2 = el('text', { x: lx, y: e.ly + 12, class: 'ci-end-lab' }, g);
    t2.textContent = e.s.name;
  }

  // Crosshair + tooltip. Snaps to the day under the pointer.
  const tip = tooltip(wrap);
  const hair = el('line', { y1: 0, y2: ih, class: 'ci-hair', visibility: 'hidden' }, g);
  const hit = el('rect', { x: 0, y: 0, width: iw, height: ih, class: 'ci-hit', tabindex: 0 }, g);
  const show = (d) => {
    d = Math.max(1, Math.min(days, Math.round(d)));
    hair.setAttribute('x1', x(d)); hair.setAttribute('x2', x(d));
    hair.setAttribute('visibility', 'visible');
    const date = new Date(Date.UTC(year, 0, d));
    const title = `Through ${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCDate()}`;
    const rows = [];
    // Monthly-only years can only say "through the last complete month".
    const lab = (pts, y) => (pts.some(p => p.monthEnd) ? `${y} · whole months` : String(y));
    if (cur.length && (asOfX === null || d <= asOfX)) rows.push({ cls: 'ci-cur', value: fmtMoney(valueAt(cur, d) ?? 0), label: lab(cur, year) });
    if (prev.length) rows.push({ cls: 'ci-prev', value: fmtMoney(valueAt(prev, d) ?? 0), label: lab(prev, year - 1) });
    tip.show(title, rows, PAD.left + x(d), PAD.top + 8);
  };
  hit.addEventListener('pointermove', (e) => {
    const r = hit.getBoundingClientRect();
    show(((e.clientX - r.left) / r.width) * days);
  });
  hit.addEventListener('pointerleave', () => { hair.setAttribute('visibility', 'hidden'); tip.hide(); });
  let kd = asOfX || days;
  hit.addEventListener('focus', () => show(kd));
  hit.addEventListener('blur', () => { hair.setAttribute('visibility', 'hidden'); tip.hide(); });
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { kd = Math.min(days, kd + 7); show(kd); e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { kd = Math.max(1, kd - 7); show(kd); e.preventDefault(); }
  });
}

// ── Month-by-month columns ─────────────────────────────────────────────────
// rows: monthRows() output. Last year's column sits left of this year's.
export function drawMonths(wrap, { year, rows }) {
  const { svg, iw, ih } = frame(wrap, 290);
  const hasPrev = rows.some(r => r.priorAmount !== null);
  const maxY = Math.max(1, ...rows.map(r => Math.max(r.amount || 0, r.priorAmount || 0)));
  const ticks = niceTicks(maxY);
  const top = ticks[ticks.length - 1];
  const y = (v) => ih - (Math.max(0, v) / top) * ih;
  const band = iw / 12;
  const bw = Math.min(24, (band - 10) / (hasPrev ? 2 : 1) - 1);

  svg.setAttribute('aria-label', `Income by month for ${year}${hasPrev ? ` beside ${year - 1}` : ''}. Values are in the month table below.`);
  const g = el('g', { transform: `translate(${PAD.left},${PAD.top})` }, svg);
  yAxis(g, ticks, y, iw);

  // Column with a 4px rounded top and a square foot on the baseline.
  const column = (cx, v, cls) => {
    if (!(v > 0)) return null;
    const h = ih - y(v), r = Math.min(4, h, bw / 2), x0 = cx, x1 = cx + bw, yt = y(v);
    const d = `M${x0},${ih}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x1 - r}Q${x1},${yt} ${x1},${yt + r}V${ih}Z`;
    return el('path', { d, class: `ci-bar ${cls}` }, g);
  };

  const tip = tooltip(wrap);
  rows.forEach((r, i) => {
    const cx = i * band + band / 2;
    const pair = hasPrev ? bw * 2 + 2 : bw;
    const left = cx - pair / 2;
    const bars = [];
    if (hasPrev) bars.push(column(left, r.priorAmount, 'ci-prev'));
    bars.push(column(hasPrev ? left + bw + 2 : left, r.amount, 'ci-cur'));

    const lab = el('text', { x: cx, y: ih + 18, class: 'ci-tick', 'text-anchor': 'middle' }, g);
    lab.textContent = r.label;

    const hit = el('rect', { x: i * band, y: 0, width: band, height: ih, class: 'ci-hit', tabindex: 0 }, g);
    const show = () => {
      bars.forEach(b => b?.classList.add('is-hover'));
      const rowsOut = [];
      if (r.amount !== null) rowsOut.push({ cls: 'ci-cur', value: fmtMoney(r.amount), label: `${year}${r.partial ? ' so far' : ''}` });
      if (hasPrev) rowsOut.push({ cls: 'ci-prev', value: fmtMoney(r.priorAmount ?? 0), label: String(year - 1) });
      if (!rowsOut.length) rowsOut.push({ cls: 'ci-none', value: 'No data yet', label: '' });
      tip.show(r.long, rowsOut, PAD.left + cx, PAD.top + Math.min(y(Math.max(r.amount || 0, r.priorAmount || 0)), ih - 40));
    };
    const hide = () => { bars.forEach(b => b?.classList.remove('is-hover')); tip.hide(); };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', show);
    hit.addEventListener('blur', hide);
  });
}
