// Fixture harness for the "Possible issues" component. NOT PRODUCTION CODE.
//
// It imports the REAL production component from /pages/proof-scan/exploration.js
// and drives it with mock callbacks so the pending, success, failure and
// "no handler wired" paths can be seen by eye. Nothing here is imported by the
// portal, and test/ is listed in .assetsignore, so this file is never deployed.
//
// The lab's fictional findings and simulated success handlers are deliberately
// NOT reproduced. Everything below is obviously-fake harness data, and the mock
// handlers do exactly what a real one would: resolve, reject, or take a while.

import { renderExploration } from '/pages/proof-scan/exploration.js';

// Query parameters let a headless browser capture a specific state:
//   ?data=hostile&handlers=slow&mode=dark&open=1&evidence=1&dismiss=1&click=accept
// They only drive the harness controls; the component itself has no such input.
const params = new URLSearchParams(location.search);

const mount = document.getElementById('harness-mount');
const modeSelect = document.getElementById('harness-mode');
const dataSelect = document.getElementById('harness-data');
const log = document.getElementById('harness-log');

// ── Harness fixtures ─────────────────────────────────────────────────────────

const SAMPLE = {
  schema_version: 1,
  suggestions: [
    {
      suggestion_id: 'harness-address-mismatch',
      title: 'Possible address inconsistency',
      description: 'Two documents in this package give different mailing addresses. '
        + 'That may be intentional, but the difference is not explained anywhere.',
      evidence_label: 'Application, page 2 ↔ Supporting statement, page 1',
      evidence_text: 'Application: 124 Oak Street\nSupporting statement: 124 Oak Avenue',
    },
    {
      suggestion_id: 'harness-date-mismatch',
      title: 'A date may need a second look',
      description: 'The cover letter and the attached statement give different dates '
        + 'for what looks like the same event.',
      evidence_label: 'Cover letter, page 1 ↔ Supporting statement, page 2',
      evidence_text: 'Cover letter: June 12\nSupporting statement: June 21',
    },
    {
      suggestion_id: 'harness-no-evidence',
      title: 'A suggestion with no evidence excerpt',
      description: 'This one carries no excerpt, so no evidence link should appear.',
      evidence_label: 'ignored because there is no excerpt',
      evidence_text: null,
    },
  ],
};

// Every field carries markup and control characters. Nothing may execute or
// render as HTML — it must all appear as literal characters on the page.
const HOSTILE = {
  schema_version: 1,
  suggestions: [
    {
      suggestion_id: '<img src=x onerror=alert(1)>',
      title: '<script>alert("title")</script> & "quoted" \'apostrophed\'',
      description: '<iframe src="https://evil.example"></iframe> <b>not bold</b>',
      evidence_label: '<a href="javascript:alert(1)">click</a>',
      evidence_text: '<style>body{display:none}</style>\n<svg onload=alert(1)></svg>',
    },
  ],
};

const MALFORMED = {
  schema_version: 1,
  suggestions: [
    null,
    'a string',
    42,
    [],
    { title: 'no id' },
    { suggestion_id: 'no-title' },
    { suggestion_id: '   ', title: '   ' },
    { suggestion_id: 'dup', title: 'Kept — the one valid entry' },
    { suggestion_id: 'dup', title: 'Dropped as a duplicate id' },
  ],
};

const DATA_SETS = {
  sample: SAMPLE,
  hostile: HOSTILE,
  malformed: MALFORMED,
  empty: { schema_version: 1, suggestions: [] },
  'wrong-version': { schema_version: 99, suggestions: SAMPLE.suggestions },
  none: undefined,
};

// ── Mock handlers ────────────────────────────────────────────────────────────

const note = (message) => {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  log.prepend(line);
};

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function handlersFor(mode) {
  // "none" returns {} — exactly what production returns today, so the harness can
  // show the honest "not saved" messaging.
  if (mode === 'none') return {};

  const behave = async (payload) => {
    note(`${payload.action} → ${payload.suggestion_id}${payload.reason_id ? ` (${payload.reason_id})` : ''}`);
    if (mode === 'slow') await delay(1500);
    if (mode === 'failure') throw new Error('harness: simulated handler failure');
    if (mode === 'false') return false;
    return true;
  };

  return { onAccept: behave, onDismiss: behave, onNominateRule: behave };
}

// ── Render ───────────────────────────────────────────────────────────────────

function draw() {
  mount.textContent = '';
  const section = renderExploration(DATA_SETS[dataSelect.value], {
    handlers: handlersFor(modeSelect.value),
  });
  if (section) {
    mount.appendChild(section);
  } else {
    const empty = document.createElement('p');
    empty.className = 'harness-empty';
    empty.textContent = 'renderExploration() returned null — the section is hidden, '
      + 'which is the production behaviour when no supported suggestion data is supplied.';
    mount.appendChild(empty);
  }
  note(`rendered: data=${dataSelect.value} handlers=${modeSelect.value}`);
  reportOverflow();
}

// Layout readout for responsive checks. Reports whether anything is wider than
// the viewport — the component, or the page as a whole.
function reportOverflow() {
  requestAnimationFrame(() => {
    const viewport = document.documentElement.clientWidth;
    const section = mount.querySelector('.ps-explore');
    const widest = [...mount.querySelectorAll('*')]
      .reduce((max, node) => Math.max(max, node.getBoundingClientRect().right), 0);
    // The real question on a phone is whether anything escapes the report card,
    // not just the viewport — the harness page has slack the portal will not.
    const bounds = section ? section.getBoundingClientRect().right : 0;
    note(`viewport=${viewport} docScrollWidth=${document.documentElement.scrollWidth} `
      + `sectionRight=${Math.round(bounds)} widestRight=${Math.round(widest)} `
      + `escapesCard=${widest > bounds + 1 ? 'YES' : 'no'} `
      + `overflow=${document.documentElement.scrollWidth > viewport ? 'YES' : 'no'}`);

    // Reduced-motion readout: what the browser reports, and what the component's
    // controls actually compute to under that preference.
    const control = mount.querySelector('.ps-explore-control');
    const chevron = mount.querySelector('.ps-explore-head');
    if (control) {
      note(`reducedMotion=${matchMedia('(prefers-reduced-motion: reduce)').matches} `
        + `controlTransition="${getComputedStyle(control).transitionProperty}" `
        + `chevronTransition="${getComputedStyle(chevron, '::after').transitionProperty}"`);
    }
  });
}

document.getElementById('harness-theme').addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-mode') === 'dark';
  document.documentElement.setAttribute('data-mode', dark ? 'light' : 'dark');
});

modeSelect.addEventListener('change', draw);
dataSelect.addEventListener('change', draw);
document.getElementById('harness-redraw').addEventListener('click', draw);

// ── Query-driven state, for headless capture ─────────────────────────────────

if (params.get('mode') === 'dark') document.documentElement.setAttribute('data-mode', 'dark');
// Headless Chrome will not open a window narrower than ~500px, so a true phone
// width is reproduced by constraining the container instead.
if (params.has('width')) {
  const wrap = document.querySelector('.harness-wrap');
  wrap.style.maxWidth = `${params.get('width')}px`;
  wrap.style.marginLeft = '0';
}
if (params.has('data')) dataSelect.value = params.get('data');
if (params.has('handlers')) modeSelect.value = params.get('handlers');

draw();

const first = (selector) => mount.querySelector(selector);

if (params.has('open')) {
  const fold = first('.ps-explore');
  if (fold) fold.open = true;
}
if (params.has('evidence')) first('.ps-explore-source')?.click();
if (params.has('dismiss')) {
  const fold = first('.ps-explore-dismiss');
  if (fold) fold.open = true;
}
if (params.has('focus')) first(params.get('focus') || '.ps-explore-accept')?.focus();
if (params.has('click')) {
  const target = params.get('click') === 'dismiss-choice'
    ? first('.ps-explore-choice')
    : first(`.ps-explore-${params.get('click')}`);
  target?.click();
}
