// evidence-zero.js: the quiet document and fact workspace (D-53), ported from
// the v2 Lab's evidence-zero.js and wired to the Batch 2 routes.
//
// No attention count, no error language. A document is uploaded, read by the
// server and dropped (D-84); what comes back is the card, the facts, and any
// suggestions, and the screen draws exactly that. Fills, replacements and
// suggestions are all the server's decisions (D-45, D-54, D-55).

import {
  el, t, button, section, dropZone, icon, fmtDate, fmtANumber, maskSsn, remask, errorLine,
} from './ui.js';
import {
  checkFiles, DATE_FIELDS, visibleFields, suggestionsFor, sourceKind,
  workspaceDocuments, docFactKeys, docFactValue, docFactUnreadable, DOC_TYPE_SETS, isGeneral, mainPerson,
} from './model.js';
import { errorText } from './api.js';

const ROLES = ['applicant', 'beneficiary', 'petitioner', 'sponsor', 'joint_sponsor', 'household_member'];
const REPEATABLE = new Set(['household_member']);
const APT_TYPES = ['Apt.', 'Ste.', 'Flr.'];
const DOC_TYPE_LABEL_KEY = {
  ead: 'ez.type.ead', intake: 'ez.type.intake', birth_certificate: 'ez.type.birth_certificate',
  marriage_certificate: 'ez.type.marriage_certificate', passport: 'ez.type.passport', i94: 'ez.type.i94',
  green_card: 'ez.type.green_card', other: 'ez.type.other',
};
const docTypeLabel = (type) => t(DOC_TYPE_LABEL_KEY[type] || 'ez.type.other');
const roleLabel = (role) => t(`role.${role}`);

export function renderEvidenceZero(mount, ctx) {
  const view = ctx.view;
  const general = isGeneral(view);
  const local = ctx.ez || (ctx.ez = { note: '', landed: null, busy: null, error: '' });
  // The card that just arrived lands green once, then settles (Lab behaviour).
  const landedId = local.busy ? null : local.landed;
  local.landed = null;

  const docs = section(t('ez.docs.heading'));
  mount.appendChild(docs.wrap);
  drawDocs(docs.body);

  const people = general ? view.people : [mainPerson(view)].filter(Boolean);
  for (const person of people) {
    const ref = section(general ? t('ref.heading_person', { role: roleLabel(person.role) }) : t('ref.heading'));
    ref.wrap.classList.add('v2-person-section');
    mount.appendChild(ref.wrap);
    drawReference(ref.body, person);
  }
  if (general) {
    const add = section(t('people.heading'));
    mount.appendChild(add.wrap);
    drawAddPerson(add.body);
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  function drawDocs(body) {
    body.appendChild(el('p', 'v2-hint', t('ez.intro')));
    const landed = workspaceDocuments(view).find((d) => d.id === landedId);
    body.appendChild(dropZone({
      title: local.busy ? t('ez.reading', { name: local.busy }) : landed ? t('ez.drop.added', { type: docTypeLabel(landed.doc_type) }) : t('ez.drop.title'),
      meta: landed && !local.busy ? landed.filename : t('ez.drop.meta'),
      landed: Boolean(landed) && !local.busy,
      busy: Boolean(local.busy),
      multiple: true,
      note: `${t('limit.note_one')} ${t('ez.drop.kept')}`,
      onFiles: upload,
    }));
    if (local.error) body.appendChild(errorLine(local.error));
    if (local.note) {
      const note = el('p', 'v2-quiet-note', local.note);
      note.setAttribute('role', 'status');
      body.appendChild(note);
    }
    const list = workspaceDocuments(view);
    if (!list.length) return;
    const wrap = el('div', 'v2-doc-list');
    list.forEach((d) => wrap.appendChild(docCard(d)));
    body.appendChild(wrap);
  }

  // One document per request; several dropped are read one after another.
  async function upload(files) {
    local.error = '';
    local.note = '';
    for (const file of files) {
      const problem = checkFiles([file]);
      if (problem) { local.error = t(problem.key, problem.vars); ctx.redraw(); return; }
    }
    for (const file of files) {
      local.busy = file.name;
      ctx.redraw();
      const res = await ctx.api.readDocument(view.case.id, file);
      local.busy = null;
      if (!res.ok) { local.error = errorText(res); ctx.redraw(); return; }
      local.note = res.data.note || '';
      local.landed = res.data.document_id || null;
      const { note, document_id, ...caseView } = res.data;
      ctx.setView(caseView);
    }
  }

  function docCard(d) {
    const review = d.status === 'source_review';
    const card = el('article', `v2-doc${review ? ' v2-doc--review' : ''}${d.id === landedId ? ' v2-doc--new' : ''}`);
    card.dataset.type = d.doc_type;
    card.dataset.documentId = d.id;
    const head = el('div', 'v2-doc-head');
    const tile = el('span', 'v2-doc-tile');
    tile.appendChild(icon(d.doc_type));
    head.appendChild(tile);
    const titles = el('div', 'v2-doc-titles');
    titles.appendChild(el('div', 'v2-doc-type', t('ez.doc.identified', { type: docTypeLabel(d.doc_type) })));
    titles.appendChild(el('div', 'v2-doc-file', d.filename || ''));
    head.appendChild(titles);
    const tags = el('div', 'v2-doc-tags');
    if (review) tags.appendChild(el('span', 'v2-tag v2-tag--review', t('ez.doc.status_review')));
    if (d.type_corrected) tags.appendChild(el('span', 'v2-tag', t('ez.doc.type_corrected')));
    head.appendChild(tags);
    card.appendChild(head);

    // D-53: the case-relevant facts, not a generic summary.
    const facts = el('div', 'v2-doc-facts');
    for (const key of docFactKeys(d)) {
      const cell = el('div', 'psr-fact');
      cell.appendChild(el('div', 'psr-fact-k', t(`ez.fact.${key}`)));
      const unreadable = docFactUnreadable(d, key);
      let value = unreadable ? t('ez.doc.unreadable_value') : docFactValue(d, key);
      if (key === 'ssn' && !unreadable) value = remask(value); // a card only ever holds the last four (D-97)
      cell.appendChild(el('div', `psr-fact-v${unreadable || review ? ' v2-fact-uncertain' : ''}`, value || t('ez.doc.not_on_document')));
      facts.appendChild(cell);
    }
    card.appendChild(facts);
    if (review) card.appendChild(el('p', 'v2-doc-review-note', t('ez.doc.source_review')));

    const foot = el('div', 'v2-doc-foot');
    // Q-45: staff can correct the identified type.
    const typeLab = el('label', 'v2-doc-typefix');
    typeLab.appendChild(el('span', null, t('ez.doc.correct_type')));
    const sel = el('select', 'v2-input v2-inline-select');
    const types = DOC_TYPE_SETS[view.case.case_type] || DOC_TYPE_SETS.general;
    [...new Set([...types, d.doc_type])].forEach((type) => {
      const o = el('option', null, docTypeLabel(type));
      o.value = type;
      o.selected = type === d.doc_type;
      sel.appendChild(o);
    });
    sel.value = d.doc_type;
    sel.addEventListener('change', () => change(ctx.api.correctDocument({ document_id: d.id, doc_type: sel.value })));
    typeLab.appendChild(sel);
    foot.appendChild(typeLab);

    // D-94: whose document this is. Staff correct the AI's proposal.
    if (general) {
      const own = el('div', 'v2-owners');
      own.appendChild(el('span', 'v2-owners-k', t('people.belongs')));
      for (const p of view.people) {
        const on = (d.owner_ids || []).includes(p.id);
        const chip = button(roleLabel(p.role), `v2-owner-chip${on ? ' is-on' : ''}`, () => {
          if (on && d.owner_ids.length === 1) return undefined; // a document always belongs to someone
          const next = on ? d.owner_ids.filter((x) => x !== p.id) : [...(d.owner_ids || []), p.id];
          return change(ctx.api.correctDocument({ document_id: d.id, owner_person_ids: next }));
        });
        chip.setAttribute('aria-pressed', String(on));
        own.appendChild(chip);
      }
      foot.appendChild(own);
    }
    foot.appendChild(button(t('ez.doc.remove'), 'v2-link', () => { local.note = ''; return change(ctx.api.removeDocument(d.id)); }));
    card.appendChild(foot);
    return card;
  }

  async function change(promise) {
    const res = await promise;
    if (!res.ok) { local.error = errorText(res); ctx.redraw(); return; }
    local.error = '';
    ctx.setView(res.data);
  }

  // ── Reference record (D-10 to D-13, D-49, D-55, D-64, D-82) ────────────────

  function drawReference(body, person) {
    const suggestions = suggestionsFor(view, person);
    body.appendChild(el('p', 'v2-hint', t('ref.hint')));

    if (general) {
      const bar = el('div', 'v2-person-edit-head');
      const roleRow = el('label', 'v2-role-pick');
      roleRow.appendChild(el('span', 'v2-ref-label', t('people.role')));
      const sel = el('select', 'v2-input v2-inline-select');
      ROLES.filter((r) => r !== 'applicant' || r === person.role)
        .filter((r) => r === person.role || REPEATABLE.has(r) || !view.people.some((p) => p.role === r))
        .forEach((r) => {
          const o = el('option', null, roleLabel(r));
          o.value = r;
          o.selected = r === person.role;
          sel.appendChild(o);
        });
      sel.value = person.role;
      sel.addEventListener('change', () => change(ctx.api.person({ action: 'edit', person_id: person.id, role: sel.value })));
      roleRow.appendChild(sel);
      bar.appendChild(roleRow);
      const actions = el('div', 'v2-person-actions');
      if (person.is_main) actions.appendChild(el('span', 'v2-pill v2-pill--muted', t('people.main_tag')));
      else {
        actions.appendChild(button(t('people.make_main'), 'v2-link', () => change(ctx.api.person({ action: 'set_main', person_id: person.id }))));
        actions.appendChild(button(t('people.remove'), 'v2-link', () => change(ctx.api.person({ action: 'remove', person_id: person.id }))));
      }
      bar.appendChild(actions);
      body.appendChild(bar);
    }

    for (const [group, fields] of visibleFields(person, suggestions)) {
      const fs = el('fieldset', `v2-ref-group v2-ref-group--${group}`);
      fs.appendChild(el('legend', null, t(`ref.group.${group}`)));
      const grid = el('div', 'v2-ref-grid');
      for (const field of fields) grid.appendChild(field === 'ssn' ? ssnRow(person, suggestions) : fieldRow(person, field, suggestions));
      fs.appendChild(grid);
      body.appendChild(fs);
    }

    // D-10, D-11: approve as a whole; nothing missing ever blocks it.
    const approved = person.approved_at && !person.changed_since_approval;
    const bar = el('div', 'dk-toolbar v2-ref-bar');
    bar.appendChild(button(approved ? t('ref.approved_btn') : t('ref.approve'), 'btn btn--primary v2-approve', async () => {
      const res = await ctx.api.person({ action: 'approve', person_id: person.id });
      if (!res.ok) { local.error = errorText(res); ctx.redraw(); return; }
      local.error = '';
      ctx.afterApprove(res.data);
    }));
    body.appendChild(bar);

    if (person.is_main || !general) drawGate(body, person);
  }

  // The evidence requirement (D-74, D-91), as the server states it. General has
  // none (D-95), so nothing is drawn for it.
  function drawGate(body, person) {
    if (general) return;
    const gate = view.evidence_requirement || { ready: false, missing: [], messages: [] };
    const box = el('div', `v2-gate${gate.ready ? ' is-ready' : ''}`);
    box.appendChild(el('div', 'v2-gate-head', t('ref.gate.heading')));
    if (gate.ready) box.appendChild(el('p', 'v2-gate-line', t('ref.gate.ready')));
    else (gate.messages || []).forEach((m) => box.appendChild(el('p', 'v2-gate-line v2-gate-missing', m)));
    body.appendChild(box);

    // The rare case with no evidence at all: a deliberate second step (D-74).
    const evidenceMissing = (gate.missing || []).some((k) => k === 'ead_doc' || k === 'ead_facts');
    if (person.no_evidence) {
      const on = el('div', 'v2-noead');
      on.appendChild(el('span', 'v2-tag v2-tag--review', t('ref.noead.on')));
      on.appendChild(button(t('ref.noead.undo'), 'v2-link', () => change(ctx.api.person({ action: 'no_evidence', person_id: person.id, value: false }))));
      body.appendChild(on);
    } else if (evidenceMissing) {
      const wrap = el('div', 'v2-noead');
      const ask = button(t('ref.noead.ask'), 'v2-link v2-noead-ask', () => {
        ask.hidden = true;
        wrap.appendChild(el('span', 'v2-noead-warn', t('ref.noead.warn')));
        wrap.appendChild(button(t('ref.noead.confirm'), 'btn btn--secondary v2-noead-confirm',
          () => change(ctx.api.person({ action: 'no_evidence', person_id: person.id, value: true }))));
        wrap.appendChild(button(t('rulebook.add.cancel'), 'btn btn--ghost', () => ctx.redraw()));
      });
      wrap.appendChild(ask);
      body.appendChild(wrap);
    }
  }

  function sourceLine(person, field) {
    const has = field === 'ssn' ? person.has_ssn : person[field];
    if (!has) return t('ref.source.none');
    const src = person.field_sources?.[field];
    if (!src || src.kind === 'staff') return t('ref.source.staff');
    if (src.kind === 'scan') return t('people.from_scan');
    if (src.kind === 'forms') return t('people.from_forms');
    return t('ref.source.doc', { label: src.label || '' });
  }

  function shown(field, value) {
    if (value == null || value === '') return '';
    if (DATE_FIELDS.has(field)) return fmtDate(value);
    if (field === 'a_number') return fmtANumber(value);
    return String(value);
  }

  function fieldRow(person, field, suggestions) {
    const row = el('div', `v2-ref-field v2-ref-field--${field}`);
    const id = `ps2-${person.id}-${field}`;
    const label = el('label', 'v2-ref-label', t(`field.${field}`));
    label.htmlFor = id;
    row.appendChild(label);
    const msg = el('div', `v2-ref-source v2-src--${sourceKind(person, field)}`, sourceLine(person, field));
    const save = async (value) => {
      msg.textContent = t('ref.saving');
      const res = await ctx.api.person({ action: 'edit', person_id: person.id, fields: { [field]: value === '' ? null : value } });
      if (!res.ok) { msg.textContent = t('ref.saved_error', { error: errorText(res) }); msg.classList.add('v2-ref-error'); return; }
      ctx.setView(res.data);
    };
    row.appendChild(fieldControl(field, person[field], id, save));
    row.appendChild(msg);
    suggestions.filter((s) => s.field === field).forEach((s) => row.appendChild(proposalBox(s, shown(field, person[field]), shown(field, s.value))));
    return row;
  }

  function fieldControl(field, value, id, save) {
    if (field === 'apt_type') {
      const select = el('select', 'v2-input');
      select.id = id;
      select.appendChild(el('option', null, ''));
      APT_TYPES.forEach((o) => { const opt = el('option', null, o); opt.value = o; select.appendChild(opt); });
      select.value = value || '';
      select.addEventListener('change', () => save(select.value));
      return select;
    }
    const input = el('input', 'v2-input');
    input.id = id;
    input.type = 'text';
    input.autocomplete = 'off';
    // The A- is part of the format, not part of the value staff type (D-64).
    if (field === 'a_number') {
      const wrap = el('div', 'v2-affix');
      wrap.appendChild(el('span', 'v2-affix-prefix', 'A-'));
      input.inputMode = 'numeric';
      input.maxLength = 9;
      input.value = String(value || '').replace(/\D/g, '');
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 9); });
      input.addEventListener('change', () => save(input.value));
      wrap.appendChild(input);
      return wrap;
    }
    if (field === 'state') {
      input.maxLength = 2;
      input.addEventListener('input', () => { input.value = input.value.replace(/[^a-z]/gi, '').toUpperCase(); });
    }
    if (DATE_FIELDS.has(field)) {
      input.placeholder = 'MM/DD/YYYY';
      input.inputMode = 'numeric';
      input.value = fmtDate(value);
    } else {
      input.value = value || '';
    }
    input.addEventListener('change', () => save(input.value.trim()));
    return input;
  }

  // A suggested change reads "old -> new" (D-55). Use or keep, never automatic.
  function proposalBox(s, current, proposed, ssnNodes) {
    const box = el('div', 'v2-proposal');
    box.dataset.suggestionId = s.id;
    box.appendChild(el('div', 'v2-proposal-from', t('ref.proposal.from', { label: s.source_label || '' })));
    const swap = el('div', 'v2-proposal-swap');
    if (ssnNodes) swap.append(ssnNodes[0], el('span', 'v2-proposal-arrow', '→'), ssnNodes[1]);
    else {
      swap.appendChild(el('span', 'v2-proposal-old', current || t('ref.source.none')));
      swap.appendChild(el('span', 'v2-proposal-arrow', '→'));
      swap.appendChild(el('span', 'v2-proposal-new', proposed));
    }
    box.appendChild(swap);
    const actions = el('div', 'v2-proposal-actions');
    actions.appendChild(button(t('ref.proposal.use'), 'btn btn--secondary v2-proposal-use', () => change(ctx.api.suggestion(s.id, 'use'))));
    actions.appendChild(button(t('ref.proposal.keep'), 'btn btn--ghost v2-proposal-keep', () => change(ctx.api.suggestion(s.id, 'keep'))));
    box.appendChild(actions);
    return box;
  }

  // D-80: masked until the eye is pressed; "Not yet provided" is a real state (D-13).
  function ssnRow(person, suggestions) {
    const row = el('div', 'v2-ref-field v2-ref-field--ssn');
    const id = `ps2-${person.id}-ssn`;
    const label = el('label', 'v2-ref-label', t('field.ssn'));
    label.htmlFor = id;
    row.appendChild(label);
    const target = { person_id: person.id, last4: person.ssn_last4 };
    const line = el('div', 'v2-ssn-line');
    const inputWrap = el('div', 'v2-ssn-input');
    const input = el('input', 'v2-input v2-input--ssn');
    input.id = id;
    input.inputMode = 'numeric';
    input.maxLength = 11;
    input.placeholder = '###-##-####';
    input.autocomplete = 'off';
    const eye = el('button', 'v2-ssn-eye v2-ssn-eye--field');
    eye.type = 'button';
    eye.addEventListener('click', () => ctx.ssn.toggle());
    inputWrap.append(input, eye);
    const pendingBox = el('label', 'v2-check');
    const pending = el('input');
    pending.type = 'checkbox';
    pendingBox.append(pending, el('span', null, t('ref.ssn.not_provided')));
    line.append(inputWrap, pendingBox);
    row.appendChild(line);
    const msg = el('div', `v2-ref-source v2-src--${sourceKind(person, 'ssn')}`);
    row.appendChild(msg);

    const sync = () => {
      const full = ctx.ssn.value(target);
      const has = Boolean(person.has_ssn);
      // Hidden by default: a masked, read-only value until the eye is pressed.
      input.readOnly = has && !full;
      input.value = has ? (full || maskSsn(person.ssn_last4)) : '';
      eye.hidden = !has;
      eye.textContent = '';
      eye.appendChild(icon(ctx.ssn.shown ? 'eye_off' : 'eye'));
      eye.setAttribute('aria-label', t(ctx.ssn.shown ? 'ssn.hide' : 'ssn.show'));
      eye.setAttribute('aria-pressed', String(ctx.ssn.shown));
      pending.checked = !has;
      msg.textContent = has ? (full ? sourceLine(person, 'ssn') : `${sourceLine(person, 'ssn')}. ${t('ref.ssn.reveal_first')}`) : t('ref.ssn.pending_state');
    };
    if (person.has_ssn) ctx.ssn.register(target, row, sync);
    sync();

    const format = (d) => [d.slice(0, 3), d.slice(3, 5), d.slice(5, 9)].filter(Boolean).join('-');
    input.addEventListener('input', () => { if (!input.readOnly) input.value = format(input.value.replace(/\D/g, '')); });
    input.addEventListener('change', async () => {
      if (input.readOnly) return;
      const digits = input.value.replace(/\D/g, '');
      if (digits && digits.length !== 9) { msg.textContent = t('ref.ssn.nine_digits'); return; }
      const res = await ctx.api.saveSsn(person.id, digits ? format(digits) : null);
      if (!res.ok) { msg.textContent = t('ref.saved_error', { error: errorText(res) }); return; }
      if (digits) ctx.ssn.remember(target, format(digits));
      return refresh();
    });
    pending.addEventListener('change', async () => {
      if (!pending.checked) { input.readOnly = false; input.value = ''; input.focus?.(); return; }
      const res = await ctx.api.saveSsn(person.id, null);
      if (!res.ok) { msg.textContent = t('ref.saved_error', { error: errorText(res) }); return; }
      return refresh();
    });

    // D-97: a different SSN from a newer document, masked behind the same eye.
    for (const s of suggestions.filter((x) => x.field === 'ssn')) {
      const last4 = String(s.value || '').replace(/\D/g, '').slice(-4);
      const oldNode = ctx.ssn.view(target);
      oldNode.classList.add('v2-proposal-old');
      const newNode = ctx.ssn.view({ suggestion_id: s.id, last4 });
      newNode.classList.add('v2-proposal-new');
      row.appendChild(proposalBox(s, null, null, [oldNode, newNode]));
    }
    return row;
  }

  async function refresh() {
    const res = await ctx.api.getCase(view.case.id);
    if (res.ok) ctx.setView(res.data);
    else { local.error = errorText(res); ctx.redraw(); }
  }

  // ── Other people on the case (D-94, General) ───────────────────────────────

  function drawAddPerson(body) {
    body.appendChild(el('p', 'v2-hint', t('people.hint')));
    const free = ROLES.filter((r) => r !== 'applicant' && (REPEATABLE.has(r) || !view.people.some((p) => p.role === r)));
    if (!free.length) return;
    const add = el('div', 'v2-person-add');
    const sel = el('select', 'v2-input v2-inline-select');
    free.forEach((r) => { const o = el('option', null, roleLabel(r)); o.value = r; sel.appendChild(o); });
    sel.value = free[0];
    add.append(sel, button(t('people.add'), 'btn btn--secondary v2-person-add-btn',
      () => change(ctx.api.person({ action: 'add', case_id: view.case.id, role: sel.value }))));
    body.appendChild(add);
  }
}
