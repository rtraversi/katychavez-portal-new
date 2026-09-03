// report.js — draws a validated, server-composed Proof Scan result.
//
// Derived from the approved UI Lab renderer, with the lab's diagnostic sections
// removed and its fixture composition replaced by the production contract.
//
// Two hard rules, both load-bearing:
//   1. This renderer receives DATA that the server already validated and composed.
//      It never parses model HTML, never reads a verdict out of prose, and has no
//      way to show a severity or a title a profile did not define.
//   2. Every value that came from the uploaded package — names, evidence, reasons —
//      reaches the page through textContent on a node this file created. There is
//      no innerHTML path, so evidence containing "<script>" is drawn as the
//      characters "<script>".
//
// Presentation decisions carried over from the lab review: problems first; a
// cleared check is one line, never a paragraph; the form name is a heading rather
// than a prefix on every row; rule IDs stay in the DOM as metadata, off the page.

// No imports: the controller loads this and report-model.js as two separately
// versioned dynamic imports, so neither can be served stale relative to the other.
// It builds the model with report-model.js and hands the result straight to
// renderReport below.

const STAFF_REVIEW_REMINDER = 'Staff review is still required before filing.';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The only node factory in this file. `text` always goes through textContent.
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// <details> opens instantly, which reads as cheap next to everything else. Drive
// open/close so the body can animate, keeping a real <details> so keyboard
// behaviour and aria-expanded are untouched.
function animateDisclosure(details, body) {
  const summary = details.querySelector('summary');
  summary.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (reduceMotion()) { details.open = !details.open; return; }
    const settle = () => { body.style.height = ''; body.style.opacity = ''; };
    if (details.open) {
      body.style.height = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.height = '0px'; body.style.opacity = '0'; });
      body.addEventListener('transitionend', function done() {
        body.removeEventListener('transitionend', done); details.open = false; settle();
      }, { once: true });
    } else {
      details.open = true;
      const h = body.scrollHeight;
      body.style.height = '0px'; body.style.opacity = '0';
      requestAnimationFrame(() => { body.style.height = h + 'px'; body.style.opacity = '1'; });
      body.addEventListener('transitionend', function done() {
        body.removeEventListener('transitionend', done); settle();
      }, { once: true });
    }
  });
}

function block(label, count, cls) {
  const wrap = el('section', 'psr-block' + (cls ? ' ' + cls : ''));
  const head = el('h3', 'psr-block-head');
  head.appendChild(el('span', null, label));
  if (count != null) head.appendChild(el('span', 'psr-count', String(count)));
  wrap.appendChild(head);
  return wrap;
}

// ONE row shape for every check, cleared or not — same size, same position, same
// order every run. State changes the mark and the colour, nothing else.
function checkRow(item) {
  const row = el('div', `psr-check psr-check--${item.status}`);
  row.dataset.ruleId = item.rule_id;           // metadata for debugging, not staff copy
  row.title = item.rule_id;
  row.appendChild(el('span', 'psr-check-mark',
    item.status === 'clear' ? '✓' : item.status === 'not_checked' ? '?' : '!'));
  row.appendChild(el('span', 'psr-check-text', item.line));
  if (item.where) row.appendChild(el('span', 'psr-where', item.where));
  return row;
}

// A notice collapses to one line and opens to its detail.
function notice(item) {
  const wrap = el('details', `psr-notice psr-notice--${item.status}`);
  if (item.id) wrap.dataset.itemId = item.id;

  const sum = el('summary', 'psr-notice-head');
  sum.appendChild(el('span', 'psr-check-mark', item.status === 'not_checked' ? '?' : '!'));

  // House pattern for a finding is two sentences: what is wrong, then what it
  // should be. Bold the first, leave the second normal, so the line has a shape.
  const text = el('span', 'psr-check-text');
  const cut = item.headline.search(/(?<=\.)\s+/);
  if (cut > 0) {
    text.appendChild(el('strong', null, item.headline.slice(0, cut)));
    text.appendChild(el('span', 'psr-rest', ' ' + item.headline.slice(cut).trim()));
  } else {
    text.appendChild(el('strong', null, item.headline));
  }
  sum.appendChild(text);
  if (item.severity && item.status === 'needs_attention') {
    sum.appendChild(el('span', `psr-sev psr-sev--${item.severity}`, item.severity));
  }
  sum.setAttribute('aria-expanded', 'false');
  wrap.addEventListener('toggle', () => sum.setAttribute('aria-expanded', String(wrap.open)));
  wrap.appendChild(sum);

  const body = el('div', 'psr-notice-body');
  const fact = (key, value) => {
    if (!value) return;
    const row = el('div', 'psr-nf');
    row.appendChild(el('span', 'psr-nf-k', key));
    row.appendChild(el('span', 'psr-nf-v', value));
    body.appendChild(row);
  };
  fact('Expected', item.expected);
  fact('Where', item.where);
  fact('Why it could not be checked', item.status === 'not_checked' ? item.reason : null);
  fact('Observed', item.status === 'needs_attention' ? item.reason : null);
  if (item.evidence) body.appendChild(el('div', 'psr-evidence', item.evidence));

  // Checks that could not run because this form is absent. They live here, on the
  // one actionable issue, rather than as separate headlines or counts of their own.
  if (item.blocked?.length) {
    const n = item.blocked.length;
    body.appendChild(el('div', 'psr-blocked-head',
      `${n} dependent ${n === 1 ? 'check' : 'checks'} could not run without this form:`));
    const list = el('ul', 'psr-blocked');
    for (const blocked of item.blocked) {
      const li = el('li', null, blocked.title);
      li.dataset.ruleId = blocked.rule_id;
      list.appendChild(li);
    }
    body.appendChild(list);
  }

  wrap.appendChild(body);
  animateDisclosure(wrap, body);
  return wrap;
}

// `d` is the output of buildReportModel() — already validated by the server and
// already shaped. Nothing below re-derives a status, a count, or a verdict.
export function renderReport(d, mount) {
  mount.textContent = '';

  // ── 1. Client summary, from the uploaded package only ──────────────────────
  const strip = el('div', 'psr-summary-strip');
  for (const fact of d.client.primary) {
    const cell = el('div', 'psr-fact');
    cell.appendChild(el('div', 'psr-fact-k', fact.key));
    cell.appendChild(el('div', 'psr-fact-v', fact.value));
    strip.appendChild(cell);
  }
  mount.appendChild(strip);

  if (d.client.secondary.length) {
    const details = el('div', 'psr-client-details');
    for (const fact of d.client.secondary) {
      const cell = el('div', `psr-fact psr-detail--${fact.modifier}`);
      cell.appendChild(el('div', 'psr-fact-k', fact.key));
      cell.appendChild(el('div', 'psr-fact-v', fact.value));
      details.appendChild(cell);
    }
    mount.appendChild(details);
  }

  // ── 2. File, scan type, date, and the server's derived report language ─────
  const head = el('div', 'psr-head');
  const left = el('div');
  left.appendChild(el('div', 'psr-file', d.scan.filename));
  left.appendChild(el('div', 'psr-casetype', d.scan_type_label || '—'));
  head.appendChild(left);

  const right = el('div', 'psr-head-right');
  if (d.scan.scanned_at) {
    const when = new Date(d.scan.scanned_at);
    if (!Number.isNaN(when.valueOf())) {
      right.appendChild(el('div', 'psr-scanned',
        when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
    }
  }
  // Verbatim from the server. There is no branch here that can invent a verdict.
  const tone = d.report_state === 'items_need_attention' ? 'attention'
    : d.report_state === 'review_incomplete' ? 'incomplete' : 'clear';
  right.appendChild(el('div', `psr-verdict psr-verdict--${tone}`, d.primary_report_language));

  const toggleAll = el('button', 'psr-toggle-all');
  toggleAll.type = 'button';
  toggleAll.textContent = 'Expand all';
  toggleAll.addEventListener('click', () => {
    const open = toggleAll.textContent === 'Expand all';
    mount.querySelectorAll('details').forEach((x) => { x.open = open; });
    toggleAll.textContent = open ? 'Collapse all' : 'Expand all';
  });
  right.appendChild(toggleAll);
  head.appendChild(right);
  mount.appendChild(head);

  // ── 3. Needs attention ─────────────────────────────────────────────────────
  if (d.needs_attention.length) {
    const b = block('Needs attention', d.needs_attention.length);
    d.needs_attention.forEach((i) => b.appendChild(notice(i)));
    mount.appendChild(b);
  }

  // ── 4. Included in the scan ────────────────────────────────────────────────
  if (d.included.length) {
    const b = block('Included in the scan');
    const table = el('table', 'psr-table');
    for (const row of d.included) {
      const tr = el('tr', row.ok ? null : 'psr-tr--bad');
      const name = el('td', 'psr-td-form');
      name.appendChild(el('span', null, row.form));
      if (row.instance) name.appendChild(el('span', 'psr-instance', ' ' + row.instance));
      tr.appendChild(name);
      tr.appendChild(el('td', 'psr-td-label', row.label || ''));
      tr.appendChild(el('td', 'psr-td-tick', row.ok ? '✓' : row.status === 'not_checked' ? '?' : '✕'));
      table.appendChild(tr);
    }
    b.appendChild(table);
    mount.appendChild(b);
  }

  // ── 5. Checks, one group per form, every check always listed ───────────────
  if (d.groups.length) {
    const b = block('Checks');
    for (const g of d.groups) {
      const clean = g.cleared === g.total;
      const fold = el('details', 'psr-fold' + (clean ? ' psr-fold--clean' : ' psr-fold--bad'));
      const sum = el('summary', 'psr-fold-head');
      sum.appendChild(el('span', 'psr-fold-form', g.form));
      sum.appendChild(el('span', `psr-fold-meta psr-fold-meta--${clean ? 'ok' : 'bad'}`,
        clean ? `all ${g.total} cleared` : `${g.cleared}/${g.total} cleared`));
      sum.setAttribute('aria-expanded', 'false');
      fold.addEventListener('toggle', () => sum.setAttribute('aria-expanded', String(fold.open)));
      fold.appendChild(sum);

      // The width is the truth; the sweep is a transform, so a dropped frame
      // changes nothing about what the bar reports.
      const bar = el('div', 'psr-bar');
      const fill = el('span', `psr-bar-fill psr-bar-fill--${clean ? 'ok' : 'bad'}`);
      fill.style.width = `${g.total ? Math.round((g.cleared / g.total) * 100) : 0}%`;
      bar.appendChild(fill);
      fold.appendChild(bar);

      // Named while closed; hidden once open, because the rows below say it.
      if (!clean) {
        const names = el('div', 'psr-outstanding');
        for (const i of g.outstanding) {
          const tag = el('span', `psr-out psr-out--${i.status}`);
          tag.appendChild(el('span', 'psr-out-mark', i.status === 'not_checked' ? '?' : '!'));
          tag.appendChild(el('span', null, i.line));
          names.appendChild(tag);
        }
        fold.appendChild(names);
      }

      const body = el('div', 'psr-fold-body');
      g.items.forEach((i) => body.appendChild(checkRow(i)));
      fold.appendChild(body);
      animateDisclosure(fold, body);
      b.appendChild(fold);
    }
    mount.appendChild(b);
  }

  // ── 6. Not checked — only when something is genuinely unevaluated. Checks
  //       suppressed by a missing form are not here; they sit on that form's own
  //       entry above, so one missing document is one issue, not eight.
  if (d.not_checked.length) {
    const b = el('section', 'psr-block');
    const fold = el('details', 'psr-fold psr-fold--muted');
    const sum = el('summary', 'psr-fold-head');
    sum.appendChild(el('span', 'psr-fold-form', 'Not checked'));
    sum.appendChild(el('span', 'psr-fold-meta psr-fold-meta--muted', String(d.not_checked.length)));
    sum.setAttribute('aria-expanded', 'false');
    fold.addEventListener('toggle', () => sum.setAttribute('aria-expanded', String(fold.open)));
    fold.appendChild(sum);
    const body = el('div', 'psr-fold-body');
    d.not_checked.forEach((i) => body.appendChild(notice(i)));
    fold.appendChild(body);
    animateDisclosure(fold, body);
    b.appendChild(fold);
    mount.appendChild(b);
  }

  // ── 7. The reminder, on every report, in every state ───────────────────────
  mount.appendChild(el('p', 'psr-standing-note', STAFF_REVIEW_REMINDER));
}
