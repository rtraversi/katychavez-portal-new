// physical-scan.js: Physical Scan IS the 1.2 checker (D-58). Same report.js,
// same compose.js, same four fixtures, imported by URL so the two cannot drift.
// No rule is changed and no form-to-form order check is added.
import { renderReport } from '/ui-lab/report.js';
import { compose } from '/ui-lab/compose.js';
import { el, t, loadJSON, loadRules, reportState, dropZone, scanButton, reveal, signOff, fmtDate, maskSsn } from '/v2-lab/ui.js';
import { renderPossibleIssues } from '/v2-lab/possible-issues.js';
import { state, REFERENCE_FIELDS, personByRole, newPerson, setField } from '/v2-lab/state.js';
import { GENERAL_CHECKLIST } from '/v2-lab/review.js';
import { matchEvidence, matchItems, renderMatchBlock, crossFormRows, crossFormItems, renderCrossBlock, translationItems, expiredIssues } from '/v2-lab/evidence-match.js';
import { formatAddress } from '/v2-lab/evidence-zero.js';
import { renderEmail } from '/v2-lab/email.js';

// The 1.2 Lab's own four fixtures, with its button labels.
const DACA_FIXTURES = [
  ['/ui-lab/fixtures/1-known-good-daca.json', 'r12.fixture.1'],
  ['/ui-lab/fixtures/2-todays-false-positives.json', 'r12.fixture.2'],
  ['/ui-lab/fixtures/3-error-injected-daca.json', 'r12.fixture.3'],
  ['/ui-lab/fixtures/4-everything-wrong.json', 'r12.fixture.4'],
];
// D-95: General goes straight to Physical Scan with the whole package, evidence included.
const GENERAL_FIXTURES = [['/v2-lab/fixtures/ps-general-aos.json', 'ps.fixture.general']];
const fixturesFor = () => (state.caseType === 'general' ? GENERAL_FIXTURES : DACA_FIXTURES);
const fileName = (path) => path.split('/').pop().replace(/\.json$/, '.pdf');

// D-58: a missing required form or expected evidence item is an item needing
// attention. The 1.2 Lab's compose() marks it ✕ in "Included in the scan" but
// does not count it; the portal's v1.2 contract does (package_items). So each
// missing item is added to the attention list here, as data, before the
// unchanged renderer draws it. Composition entries only, never a rule.
function withMissingItems(d, caseLabel) {
  const missing = d.composition.filter((c) => !c.ok).map((c) => ({
    rule_id: `package:${c.key}`,
    status: 'needs_attention',
    severity: null,
    title: t('ps.missing_item', { item: c.key, case_type: caseLabel }),
    reason: '', evidence: '', expected: c.label || '', note: '',
    form: c.form, where: '', locations: [],
  }));
  return { ...d, needs_attention: [...missing, ...d.needs_attention] };
}

// Max 2026-10-02 (Q-46): a value never added to the reference record is a light
// heads-up at Physical Scan, not an attention item.
function noReferenceNotice(card) {
  const missing = REFERENCE_FIELDS.filter((f) => !state.reference.fields[f.key].value).map((f) => t(`field_in.${f.key}`));
  if (!missing.length) return;
  const b = el('section', 'psr-block v2-notifications');
  const h = el('h3', 'psr-block-head');
  h.appendChild(el('span', null, t('review.notifications')));
  b.appendChild(h);
  b.appendChild(el('p', 'v2-block-note', t('ps.no_reference.note')));
  const row = el('div', 'v2-info-row');
  row.appendChild(el('span', 'v2-info-mark', 'i'));
  row.appendChild(el('span', 'psr-check-text', t('ps.no_reference', { fields: missing.join(', ') })));
  b.appendChild(row);
  card.appendChild(b);
}

// Max 2026-10-07: the client details live only on the case card. The report does
// not repeat them; it says so immediately when the scanned package differs from it.
const norm = (v) => String(v ?? '').toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const digits = (v) => String(v ?? '').replace(/\D/g, '');

// "RIVERA, ANA M." and "ANA MARIA RIVERA" are the same name: same last and first
// name, and a middle initial that matches the middle name.
function sameName(scanned, f) {
  const s = norm(scanned).split(' ').filter(Boolean);
  const comma = /,/.test(String(scanned).replace(/\[[^\]]*\]/g, ''));
  const last = comma ? s[0] : s[s.length - 1];
  const rest = comma ? s.slice(1) : s.slice(0, -1);
  if (last !== norm(f.last_name) || rest[0] !== norm(f.first_name)) return false;
  const mid = rest[1];
  return !mid || !f.middle_name || norm(f.middle_name).startsWith(mid);
}

function caseCardDiffs(client) {
  if (!client) return [];
  const f = Object.fromEntries(Object.entries(state.reference.fields).map(([k, v]) => [k, v.value]));
  const out = [];
  const add = (field, scanned, card) => out.push({ field, scanned, card });
  if (client.name && f.last_name && !sameName(client.name, f)) add('name', client.name.replace(/\[[^\]]*\]\s*/g, ''), [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' '));
  if (client.a_number && f.a_number && digits(client.a_number) !== digits(f.a_number)) add('a_number', client.a_number, f.a_number);
  if (client.date_of_birth && f.date_of_birth && client.date_of_birth !== f.date_of_birth) add('date_of_birth', fmtDate(client.date_of_birth), fmtDate(f.date_of_birth));
  if (client.ead_expires && f.ead_expiration && client.ead_expires !== f.ead_expiration) add('ead_expiration', fmtDate(client.ead_expires), fmtDate(f.ead_expiration));
  if (client.ssn_last4 && f.ssn && digits(f.ssn).slice(-4) !== client.ssn_last4) add('ssn', maskSsn(`000000${client.ssn_last4}`), maskSsn(f.ssn));
  if (client.phone && f.phone && digits(client.phone) !== digits(f.phone)) add('phone', client.phone, f.phone);
  if (client.email && f.email && norm(client.email) !== norm(f.email)) add('email', client.email, f.email);
  const addr = formatAddress(f);
  if (client.address && f.street && norm(client.address) !== norm(addr)) add('address', client.address, addr);
  return out;
}

function withCaseCardDiffs(d) {
  const diffs = caseCardDiffs(d.client).map((x) => ({
    rule_id: `casecard:${x.field}`, status: 'needs_attention', severity: null,
    title: t('ps.casecard_diff', { field: t(`field_in.${x.field}`), scanned: x.scanned, card: x.card }),
    reason: '', evidence: '', expected: '', note: '', form: null, where: '', locations: [],
  }));
  return { ...d, needs_attention: [...diffs, ...d.needs_attention] };
}

// ── General: people and evidence come from the package itself (D-94, D-95) ───
const SCAN_SRC = { kind: 'scan', label: 'scan' };
// D-100: every fact the scan reads for a person fills (or completes) their case card.
const PERSON_KEYS = ['first_name', 'last_name', 'date_of_birth', 'a_number', 'country_of_birth', 'country_of_citizenship',
  'phone', 'email', 'i94_number', 'last_entry_date', 'port_of_entry', 'employer', 'marriage_date', 'marriage_place'];
const ADDRESS_FROM_SCAN = (sp) => sp.address || '';
// "1842 W Encanto Blvd, Apt 6, Phoenix, AZ 85007" -> the main card's address parts.
function addressParts(line) {
  const parts = String(line || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const [stateCode, zip] = (parts.pop() || '').split(/\s+/);
  const city = parts.pop();
  const aptMatch = parts[1] && /^(apt|ste|flr)\.?\s*(.+)$/i.exec(parts[1]);
  return { street: parts[0], apt_type: aptMatch ? `${aptMatch[1][0].toUpperCase()}${aptMatch[1].slice(1).toLowerCase()}.` : '', apt_number: aptMatch ? aptMatch[2] : '', city, state: stateCode, zip };
}

// Each person the scan finds is matched to their case card by role. A role with
// no card gets one, filled from the package. A card that already holds values is
// compared, field by field, and any difference leads the report (D-89).
function withPeopleDiffs(d, people) {
  const items = [];
  people.forEach((sp) => {
    const card = personByRole(sp.role);
    if (!card) {
      const p = newPerson(sp.role, null, sp);
      PERSON_KEYS.forEach((k) => { if (sp[k]) p.fields[k] = { value: sp[k], source: SCAN_SRC }; });
      if (sp.address) p.fields.address = { value: sp.address, source: SCAN_SRC };
      state.others.push(p);
      sp._new = true;
      return;
    }
    // Values that only came from draft forms are replaced by what the package
    // shows; they were never evidence (D-99).
    const f = card.fields;
    const weak = (k) => !f[k]?.value || f[k].source?.kind === 'forms';
    if (PERSON_KEYS.every(weak)) sp._new = true;
    PERSON_KEYS.forEach((k) => {
      if (!sp[k] || !weak(k)) return;
      if (card.id === 'main') setField(k, sp[k], SCAN_SRC);
      else f[k] = { value: sp[k], source: SCAN_SRC };
    });
    if (card.id !== 'main' && sp.address && (!f.address?.value || f.address.source?.kind === 'forms')) f.address = { value: ADDRESS_FROM_SCAN(sp), source: SCAN_SRC };
    if (card.id === 'main' && sp.address && !f.street.value) {
      const a = addressParts(sp.address);
      if (a) Object.entries(a).forEach(([k, val]) => { if (val) setField(k, val, SCAN_SRC); });
    }
    const role = t(`role.${sp.role}`).toLowerCase();
    const add = (field, scanned, have) => items.push({
      rule_id: `casecard:${sp.role}:${field}`, status: 'needs_attention', severity: null,
      title: t('ps.casecard_diff_person', { role, field: t(`field_in.${field}`), scanned, card: have }),
      reason: '', evidence: '', expected: '', note: '', form: null, where: '', locations: [],
    });
    const strong = (k) => f[k]?.value && f[k].source?.kind !== 'scan';
    if (sp.last_name && strong('last_name') && (norm(sp.last_name) !== norm(f.last_name.value) || norm(sp.first_name) !== norm(f.first_name.value))) {
      add('name', [sp.first_name, sp.last_name].join(' '), [f.first_name.value, f.middle_name?.value, f.last_name.value].filter(Boolean).join(' '));
    }
    if (sp.date_of_birth && strong('date_of_birth') && sp.date_of_birth !== f.date_of_birth.value) add('date_of_birth', fmtDate(sp.date_of_birth), fmtDate(f.date_of_birth.value));
    if (sp.a_number && strong('a_number') && digits(sp.a_number) !== digits(f.a_number.value)) add('a_number', sp.a_number, f.a_number.value);
  });
  document.dispatchEvent(new CustomEvent('v2-reference-changed'));
  return { ...d, needs_attention: [...items, ...d.needs_attention] };
}

// D-100 #3: an information-only list of what the scan found. Nothing is required.
function renderFormsFound(card, forms) {
  const b = el('section', 'psr-block v2-forms-found');
  const h = el('h3', 'psr-block-head');
  h.appendChild(el('span', null, t('forms_found.heading')));
  h.appendChild(el('span', 'psr-count', String(forms.length)));
  b.appendChild(h);
  b.appendChild(el('p', 'v2-block-note', t('forms_found.note')));
  const list = el('div', 'v2-forms-found-list');
  forms.forEach((f) => {
    const row = el('div', 'v2-forms-found-row');
    row.appendChild(el('span', 'v2-file-tag', f.form));
    row.appendChild(el('span', 'v2-person-meta', t('forms_found.row', { pages: f.pages, owner: t(`role.${f.person}`) })));
    list.appendChild(row);
  });
  b.appendChild(list);
  card.appendChild(b);
}

function renderPeopleBlock(card, result) {
  const b = el('section', 'psr-block v2-ps-people');
  const h = el('h3', 'psr-block-head');
  h.appendChild(el('span', null, t('ps.people.heading')));
  b.appendChild(h);
  const grid = el('div', 'v2-ps-people-grid');
  result.people.forEach((sp) => {
    const c = el('div', 'v2-ps-person');
    const top = el('div', 'v2-ps-person-top');
    top.appendChild(el('span', 'v2-pill v2-pill--role', t(`role.${sp.role}`)));
    if (sp._new) top.appendChild(el('span', 'v2-pill v2-pill--new', t('ps.people.new_card')));
    c.appendChild(top);
    c.appendChild(el('div', 'v2-person-name', [sp.first_name, sp.last_name].filter(Boolean).join(' ')));
    const meta = [sp.date_of_birth && fmtDate(sp.date_of_birth), sp.a_number].filter(Boolean).join(' · ');
    if (meta) c.appendChild(el('div', 'v2-person-meta', meta));
    const forms = result.forms.filter((x) => x.person === sp.role);
    if (forms.length) {
      c.appendChild(el('div', 'v2-ps-k', t('ps.people.forms')));
      const row = el('div', 'v2-file-tags v2-ps-tags');
      forms.forEach((x) => row.appendChild(el('span', 'v2-file-tag', x.form)));
      c.appendChild(row);
    }
    c.appendChild(el('div', 'v2-ps-k', t('ps.people.evidence')));
    const ev = result.evidence.filter((x) => x.owners.includes(sp.role));
    if (!ev.length) c.appendChild(el('div', 'v2-person-meta', t('ps.people.none')));
    ev.forEach((x) => {
      const r = el('div', 'v2-ps-ev');
      r.appendChild(el('span', 'v2-ps-ev-name', x.label));
      if (x.owners.length > 1) r.appendChild(el('span', 'v2-pill v2-pill--muted', t('ps.people.shared')));
      r.appendChild(el('span', 'v2-person-meta', t('ps.people.pages', { n: x.pages })));
      c.appendChild(r);
    });
    grid.appendChild(c);
  });
  b.appendChild(grid);
  card.appendChild(b);
}

export async function renderPhysicalScan(mount) {
  const [base, checklist] = await loadRules();

  mount.appendChild(el('p', 'v2-hint v2-stage-intro', t('ps.intro')));

  // The 1.2 flow: drop the package in, run the scan, the report unseals.
  const local = { file: null, landed: false };
  const setup = el('div', 'dk-sec');
  mount.appendChild(setup);
  const drawSetup = () => {
    setup.textContent = '';
    const picked = fixturesFor().find(([f]) => f === local.file);
    setup.appendChild(dropZone({
      title: picked ? t('ps.drop.ready') : t('ps.drop.title'),
      meta: picked ? t('files.one') : t('ps.drop.meta'),
      ready: Boolean(picked),
      landed: Boolean(picked && local.landed),
      files: picked ? [{ name: fileName(picked[0]), meta: t('ps.file.meta'), tags: [t(picked[1])] }] : [],
      choices: fixturesFor().filter(([file]) => file !== local.file).map(([file, label]) => ({
        label: picked ? t('files.use_instead', { label: t(label) }) : t(label),
        onPick: () => { local.file = file; local.landed = true; wrap.classList.add('hidden'); drawSetup(); },
      })),
      note: picked ? null : t('limit.note'),
    }));
    local.landed = false;
    const bar = el('div', 'dk-toolbar');
    bar.appendChild(scanButton(t('ps.run'), () => show(local.file), !local.file));
    setup.appendChild(bar);
  };

  const wrap = el('div', 'dk-sec hidden');
  const head = el('div', 'dk-sec-head');
  head.appendChild(el('h2', null, t('r12.scan_results')));
  head.appendChild(el('span', 'dk-sec-rule'));
  wrap.appendChild(head);
  const card = el('div', 'card ps-report');
  card.id = 'ps-results-content';
  const reminder = el('p', 'v2-reminder');
  const signMount = el('div');
  const emailMount = el('div');
  wrap.append(card, reminder, signMount, emailMount);
  mount.appendChild(wrap);
  drawSetup();

  async function show(file) {
    const result = await loadJSON(file);
    const general = state.caseType === 'general';
    const cl = general ? GENERAL_CHECKLIST : checklist;
    const composed = withMissingItems(compose({ base, checklist: cl, result }), cl.case_type.label);
    let d = result.people ? withPeopleDiffs(composed, result.people) : withCaseCardDiffs(composed);
    // D-98: the evidence inside the package must match the forms. Differences lead the report.
    const matchRows = result.evidence && result.forms ? matchEvidence(result.evidence, result.forms) : [];
    // D-100 #1: every shared fact across the forms, per person. #6: translations (counted).
    const crossRows = result.forms ? crossFormRows(result.forms) : [];
    const translations = result.evidence ? translationItems(result.evidence) : [];
    d = { ...d, needs_attention: [...matchItems(matchRows), ...crossFormItems(crossRows, matchRows), ...translations, ...d.needs_attention] };
    wrap.classList.remove('hidden');
    renderReport(d, card);
    card.querySelector('.psr-summary-strip')?.remove();   // shown once, on the case card
    card.querySelector('.psr-client-details')?.remove();
    renderMatchBlock(card, matchRows);
    renderCrossBlock(card, crossRows);
    if (result.forms) renderFormsFound(card, result.forms);
    if (result.people) renderPeopleBlock(card, result);
    // D-102: no "not on the case card yet" note in General.
    else if (state.caseType !== 'general') noReferenceNotice(card);
    // D-100 #5: expired evidence is a Possible issue only, never counted.
    renderPossibleIssues(card, result.evidence ? expiredIssues(result.evidence) : []);
    const st = reportState(d.needs_attention.length, d.not_checked.length);
    reminder.textContent = t('state.reminder');
    renderEmail(emailMount, { caseLabel: cl.case_type.label, stageLabel: t('stage.physical_scan'), phrase: st.phrase });
    state.runs.physical_scan = st.key;
    state.signedOff.physical_scan = false;
    signMount.textContent = '';
    signMount.appendChild(signOff('physical_scan'));
    document.dispatchEvent(new CustomEvent('v2-progress'));
    reveal(card);
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    wrap.scrollIntoView({ block: 'start', behavior });
  }
}
