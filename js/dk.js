// Docket kit — shared render helpers for the portal's signature style.
// Pairs with the .dk-* classes in css/portal.css and DESIGN-SYSTEM.md.
// Loaded before page scripts (see portal.html), so every page can call window.DK.
'use strict';

window.DK = (function () {

  const esc = (s) => window.Utils ? window.Utils.esc(s) : String(s ?? '');

  // ── Avatars ───────────────────────────────────────────────────────────────
  // Deterministic hue from an id/name — same subject, same color across a page.
  const AV_COLORS = ['#2f6db0', '#5b7d3a', '#8a5a9b', '#93402f', '#22757c', '#b06f14', '#3a6ea5'];
  function avatarColor(seed) {
    const s = String(seed); let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function initials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2)
      .map(w => w[0] || '').join('').toUpperCase() || '—';
  }
  // avatar(name, seed?, size?) → the standard .dk-avatar chip
  function avatar(name, seed = name, size = 30) {
    const px = `${size}px`;
    return `<span class="dk-avatar" style="width:${px};height:${px};font-size:${Math.round(size * 0.4)}px;background:${avatarColor(seed)}" title="${esc(name)}">${initials(name)}</span>`;
  }

  // ── Masthead — kicker + serif title (put an <em> in `title` for the accent) ──
  function masthead({ kicker, title, sub }) {
    return `<div class="dk-masthead">
      ${kicker ? `<div class="dk-kicker rise" style="animation-delay:.04s">${esc(kicker)}</div>` : ''}
      <h1 class="dk-title rise" style="animation-delay:.09s">${title}</h1>
      ${sub ? `<p class="dk-sub rise" style="animation-delay:.13s">${sub}</p>` : ''}
    </div>`;
  }

  // ── Section head — serif title + hairline rule + optional add-button / count ─
  // opts: { count, add: { id, label } }
  function sectionHead(title, opts = {}) {
    const count = opts.count ? `<span class="dk-sec-count">${esc(opts.count)}</span>` : '';
    const add = opts.add ? `<button class="dk-sec-add" id="${opts.add.id}" type="button">${esc(opts.add.label)}</button>` : '';
    return `<div class="dk-sec-head"><h2>${esc(title)}</h2><span class="dk-sec-rule"></span>${count}${add}</div>`;
  }

  // ── Slider toggle — wraps a real checkbox (id/data-* preserved via `attrs`) ──
  function toggle(attrs = '', checked = false) {
    return `<span class="dk-toggle"><input type="checkbox" ${attrs} ${checked ? 'checked' : ''}><span class="dk-toggle-track"></span></span>`;
  }

  // ── Tag — inline status pill. kind: warn | ok | mut | acc ────────────────────
  function tag(label, kind = 'mut') {
    return `<span class="dk-tag ${kind}">${esc(label)}</span>`;
  }

  // ── Desk chips — at-a-glance status strip ────────────────────────────────────
  // chips: [{ n, label, tone:'live'|'warn', static:bool, jump:'elementId' }]
  function deskbar(chips) {
    const html = chips.map(c => {
      if (c.live) return `<span class="dk-chip is-live static"><span class="beat"></span> ${esc(c.label)}</span>`;
      const cls = ['dk-chip', c.tone === 'warn' ? 'is-warn' : '', c.static ? 'static' : ''].filter(Boolean).join(' ');
      const n = (c.n !== undefined && c.n !== null) ? `<span class="n">${esc(c.n)}</span> ` : '';
      const jump = c.jump ? ` data-jump="${esc(c.jump)}"` : '';
      const tag = c.static ? 'span' : 'button';
      const type = c.static ? '' : ' type="button"';
      return `<${tag} class="${cls}"${type}${jump}>${n}${esc(c.label)}</${tag}>`;
    }).join('');
    return `<div class="dk-deskbar">${html}</div>`;
  }
  // Wire deskbar [data-jump] chips to smooth-scroll to their section.
  function wireDeskbar(root = document) {
    (window.Utils ? window.Utils.qsa('[data-jump]', root) : [...root.querySelectorAll('[data-jump]')])
      .forEach(c => c.addEventListener('click', () => {
        document.getElementById(c.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
  }

  return { esc, avatarColor, initials, avatar, masthead, sectionHead, toggle, tag, deskbar, wireDeskbar };
})();
