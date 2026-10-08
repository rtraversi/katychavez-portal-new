// app.js: Proof Scan v2, the page. Ported from the v2 Lab's v2-lab.js (the
// flow Max approved) and wired to the Batch 2 routes.
//
// 1. Start: pick the case type, name the folder, press Start. The case type is
//    locked from then on (D-77). Or find an existing case by client name or
//    A-Number (D-83).
// 2. The case card stays on top: folder, case type, the stage tracker and the
//    people (D-63, D-99).
// 3. DACA opens in Evidence Zero; once the evidence requirement is met and the
//    record approved, approving moves on to the stage choice (D-67, D-91).
//    General can go straight to any stage (D-95).
//
// Everything shown is what the server returned (D-18). Text only (D-41).

import {
  el, t, button, section, clear, icon, fmtDate, fmtANumber, fmtWhen, scrollTo, errorLine,
} from './ui.js';
import {
  STAGES, CASE_TYPES, stepState, statusKey, gateReady, isGeneral, mainPerson, fullName, formatAddress,
} from './model.js';
import { createSsnToggle } from './ssn.js';
import { renderEvidenceZero } from './evidence-zero.js';
import { renderStage, loadStoredRun } from './stages.js';
import { renderRulebook } from './rulebook.js';
import { errorText } from './api.js';

export function mountProofScanV2({ root, api }) {
  const ctx = {
    api,
    view: null,
    stage: null,
    mode: 'scan',
    rules: {},
    start: { caseType: '', label: '', error: '', query: '', results: null, searching: false },
    error: '',
  };
  ctx.ssn = createSsnToggle(api, { onError: (res) => { ctx.error = errorText(res); render(); } });

  // ── Shell ──────────────────────────────────────────────────────────────────
  clear(root);
  root.classList.add('ps2');
  const masthead = el('div', 'dk-masthead');
  masthead.appendChild(el('div', 'dk-kicker rise', t('masthead.kicker')));
  const mastTitle = el('h1', 'dk-title rise', t('masthead.title'));
  const mastSub = el('p', 'dk-sub rise', t('masthead.sub'));
  masthead.append(mastTitle, mastSub);
  const tabs = el('div', 'v2-tabs');
  tabs.setAttribute('role', 'tablist');
  const scanTab = button(t('nav.scan'), 'v2-tab', () => showMode('scan'));
  const ruleTab = button(t('nav.rulebook'), 'v2-tab', () => showMode('rulebook'));
  scanTab.dataset.mode = 'scan';
  ruleTab.dataset.mode = 'rulebook';
  tabs.append(scanTab, ruleTab);
  masthead.appendChild(tabs);
  const scanView = el('div', 'v2-view-scan');
  const ruleView = el('div', 'v2-view-rulebook');
  root.append(masthead, scanView, ruleView);

  function showMode(mode) {
    ctx.mode = mode;
    for (const [b, on] of [[scanTab, mode === 'scan'], [ruleTab, mode === 'rulebook']]) {
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('is-on', on);
    }
    scanView.hidden = mode !== 'scan';
    // The rulebook has its own masthead (Lab layout); one title per view.
    mastTitle.hidden = mode !== 'scan';
    mastSub.hidden = mode !== 'scan';
    ruleView.hidden = mode !== 'rulebook';
    if (mode === 'rulebook') return renderRulebook(ruleView, ctx);
    return render();
  }

  // ── Context the screens use ────────────────────────────────────────────────
  ctx.setView = (view, opts) => { ctx.view = view; render(opts); };
  ctx.redraw = (opts) => render(opts);
  ctx.formsFor = (caseType) => [...new Set((ctx.rules[caseType]?.package_items || [])
    .filter((i) => (i.kind || 'form') === 'form').map((i) => i.form))];
  ctx.rememberRules = (caseType, book) => { ctx.rules[caseType] = book; };
  ctx.openStage = async (key) => {
    ctx.stage = key;
    if (key !== 'evidence_zero') await loadStoredRun(ctx, key);
    render({ scrollToCase: true });
  };
  // D-67: approving a ready record leaves Evidence Zero for the stage choice.
  ctx.afterApprove = (view) => {
    ctx.view = view;
    if (gateReady(view)) { ctx.stage = null; render({ scrollToCase: true }); } else render();
  };

  async function openCase(id) {
    const res = await api.getCase(id);
    if (!res.ok) { ctx.start.error = errorText(res); render(); return; }
    await caseOpened(res.data);
  }

  async function caseOpened(view) {
    ctx.view = view;
    ctx.stages = {};
    ctx.ez = null;
    const ct = view.case.case_type;
    if (!ctx.rules[ct]) {
      const r = await api.rules(ct);
      if (r.ok) ctx.rules[ct] = r.data;
    }
    // DACA starts in Evidence Zero until the requirement is met (D-63).
    ctx.stage = !isGeneral(view) && !gateReady(view) ? 'evidence_zero' : null;
    render({ scrollToCase: true });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render(opts = {}) {
    if (ctx.mode !== 'scan') return;
    const active = globalThis.document?.activeElement?.id;
    clear(scanView);
    if (ctx.error) scanView.appendChild(errorLine(ctx.error));
    if (!ctx.view) {
      drawStart();
    } else {
      const caseCard = drawCase();
      drawChoice();
      const mount = el('div', 'v2-stage-mount');
      scanView.appendChild(mount);
      if (ctx.stage === 'evidence_zero') renderEvidenceZero(mount, ctx);
      else if (ctx.stage) renderStage(mount, ctx, ctx.stage);
      if (opts.scrollToCase) {
        mount.classList.add('v2-stage-in');
        scrollTo(caseCard);
      }
      if (opts.scrollToResult) scrollTo(mount.querySelector?.('.v2-result'));
    }
    if (active) globalThis.document?.getElementById?.(active)?.focus?.();
  }

  // ── Start, and finding a case (D-77, D-83) ─────────────────────────────────
  function drawStart() {
    const s = ctx.start;
    const start = section(t('entry.heading'));
    start.wrap.classList.add('v2-start');
    const b = start.body;
    const label = el('label', 'v2-start-label', t('entry.case_type_label'));
    label.htmlFor = 'ps2-case-type';
    const row = el('div', 'v2-start-row');
    const sel = el('select', 'ps-select');
    sel.id = 'ps2-case-type';
    const ph = el('option', null, t('entry.case_type_placeholder'));
    ph.value = '';
    sel.appendChild(ph);
    CASE_TYPES.forEach((c) => { const o = el('option', null, c.label); o.value = c.value; sel.appendChild(o); });
    sel.value = s.caseType;
    const nameLabel = el('label', 'v2-start-label', t('entry.label_label'));
    nameLabel.htmlFor = 'ps2-case-label';
    const name = el('input', 'v2-input v2-start-name');
    name.id = 'ps2-case-label';
    name.type = 'text';
    name.autocomplete = 'off';
    name.maxLength = 200;
    name.placeholder = t('entry.label_placeholder');
    name.value = s.label;
    const go = button(t('entry.start'), 'btn btn--primary v2-start-btn', async () => {
      s.caseType = sel.value;
      s.label = name.value.trim();
      if (!s.caseType) return;
      if (!s.label) { s.error = t('entry.need_label'); render(); return; }
      go.disabled = true;
      const res = await api.createCase(s.caseType, s.label);
      go.disabled = false;
      if (!res.ok) { s.error = errorText(res); render(); return; }
      s.error = '';
      s.caseType = '';
      s.label = '';
      await caseOpened(res.data);
    });
    go.disabled = !s.caseType;
    sel.addEventListener('change', () => { s.caseType = sel.value; go.disabled = !sel.value; });
    name.addEventListener('input', () => { s.label = name.value; });
    row.append(sel);
    b.append(label, row, el('p', 'v2-hint', t('entry.case_type_hint')), nameLabel);
    const row2 = el('div', 'v2-start-row');
    row2.append(name, go);
    b.append(row2, el('p', 'v2-hint', t('entry.label_hint')));
    if (s.error) b.appendChild(errorLine(s.error));
    scanView.appendChild(start.wrap);

    const find = section(t('find.heading'));
    find.wrap.classList.add('v2-find');
    const qLabel = el('label', 'v2-start-label', t('find.label'));
    qLabel.htmlFor = 'ps2-find';
    const qRow = el('div', 'v2-start-row');
    const q = el('input', 'v2-input');
    q.id = 'ps2-find';
    q.type = 'search';
    q.autocomplete = 'off';
    q.placeholder = t('find.placeholder');
    q.value = s.query;
    const search = button(t('find.search'), 'btn btn--secondary v2-find-btn', () => runSearch(q.value));
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault?.(); runSearch(q.value); } });
    qRow.append(q, search);
    find.body.append(qLabel, qRow);
    const list = el('div', 'v2-case-list');
    find.body.appendChild(list);
    if (s.results == null) {
      list.appendChild(el('div', 'dk-empty', t('shell.loading')));
      if (!s.searching) runSearch('');
    } else if (s.results.error) {
      list.appendChild(errorLine(s.results.error));
    } else if (!s.results.cases.length) {
      list.appendChild(el('div', 'dk-empty', t(s.query ? 'find.none' : 'find.empty')));
    } else {
      if (!s.query) list.appendChild(el('div', 'v2-ref-label', t('find.recent')));
      const reg = el('div', 'dk-register');
      for (const c of s.results.cases) {
        const r = el('div', 'dk-reg-row v2-case-row');
        r.dataset.caseId = c.id;
        r.tabIndex = 0;
        r.setAttribute('role', 'button');
        const left = el('div');
        left.appendChild(el('div', 'dk-reg-title', c.label));
        left.appendChild(el('div', 'dk-reg-meta', fmtWhen(c.created_at)));
        r.appendChild(left);
        r.appendChild(el('span', 'v2-pill v2-pill--type', c.case_type_label || ''));
        r.addEventListener('click', () => openCase(c.id));
        r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); openCase(c.id); } });
        reg.appendChild(r);
      }
      list.appendChild(reg);
    }
    scanView.appendChild(find.wrap);
  }

  async function runSearch(query) {
    const s = ctx.start;
    s.query = String(query || '').trim();
    s.searching = true;
    const res = await api.findCases(s.query);
    s.searching = false;
    s.results = res.ok ? { cases: res.data.cases || [] } : { error: errorText(res) };
    render();
  }

  // ── The case card: folder, type, tracker, people (D-63, D-83, D-99) ────────
  function drawCase() {
    const view = ctx.view;
    const card = el('section', 'v2-case');
    card.setAttribute('aria-label', t('summary.case'));
    const back = button(t('case.back'), 'v2-link v2-case-back', () => {
      ctx.view = null;
      ctx.stage = null;
      ctx.start.results = null;
      render();
    });
    scanView.appendChild(back);

    const top = el('div', 'v2-case-top');
    const type = el('div', 'v2-case-type');
    const folder = el('span', 'v2-case-folder');
    folder.appendChild(icon('folder'));
    type.appendChild(folder);
    type.appendChild(el('span', 'v2-case-type-v', view.case.label || t('case.folder_new')));
    type.appendChild(el('span', 'v2-pill v2-pill--type', view.case.case_type_label || ''));
    top.appendChild(type);
    const tags = el('div', 'v2-case-tags');
    const main = mainPerson(view);
    if (main && (!isGeneral(view) || main.approved_at)) {
      const ok = main.approved_at && !main.changed_since_approval;
      const key = !main.approved_at ? 'summary.not_approved' : main.changed_since_approval ? 'summary.changed' : 'summary.approved';
      tags.appendChild(el('span', `v2-pill v2-pill--${ok ? 'ok' : 'muted'}`, t(key)));
    }
    if (main?.no_evidence) tags.appendChild(el('span', 'v2-pill v2-pill--warn', t('ref.noead.on')));
    top.appendChild(tags);
    card.appendChild(top);

    card.appendChild(drawTracker());
    card.appendChild(drawSummary());
    scanView.appendChild(card);
    return card;
  }

  function dot(state, i) {
    const d = el('span', 'v2-step-dot');
    if (state === 'done') d.appendChild(icon('check'));
    else if (state === 'attention') d.appendChild(icon('attention'));
    else if (state === 'locked') d.appendChild(icon('locked'));
    else d.textContent = String(i);
    return d;
  }

  function drawTracker() {
    const nav = el('nav', 'v2-tracker');
    nav.setAttribute('aria-label', 'Stages');
    const list = el('ol', 'v2-track');
    STAGES.forEach((key, i) => {
      const st = stepState(ctx.view, key);
      const current = ctx.stage === key;
      const optional = key === 'preflight' && st === 'todo';
      const li = el('li', `v2-step v2-step--${st}${current ? ' v2-step--current' : ''}${optional ? ' v2-step--optional' : ''}`);
      li.dataset.stage = key;
      const b = el('button', 'v2-step-btn');
      b.type = 'button';
      b.disabled = st === 'locked';
      if (current) b.setAttribute('aria-current', 'step');
      b.appendChild(dot(st, i));
      b.appendChild(el('span', 'v2-step-name', t(`stage.${key}`)));
      const sk = statusKey(ctx.view, key, st, ctx.stage);
      b.appendChild(el('span', 'v2-step-status', sk === 'track.todo' ? ' ' : t(sk)));
      b.addEventListener('click', () => (current || st === 'locked' ? undefined : ctx.openStage(key)));
      li.appendChild(b);
      list.appendChild(li);
    });
    nav.appendChild(list);
    return nav;
  }

  function fact(parent, label, value, modifier) {
    if (!value) return;
    const cell = el('div', `psr-fact${modifier ? ` psr-detail--${modifier}` : ''}`);
    cell.appendChild(el('div', 'psr-fact-k', label));
    const v = el('div', 'psr-fact-v');
    if (typeof value === 'string') v.textContent = value; else v.appendChild(value);
    cell.appendChild(v);
    parent.appendChild(cell);
  }

  const ssnNode = (p) => (p.has_ssn ? ctx.ssn.view({ person_id: p.id, last4: p.ssn_last4 }) : null);

  function drawSummary() {
    const view = ctx.view;
    const summary = el('div', 'v2-summary');
    summary.setAttribute('aria-live', 'polite');
    const people = view.people || [];
    const anything = (p) => fullName(p) || p.a_number || p.date_of_birth || p.street || p.has_ssn || p.phone || p.email;

    if (isGeneral(view)) {
      if (!people.some(anything) && people.length < 2) {
        summary.appendChild(el('p', 'v2-summary-empty', t('summary.empty_general')));
        return summary;
      }
      // D-99: every person gets an equal, full case card.
      const grid = el('div', 'v2-people-cards');
      for (const p of people) grid.appendChild(personCard(p));
      summary.appendChild(grid);
      return summary;
    }

    const p = mainPerson(view);
    if (!p || !anything(p)) {
      summary.appendChild(el('p', 'v2-summary-empty', t('summary.empty')));
      return summary;
    }
    const strip = el('div', 'psr-summary-strip');
    fact(strip, t('summary.name'), fullName(p) || '–');
    fact(strip, t('field.a_number'), fmtANumber(p.a_number) || '–');
    fact(strip, t('field.date_of_birth'), fmtDate(p.date_of_birth) || '–');
    fact(strip, t('field.ead_expiration'), fmtDate(p.ead_expiration) || '–');
    summary.appendChild(strip);
    const details = el('div', 'psr-client-details');
    fact(details, t('field.ssn'), ssnNode(p), 'ssn');
    fact(details, t('field.phone'), p.phone, 'phone');
    fact(details, t('field.email'), p.email, 'email');
    fact(details, t('ref.group.address'), formatAddress(p), 'address');
    summary.appendChild(details);
    return summary;
  }

  const srcText = (src) => {
    if (!src) return '';
    if (src.kind === 'scan') return t('people.from_scan');
    if (src.kind === 'forms') return t('people.from_forms');
    if (src.kind === 'document') return t('ref.source.doc', { label: src.label || '' });
    return t('ref.source.staff');
  };

  function personCard(p) {
    const card = el('div', 'v2-person-card');
    card.dataset.personId = p.id;
    const top = el('div', 'v2-person-top');
    top.appendChild(el('span', 'v2-pill v2-pill--role', t(`role.${p.role}`)));
    if (p.is_main) top.appendChild(el('span', 'v2-pill v2-pill--muted', t('people.main_tag')));
    card.appendChild(top);
    card.appendChild(el('div', 'v2-person-name', fullName(p) || t('people.unnamed')));
    const facts = el('div', 'v2-person-facts');
    fact(facts, t('field.date_of_birth'), fmtDate(p.date_of_birth));
    fact(facts, t('field.a_number'), fmtANumber(p.a_number));
    fact(facts, t('field.ead_expiration'), fmtDate(p.ead_expiration));
    fact(facts, t('field.ssn'), ssnNode(p));
    fact(facts, t('field.phone'), p.phone);
    fact(facts, t('field.email'), p.email);
    fact(facts, t('ref.group.address'), formatAddress(p));
    card.appendChild(facts);
    const src = Object.entries(p.field_sources || {}).find(([k]) => p[k] || (k === 'ssn' && p.has_ssn))?.[1];
    if (src) card.appendChild(el('div', `v2-person-src v2-ref-source v2-src--${src.kind === 'document' ? 'doc' : src.kind}`, srcText(src)));
    return card;
  }

  // ── The stage choice (D-67), when the requirement is met and no stage is open ──
  function drawChoice() {
    if (!gateReady(ctx.view) || ctx.stage) return;
    const choose = section(t('choose.heading'));
    choose.wrap.classList.add('v2-choose');
    choose.body.appendChild(el('p', 'v2-hint', t('choose.sub')));
    const cards = el('div', 'v2-stage-cards');
    STAGES.filter((k) => k !== 'evidence_zero').forEach((key, i) => {
      const st = stepState(ctx.view, key);
      const card = el('button', `v2-stage-card v2-stage-card--${st}`);
      card.type = 'button';
      card.dataset.stage = key;
      const top = el('span', 'v2-stage-card-top');
      top.appendChild(dot(st, i + 1));
      const sk = statusKey(ctx.view, key, st, null);
      if (sk !== 'track.todo') top.appendChild(el('span', 'v2-stage-card-status', t(sk)));
      card.appendChild(top);
      card.appendChild(el('span', 'v2-stage-name', t(`stage.${key}`)));
      card.appendChild(el('span', 'v2-stage-desc', t(`stage.${key}.desc`)));
      card.addEventListener('click', () => ctx.openStage(key));
      cards.appendChild(card);
    });
    choose.body.appendChild(cards);
    scanView.appendChild(choose.wrap);
  }

  showMode('scan');
  return ctx;
}

export { createApi } from './api.js';
