// rulebook.js: read-only rulebook (D-61). Firm-wide rules from base-rules.json,
// case-type rules from daca-renewal.json, each with its scope and origin. No
// change-history log. Rules added from Possible issues (D-60) live in memory
// only and are marked as affecting future scans only.
import { el, t, button, loadRules } from '/v2-lab/ui.js';
import { state } from '/v2-lab/state.js';

function section(title, count) {
  const wrap = el('div', 'dk-sec');
  const head = el('div', 'dk-sec-head');
  head.appendChild(el('h2', null, title));
  if (count != null) head.appendChild(el('span', 'psr-count', String(count)));
  head.appendChild(el('span', 'dk-sec-rule'));
  wrap.appendChild(head);
  return wrap;
}

// Max 2026-10-02: "repeating information". Scope and origin are said once, by the
// section; a row only carries a tag when it differs from its section.
function ruleRow({ title, where, tag, id, onEdit }) {
  const row = el('div', 'v2-rule');
  if (id) row.title = id;
  const main = el('div', 'v2-rule-main');
  main.appendChild(el('div', 'v2-rule-title', title));
  if (where) main.appendChild(el('div', 'v2-rule-where', where));
  row.appendChild(main);
  if (tag) row.appendChild(el('span', 'v2-pill v2-pill--muted v2-rule-tag', tag));
  if (onEdit) row.appendChild(button(t('rulebook.edit'), 'v2-link v2-rule-edit', () => row.replaceWith(onEdit())));
  return row;
}

// Max 2026-10-02: each rule can be edited in place. Wording always; form, page
// and item for rules tied to a form. Lives in memory until reload (D-61).
function ruleEditor({ values, forms, withPlace, onSave, onCancel }) {
  const box = el('div', 'v2-rule v2-rule--editing');
  const form = el('div', 'v2-addrule-form');
  const field = (labelKey, control) => {
    const f = el('label', 'v2-addrule-field');
    f.appendChild(el('span', 'v2-ref-label', t(labelKey)));
    f.appendChild(control);
    return f;
  };
  const title = el('textarea', 'v2-input v2-textarea');
  title.rows = 2;
  title.value = values.title || '';
  form.appendChild(field('rulebook.add.title', title));
  let formSel, page, item;
  if (withPlace) {
    formSel = el('select', 'v2-input');
    formSel.appendChild(Object.assign(el('option', null, t('rulebook.add.form_any')), { value: '' }));
    forms.forEach((f) => formSel.appendChild(Object.assign(el('option', null, f), { value: f })));
    formSel.value = values.form || '';
    page = Object.assign(el('input', 'v2-input'), { type: 'text', value: values.page ?? '' });
    item = Object.assign(el('input', 'v2-input'), { type: 'text', value: values.item ?? '' });
    const grid = el('div', 'v2-addrule-grid v2-addrule-grid--3');
    grid.append(field('rulebook.add.form', formSel), field('rulebook.add.page', page), field('rulebook.add.item', item));
    form.appendChild(grid);
  }
  const actions = el('div', 'dk-toolbar');
  actions.appendChild(button(t('rulebook.edit.save'), 'btn btn--primary', () => {
    if (!title.value.trim()) { title.focus(); return; }
    onSave({
      title: title.value.trim(),
      ...(withPlace ? { form: formSel.value || null, page: page.value.trim() || null, item: item.value.trim() || null } : {}),
    });
  }));
  actions.appendChild(button(t('rulebook.add.cancel'), 'btn btn--ghost', onCancel));
  form.appendChild(actions);
  box.appendChild(form);
  setTimeout(() => title.focus(), 0);
  return box;
}

const V2_FIRM = [
  { id: 'PS-304', title: 'rulebook.v2.evidence', where: 'rulebook.v2.evidence_where' },
  { id: 'PS-305', title: 'rulebook.v2.cross', where: 'rulebook.v2.cross_where' },
  { id: 'PS-306', title: 'rulebook.v2.translation', where: 'rulebook.v2.translation_where' },
];

const whereOf = (r) => [r.form, r.page != null ? `p.${r.page}` : null, r.item ? `item ${r.item}` : null].filter(Boolean).join(' · ');

// D-61: staff add rules here directly, no code or Markdown. Wording, form,
// page, item and scope are all theirs. In this preview it lives until reload.
function addRuleForm(checklist, caseLabel, redraw) {
  const wrap = el('div', 'dk-sec v2-addrule');
  const open = button(t('rulebook.add'), 'btn btn--primary');
  const form = el('form', 'v2-addrule-form');
  form.hidden = true;

  const field = (labelKey, control) => {
    const f = el('label', 'v2-addrule-field');
    f.appendChild(el('span', 'v2-ref-label', t(labelKey)));
    f.appendChild(control);
    return f;
  };

  const title = el('textarea', 'v2-input v2-textarea');
  title.rows = 2;
  title.placeholder = t('rulebook.add.title_ph');

  const formSel = el('select', 'v2-input');
  formSel.appendChild(Object.assign(el('option', null, t('rulebook.add.form_any')), { value: '' }));
  [...new Set(checklist.composition.map((c) => c.form))].forEach((f) => formSel.appendChild(Object.assign(el('option', null, f), { value: f })));

  const page = Object.assign(el('input', 'v2-input'), { type: 'text', inputMode: 'numeric' });
  const item = Object.assign(el('input', 'v2-input'), { type: 'text' });

  const scope = el('select', 'v2-input');
  scope.appendChild(Object.assign(el('option', null, t('rulebook.scope.case', { case_type: caseLabel })), { value: 'case' }));
  scope.appendChild(Object.assign(el('option', null, t('rulebook.scope.firm')), { value: 'firm' }));

  const msg = el('p', 'v2-ref-source');
  const grid = el('div', 'v2-addrule-grid');
  grid.append(field('rulebook.add.form', formSel), field('rulebook.add.page', page), field('rulebook.add.item', item), field('rulebook.add.scope', scope));
  const actions = el('div', 'dk-toolbar');
  const save = Object.assign(el('button', 'btn btn--primary', t('rulebook.add.save')), { type: 'submit' });
  actions.append(save, button(t('rulebook.add.cancel'), 'btn btn--ghost', () => { form.hidden = true; open.hidden = false; }));
  form.append(field('rulebook.add.title', title), grid, msg, actions);

  open.addEventListener('click', () => { form.hidden = false; open.hidden = true; title.focus(); });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!title.value.trim()) { msg.textContent = t('rulebook.add.need_title'); title.focus(); return; }
    state.learnedRules.push({
      title: title.value.trim(), scope: scope.value, origin: 'staff',
      form: formSel.value || null, page: page.value.trim() || null, item: item.value.trim() || null,
    });
    redraw();
  });

  wrap.append(open, form);
  return wrap;
}

export async function renderRulebook(mount) {
  const [base, checklist] = await loadRules();
  mount.textContent = '';
  const caseLabel = checklist.case_type.label;

  const masthead = el('div', 'dk-masthead');
  masthead.appendChild(el('div', 'dk-kicker', t('rulebook.kicker')));
  masthead.appendChild(el('h1', 'dk-title', t('rulebook.title')));
  masthead.appendChild(el('p', 'dk-sub', t('rulebook.sub')));
  mount.appendChild(masthead);

  const redraw = () => renderRulebook(mount);
  const forms = [...new Set(checklist.composition.map((c) => c.form))];
  const edited = (r) => ({ ...r, ...(state.ruleEdits[r.rule_id] || {}) });
  const editFor = (r, withPlace) => () => ruleEditor({
    values: edited(r), forms, withPlace,
    onSave: (v) => { state.ruleEdits[r.rule_id] = v; redraw(); },
    onCancel: redraw,
  });

  const learned = (scope) => state.learnedRules.filter((r) => r.scope === scope).map((r) => ruleRow({
    title: r.title,
    where: r.origin === 'staff' ? whereOf(r) : t('rulebook.learned_where', { stage: r.stage ? t(`stage.${r.stage}`) : '' }),
    tag: r.origin === 'staff' ? t('rulebook.origin.staff') : t('rulebook.origin.learned'),
    onEdit: () => ruleEditor({
      values: r, forms, withPlace: r.origin === 'staff',
      onSave: (v) => { Object.assign(r, v); redraw(); },
      onCancel: redraw,
    }),
  }));

  mount.appendChild(addRuleForm(checklist, caseLabel, () => renderRulebook(mount)));

  // Firm-wide
  const firmRules = base.rules.filter((r) => r.check === 'pdf');
  const firm = section(t('rulebook.firm'), firmRules.length + state.learnedRules.filter((r) => r.scope === 'firm').length);
  firm.appendChild(el('p', 'v2-hint', t('rulebook.firm.note')));
  firmRules.forEach((r) => {
    const e = edited(r);
    firm.appendChild(ruleRow({
      id: r.rule_id, title: e.title, where: r.note || '',
      tag: state.ruleEdits[r.rule_id] ? t('rulebook.edited') : null,
      onEdit: editFor(r, false),
    }));
  });
  // v2 firm-wide checks decided by Max (D-98, D-100). In the build they are seeded rules.
  V2_FIRM.forEach((r) => firm.appendChild(ruleRow({ id: r.id, title: t(r.title), where: t(r.where), tag: t('rulebook.new_v2') })));
  learned('firm').forEach((row) => firm.appendChild(row));
  mount.appendChild(firm);

  // Case type, grouped by form so the form name is said once.
  const caseRules = checklist.rules.filter((r) => r.check === 'pdf');
  const cs = section(t('rulebook.case', { case_type: caseLabel }), caseRules.length + state.learnedRules.filter((r) => r.scope === 'case').length);
  cs.appendChild(el('p', 'v2-hint', t('rulebook.case.note')));
  const order = checklist.composition.map((c) => c.form);
  const groups = new Map();
  caseRules.map(edited).forEach((r) => {
    const k = r.form || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  [...groups.entries()]
    .sort((x, y) => (x[0] ? order.indexOf(x[0]) : 99) - (y[0] ? order.indexOf(y[0]) : 99))
    .forEach(([form, rules]) => {
      cs.appendChild(el('h3', 'v2-rule-group', form || t('rulebook.whole_package')));
      rules.forEach((r) => cs.appendChild(ruleRow({
        id: r.rule_id, title: r.title,
        where: [r.page != null ? `p.${r.page}` : null, r.item ? `item ${r.item}` : null].filter(Boolean).join(' · '),
        tag: state.ruleEdits[r.rule_id] ? t('rulebook.edited') : null,
        onEdit: editFor(caseRules.find((x) => x.rule_id === r.rule_id), true),
      })));
    });
  const extra = learned('case');
  if (extra.length) {
    cs.appendChild(el('h3', 'v2-rule-group', t('rulebook.added_group')));
    extra.forEach((row) => cs.appendChild(row));
  }
  mount.appendChild(cs);

  // D-33: kept in the checklist document, not PDF-checkable.
  const kept = checklist.rules.filter((r) => r.check !== 'pdf');
  const k = section(t('rulebook.kept'), kept.length);
  k.appendChild(el('p', 'v2-hint', t('rulebook.kept.note')));
  kept.forEach((r) => k.appendChild(ruleRow({ id: r.rule_id, title: r.title, where: t(`rulebook.check.${r.check}`) })));
  mount.appendChild(k);

  // D-59: firm-wide suppressed reasoning.
  const sup = section(t('rulebook.suppressed'), state.suppressed.length);
  sup.appendChild(el('p', 'v2-hint', t('rulebook.suppressed.note')));
  state.suppressed.forEach((x) => sup.appendChild(ruleRow({
    title: x.copyKey ? t(x.copyKey) : x.reasoning,
    where: x.origin === 'r1' ? t('rulebook.origin.r1') : t('rulebook.origin.dismissal'),
  })));
  mount.appendChild(sup);
}
