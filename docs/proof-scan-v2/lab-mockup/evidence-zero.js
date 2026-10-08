// evidence-zero.js: the quiet document and fact workspace (D-53).
// No attention count, no error language. Documents are local synthetic fixtures;
// no uploaded file is ever read.
import { el, t, button, loadJSON, dropZone, fmtDate, parseDate, ssnView, maskSsn, toggleSsn, eyeMarkup } from '/v2-lab/ui.js';
import { state, REFERENCE_FIELDS, nextId, sameValue, setField, stageGate, newPerson, personByRole, ROLES, PERSON_FIELDS } from '/v2-lab/state.js';

const SAMPLES = {
  daca_renewal: ['ez-ead.json', 'ez-ead-newer.json', 'ez-intake.json', 'ez-ead-damaged.json'],
  // D-94: General samples come with the people they belong to.
  general: ['ez-gen-bc-ben.json', 'ez-gen-bc-pet.json', 'ez-gen-mc.json'],
};

const GROUPS = ['name', 'address', 'identity', 'contact'];
const DATE_FIELDS = new Set(['date_of_birth', 'ead_expiration', 'marriage_date']);

function section(title) {
  const wrap = el('div', 'dk-sec');
  const head = el('div', 'dk-sec-head');
  head.appendChild(el('h2', null, title));
  head.appendChild(el('span', 'dk-sec-rule'));
  wrap.appendChild(head);
  const body = el('div');
  wrap.appendChild(body);
  return { wrap, head, body };
}

// ── Adding a document ───────────────────────────────────────────────────────
function addDocument(sample) {
  state.workspaceNote = '';
  const doc = { id: nextId('doc'), sample };

  // D-54: an unreliable source is held for review. It fills nothing and
  // proposes nothing, so an OCR guess can never become a discrepancy.
  if (sample.read_quality !== 'clear') {
    doc.status = 'source_review';
    state.docs.push(doc);
    state.justAdded = doc.id;
    return;
  }
  doc.status = 'current';

  // D-94: a document belongs to one person or several. The sample's owner roles
  // stand in for the AI's proposal; a role with no case card yet gets a new card.
  doc.owners = ownersFor(sample);

  // D-55: a newer document of the same type, for the same people, replaces the
  // older one here. The firm's own record system keeps the archive.
  const sameOwners = (d) => d.owners.length === doc.owners.length && d.owners.every((o) => doc.owners.includes(o));
  const older = state.docs.find((d) => d.status === 'current' && d.sample.doc_type === sample.doc_type && sameOwners(d));
  if (older) {
    if ((older.sample.issued || '') > (sample.issued || '')) {
      state.workspaceNote = t('ez.note.older_not_kept', { type: sample.type_label });
      return;
    }
    removeDocument(older.id);
    state.workspaceNote = t('ez.note.replaced', { type: sample.type_label });
  }
  state.docs.push(doc);
  state.justAdded = doc.id;
  state.justFilled = new Set();

  // A document shared by several people (a marriage certificate) fills nobody's card.
  if (doc.owners.length !== 1) return;
  if (doc.owners[0] !== 'main') {
    const p = state.others.find((x) => x.id === doc.owners[0]);
    PERSON_FIELDS.forEach((k) => {
      if (p && sample.facts[k] && !p.fields[k].value) p.fields[k] = { value: sample.facts[k], source: { kind: 'doc', label: sample.type_label } };
    });
    return;
  }

  // D-45: the document fills the fields it carries. D-55: where the record
  // already holds a different value, the new one is only proposed.
  Object.entries(sample.facts).forEach(([key, value]) => {
    const field = state.reference.fields[key];
    if (!field || !value) return;
    if (!field.value) { setField(key, value, { kind: 'doc', label: sample.type_label }); state.justFilled.add(key); return; }
    if (sameValue(key, field.value, value)) return;
    state.proposals = state.proposals.filter((p) => p.field !== key);
    state.proposals.push({ id: nextId('prop'), field: key, value, docId: doc.id, label: sample.type_label });
  });
}

function ownersFor(sample) {
  const roles = sample.owner_roles || [state.reference.role];
  return roles.map((role) => {
    const found = personByRole(role);
    if (found) return found.id;
    const p = newPerson(role, sample.type_label, roles.length === 1 ? sample.facts : {});
    state.others.push(p);
    return p.id;
  });
}

const personLabel = (id) => {
  if (id === 'main') return t(`role.${state.reference.role}`);
  const p = state.others.find((x) => x.id === id);
  return p ? t(`role.${p.role}`) : '';
};

function removeDocument(id) {
  state.docs = state.docs.filter((d) => d.id !== id);
  state.proposals = state.proposals.filter((p) => p.docId !== id);
}

// ── Document cards ──────────────────────────────────────────────────────────
// G-28 Part 3 item 12 order: street, Apt./Ste./Flr. number, city, state ZIP.
export function formatAddress(f) {
  const apt = f.apt_number ? `${f.apt_type || ''} ${f.apt_number}`.trim() : '';
  const stateZip = [f.state, f.zip].filter(Boolean).join(' ');
  const careOf = f.in_care_of ? `c/o ${f.in_care_of}` : '';
  return [careOf, f.street, apt, f.city, stateZip, f.province, f.postal_code, f.country].filter(Boolean).join(', ');
}

function factValue(sample, key) {
  const f = sample.facts;
  if (key === 'name') return [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' ');
  if (key === 'address') return formatAddress(f);
  return DATE_FIELDS.has(key) ? fmtDate(f[key]) : (f[key] || '');
}

// Visual only: each document type gets its own colour and glyph.
const DOC_TILE = {
  ead: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M6 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14.5 10h3.5M14.5 13h3.5"/></svg>',
  intake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4"/></svg>',
  birth_certificate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><circle cx="12" cy="14" r="2.6"/><path d="M10.6 16.2L10 20l2-1 2 1-.6-3.8"/></svg>',
  marriage_certificate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="13" r="4.5"/><circle cx="15" cy="13" r="4.5"/><path d="M10.5 5l1.5-2 1.5 2"/></svg>',
  other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
};

const DOC_TYPE_SETS = {
  daca_renewal: [['ead', 'ez.type.ead'], ['intake', 'ez.type.intake'], ['other', 'ez.type.other']],
  // Max's own General examples (D-94): birth and marriage certificates.
  general: [['birth_certificate', 'ez.type.birth_certificate'], ['marriage_certificate', 'ez.type.marriage_certificate'], ['other', 'ez.type.other']],
};
const docTypes = () => DOC_TYPE_SETS[state.caseType] || DOC_TYPE_SETS.daca_renewal;

function docCard(doc, redraw) {
  const s = doc.sample;
  const card = el('article', `v2-doc${doc.status === 'source_review' ? ' v2-doc--review' : ''}${doc.id === state.justAdded ? ' v2-doc--new' : ''}`);

  card.dataset.type = s.doc_type;
  const head = el('div', 'v2-doc-head');
  const tile = el('span', 'v2-doc-tile');
  tile.insertAdjacentHTML('afterbegin', DOC_TILE[s.doc_type] || DOC_TILE.other); // fixed trusted markup
  head.appendChild(tile);
  const title = el('div', 'v2-doc-titles');
  title.appendChild(el('div', 'v2-doc-type', t('ez.doc.identified', { type: s.type_label })));
  title.appendChild(el('div', 'v2-doc-file', s.filename));
  head.appendChild(title);
  const tags = el('div', 'v2-doc-tags');
  if (doc.status === 'source_review') tags.appendChild(el('span', 'v2-tag v2-tag--review', t('ez.doc.status_review')));
  if (doc.typeCorrected) tags.appendChild(el('span', 'v2-tag', t('ez.doc.type_corrected')));
  head.appendChild(tags);
  card.appendChild(head);

  // D-53: the case-relevant facts, not a generic summary.
  const facts = el('div', 'v2-doc-facts');
  s.summary_fields.forEach((key) => {
    const cell = el('div', 'psr-fact');
    cell.appendChild(el('div', 'psr-fact-k', t(`ez.fact.${key}`)));
    const unreadable = (s.unreadable || []).includes(key);
    const v = unreadable ? t('ez.doc.unreadable_value') : (factValue(s, key) || t('ez.doc.not_on_document'));
    const vNode = el('div', `psr-fact-v${unreadable || doc.status === 'source_review' ? ' v2-fact-uncertain' : ''}`);
    if (key === 'ssn' && !unreadable && s.facts.ssn) vNode.appendChild(ssnView(s.facts.ssn));
    else vNode.textContent = v;
    cell.appendChild(vNode);
    facts.appendChild(cell);
  });
  card.appendChild(facts);

  if (doc.status === 'source_review') {
    card.appendChild(el('p', 'v2-doc-review-note', t('ez.doc.source_review')));
  }

  const foot = el('div', 'v2-doc-foot');
  // Max 2026-10-02: staff can correct the identified type. Only the types the Lab
  // already knows are offered; no new evidence categories are invented here.
  const typeLab = el('label', 'v2-doc-typefix');
  typeLab.appendChild(el('span', null, t('ez.doc.correct_type')));
  const sel = el('select', 'v2-input v2-inline-select');
  docTypes().forEach(([key, labelKey]) => {
    const o = el('option', null, t(labelKey));
    o.value = key;
    o.selected = key === s.doc_type;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    const [key, labelKey] = docTypes().find(([k]) => k === sel.value);
    doc.sample = { ...s, doc_type: key, type_label: t(labelKey) };
    doc.typeCorrected = true;
    redraw();
  });
  typeLab.appendChild(sel);
  foot.appendChild(typeLab);

  // D-94: whose document this is. Staff can correct the AI's proposal.
  if (state.caseType === 'general' && doc.owners) {
    const own = el('div', 'v2-owners');
    own.appendChild(el('span', 'v2-owners-k', t('people.belongs')));
    ['main', ...state.others.map((p) => p.id)].forEach((id) => {
      const on = doc.owners.includes(id);
      const chip = button(personLabel(id), `v2-owner-chip${on ? ' is-on' : ''}`, () => {
        if (on && doc.owners.length === 1) return; // a document always belongs to someone
        doc.owners = on ? doc.owners.filter((x) => x !== id) : [...doc.owners, id];
        doc.ownersCorrected = true;
        redraw();
      });
      chip.setAttribute('aria-pressed', String(on));
      own.appendChild(chip);
    });
    foot.appendChild(own);
  }
  foot.appendChild(button(t('ez.doc.remove'), 'v2-link', () => { removeDocument(doc.id); state.workspaceNote = ''; redraw(); }));
  card.appendChild(foot);
  return card;
}

function drawDocs(body, samples, redraw) {
  body.textContent = '';
  body.appendChild(el('p', 'v2-hint', t('ez.intro')));

  // The 1.2 drop zone. It lands green for a moment when a document arrives.
  const added = state.docs.find((d) => d.id === state.justAdded);
  body.appendChild(dropZone({
    title: added ? t('ez.drop.added', { type: added.sample.type_label }) : t('ez.drop.title'),
    meta: added ? added.sample.filename : t('ez.drop.meta'),
    landed: Boolean(added),
    choices: samples.map((s) => ({ label: s.sample_label, onPick: () => { addDocument(s); redraw(); } })),
    note: t('ez.drop.kept'),
  }));

  if (state.workspaceNote) {
    const note = el('p', 'v2-quiet-note', state.workspaceNote);
    note.setAttribute('role', 'status');
    body.appendChild(note);
  }

  if (!state.docs.length) {
    return;
  }
  const list = el('div', 'v2-doc-list');
  state.docs.forEach((d) => list.appendChild(docCard(d, redraw)));
  body.appendChild(list);
}

// ── Reference record (D-10 to D-13, D-49, D-55) ─────────────────────────────
function sourceLine(field) {
  if (!field.value) return t('ref.source.none');
  if (!field.source) return '';
  if (field.source.kind === 'scan') return t('people.from_scan');
  return field.source.kind === 'doc' ? t('ref.source.doc', { label: field.source.label }) : t('ref.source.staff');
}

// Visual only: where a value came from, as a coloured dot (EAD, intake, staff).
function sourceKind(field) {
  if (!field.value) return 'none';
  if (field.source?.kind === 'scan') return 'scan';
  if (field.source?.kind !== 'doc') return 'staff';
  return /EAD/i.test(field.source.label) ? 'ead' : /intake/i.test(field.source.label) ? 'intake' : 'doc';
}

function fieldRow(key, redraw) {
  const field = state.reference.fields[key];
  const row = el('div', `v2-ref-field v2-ref-field--${key}${state.justFilled?.has(key) ? ' v2-ref-field--filled' : ''}`);
  const id = `v2-ref-${key}`;
  const label = el('label', 'v2-ref-label', t(`field.${key}`));
  label.htmlFor = id;
  row.appendChild(label);

  row.appendChild(fieldControl(key, field, id, redraw));
  row.appendChild(el('div', `v2-ref-source v2-src--${sourceKind(field)}`, sourceLine(field)));

  state.proposals.filter((p) => p.field === key).forEach((p) => row.appendChild(proposalBox(p, field, redraw)));
  return row;
}

// G-28 12.b is three checkboxes (Apt., Ste., Flr.), so the type is a pick, not free text.
const APT_TYPES = ['Apt.', 'Ste.', 'Flr.'];

function fieldControl(key, field, id, redraw) {
  const save = (v) => { setField(key, v, { kind: 'staff' }); redraw(); };

  if (key === 'apt_type') {
    const select = el('select', 'v2-input');
    select.id = id;
    select.appendChild(el('option', null, ''));
    APT_TYPES.forEach((o) => { const opt = el('option', null, o); opt.value = o; select.appendChild(opt); });
    select.value = field.value;
    select.addEventListener('change', () => save(select.value));
    return select;
  }

  const input = el('input', 'v2-input');
  input.id = id;
  input.type = 'text';
  input.autocomplete = 'off';

  // The A- is part of the format, not part of the value staff type. Digits only.
  if (key === 'a_number') {
    const wrap = el('div', 'v2-affix');
    wrap.appendChild(el('span', 'v2-affix-prefix', 'A-'));
    input.inputMode = 'numeric';
    input.maxLength = 9;
    input.value = field.value.replace(/\D/g, '');
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 9); });
    input.addEventListener('change', () => save(input.value ? `A-${input.value}` : ''));
    wrap.appendChild(input);
    return wrap;
  }

  if (key === 'state') {
    input.maxLength = 2;
    input.addEventListener('input', () => { input.value = input.value.replace(/[^a-z]/gi, '').toUpperCase(); });
  }

  if (DATE_FIELDS.has(key)) {
    input.placeholder = 'MM/DD/YYYY';
    input.inputMode = 'numeric';
    input.value = fmtDate(field.value);
    input.addEventListener('change', () => {
      const v = input.value.trim();
      const iso = parseDate(v);
      if (v && !iso) { input.setCustomValidity(t('ref.date_format')); input.reportValidity(); return; }
      input.setCustomValidity('');
      save(iso || '');
    });
    return input;
  }

  input.value = field.value;
  input.addEventListener('change', () => save(input.value.trim()));
  return input;
}

function proposalBox(p, field, redraw) {
  const box = el('div', 'v2-proposal');
  const show = (v) => (DATE_FIELDS.has(p.field) ? fmtDate(v) : v);
  box.appendChild(el('div', 'v2-proposal-from', t('ref.proposal.from', { label: p.label })));
  const swap = el('div', 'v2-proposal-swap');
  swap.appendChild(el('span', 'v2-proposal-old', show(field.value) || t('ref.source.none')));
  swap.appendChild(el('span', 'v2-proposal-arrow', '→'));
  swap.appendChild(el('span', 'v2-proposal-new', show(p.value)));
  box.appendChild(swap);
  const actions = el('div', 'v2-proposal-actions');
  actions.appendChild(button(t('ref.proposal.use'), 'btn btn--secondary', () => {
    setField(p.field, p.value, { kind: 'doc', label: p.label });
    state.proposals = state.proposals.filter((x) => x.id !== p.id);
    redraw();
  }));
  actions.appendChild(button(t('ref.proposal.keep'), 'btn btn--ghost', () => {
    state.proposals = state.proposals.filter((x) => x.id !== p.id);
    redraw();
  }));
  box.appendChild(actions);
  return box;
}

// D-62: full SSN, shown to staff. "Not yet provided" is a real state (D-13).
const formatSsn = (d) => [d.slice(0, 3), d.slice(3, 5), d.slice(5, 9)].filter(Boolean).join('-');

function ssnRow(redraw) {
  const field = state.reference.fields.ssn;
  const row = el('div', 'v2-ref-field v2-ref-field--ssn');
  const label = el('label', 'v2-ref-label', t('field.ssn'));
  label.htmlFor = 'v2-ref-ssn';
  row.appendChild(label);

  const line = el('div', 'v2-ssn-line');
  const input = el('input', 'v2-input v2-input--ssn');
  input.id = 'v2-ref-ssn';
  input.inputMode = 'numeric';
  input.maxLength = 11;
  input.placeholder = '###-##-####';
  input.autocomplete = 'off';
  // Hidden by default: a masked, read-only value until the eye is pressed.
  const hidden = Boolean(field.value) && !state.showSsn;
  input.value = hidden ? maskSsn(field.value) : field.value;
  input.readOnly = hidden;
  const eye = el('button', 'v2-ssn-eye v2-ssn-eye--field');
  eye.type = 'button';
  eye.hidden = !field.value;
  eye.innerHTML = eyeMarkup(); // fixed trusted markup
  eye.setAttribute('aria-label', t(state.showSsn ? 'ssn.hide' : 'ssn.show'));
  eye.addEventListener('click', toggleSsn);
  const inputWrap = el('div', 'v2-ssn-input');
  inputWrap.append(input, eye);
  const pendingBox = el('label', 'v2-check');
  const pending = el('input');
  pending.type = 'checkbox';
  pending.checked = !field.value;
  pendingBox.append(pending, el('span', null, t('ref.ssn.not_provided')));
  line.append(inputWrap, pendingBox);
  row.appendChild(line);

  const msg = el('div', `v2-ref-source v2-src--${sourceKind(field)}`, field.value ? sourceLine(field) : t('ref.ssn.pending_state'));
  row.appendChild(msg);

  input.addEventListener('input', () => { if (!input.readOnly) input.value = formatSsn(input.value.replace(/\D/g, '')); });
  input.addEventListener('change', () => {
    if (input.readOnly) return;
    const digits = input.value.replace(/\D/g, '');
    if (digits && digits.length !== 9) { msg.textContent = t('ref.ssn.nine_digits'); return; }
    setField('ssn', digits ? formatSsn(digits) : '', { kind: 'staff' });
    redraw();
  });
  pending.addEventListener('change', () => {
    if (pending.checked) { setField('ssn', '', null); redraw(); return; }
    input.focus();
  });
  state.proposals.filter((p) => p.field === 'ssn').forEach((p) => row.appendChild(proposalBox(p, field, redraw)));
  return row;
}

function drawReference(body, head, redraw) {
  body.textContent = '';
  head.querySelector('.v2-ref-status')?.remove();

  // Approval status lives once, in the case header.
  const ref = state.reference;

  body.appendChild(el('p', 'v2-hint', t('ref.hint')));

  // D-94 (General): whose card this is. Roles other people already hold are not offered.
  if (state.caseType === 'general') {
    const row = el('label', 'v2-role-pick');
    row.appendChild(el('span', 'v2-ref-label', t('people.role')));
    const sel = el('select', 'v2-input v2-inline-select');
    ROLES.filter((r) => r === ref.role || !state.others.some((p) => p.role === r)).forEach((r) => {
      const o = el('option', null, t(`role.${r}`));
      o.value = r;
      o.selected = r === ref.role;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { ref.role = sel.value; redraw(); });
    row.appendChild(sel);
    body.appendChild(row);
  }

  GROUPS.forEach((g) => {
    const fs = el('fieldset', `v2-ref-group v2-ref-group--${g}`);
    fs.appendChild(el('legend', null, t(`ref.group.${g}`)));
    const grid = el('div', 'v2-ref-grid');
    REFERENCE_FIELDS.filter((f) => f.group === g)
      .filter((f) => !f.optional || state.reference.fields[f.key].value || state.proposals.some((p) => p.field === f.key))
      .forEach((f) => {
      grid.appendChild(f.key === 'ssn' ? ssnRow(redraw) : fieldRow(f.key, redraw));
    });
    fs.appendChild(grid);
    body.appendChild(fs);
  });

  // D-10 and D-11: approve as a whole; nothing missing ever blocks it.
  const bar = el('div', 'dk-toolbar v2-ref-bar');
  bar.appendChild(button(ref.approvedAt && !ref.changedSinceApproval ? t('ref.approved_btn') : t('ref.approve'), 'btn btn--primary', () => {
    ref.approvedAt = new Date();
    ref.changedSinceApproval = false;
    // Max 2026-10-02: approving moves on to the stage choice, not a silent reveal.
    redraw();
    document.dispatchEvent(new CustomEvent('v2-record-approved'));
  }));
  // Max 2026-10-02: no status lines next to the button; the tracker shows readiness.
  body.appendChild(bar);
  const needed = stageGate().missing;

  // The rare case with no EAD at all: a deliberate second step, never the default.
  const eadMissing = needed.some((k) => k === 'gate.ead_doc' || k === 'gate.ead_facts');
  if (ref.noEad) {
    const on = el('div', 'v2-noead');
    on.appendChild(el('span', 'v2-tag v2-tag--review', t('ref.noead.on')));
    on.appendChild(button(t('ref.noead.undo'), 'v2-link', () => { ref.noEad = false; redraw(); }));
    body.appendChild(on);
  } else if (eadMissing) {
    const wrap = el('div', 'v2-noead');
    const ask = button(t('ref.noead.ask'), 'v2-link', () => {
      ask.hidden = true;
      wrap.appendChild(el('span', 'v2-noead-warn', t('ref.noead.warn')));
      wrap.appendChild(button(t('ref.noead.confirm'), 'btn btn--secondary', () => { ref.noEad = true; redraw(); }));
      wrap.appendChild(button(t('rulebook.add.cancel'), 'btn btn--ghost', () => redraw()));
    });
    wrap.appendChild(ask);
    body.appendChild(wrap);
  }
}

let currentRedraw = null;
document.addEventListener('v2-ssn-toggle', () => currentRedraw?.());

// ── Other people on the case (D-94, General) ────────────────────────────────
function drawPeople(body, redraw) {
  body.textContent = '';
  body.appendChild(el('p', 'v2-hint', t('people.hint')));
  const list = el('div', 'v2-people-edit');
  state.others.forEach((p) => {
    const card = el('div', 'v2-person-edit');
    const head = el('div', 'v2-person-edit-head');
    const roleSel = el('select', 'v2-input v2-inline-select');
    ROLES.filter((r) => r === p.role || (r !== state.reference.role && !state.others.some((x) => x.role === r))).forEach((r) => {
      const o = el('option', null, t(`role.${r}`));
      o.value = r;
      o.selected = r === p.role;
      roleSel.appendChild(o);
    });
    roleSel.addEventListener('change', () => { p.role = roleSel.value; redraw(); });
    head.appendChild(roleSel);
    head.appendChild(button(t('people.remove'), 'v2-link', () => {
      state.others = state.others.filter((x) => x.id !== p.id);
      state.docs.forEach((d) => { if (d.owners) d.owners = d.owners.filter((o) => o !== p.id); if (d.owners && !d.owners.length) d.owners = ['main']; });
      redraw();
    }));
    card.appendChild(head);
    const grid = el('div', 'v2-ref-grid');
    PERSON_FIELDS.forEach((k) => {
      const cell = el('div', 'v2-ref-field');
      const id = `v2-${p.id}-${k}`;
      const lab = el('label', 'v2-ref-label', t(`field.${k}`));
      lab.htmlFor = id;
      const input = el('input', 'v2-input');
      input.id = id;
      input.autocomplete = 'off';
      const f = p.fields[k];
      if (DATE_FIELDS.has(k)) { input.placeholder = 'MM/DD/YYYY'; input.value = fmtDate(f.value); }
      else input.value = k === 'a_number' ? f.value : f.value;
      input.addEventListener('change', () => {
        let v = input.value.trim();
        if (DATE_FIELDS.has(k)) v = parseDate(v) || '';
        p.fields[k] = { value: v, source: v ? { kind: 'staff' } : null };
        redraw();
      });
      cell.append(lab, input);
      const src = f.source;
      cell.appendChild(el('div', `v2-ref-source v2-src--${!f.value ? 'none' : src?.kind === 'doc' ? 'doc' : 'staff'}`,
        !f.value ? t('ref.source.none') : src?.kind === 'doc' ? t('ref.source.doc', { label: src.label }) : t('ref.source.staff')));
      grid.appendChild(cell);
    });
    card.appendChild(grid);
    list.appendChild(card);
  });
  body.appendChild(list);

  const free = ROLES.filter((r) => r !== state.reference.role && !state.others.some((x) => x.role === r));
  if (free.length) {
    const add = el('div', 'v2-person-add');
    const sel = el('select', 'v2-input v2-inline-select');
    free.forEach((r) => { const o = el('option', null, t(`role.${r}`)); o.value = r; sel.appendChild(o); });
    add.append(sel, button(t('people.add'), 'btn btn--secondary', () => { state.others.push(newPerson(sel.value)); redraw(); }));
    body.appendChild(add);
  }
}

export async function renderEvidenceZero(mount) {
  const samples = await Promise.all((SAMPLES[state.caseType] || SAMPLES.daca_renewal).map((f) => loadJSON(`/v2-lab/fixtures/${f}`)));

  const docs = section(t('ez.docs.heading'));
  const ref = section(t(state.caseType === 'general' ? 'ref.heading_main' : 'ref.heading'));
  const people = section(t('people.heading'));
  people.wrap.hidden = state.caseType !== 'general';
  // Max 2026-10-02: expected final evidence is shown at Physical Scan, not here.
  mount.append(docs.wrap, ref.wrap, people.wrap);

  // Deferred one tick so a field's `change` finishes and focus lands on the next
  // field before the section is rebuilt; focus is then put back where it was.
  const draw = () => {
    const active = document.activeElement?.id;
    drawDocs(docs.body, samples, redraw);
    drawReference(ref.body, ref.head, redraw);
    if (state.caseType === 'general') drawPeople(people.body, redraw);
    document.dispatchEvent(new CustomEvent('v2-reference-changed'));
    state.justAdded = null;
    state.justFilled = null;
    if (active) document.getElementById(active)?.focus();
  };
  const redraw = () => setTimeout(draw, 0);
  currentRedraw = () => { if (mount.isConnected) redraw(); };
  draw();
}
