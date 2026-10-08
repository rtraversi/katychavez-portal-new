// rulebook.js: the rulebook (D-61, D-65, D-76), ported from the v2 Lab's
// rulebook.js and wired to the rules route.
//
// Firm-wide rules first, then the case type's own rules grouped by form, so a
// form name, a scope and an origin are each said once, by their section (Max
// 2026-10-02: "repeating information"). Rules are added and edited in place
// and can be retired; every change is a new rule-set version on the server, so
// results already run keep the rules they ran with (D-60). Suppressed
// reasoning is listed at the end (D-59).

import { el, t, button, section, errorLine } from './ui.js';
import { CASE_TYPES } from './model.js';
import { errorText } from './api.js';

const SECTION_ORIGIN = { firm: 'general_rules', case_type: 'firm_checklist' };

export async function renderRulebook(mount, ctx) {
  const local = ctx.rulebook || (ctx.rulebook = { caseType: ctx.view?.case?.case_type || 'daca_renewal', editing: null, adding: false, retiring: null, error: '', note: '' });
  mount.textContent = '';

  const masthead = el('div', 'dk-masthead');
  masthead.appendChild(el('div', 'dk-kicker', t('rulebook.kicker')));
  masthead.appendChild(el('h1', 'dk-title', t('rulebook.title')));
  masthead.appendChild(el('p', 'dk-sub', t('rulebook.sub')));
  mount.appendChild(masthead);

  // Which case type's rules are shown. Firm-wide rules are the same in both.
  const pick = el('div', 'v2-scope v2-rulebook-type');
  pick.setAttribute('role', 'group');
  pick.setAttribute('aria-label', t('rulebook.case_type'));
  for (const ct of CASE_TYPES) {
    const b = button('', 'v2-scope-btn', () => {
      if (local.caseType === ct.value) return undefined;
      local.caseType = ct.value;
      local.editing = null;
      local.adding = false;
      return renderRulebook(mount, ctx);
    });
    b.dataset.caseType = ct.value;
    b.setAttribute('aria-pressed', String(local.caseType === ct.value));
    b.appendChild(el('span', 'v2-scope-name', ct.label));
    pick.appendChild(b);
  }
  mount.appendChild(pick);

  const loading = el('p', 'v2-hint', t('shell.loading'));
  mount.appendChild(loading);
  const res = await ctx.api.rules(local.caseType);
  loading.remove?.();
  if (!res.ok) { mount.appendChild(errorLine(errorText(res))); return; }
  const book = res.data;
  ctx.rememberRules?.(local.caseType, book);
  const caseLabel = CASE_TYPES.find((c) => c.value === local.caseType)?.label || '';
  const forms = [...new Set((book.package_items || []).filter((i) => (i.kind || 'form') === 'form').map((i) => i.form))];
  const redraw = () => renderRulebook(mount, ctx);

  if (local.error) mount.appendChild(errorLine(local.error));
  if (local.note) {
    const n = el('p', 'v2-quiet-note', local.note);
    n.setAttribute('role', 'status');
    mount.appendChild(n);
  }
  local.error = '';
  local.note = '';
  mount.appendChild(el('p', 'v2-hint v2-rulebook-version', t('rulebook.version', { n: book.version })));

  async function save(promise) {
    const r = await promise;
    if (!r.ok) { local.error = errorText(r); return redraw(); }
    local.editing = null;
    local.adding = false;
    local.retiring = null;
    local.note = t('rulebook.saved');
    return redraw();
  }

  mount.appendChild(addRuleForm());

  // ── Firm-wide ──
  const firm = section(t('rulebook.firm'), book.firm.length);
  firm.body.appendChild(el('p', 'v2-hint', t('rulebook.firm.note')));
  if (!book.firm.length) firm.body.appendChild(el('p', 'v2-block-empty', t('rulebook.firm.none')));
  book.firm.forEach((r) => firm.body.appendChild(ruleRow(r, false, SECTION_ORIGIN.firm)));
  mount.appendChild(firm.wrap);

  // ── Case type, grouped by form so the form name is said once ──
  const cs = section(t('rulebook.case', { case_type: caseLabel }), book.case_type_rules.length);
  cs.body.appendChild(el('p', 'v2-hint', t('rulebook.case.note')));
  if (!book.case_type_rules.length) cs.body.appendChild(el('p', 'v2-block-empty', t('rulebook.none')));
  const groups = new Map();
  for (const r of book.case_type_rules) {
    const k = r.form || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const rank = (f) => (f ? (forms.indexOf(f) < 0 ? forms.length : forms.indexOf(f)) : forms.length + 1);
  [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).forEach(([form, rules]) => {
    cs.body.appendChild(el('h3', 'v2-rule-group', form || t('rulebook.whole_package')));
    rules.forEach((r) => cs.body.appendChild(ruleRow(r, true, SECTION_ORIGIN.case_type)));
  });
  mount.appendChild(cs.wrap);

  // ── Suppressed reasoning (D-59) ──
  const sups = book.suppressions || [];
  const sup = section(t('rulebook.suppressed'), sups.length);
  sup.body.appendChild(el('p', 'v2-hint', t('rulebook.suppressed.note')));
  sups.forEach((s) => {
    const row = el('div', 'v2-rule');
    const main = el('div', 'v2-rule-main');
    main.appendChild(el('div', 'v2-rule-title', s.label));
    main.appendChild(el('div', 'v2-rule-where', t(s.origin === 'possible_issue' ? 'rulebook.origin.dismissal' : `rulebook.origin.${s.origin}`)));
    row.appendChild(main);
    sup.body.appendChild(row);
  });
  mount.appendChild(sup.wrap);

  // ── Pieces ──

  function whereOf(r, withForm) {
    return [withForm ? null : r.form, r.page ? `p.${r.page}` : null, r.item ? `item ${r.item}` : null].filter(Boolean).join(' · ');
  }

  // A row carries a tag only when its origin differs from its section's.
  function ruleRow(r, isCase, sectionOrigin) {
    if (local.editing === r.rule_id) return ruleEditor(r, isCase);
    const row = el('div', 'v2-rule');
    row.title = r.rule_id;
    row.dataset.ruleId = r.rule_id;
    const main = el('div', 'v2-rule-main');
    main.appendChild(el('div', 'v2-rule-title', r.title));
    const where = isCase ? whereOf(r, true) : (r.note || '');
    if (where) main.appendChild(el('div', 'v2-rule-where', where));
    row.appendChild(main);
    if (r.origin && r.origin !== sectionOrigin) row.appendChild(el('span', 'v2-pill v2-pill--muted v2-rule-tag', t(`rulebook.origin.${r.origin}`)));
    if (local.retiring === r.rule_id) {
      const confirm = el('div', 'v2-rule-retire');
      confirm.appendChild(el('span', 'v2-noead-warn', t('rulebook.retire_confirm')));
      confirm.appendChild(button(t('rulebook.retire_yes'), 'btn btn--secondary v2-retire-yes',
        () => save(ctx.api.editRule({ rule_id: r.rule_id, case_type: local.caseType, changes: { retired: true } }))));
      confirm.appendChild(button(t('rulebook.add.cancel'), 'btn btn--ghost', () => { local.retiring = null; return redraw(); }));
      row.appendChild(confirm);
    } else {
      row.appendChild(button(t('rulebook.edit'), 'v2-link v2-rule-edit', () => { local.editing = r.rule_id; return redraw(); }));
      row.appendChild(button(t('rulebook.retire'), 'v2-link v2-rule-edit v2-rule-retire-btn', () => { local.retiring = r.rule_id; return redraw(); }));
    }
    return row;
  }

  function field(labelKey, control) {
    const f = el('label', 'v2-addrule-field');
    f.appendChild(el('span', 'v2-ref-label', t(labelKey)));
    f.appendChild(control);
    return f;
  }

  function formSelect(value) {
    const sel = el('select', 'v2-input');
    const any = el('option', null, t('rulebook.add.form_any'));
    any.value = '';
    sel.appendChild(any);
    [...new Set([...forms, value].filter(Boolean))].forEach((f) => { const o = el('option', null, f); o.value = f; sel.appendChild(o); });
    sel.value = value || '';
    return sel;
  }

  // D-76: wording always; form, page and item for case-type rules.
  function ruleEditor(r, withPlace) {
    const box = el('div', 'v2-rule v2-rule--editing');
    box.dataset.ruleId = r.rule_id;
    const form = el('div', 'v2-addrule-form');
    const title = el('textarea', 'v2-input v2-textarea');
    title.rows = 2;
    title.value = r.title || '';
    form.appendChild(field('rulebook.add.title', title));
    let formSel; let page; let item;
    if (withPlace) {
      formSel = formSelect(r.form);
      page = el('input', 'v2-input');
      page.type = 'text';
      page.value = r.page ?? '';
      item = el('input', 'v2-input');
      item.type = 'text';
      item.value = r.item ?? '';
      const grid = el('div', 'v2-addrule-grid v2-addrule-grid--3');
      grid.append(field('rulebook.add.form', formSel), field('rulebook.add.page', page), field('rulebook.add.item', item));
      form.appendChild(grid);
    }
    const actions = el('div', 'dk-toolbar');
    actions.appendChild(button(t('rulebook.edit.save'), 'btn btn--primary v2-rule-save', () => {
      if (!title.value.trim()) { title.focus?.(); return undefined; }
      const changes = { title: title.value.trim() };
      if (withPlace) Object.assign(changes, { form: formSel.value || null, page: page.value.trim() || null, item: item.value.trim() || null });
      return save(ctx.api.editRule({ rule_id: r.rule_id, case_type: local.caseType, changes }));
    }));
    actions.appendChild(button(t('rulebook.add.cancel'), 'btn btn--ghost', () => { local.editing = null; return redraw(); }));
    form.appendChild(actions);
    box.appendChild(form);
    return box;
  }

  // D-65: staff add rules here directly. Wording, form, page, item and scope.
  function addRuleForm() {
    const wrap = el('div', 'dk-sec v2-addrule');
    if (!local.adding) {
      wrap.appendChild(button(t('rulebook.add'), 'btn btn--primary v2-addrule-open', () => { local.adding = true; return redraw(); }));
      return wrap;
    }
    const form = el('div', 'v2-addrule-form');
    const title = el('textarea', 'v2-input v2-textarea');
    title.rows = 2;
    title.placeholder = t('rulebook.add.title_ph');
    const formSel = formSelect('');
    const page = el('input', 'v2-input');
    page.type = 'text';
    page.inputMode = 'numeric';
    const item = el('input', 'v2-input');
    item.type = 'text';
    const scope = el('select', 'v2-input');
    const caseOpt = el('option', null, t('rulebook.scope.case', { case_type: caseLabel }));
    caseOpt.value = 'case_type';
    const firmOpt = el('option', null, t('rulebook.scope.firm'));
    firmOpt.value = 'firm';
    scope.append(caseOpt, firmOpt);
    scope.value = 'case_type';
    const msg = el('p', 'v2-ref-source');
    const grid = el('div', 'v2-addrule-grid');
    grid.append(field('rulebook.add.form', formSel), field('rulebook.add.page', page), field('rulebook.add.item', item), field('rulebook.add.scope', scope));
    const actions = el('div', 'dk-toolbar');
    actions.appendChild(button(t('rulebook.add.save'), 'btn btn--primary v2-addrule-save', () => {
      if (!title.value.trim()) { msg.textContent = t('rulebook.add.need_title'); title.focus?.(); return undefined; }
      return save(ctx.api.addRule({
        scope: scope.value,
        ...(scope.value === 'case_type' ? { case_type: local.caseType } : {}),
        title: title.value.trim(),
        form: formSel.value || null,
        page: page.value.trim() || null,
        item: item.value.trim() || null,
      }));
    }));
    actions.appendChild(button(t('rulebook.add.cancel'), 'btn btn--ghost', () => { local.adding = false; return redraw(); }));
    form.append(field('rulebook.add.title', title), grid, msg, actions);
    wrap.appendChild(form);
    return wrap;
  }
}
