// results.js: draws a STORED stage result with its staff clears (D-18, D-41).
//
// v2.1: Draft Review, Pre-flight and Physical Scan share one design (approved
// by Max 2026-10-16, "ok good"): the summary strip, one Needs attention list of
// cards (D-135, D-136), the client's corrections at Pre-flight, the checks with
// Evidence Match inside "Whole package" (D-140, D-145), needs info, please
// confirm, Possible issues. Physical Scan no longer goes through
// pages/proof-scan/report.js, so the old checker's renderer is untouched (D-88).
//
// What is drawn is the server's: the stored result and the report view the
// server computed from the clears (_proof-scan-v2-view.js): the result line,
// every count, which item is cleared. Nothing here evaluates, compares or
// counts. Every string goes through textContent.

import { el, t, button, block, findingText, infoRow, fmtWhen, reduceMotion, headlineCut } from './ui.js';
import { reviewModel, peopleInPackage } from './model.js';

const fieldIn = (field) => t(`field_in.${field}`);
const MARKS = { clear: '✓', not_checked: '?', needs_info: '·', please_confirm: 'i' };
const markOf = (status) => MARKS[status] || '!';
const SVG_NS = 'http://www.w3.org/2000/svg';
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ── Clear and Undo (D-132, D-143) ────────────────────────────────────────────
// The button sits beside the item's open/close control, never inside it, so a
// screen reader meets two controls with their own names.
function clearControls(key, cleared, ctx) {
  const frag = [];
  if (!key || !ctx.onClear) return frag;
  const tag = el('span', 'ps2-cleared-tag', cleared ? t('v21.cleared') : '');
  const btn = button(cleared ? t('v21.undo') : t('v21.clear'), 'ps2-clear', async (e) => {
    e?.stopPropagation?.();
    btn.disabled = true;
    await ctx.onClear(key, !cleared);
    btn.disabled = false;
  });
  btn.setAttribute('aria-label', cleared ? t('v21.undo_label') : t('v21.clear_label'));
  btn.setAttribute('aria-pressed', String(cleared));
  frag.push(tag, btn);
  return frag;
}

// ── Issue cards (D-136, D-141) ───────────────────────────────────────────────

function chevron() {
  const span = el('span', 'ps2-issue-chev');
  span.setAttribute('aria-hidden', 'true');
  const svg = globalThis.document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('focusable', 'false');
  const path = globalThis.document.createElementNS(SVG_NS, 'path');
  for (const [k, v] of Object.entries({ d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(k, v);
  svg.appendChild(path);
  span.appendChild(svg);
  return span;
}

// "I-765 · p.3, item 27 · I-765 page 3" says page 3 twice; keep the precise one.
function tidyWhere(where) {
  const parts = String(where || '').split(' · ').filter(Boolean);
  return parts.filter((p) => {
    const m = p.match(/^(.+) page (\d+)$/);
    return !(m && parts.some((q) => q !== p && q.includes(`p.${m[2]}`)));
  }).join(' · ');
}

// D-141: open 300 ms with a soft ease-out and the details drifting into place,
// close 240 ms. The header's padding never changes, the last frame is held
// until the card has closed, a timer finishes a throttled animation, and
// reduced motion gets no animation at all.
export function animateCard(card, body, open, onDone = () => {}) {
  const toggle = card.querySelector('.ps2-issue-toggle');
  const finishState = (isOpen) => {
    card.classList.toggle('is-open', isOpen);
    toggle?.setAttribute('aria-expanded', String(isOpen));
    onDone(isOpen);
  };
  if (card.dataset.animating) return;
  if (reduceMotion() || typeof body.animate !== 'function') {
    body.hidden = !open;
    finishState(open);
    return;
  }
  card.dataset.animating = '1';
  let finished = false;
  let anim;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (!open) body.hidden = true;
    anim?.cancel?.();
    card.classList.remove('is-closing');
    delete card.dataset.animating;
  };
  if (open) {
    body.hidden = false;
    finishState(true);
    const h = body.scrollHeight;
    anim = body.animate([
      { height: '0px', opacity: 0, transform: 'translateY(-6px)' },
      { height: `${h}px`, opacity: 1, transform: 'translateY(0)' },
    ], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    anim.onfinish = finish;
    setTimeout(finish, 360);
  } else {
    card.classList.add('is-closing');
    const h = body.offsetHeight;
    finishState(false);
    anim = body.animate([
      { height: `${h}px`, opacity: 1, transform: 'translateY(0)' },
      { height: '0px', opacity: 0, transform: 'translateY(-4px)' },
    ], { duration: 240, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    anim.onfinish = finish;
    setTimeout(finish, 300);
  }
}

let cardSeq = 0;
function issueCard(item, ctx, h) {
  const card = el('div', `ps2-issue ps2-issue--${item.kind || 'check'}${item.cleared ? ' is-cleared' : ''}`);
  card.dataset.key = item.key || '';
  const bar = el('div', 'ps2-issue-bar');
  const toggle = el('button', 'ps2-issue-toggle');
  toggle.type = 'button';
  const bodyId = `ps2-issue-body-${(cardSeq += 1)}`;
  toggle.setAttribute('aria-controls', bodyId);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.appendChild(el('span', 'ps2-issue-mark', item.cleared ? '✓' : '!'));
  // The title says what is wrong (D-136): the first sentence; the rest is the detail.
  const sentence = String(item.title || '');
  const cut = item.kind === 'fact' ? -1 : headlineCut(sentence);
  const title = cut > 0 ? sentence.slice(0, cut) : sentence;
  const rest = cut > 0 ? sentence.slice(cut).trim() : null;
  toggle.appendChild(el('span', 'ps2-issue-title', title.replace(/\.$/, '')));
  toggle.appendChild(chevron());
  bar.appendChild(toggle);
  clearControls(item.key, item.cleared, ctx).forEach((n) => bar.appendChild(n));
  card.appendChild(bar);

  const body = el('div', 'ps2-issue-body');
  body.id = bodyId;
  const grid = el('div', 'ps2-issue-grid');
  const line = (k, v, cls) => {
    if (v == null || v === '') return;
    grid.appendChild(el('span', 'ps2-issue-k', k));
    const cell = el('div', `ps2-issue-v${cls ? ` ${cls}` : ''}`);
    if (typeof v === 'string') cell.textContent = v; else cell.appendChild(v);
    grid.appendChild(cell);
  };
  const chips = (list) => {
    const wrap = el('div', 'ps2-chips');
    list.forEach(({ form, n }) => wrap.appendChild(el('span', 'ps2-chip', n > 1 ? `${form} ×${n}` : form)));
    return wrap;
  };
  let todo;
  if (item.kind === 'fact') {
    const many = item.on_forms.length > 1;
    for (const v of item.on_forms) {
      line(many ? `${t('v21.on_forms')}: ${v.forms.map((f) => f.form).join(', ')}` : t('v21.on_forms'), v.value || t('review.blank'), 'is-bad');
    }
    for (const s of item.sources) line(t('v21.on_sources', { sources: joinAnd(s.labels.map((l) => l.replace(/^the /, ''))) }), s.value, 'is-good');
    if (item.fix_on?.length) line(t('v21.fix_on'), chips(item.fix_on));
    todo = t(item.sources.length ? 'v21.todo.fact' : 'v21.todo.forms');
  } else if (item.kind === 'document_difference') {
    for (const d of item.documents || []) line(t('v21.on_sources', { sources: d.label.toLowerCase() }), d.value, 'is-bad');
    todo = t('v21.todo.documents');
  } else {
    line(t('v21.detail'), [rest, item.detail].filter(Boolean).join(' '));
    line(t('v21.expected'), item.expected);
    line(t('v21.where'), tidyWhere(item.where));
    line(t('v21.why'), item.reason);
    todo = t('v21.todo.other', { stage: h.stage_label || '' });
  }
  body.appendChild(grid);
  body.appendChild(el('p', 'ps2-issue-todo', todo));
  card.appendChild(body);

  const open = ctx.open?.has(item.key) && !item.cleared;
  body.hidden = !open;
  card.classList.toggle('is-open', Boolean(open));
  toggle.setAttribute('aria-expanded', String(Boolean(open)));
  // The whole card is the target from its first pixel; Clear keeps its own click.
  bar.addEventListener('click', (e) => {
    if (e.target?.closest?.('.ps2-clear')) return;
    animateCard(card, body, body.hidden, (isOpen) => {
      if (!ctx.open || !item.key) return;
      if (isOpen) ctx.open.add(item.key); else ctx.open.delete(item.key);
    });
  });
  return card;
}

// ── Check lists (one fold per form, the 1.2 shape, N-023) ────────────────────

function checkRow(r) {
  const status = r.cleared ? 'clear' : r.status;
  const row = el('div', `psr-check psr-check--${r.status}${r.cleared ? ' is-cleared' : ''}${r.kind === 'evidence' ? ' v2-ev-check' : ''}`);
  row.title = r.rule_id || '';
  if (r.rule_id) row.dataset.ruleId = r.rule_id;
  row.appendChild(el('span', 'psr-check-mark', markOf(status)));
  row.appendChild(el('span', 'psr-check-text', r.title));
  if (r.where) row.appendChild(el('span', 'psr-where', r.where));
  if (r.cleared) row.appendChild(el('span', 'ps2-cleared-tag', t('v21.cleared')));
  return row;
}

function fold(g) {
  const label = g.form || t('r12.package_group');
  const f = el('details', `psr-fold${g.clean ? ' psr-fold--clean' : ' psr-fold--bad'}`);
  const sum = el('summary', 'psr-fold-head');
  sum.appendChild(el('span', 'psr-fold-form', label));
  sum.appendChild(el('span', `psr-fold-meta psr-fold-meta--${g.clean ? 'ok' : 'bad'}`,
    g.passed === g.total ? t('r12.all_cleared', { n: g.total })
      : g.clean ? t('review.cleared_soft', { a: g.passed, b: g.total - g.passed })
        : t('r12.some_cleared', { a: g.passed, b: g.total })));
  f.appendChild(sum);
  const bar = el('div', 'psr-bar');
  const fill = el('span', `psr-bar-fill psr-bar-fill--${g.clean ? 'ok' : 'bad'}`);
  fill.style.width = `${g.total ? Math.round((g.passed / g.total) * 100) : 0}%`;
  bar.appendChild(fill);
  f.appendChild(bar);
  if (g.outstanding.length) {
    const names = el('div', 'psr-outstanding');
    g.outstanding.forEach((i) => {
      const tag = el('span', `psr-out psr-out--${i.status}`);
      tag.appendChild(el('span', 'psr-out-mark', markOf(i.status)));
      tag.appendChild(el('span', null, i.title));
      names.appendChild(tag);
    });
    f.appendChild(names);
  }
  const body = el('div', 'psr-fold-body');
  g.rows.forEach((r, i) => {
    // D-140: Evidence Match is a subheading inside "Whole package".
    if (i === g.evidence_from) body.appendChild(el('div', 'v2-ev-check-head', t('v21.evidence_match')));
    body.appendChild(checkRow(r));
  });
  f.appendChild(body);
  return f;
}

function mutedFold(label, count, rows, cls) {
  const s = el('section', `psr-block${cls ? ` ${cls}` : ''}`);
  const f = el('details', 'psr-fold psr-fold--muted');
  const sum = el('summary', 'psr-fold-head');
  sum.appendChild(el('span', 'psr-fold-form', label));
  sum.appendChild(el('span', 'psr-fold-meta psr-fold-meta--muted', String(count)));
  f.appendChild(sum);
  const body = el('div', 'psr-fold-body');
  rows.forEach((r) => body.appendChild(r));
  f.appendChild(body);
  s.appendChild(f);
  return s;
}

// An info row (needs info, please confirm, not checked) with its Clear.
function clearableRow(mark, text, item, ctx, extra = []) {
  const row = infoRow(item.cleared ? '✓' : mark, text);
  row.classList.add('ps2-row');
  if (item.cleared) row.classList.add('is-cleared');
  row.dataset.key = item.key;
  extra.forEach((n) => row.appendChild(n));
  clearControls(item.key, item.cleared, ctx).forEach((n) => row.appendChild(n));
  return row;
}

// ── Pre-flight client corrections (D-68, D-72, D-73) ─────────────────────────

const CORR_MARK = { fixed: '✓', omitted_ok: '✓', not_fixed: '!', not_carried: '!', no_page: '!', check: '!', unreadable: '?' };
const CORR_COPY = { fixed: 'fixed', omitted_ok: 'omitted_ok', not_fixed: 'not_fixed', not_carried: 'not_carried', no_page: 'no_page', check: 'check', unreadable: 'unreadable' };

function renderCorrections(corrections, mount, ctx) {
  const look = corrections.filter((c) => c.status === 'not_fixed' || c.status === 'no_page' || c.status === 'not_carried').length;
  const b = block(t('pf.corr.heading'), look, 'v2-corrections');
  b.appendChild(el('p', 'v2-block-note', t('pf.corr.note')));
  for (const c of corrections) {
    const key = CORR_COPY[c.status] || 'check';
    const vars = {
      form: c.form, page: c.page, field: fieldIn(c.field), original: c.original ?? '', markup: c.markup_read ?? '',
      corrected: c.corrected ?? '', other: c.other_form ?? '', other_value: c.other_value ?? '', other_where: '',
    };
    const row = el('div', `v2-corr v2-corr--${c.status}`);
    row.appendChild(el('span', 'v2-corr-mark', CORR_MARK[c.status] || '!'));
    row.appendChild(findingText(t(`pf.corr.${key}`, vars)));
    row.appendChild(el('span', 'v2-corr-tag', t(`pf.corr.tag.${key}`)));
    b.appendChild(row);
  }
  if (ctx?.proposedFromRun) {
    const line = el('p', 'v2-block-note v2-corr-sent', t('pf.corr.sent', { n: ctx.proposedFromRun }));
    line.appendChild(el('span', null, ' '));
    if (ctx.openStage) line.appendChild(button(t('pf.corr.review_ez'), 'v2-link', () => ctx.openStage('evidence_zero')));
    b.appendChild(line);
  }
  mount.appendChild(b);
}

// ── The summary strip (approved 2026-10-16, "i like the strip") ─────────────

function jump(target) {
  if (!target) return;
  if (target.matches?.('details')) target.open = true;
  target.scrollIntoView?.({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  target.classList.remove('ps2-flash');
  void target.offsetWidth;
  target.classList.add('ps2-flash');
}

function strip(view, mount, ctx) {
  const s = view.strip;
  if (!s.total && !s.possible) return null;
  const wrap = el('div', `ps2-strip${s.all_cleared ? ' is-done' : ''}`);
  if (s.all_cleared) {
    const done = el('div', 'ps2-strip-done');
    done.appendChild(el('span', 'ps2-strip-done-text', t('v21.strip.done')));
    done.appendChild(button(t('v21.strip.review'), 'ps2-strip-go', () => jump(ctx.signoffTarget?.())));
    wrap.appendChild(done);
  } else {
    const chips = el('div', 'ps2-strip-chips');
    const chip = (cls, n, label, find) => {
      const b = button('', `ps2-strip-chip ${cls}${n ? '' : ' is-zero'}`, () => jump(find()));
      b.appendChild(el('span', 'ps2-strip-n', String(n)));
      b.appendChild(el('span', 'ps2-strip-l', label));
      chips.appendChild(b);
    };
    chip('is-fix', s.fix, t('v21.strip.fix'), () => mount.querySelector('.v2-needs-attention'));
    chip('is-confirm', s.confirm, t('v21.strip.confirm'), () => mount.querySelector('.v2-confirm'));
    chip('is-possible', s.possible, t('v21.strip.possible'), () => mount.querySelector('.ps-explore'));
    wrap.appendChild(chips);
  }
  const bar = el('div', 'ps2-strip-bar');
  const fill = el('span', 'ps2-strip-fill');
  fill.style.width = `${s.total ? Math.round((s.cleared / s.total) * 100) : 100}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
}

// ── The report ───────────────────────────────────────────────────────────────

export function renderStageResult(result, view, mount, ctx = {}) {
  mount.textContent = '';
  const m = reviewModel(result);
  const h = m.header;

  // Header: what was reviewed, and the server's result line with the clears.
  const head = el('div', 'psr-head');
  const left = el('div');
  left.appendChild(el('div', 'psr-file', h.scope === 'individual' && h.form
    ? t('review.individual_file', { form: h.form })
    : h.files.length === 1 ? h.files[0] : t('review.n_files', { n: h.files.length })));
  left.appendChild(el('div', 'psr-casetype', [h.case_type_label, h.stage_label, h.scope ? t(`scope.${h.scope}`) : null].filter(Boolean).join(' · ')));
  head.appendChild(left);
  const right = el('div', 'psr-head-right');
  if (h.scanned_at) right.appendChild(el('div', 'psr-scanned', fmtWhen(h.scanned_at)));
  right.appendChild(el('div', `psr-verdict psr-verdict--${view.line.tone}`, view.line.text));
  if (view.line.note) right.appendChild(el('div', 'ps2-cleared-note', view.line.note));
  head.appendChild(right);
  mount.appendChild(head);
  mount.appendChild(el('p', 'v2-reminder', h.reminder));
  const s = strip(view, mount, ctx);
  if (s) mount.appendChild(s);

  // One Needs attention list in every stage (D-135), each problem a card (D-136).
  const open = view.attention.filter((a) => !a.cleared).length;
  const attn = block(t('v21.needs_attention'), view.attention.length ? open : null, `v2-needs-attention${view.attention.length && !open ? ' is-all-cleared' : ''}`);
  if (!view.attention.length) attn.appendChild(el('p', 'v2-block-empty', t('v21.none')));
  view.attention.forEach((a) => attn.appendChild(issueCard(a, ctx, h)));
  mount.appendChild(attn);

  if (m.corrections) renderCorrections(m.corrections, mount, ctx);

  if (view.groups.length) {
    const ck = block(t('v21.checks'), null, 'v2-checks');
    view.groups.forEach((g) => ck.appendChild(fold(g)));
    mount.appendChild(ck);
  }

  // Needs info (D-47): never counted, never alarming.
  if (view.needs_info.length) {
    const ni = block(t('review.needs_info'), view.needs_info.filter((x) => !x.cleared).length, 'v2-needs-info');
    ni.appendChild(el('p', 'v2-block-note', t('review.needs_info.note')));
    view.needs_info.forEach((n) => ni.appendChild(clearableRow('·', n.form ? t('review.needs_info_check', { form: n.form, title: String(n.title || '').replace(/\.$/, '') }) : n.title, n, ctx)));
    if (ctx.openStage && view.needs_info.some((n) => n.key.startsWith('ni:') && !n.key.startsWith('ni:rule:'))) {
      ni.appendChild(button(t('review.edit_reference'), 'v2-link', () => ctx.openStage('evidence_zero')));
    }
    mount.appendChild(ni);
  }

  // Please confirm (D-70, D-107, D-110): gentle, never counted. A cleared one
  // shows the check only, never the "i" (Max 10-16).
  if (view.confirm.length) {
    const cb = block(t('review.confirm'), view.confirm.filter((x) => !x.cleared).length, 'v2-confirm');
    cb.appendChild(el('p', 'v2-block-note', t('review.confirm.note')));
    view.confirm.forEach((c) => {
      const title = String(c.title || '');
      cb.appendChild(clearableRow('i', /\?\s*$/.test(title) ? title : t('review.confirm_row', { title: title.replace(/\.$/, '') }), c, ctx));
    });
    mount.appendChild(cb);
  }

  if (m.awareness.length) {
    const nb = block(t('review.notifications'), null, 'v2-notifications');
    nb.appendChild(el('p', 'v2-block-note', t('review.notifications.note')));
    m.awareness.forEach((n) => nb.appendChild(infoRow('i', n.title)));
    mount.appendChild(nb);
  }
  if (result.case_type !== 'daca_renewal' && result.stage === 'physical_scan') renderPeopleBlock(mount, result);

  if (m.later.length) {
    mount.appendChild(mutedFold(t('review.pending'), m.later.length, m.later.map((r) => {
      const row = el('div', 'psr-check v2-check--pending');
      row.title = r.rule_id;
      row.appendChild(el('span', 'psr-check-mark', '–'));
      row.appendChild(el('span', 'psr-check-text', [r.form, r.title].filter(Boolean).join(' · ')));
      return row;
    }), 'v2-later'));
  }
  if (m.not_this_stage_count) {
    const sec = el('section', 'psr-block v2-not-this-stage');
    sec.appendChild(el('p', 'v2-block-note', t('review.not_this_stage_count', { n: m.not_this_stage_count })));
    mount.appendChild(sec);
  }
  if (view.not_checked.length) {
    mount.appendChild(mutedFold(t('r12.not_checked'), view.not_checked.filter((x) => !x.cleared).length,
      view.not_checked.map((c) => clearableRow('?', [c.title, c.reason ? `${t('r12.why_not_checked')}: ${c.reason}` : null].filter(Boolean).join(' '), c, ctx)), 'v2-not-checked'));
  }
  if (ctx.afterReport) ctx.afterReport(mount);
  mount.appendChild(el('p', 'psr-standing-note', h.reminder));
}

// Kept for callers that name the stage: both draw the same report.
export const renderReviewResult = (result, mount, ctx = {}) => renderStageResult(result, ctx.view || null, mount, ctx);
export const renderPhysicalScanResult = renderReviewResult;

// General and AOS Physical Scan: who the package is about (D-94, D-95, D-99).
function renderPeopleBlock(container, result) {
  const people = peopleInPackage(result);
  if (!people.length) return;
  const b = block(t('ps.people.heading'), null, 'v2-ps-people');
  const grid = el('div', 'v2-ps-people-grid');
  for (const p of people) {
    const c = el('div', 'v2-ps-person');
    const top = el('div', 'v2-ps-person-top');
    top.appendChild(el('span', 'v2-pill v2-pill--role', t(`role.${p.role}`)));
    if (p.is_new) top.appendChild(el('span', 'v2-pill v2-pill--new', t('ps.people.new_card')));
    c.appendChild(top);
    c.appendChild(el('div', 'v2-person-name', p.name || t('people.unnamed')));
    const meta = [p.date_of_birth, p.a_number].filter(Boolean).join(' · ');
    if (meta) c.appendChild(el('div', 'v2-person-meta', meta));
    if (p.forms.length) {
      c.appendChild(el('div', 'v2-ps-k', t('ps.people.forms')));
      const row = el('div', 'v2-file-tags v2-ps-tags');
      p.forms.forEach((f) => row.appendChild(el('span', 'v2-file-tag', f)));
      c.appendChild(row);
    }
    c.appendChild(el('div', 'v2-ps-k', t('ps.people.evidence')));
    if (!p.evidence.length) c.appendChild(el('div', 'v2-person-meta', t('ps.people.none')));
    p.evidence.forEach((e) => {
      const r = el('div', 'v2-ps-ev');
      r.appendChild(el('span', 'v2-ps-ev-name', e.label));
      if (e.shared) r.appendChild(el('span', 'v2-pill v2-pill--muted', t('ps.people.shared')));
      c.appendChild(r);
    });
    grid.appendChild(c);
  }
  b.appendChild(grid);
  container.appendChild(b);
}

