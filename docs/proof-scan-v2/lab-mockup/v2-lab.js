// v2-lab.js: entry, stage switching, and the shell. A local sketch of Checker v2
// (PROOF-SCAN.md D-52 to D-61). No fetch leaves localhost, no file is read, no
// scan runs, nothing is stored. Reload resets everything.
import { el, t, fmtDate, ssnView } from '/v2-lab/ui.js';
import { state, stageGate, CARD_FACTS, DATE_FACTS } from '/v2-lab/state.js';
import { renderEvidenceZero } from '/v2-lab/evidence-zero.js';
import { renderReviewStage } from '/v2-lab/review.js';
import { renderPhysicalScan } from '/v2-lab/physical-scan.js';
import { renderRulebook } from '/v2-lab/rulebook.js';
import { formatAddress } from '/v2-lab/evidence-zero.js';

// D-52. The four names are product language.
const STAGES = [
  { key: 'evidence_zero', render: renderEvidenceZero },
  { key: 'draft_review',  render: (m) => renderReviewStage(m, 'draft_review') },
  { key: 'preflight',     render: (m) => renderReviewStage(m, 'preflight') },
  { key: 'physical_scan', render: renderPhysicalScan },
];

// ── Static copy in the shell ────────────────────────────────────────────────
document.querySelectorAll('[data-copy]').forEach((n) => { n.textContent = t(n.dataset.copy); });

// ── Light / dark, same control as the 1.2 Lab ───────────────────────────────
(function modeToggle() {
  const btn = document.getElementById('ps-lab-mode-btn');
  const sun = document.getElementById('ps-lab-mode-sun');
  const moon = document.getElementById('ps-lab-mode-moon');
  const sync = () => {
    const dark = window.PortalTheme?.mode === 'dark';
    sun.style.display = dark ? '' : 'none';
    moon.style.display = dark ? 'none' : '';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  };
  btn.addEventListener('click', () => window.PortalTheme?.toggleMode());
  document.addEventListener('portalmodechange', sync);
  sync();
})();

// ── The flow (Max 2026-10-02) ───────────────────────────────────────────────
// 1. Pick the case type and press Start. It is locked from then on.
// 2. Evidence Zero opens. The case header (tracker + summary) stays on top.
// 3. Once Evidence Zero is ready (D-74) and approved, the stage choice appears
//    (D-67). After that the tracker is the way between stages.
const startSection = document.getElementById('v2-start');
const caseSelect = document.getElementById('v2-case-type');
const startBtn = document.getElementById('v2-start-btn');
const caseSection = document.getElementById('v2-case');
const caseTop = document.getElementById('v2-case-top');
const tracker = document.getElementById('v2-tracker');
const summary = document.getElementById('v2-summary');
const choose = document.getElementById('v2-choose');
const stageCards = document.getElementById('v2-stage-cards');
const stageMount = document.getElementById('v2-stage-mount');
const crumb = document.getElementById('v2-crumb');

document.getElementById('v2-reset').addEventListener('click', () => { location.hash = ''; location.reload(); });

caseSelect.addEventListener('change', () => { startBtn.disabled = !caseSelect.value; });
startBtn.addEventListener('click', () => {
  if (!caseSelect.value) return;
  state.caseType = caseSelect.value;
  state.caseLabel = caseSelect.selectedOptions[0].textContent;
  state.reference.role = state.caseType === 'general' ? 'beneficiary' : 'applicant';
  startSection.hidden = true;
  caseSection.hidden = false;
  // DACA starts in Evidence Zero. General can go straight to any stage (D-95).
  if (state.caseType === 'general') { state.stage = null; renderCase(); }
  else openStage('evidence_zero');
});

// ── Stage state, shared by the tracker and the stage cards ──────────────────
function stepState(key, gateReady) {
  if (key === 'evidence_zero') {
    // General: Evidence Zero is optional (D-95); done once anything is in it.
    if (state.caseType === 'general') return (state.docs.length || state.reference.approvedAt) ? 'done' : 'todo';
    return gateReady ? 'done' : 'todo';
  }
  if (!gateReady) return 'locked';
  if (state.signedOff[key]) return 'done'; // staff sign-off (Max 2026-10-02)
  const run = state.runs[key];
  if (run === 'clear') return 'done';
  if (run === 'attention' || run === 'incomplete') return 'attention';
  return 'todo';
}

function statusKey(key, st) {
  if (state.stage === key) return 'track.current';
  if (key === 'preflight' && st === 'todo') return 'track.optional';
  if (key === 'evidence_zero' && st === 'todo' && state.caseType === 'general') return 'track.optional';
  if (st === 'done' && state.signedOff[key]) return 'track.signed';
  return `track.${st}`;
}

const ICON = {
  done: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  attention: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="12" r="1.2" fill="currentColor"/></svg>',
  locked: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};

// Fixed, trusted SVG strings only; nothing from data is ever parsed (D-41).
function dot(st, i) {
  const d = el('span', 'v2-step-dot');
  if (ICON[st]) d.innerHTML = ICON[st];
  else d.textContent = String(i);
  return d;
}

// ── Case header ─────────────────────────────────────────────────────────────
function summaryFact(parent, label, value, modifier = '') {
  // General has no fixed field set, so empty facts are left out instead of dashed.
  if (!value && state.caseType === 'general') return;
  const cell = el('div', `psr-fact${modifier ? ` psr-detail--${modifier}` : ''}`);
  cell.appendChild(el('div', 'psr-fact-k', label));
  cell.appendChild(el('div', 'psr-fact-v', value || '–'));
  parent.appendChild(cell);
}

function renderCaseTop() {
  caseTop.textContent = '';
  const ref = state.reference;
  // D-83: the case is a folder, named after its main person once known.
  // D-101: the folder names itself from the people (DACA "LAST, First"; General the
  // main names together), and is "New case" with the date until a name is known.
  const f = ref.fields;
  let name = '';
  if (state.caseType === 'general') {
    const lasts = [f.last_name.value, ...state.others.map((p) => p.fields.last_name.value)].filter(Boolean);
    name = [...new Set(lasts)].join(' & ');
  } else if (f.last_name.value) {
    name = [f.last_name.value, [f.first_name.value, f.middle_name.value].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
  if (!name) name = t('case.folder_new_dated', { date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
  const type = el('div', 'v2-case-type');
  type.appendChild(el('span', 'v2-case-folder', ''));
  type.lastChild.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>');
  type.appendChild(el('span', 'v2-case-type-v', name));
  type.appendChild(el('span', 'v2-pill v2-pill--type', state.caseLabel));
  caseTop.appendChild(type);
  const tags = el('div', 'v2-case-tags');
  const recordKey = !ref.approvedAt ? 'summary.not_approved' : ref.changedSinceApproval ? 'summary.changed' : 'summary.approved';
  // General can skip Evidence Zero (D-95), so an unapproved record is only worth showing for DACA.
  if (state.caseType !== 'general' || ref.approvedAt) tags.appendChild(el('span', `v2-pill v2-pill--${ref.approvedAt && !ref.changedSinceApproval ? 'ok' : 'muted'}`, t(recordKey)));
  if (ref.noEad) tags.appendChild(el('span', 'v2-pill v2-pill--warn', t('ref.noead.on')));
  caseTop.appendChild(tags);
}

function renderTracker(gateReady) {
  tracker.textContent = '';
  const list = el('ol', 'v2-track');
  STAGES.forEach((s, i) => {
    const st = stepState(s.key, gateReady);
    const current = state.stage === s.key;
    const optional = s.key === 'preflight' && st === 'todo';
    const li = el('li', `v2-step v2-step--${st}${current ? ' v2-step--current' : ''}${optional ? ' v2-step--optional' : ''}`);
    const b = el('button', 'v2-step-btn');
    b.type = 'button';
    b.disabled = st === 'locked';
    if (current) b.setAttribute('aria-current', 'step');
    b.appendChild(dot(st, i));
    b.appendChild(el('span', 'v2-step-name', t(`stage.${s.key}`)));
    const sk = statusKey(s.key, st);
    b.appendChild(el('span', 'v2-step-status', sk === 'track.todo' ? '\u00a0' : t(sk)));
    b.addEventListener('click', () => { if (!current) openStage(s.key, true); });
    li.appendChild(b);
    list.appendChild(li);
  });
  tracker.appendChild(list);
}

// D-99: in General every person gets an equal, full case card, side by side.
const srcText = (src) => {
  if (!src) return '';
  if (src.kind === 'scan') return t('people.from_scan');
  if (src.kind === 'forms') return t('people.from_forms');
  if (src.kind === 'doc') return t('ref.source.doc', { label: src.label });
  return t('ref.source.staff');
};

function personCard(role, fields, isMain) {
  const v = (k) => fields[k]?.value || '';
  const card = el('div', 'v2-person-card');
  const top = el('div', 'v2-person-top');
  top.appendChild(el('span', 'v2-pill v2-pill--role', t(`role.${role}`)));
  if (isMain) top.appendChild(el('span', 'v2-pill v2-pill--muted', t('people.main_tag')));
  card.appendChild(top);
  card.appendChild(el('div', 'v2-person-name', [v('first_name'), v('middle_name'), v('last_name')].filter(Boolean).join(' ') || t('people.unnamed')));
  const facts = el('div', 'v2-person-facts');
  const fact = (label, value) => {
    if (!value) return;
    const c = el('div', 'psr-fact');
    c.appendChild(el('div', 'psr-fact-k', label));
    const val = el('div', 'psr-fact-v');
    if (value instanceof Node) val.appendChild(value); else val.textContent = value;
    c.appendChild(val);
    facts.appendChild(c);
  };
  // D-100: every fact the evidence, forms or scan carried, in a fixed order.
  CARD_FACTS.forEach((k) => {
    if (k === 'ssn') { if (v('ssn')) fact(t('field.ssn'), ssnView(v('ssn'))); return; }
    if (k === 'address') {
      fact(t('field.address'), isMain ? formatAddress(Object.fromEntries(Object.entries(fields).map(([key, x]) => [key, x.value]))) : v('address'));
      return;
    }
    fact(t(`field.${k}`), DATE_FACTS.has(k) ? fmtDate(v(k)) : v(k));
  });
  card.appendChild(facts);
  const src = Object.values(fields).find((x) => x.value && x.source)?.source;
  if (src) card.appendChild(el('div', `v2-person-src v2-ref-source v2-src--${src.kind === 'doc' ? 'doc' : src.kind}`, srcText(src)));
  return card;
}

function renderPeopleCards() {
  const grid = el('div', 'v2-people-cards');
  grid.appendChild(personCard(state.reference.role, state.reference.fields, true));
  state.others.forEach((p) => grid.appendChild(personCard(p.role, p.fields, false)));
  summary.appendChild(grid);
}

function renderSummary() {
  summary.textContent = '';
  const f = Object.fromEntries(Object.entries(state.reference.fields).map(([k, v]) => [k, v.value]));
  if (state.caseType === 'general') {
    const anyone = Object.values(f).some(Boolean) || state.others.length;
    if (!anyone) { summary.appendChild(el('p', 'v2-summary-empty', t('summary.empty_general'))); return; }
    renderPeopleCards();
    return;
  }
  if (!Object.values(f).some(Boolean)) {
    summary.appendChild(el('p', 'v2-summary-empty', t('summary.empty')));
    return;
  }
  const strip = el('div', 'psr-summary-strip');
  summaryFact(strip, t('summary.name'), [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' '));
  summaryFact(strip, t('field.a_number'), f.a_number);
  summaryFact(strip, t('field.date_of_birth'), fmtDate(f.date_of_birth));
  summaryFact(strip, t('field.ead_expiration'), fmtDate(f.ead_expiration));
  summary.appendChild(strip);
  const details = el('div', 'psr-client-details');
  const ssnCell = el('div', 'psr-fact psr-detail--ssn');
  ssnCell.appendChild(el('div', 'psr-fact-k', t('field.ssn')));
  const ssnV = el('div', 'psr-fact-v');
  ssnV.appendChild(ssnView(f.ssn));
  ssnCell.appendChild(ssnV);
  details.appendChild(ssnCell);
  summaryFact(details, t('field.phone'), f.phone, 'phone');
  summaryFact(details, t('field.email'), f.email, 'email');
  summaryFact(details, t('ref.group.address'), formatAddress(f), 'address');
  summary.appendChild(details);
}

function renderChoice(gateReady) {
  choose.hidden = !(gateReady && !state.stage);
  if (choose.hidden) return;
  stageCards.textContent = '';
  STAGES.filter((s) => s.key !== 'evidence_zero').forEach((s, i) => {
    const st = stepState(s.key, gateReady);
    const card = el('button', `v2-stage-card v2-stage-card--${st}`);
    card.type = 'button';
    const top = el('span', 'v2-stage-card-top');
    top.appendChild(dot(st, i + 1));
    const sk = statusKey(s.key, st);
    if (sk !== 'track.todo') top.appendChild(el('span', 'v2-stage-card-status', t(sk)));
    card.appendChild(top);
    card.appendChild(el('span', 'v2-stage-name', t(`stage.${s.key}`)));
    card.appendChild(el('span', 'v2-stage-desc', t(`stage.${s.key}.desc`)));
    card.addEventListener('click', () => openStage(s.key, true));
    stageCards.appendChild(card);
  });
}

function renderCase() {
  if (!state.caseType) return;
  const gate = stageGate();
  renderCaseTop();
  renderTracker(gate.ready);
  renderSummary();
  renderChoice(gate.ready);
}

// ── Opening a stage ─────────────────────────────────────────────────────────
async function openStage(key, scroll = false) {
  state.stage = key;
  if (location.hash !== '#rulebook') crumb.textContent = t(`stage.${key}`);
  // A fresh holder per open, so a slow render from a stage already left can
  // only ever write into a detached node.
  const holder = el('div');
  stageMount.textContent = '';
  stageMount.appendChild(holder);
  stageMount.classList.remove('v2-stage-in');
  renderCase();
  await STAGES.find((s) => s.key === key).render(holder);
  renderCase();
  void stageMount.offsetWidth;
  stageMount.classList.add('v2-stage-in');
  if (scroll) caseSection.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// Other modules ask to move stage (e.g. "Edit the reference record").
document.addEventListener('v2-open-stage', (ev) => {
  if (!state.caseType) return;
  if (location.hash === '#rulebook') history.replaceState(null, '', '#scan');
  showView('scan');
  openStage(ev.detail, true);
});

document.addEventListener('v2-progress', renderCase);
document.addEventListener('v2-reference-changed', renderCase);

// Approving a ready record leaves Evidence Zero for the stage choice (D-67).
document.addEventListener('v2-record-approved', () => {
  if (!stageGate().ready) return; // stays put; Evidence Zero shows what is missing
  state.stage = null;
  stageMount.textContent = '';
  crumb.textContent = '';
  renderCase();
  caseSection.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

// ── Views: Proof Scan and the Rulebook (D-61) ───────────────────────────────
const views = { scan: document.getElementById('v2-view-scan'), rulebook: document.getElementById('v2-view-rulebook') };

function showView(name) {
  Object.entries(views).forEach(([k, n]) => { n.hidden = k !== name; });
  document.querySelectorAll('.sidebar-nav [data-view]').forEach((a) => {
    const on = a.dataset.view === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (name === 'rulebook') {
    crumb.textContent = t('nav.rulebook');
    renderRulebook(views.rulebook);
  } else {
    crumb.textContent = state.stage ? t(`stage.${state.stage}`) : '';
  }
}

window.addEventListener('hashchange', () => showView(location.hash === '#rulebook' ? 'rulebook' : 'scan'));
showView(location.hash === '#rulebook' ? 'rulebook' : 'scan');
