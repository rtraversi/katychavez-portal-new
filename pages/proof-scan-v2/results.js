// results.js: draws a STORED stage result (D-18, D-41).
//
// Draft Review and Pre-flight use the v2 Lab's report layout (review.js
// renderResult); Physical Scan uses the portal's own 1.2 report renderer,
// pages/proof-scan/report.js, minus the client block (D-89). Both read the
// result exactly as the server stored it: every status, count, title and
// phrase is the server's. Nothing here evaluates, compares or counts toward
// the official result. Every string goes through textContent.

import { renderReport } from '../proof-scan/report.js';
import {
  el, t, button, block, notice, findingText, infoRow, fmtWhen,
} from './ui.js';
import { reviewModel, physicalScanReport, peopleInPackage } from './model.js';

const roleLower = (role) => t(`role.${role}`).toLowerCase();
const fieldIn = (field) => t(`field_in.${field}`);
const MARKS = { clear: '✓', not_checked: '?', needs_info: '·', please_confirm: 'i' };
const markOf = (status) => MARKS[status] || '!';
// "Birth certificate" reads mid-sentence as "birth certificate"; "EAD" stays "EAD".
const evidenceWord = (label) => String(label || '').split(' ').map((w) => (/^[A-Z0-9-]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');

function checkRow(c) {
  const row = el('div', `psr-check psr-check--${c.status}`);
  row.title = c.rule_id;
  row.dataset.ruleId = c.rule_id;
  row.appendChild(el('span', 'psr-check-mark', markOf(c.status)));
  row.appendChild(el('span', 'psr-check-text', c.title));
  if (c.where) row.appendChild(el('span', 'psr-where', c.where));
  return row;
}

// One fold per form, the 1.2 shape (N-023). Needs info and "please confirm"
// are not failures, so they never turn a form amber.
function fold(label, items) {
  const soft = (i) => i.status === 'clear' || i.status === 'needs_info' || i.status === 'please_confirm';
  const cleared = items.filter((i) => i.status === 'clear').length;
  const total = items.length;
  const clean = items.every(soft);
  const f = el('details', `psr-fold${clean ? ' psr-fold--clean' : ' psr-fold--bad'}`);
  const sum = el('summary', 'psr-fold-head');
  sum.appendChild(el('span', 'psr-fold-form', label));
  sum.appendChild(el('span', `psr-fold-meta psr-fold-meta--${clean ? 'ok' : 'bad'}`,
    clean ? (cleared === total ? t('r12.all_cleared', { n: total }) : t('review.cleared_soft', { a: cleared, b: total - cleared }))
      : t('r12.some_cleared', { a: cleared, b: total })));
  f.appendChild(sum);
  const bar = el('div', 'psr-bar');
  const fill = el('span', `psr-bar-fill psr-bar-fill--${clean ? 'ok' : 'bad'}`);
  fill.style.width = `${total ? Math.round((cleared / total) * 100) : 0}%`;
  bar.appendChild(fill);
  f.appendChild(bar);
  if (!clean) {
    const names = el('div', 'psr-outstanding');
    items.filter((i) => !soft(i)).forEach((i) => {
      const tag = el('span', `psr-out psr-out--${i.status}`);
      tag.appendChild(el('span', 'psr-out-mark', markOf(i.status)));
      tag.appendChild(el('span', null, i.title));
      names.appendChild(tag);
    });
    f.appendChild(names);
  }
  const body = el('div', 'psr-fold-body');
  items.forEach((i) => body.appendChild(checkRow(i)));
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

// ── Evidence matches the forms (D-98) ────────────────────────────────────────

export function renderMatchBlock(container, groups, differences = []) {
  if (!groups.length) return;
  const bad = groups.filter((g) => !g.ok).length;
  const b = block(t('match.heading'), bad || null, 'v2-match');
  b.appendChild(el('p', 'v2-block-note', t('match.note')));
  differences.forEach((d) => b.appendChild(notice('needs_attention', d.title)));
  const owners = (roles) => roles.map(roleLower).join(` ${t('match.and')} `);
  for (const g of groups) {
    const row = el('div', `v2-match-row v2-match-row--${g.ok ? 'ok' : 'bad'}`);
    row.appendChild(el('span', 'v2-match-mark', g.ok ? '✓' : '!'));
    const text = el('div', 'v2-match-text');
    const label = t('match.doc', { owner: owners(g.owner_roles), evidence: evidenceWord(g.evidence) });
    text.appendChild(el('strong', null, g.source === 'package' ? `${label} ${t('match.in_package')}` : label));
    const forms = [...new Set(g.rows.map((r) => r.form))].join(', ');
    const fields = [...new Set(g.rows.map((r) => fieldIn(r.field)))].join(', ');
    text.appendChild(el('span', 'v2-match-detail', g.ok
      ? t('match.ok', { forms, fields })
      : g.rows.filter((r) => !r.ok).map((r) => t('match.bad_short', { field: fieldIn(r.field), ev: r.evidence_value, form: r.form, fv: r.form_value })).join(' ')));
    row.appendChild(text);
    b.appendChild(row);
  }
  container.appendChild(b);
}

// ── Pre-flight client corrections (D-68, D-72, D-73) ─────────────────────────

const CORR_MARK = { fixed: '✓', omitted_ok: '✓', not_fixed: '!', not_carried: '!', no_page: '!', check: '!', unreadable: '?' };
const CORR_COPY = { fixed: 'fixed', omitted_ok: 'omitted_ok', not_fixed: 'not_fixed', not_carried: 'not_carried', no_page: 'no_page', check: 'check', unreadable: 'unreadable' };

function renderCorrections(m, mount, ctx) {
  const look = m.corrections.filter((c) => c.status === 'not_fixed' || c.status === 'no_page' || c.status === 'not_carried').length;
  const b = block(t('pf.corr.heading'), look, 'v2-corrections');
  b.appendChild(el('p', 'v2-block-note', t('pf.corr.note')));
  for (const c of m.corrections) {
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
  // D-55, D-72: fixed values were proposed to the case card, never written.
  if (ctx?.proposedFromRun) {
    const line = el('p', 'v2-block-note v2-corr-sent', t('pf.corr.sent', { n: ctx.proposedFromRun }));
    line.appendChild(el('span', null, ' '));
    line.appendChild(button(t('pf.corr.review_ez'), 'v2-link', () => ctx.openStage('evidence_zero')));
    b.appendChild(line);
  }
  mount.appendChild(b);
}

// ── Draft Review and Pre-flight ──────────────────────────────────────────────

export function renderReviewResult(result, mount, ctx = {}) {
  mount.textContent = '';
  const m = reviewModel(result);
  const h = m.header;

  // Header: what was reviewed, and the server's D-23 language.
  const head = el('div', 'psr-head');
  const left = el('div');
  left.appendChild(el('div', 'psr-file', h.scope === 'individual' && h.form
    ? t('review.individual_file', { form: h.form })
    : h.files.length === 1 ? h.files[0] : t('review.n_files', { n: h.files.length })));
  left.appendChild(el('div', 'psr-casetype', [h.case_type_label, h.stage_label, h.scope ? t(`scope.${h.scope}`) : null].filter(Boolean).join(' · ')));
  head.appendChild(left);
  const right = el('div', 'psr-head-right');
  if (h.scanned_at) right.appendChild(el('div', 'psr-scanned', fmtWhen(h.scanned_at)));
  right.appendChild(el('div', `psr-verdict psr-verdict--${h.tone}`, h.phrase));
  head.appendChild(right);
  mount.appendChild(head);
  mount.appendChild(el('p', 'v2-reminder', h.reminder));

  // D-98: evidence against the forms, before everything else.
  if (m.matches.length || m.evidence_differences.length) renderMatchBlock(mount, m.matches, m.evidence_differences);

  // Optional Pre-flight corrections, shown first when they were checked.
  if (m.corrections) renderCorrections(m, mount, ctx);

  // Our errors: inconsistencies across forms, and forms against the case card.
  const ourCount = m.our.consistency.length + m.our.differences.length + m.our.not_carried.length;
  const our = block(t('review.our_errors'), ourCount, 'v2-our-errors');
  our.appendChild(el('p', 'v2-block-note', t('review.our_errors.note')));
  m.our.consistency.forEach((c) => our.appendChild(notice('needs_attention', c.title,
    [[t('review.observed'), c.summary], [t('r12.where'), [c.form, c.where, ...(c.locations || [])].filter(Boolean).join(' · ')], [t('r12.expects'), c.expected], [t('r12.note'), c.reason]], c.severity)));
  m.our.not_carried.forEach((d) => our.appendChild(notice('needs_attention', d.title)));
  m.our.differences.forEach((d) => {
    const edit = ctx.openStage ? button(t('review.edit_reference'), 'v2-link', () => ctx.openStage('evidence_zero')) : null;
    our.appendChild(notice('needs_attention', d.title, [
      [t('review.draft_value'), [d.form_value || t('review.blank'), d.form].filter(Boolean).join(' · ')],
      [t('review.differences.card'), d.card_value],
      [t('review.resolve_label'), t('review.resolve_text')],
    ], null, edit));
  });
  if (m.our.fold.length) our.appendChild(fold(t('review.consistency_group'), m.our.fold));
  if (!ourCount && !m.our.fold.length) our.appendChild(el('p', 'v2-block-empty', t('review.our_errors.none')));
  mount.appendChild(our);

  // Checklist items, one fixed group per form.
  const ck = block(t('review.checklist'), m.checklist.missing.length + m.checklist.attention.length, 'v2-checklist');
  m.checklist.missing.forEach((i) => ck.appendChild(notice('needs_attention', i.title, [[t('review.expected_by'), i.detail]])));
  m.checklist.attention.forEach((c) => ck.appendChild(notice('needs_attention', c.title,
    [[t('review.observed'), c.summary], [t('r12.expects'), c.expected], [t('r12.where'), [c.form, c.where, ...(c.locations || [])].filter(Boolean).join(' · ')], [t('r12.note'), c.reason]], c.severity)));
  m.checklist.groups.forEach((g) => ck.appendChild(fold(g.form || t('r12.package_group'), g.items)));
  mount.appendChild(ck);

  // Needs info (D-47): never counted, never alarming.
  const niCount = m.needs_info.notes.length + m.needs_info.checks.length;
  if (niCount) {
    const ni = block(t('review.needs_info'), niCount, 'v2-needs-info');
    ni.appendChild(el('p', 'v2-block-note', t('review.needs_info.note')));
    m.needs_info.notes.forEach((n) => ni.appendChild(infoRow('·', n.title)));
    m.needs_info.checks.forEach((c) => ni.appendChild(infoRow('·', t('review.needs_info_check', { form: c.form || '', title: String(c.title || '').replace(/\.$/, '') }))));
    if (m.needs_info.notes.length && ctx.openStage) ni.appendChild(button(t('review.edit_reference'), 'v2-link', () => ctx.openStage('evidence_zero')));
    mount.appendChild(ni);
  }

  // Please confirm (D-70): gentle, never counted.
  if (m.confirm.length) {
    const cb = block(t('review.confirm'), m.confirm.length, 'v2-confirm');
    cb.appendChild(el('p', 'v2-block-note', t('review.confirm.note')));
    m.confirm.forEach((c) => cb.appendChild(infoRow('i', t('review.confirm_row', { title: String(c.title || '').replace(/\.$/, '') }))));
    mount.appendChild(cb);
  }

  renderAwareness(mount, m.awareness);
  renderLaterAndNotChecked(mount, m);
}

function renderAwareness(mount, notes) {
  if (!notes.length) return;
  const nb = block(t('review.notifications'), null, 'v2-notifications');
  nb.appendChild(el('p', 'v2-block-note', t('review.notifications.note')));
  notes.forEach((n) => nb.appendChild(infoRow('i', n.title)));
  mount.appendChild(nb);
}

function renderLaterAndNotChecked(mount, m) {
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
    const s = el('section', 'psr-block v2-not-this-stage');
    s.appendChild(el('p', 'v2-block-note', t('review.not_this_stage_count', { n: m.not_this_stage_count })));
    mount.appendChild(s);
  }
  if (m.not_checked.length) {
    mount.appendChild(mutedFold(t('r12.not_checked'), m.not_checked.length,
      m.not_checked.map((c) => notice('not_checked', c.title, [[t('r12.where'), [c.form, c.where].filter(Boolean).join(' · ')], [t('r12.why_not_checked'), c.reason]])), 'v2-not-checked'));
  }
}

// ── Physical Scan: the 1.2 report, then the v2 blocks ────────────────────────

export function renderPhysicalScanResult(result, mount, ctx = {}) {
  renderReport(physicalScanReport(result), mount);
  // D-89: no client block. report.js draws an empty strip when it has no facts.
  for (const node of [...mount.childNodes]) {
    if (/\bpsr-summary-strip\b|\bpsr-client-details\b/.test(node.className || '')) node.remove();
  }
  const standing = [...mount.childNodes].find((n) => /\bpsr-standing-note\b/.test(n.className || ''));
  const extra = el('div', 'v2-ps-extra');
  const m = reviewModel(result);
  renderMatchBlock(extra, m.matches);
  if (result.case_type === 'general') renderPeopleBlock(extra, result);
  renderAwareness(extra, m.awareness);
  if (m.later.length || m.not_this_stage_count) renderLaterAndNotChecked(extra, { ...m, not_checked: [] });
  if (ctx.afterReport) ctx.afterReport(extra);
  if (standing) mount.insertBefore(extra, standing);
  else mount.appendChild(extra);
}

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
