// review.js: Draft Review and Pre-flight (D-56, D-57, D-47, D-50, D-16).
//
// Both stages share one flow: choose a scope, add sample files, review. What
// differs is written down here, each with its decision:
//   Draft Review  a missing required form is one attention item (D-56);
//                 information not obtained yet is "needs info", never counted (D-47).
//   Pre-flight    missing expected final evidence is a light notification (D-57);
//                 any other missing reference value is Open: Q-46.
// Which checks are active, pending, or not applicable at each stage is NOT
// decided (Q-44). It is read from stage-map.sample.json and bannered as such.
import { el, t, button, openTag, loadJSON, loadRules, isEvidence, itemKey, reportState, findingText, dropZone, scanButton, reveal, signOff, fmtDate, shownSsn } from '/v2-lab/ui.js';
import { state, sameValue, nextId, personByRole, newPerson, setField, PERSON_FIELDS } from '/v2-lab/state.js';
import { matchEvidence, matchItems, renderMatchBlock, crossFormRows, crossFormItems, renderCrossBlock } from '/v2-lab/evidence-match.js';
import { renderPossibleIssues } from '/v2-lab/possible-issues.js';
import { renderEmail } from '/v2-lab/email.js';

// D-47 "our errors": inconsistencies across the package. The three base
// consistency rules are that, everything else configured is a checklist item.
const CONSISTENCY = new Set(['PS-301', 'PS-302', 'PS-303']);
const DATE_KEYS = new Set(['date_of_birth', 'ead_expiration', 'marriage_date', 'i94_expiry', 'last_entry_date']);

const FIXTURES = {
  draft_review: ['dr-combined.json', 'dr-separate.json'],
  preflight:    ['pf-package.json', 'pf-complete.json'],
};
const INDIVIDUAL_SOURCE = { draft_review: 'dr-separate.json', preflight: 'pf-package.json' };
// D-93: General runs the firm-wide checks only, with no expected-forms list.
const GENERAL_FIXTURES = { draft_review: ['gen-package.json'], preflight: ['gen-package.json'] };
export const GENERAL_CHECKLIST = { case_type: { key: 'general', label: 'General' }, composition: [], rules: [] };

function section(title) {
  const wrap = el('div', 'dk-sec');
  const head = el('div', 'dk-sec-head');
  head.appendChild(el('h2', null, title));
  head.appendChild(el('span', 'dk-sec-rule'));
  wrap.appendChild(head);
  const body = el('div');
  wrap.appendChild(body);
  return { wrap, body };
}

// ── Evaluation ──────────────────────────────────────────────────────────────
function evaluate({ base, checklist, stageMap, stageKey, fixture, scope, formKey, corrections }) {
  // Max 2026-10-02: departures are checked in Pre-flight only if the client marked any.
  const departuresMarked = Boolean(corrections?.corrections.some((c) => c.field === 'departures'));
  const forms = checklist.composition.filter((c) => !isEvidence(c));
  const filed = new Set(checklist.composition.map((c) => c.form));
  const singlePage = new Set(checklist.composition.filter((c) => (c.pages || 1) === 1).map((c) => c.form));
  const selForm = scope === 'individual' ? forms.find((c) => itemKey(c) === formKey)?.form : null;

  const identified = scope === 'whole' ? fixture.forms_identified.map((f) => f.key) : [formKey];
  const identifiedForms = new Set(identified.map((k) => forms.find((c) => itemKey(c) === k)?.form).filter(Boolean));
  const missingForms = scope === 'whole' ? forms.filter((c) => !identified.includes(itemKey(c))) : [];
  const missingEvidence = scope === 'whole'
    ? checklist.composition.filter(isEvidence).filter((c) => !(fixture.evidence_identified || []).includes(itemKey(c)))
    : [];

  // Same rule set compose.js builds for 1.2: base + case type, PDF-checkable,
  // and never a rule for a form this case type does not file.
  let rules = [...base.rules, ...checklist.rules]
    .map((r) => ({ ...r, ...(state.ruleEdits[r.rule_id] || {}) })) // rulebook edits (Max 2026-10-02)
    .filter((r) => r.check === 'pdf')
    .filter((r) => !r.form || filed.has(r.form));
  // Individual review ignores the rest of the package (D-56), so the
  // across-the-package consistency rules do not apply to it.
  if (scope === 'individual') rules = rules.filter((r) => (r.form ? r.form === selForm : !CONSISTENCY.has(r.rule_id)));
  // D-21: a missing form is one item. Its own checks are not repeated.
  rules = rules.filter((r) => !r.form || identifiedForms.has(r.form));

  const buckets = { active: [], if_filled: [], pending: [], not_applicable: [], unmapped: [] };
  rules.forEach((r) => {
    const entry = stageMap.entries.find((e) => e.rule_id === r.rule_id);
    let key = entry?.[stageKey];
    if (key === 'if_marked') key = departuresMarked ? 'active' : 'not_applicable';
    (buckets[key] || buckets.unmapped).push({ rule: r, entry });
  });

  const overlay = fixture.results || {};
  const active = [...buckets.active, ...buckets.if_filled].map(({ rule: r, entry }) => {
    // A stage may narrow what a check looks at (e.g. I-765WS at Draft Review).
    const st = entry?.stage_text?.[stageKey] || {};
    let o = overlay[r.rule_id] || {};
    if (scope === 'individual' && !r.form && o.form !== selForm) o = {};
    let status = o.status || 'pass';
    // Max 2026-10-02: "N" checks are only judged when filled in; blank is needs info.
    if (status === 'blank') status = entry?.[stageKey] === 'if_filled' ? 'needs_info' : 'needs_attention';
    // Max 2026-10-02: an English answer of NO is a gentle "was this intended?", not an error.
    if (status === 'needs_attention' && entry?.gentle_if_no && stageKey === 'draft_review') status = 'confirm';
    return {
      rule_id: r.rule_id, status, severity: r.severity, form: r.form || null,
      title: status === 'pass' ? (st.pass_text || r.pass_text || r.title) : (o.summary || st.title || r.title),
      reason: o.reason || '', expected: st.expected || r.expected || '', note: r.note || '',
      where: [singlePage.has(r.form) || r.page == null ? null : `p.${r.page}`, r.item ? `item ${r.item}` : null].filter(Boolean).join(' · '),
      consistency: CONSISTENCY.has(r.rule_id),
    };
  });

  // Reference record vs draft (D-16). A comparison, never a rule.
  const mismatches = [];
  const needsInfo = new Map();   // field -> [form keys]   (Draft Review, D-47)
  const noReference = new Map(); // field -> [form keys]   (Pre-flight, Q-46)
  identified.forEach((key) => {
    // D-94: each form is compared with the person it is about, never with someone else.
    const entries = fixture.forms?.[key] || {};
    const person = personByRole(entries._person || state.reference.role);
    if (!person) return; // no case card for that person yet: nothing to compare against
    const ref = person.fields;
    Object.entries(entries).filter(([field]) => field !== '_person').forEach(([field, { value, where }]) => {
      // Values copied from draft forms are never the truth the forms are checked against (D-79, D-99).
      const rv = ref[field]?.source?.kind === 'forms' ? '' : ref[field]?.value;
      if (!rv) {
        // D-11: no basis for truth. Consistency across forms is still checked.
        if (stageKey === 'preflight') (noReference.get(field) || noReference.set(field, []).get(field)).push(key);
        else if (!value) (needsInfo.get(field) || needsInfo.set(field, []).get(field)).push(key);
        return;
      }
      const pending = state.proposals.some((p) => p.field === field && sameValue(field, p.value, value));
      if (!sameValue(field, rv, value) && !pending) {
        mismatches.push({ field, formKey: key, draft: value, where, ref: rv, source: ref[field].source, role: person.id === 'main' && state.caseType !== 'general' ? null : person.role });
      }
    });
  });

  const consistencyAttention = active.filter((i) => i.consistency && i.status === 'needs_attention');
  const checklistAttention = active.filter((i) => !i.consistency && i.status === 'needs_attention');
  const countedMissing = stageKey === 'draft_review' ? missingForms : [];
  const attention = consistencyAttention.length + mismatches.length + checklistAttention.length + countedMissing.length;
  const notChecked = active.filter((i) => i.status === 'not_checked');
  const needsInfoChecks = active.filter((i) => i.status === 'needs_info');
  const confirms = active.filter((i) => i.status === 'confirm');

  return {
    stageKey, scope, fixture, formKey, forms, identified,
    missingForms, missingEvidence, active, buckets, mismatches, needsInfo, noReference,
    consistencyAttention, checklistAttention, notChecked, needsInfoChecks, confirms,
    state: reportState(attention, notChecked.length),
    attention,
  };
}

// ── Pre-flight corrections check (Max 2026-10-02) ────────────────────────────
// Compares the client's pen markups with the retyped pages. Handwriting goes
// through OCR, so an unclear read is never called wrong; it asks for a look.
// Max 2026-10-02: the firm leaves the country off US addresses on purpose, so a
// client writing it in is not a missed correction. (The I-90 differs; not in scope.)
const FIELD_RULE = {
  first_name: 'PS-301', middle_name: 'PS-301', last_name: 'PS-301', a_number: 'PS-302',
  street: 'PS-303', apt_type: 'PS-303', apt_number: 'PS-303', city: 'PS-303', state: 'PS-303', zip: 'PS-303',
};
const US_COUNTRY = /^(united states( of america)?|usa?|u\.s\.(a\.)?)$/i;

function evaluateCorrections(fix, pkg) {
  if (!fix) return null;
  const rows = fix.corrections.map((c) => {
    let status;
    // Max 2026-10-02: a form the client marked up must come back corrected.
    if (c.corrected == null) status = 'no_page';
    else if (c.markup_read !== 'clear') status = 'unclear';
    else if (c.field === 'country' && US_COUNTRY.test(c.markup.trim()) && !c.corrected) status = 'omitted_ok';
    else if (sameValue(c.field, c.corrected, c.original)) status = 'not_fixed';
    else if (sameValue(c.field, c.corrected, c.markup)) status = 'fixed';
    else status = 'differs';
    return { ...c, status };
  });

  // D-55: a fixed correction is proposed to the reference record, never written.
  let sent = 0;
  rows.filter((c) => c.status === 'fixed' && state.reference.fields[c.field]).forEach((c) => {
    if (sameValue(c.field, state.reference.fields[c.field].value, c.corrected)) return;
    state.proposals = state.proposals.filter((p) => p.field !== c.field);
    state.proposals.push({ id: nextId('prop'), field: c.field, value: c.corrected, docId: null, label: t('pf.corr.source', { form: c.form, page: c.page }) });
    sent += 1;
  });
  // Max 2026-10-02: "if we changed the address on the 821d we MUST have changed it on
  // all the others." A fixed value still old on another form counts as attention.
  // Individual review ignores the rest of the package (D-56), so pkg is null there.
  const carried = [];
  if (pkg) rows.filter((c) => c.status === 'fixed').forEach((c) => {
    Object.entries(pkg.forms || {}).forEach(([form, fields]) => {
      const v = fields[c.field];
      if (form === c.form || !v?.value) return;
      if (!sameValue(c.field, v.value, c.corrected)) carried.push({ ...c, status: 'not_carried', other: form, otherValue: v.value, otherWhere: v.where || '' });
    });
  });
  return { fix, rows: [...rows, ...carried], sent };
}

function renderCorrections(cr, mount) {
  const look = cr.rows.filter((c) => ['not_fixed', 'not_carried', 'no_page'].includes(c.status)).length;
  const b = block(t('pf.corr.heading'), look, 'v2-corrections');
  b.appendChild(el('p', 'v2-block-note', t('pf.corr.note')));
  const MARK = { fixed: '✓', not_fixed: '!', not_carried: '!', no_page: '!', differs: '!', unclear: '?', omitted_ok: '✓' };
  cr.rows.forEach((c) => {
    const vars = { form: c.form, page: c.page, field: t(`field_in.${c.field}`), original: c.original, markup: c.markup, corrected: c.corrected, other: c.other, other_value: c.otherValue, other_where: c.otherWhere };
    const row = el('div', `v2-corr v2-corr--${c.status}`);
    row.appendChild(el('span', 'v2-corr-mark', MARK[c.status]));
    row.appendChild(findingText(t(`pf.corr.${c.status}`, vars)));
    row.appendChild(el('span', 'v2-corr-tag', t(`pf.corr.tag.${c.status}`)));
    b.appendChild(row);
  });
  if (cr.sent) {
    const line = el('p', 'v2-block-note v2-corr-sent', t('pf.corr.sent', { n: cr.sent }));
    line.appendChild(button(t('pf.corr.review_ez'), 'v2-link', openReference));
    b.appendChild(line);
  }
  mount.appendChild(b);
}

// ── Rendering, in the 1.2 report's own classes and row shapes ───────────────
function block(label, count, cls) {
  const wrap = el('section', 'psr-block' + (cls ? ' ' + cls : ''));
  const head = el('h3', 'psr-block-head');
  head.appendChild(el('span', null, label));
  if (count != null) head.appendChild(el('span', 'psr-count', String(count)));
  wrap.appendChild(head);
  return wrap;
}

function notice(status, title, facts = [], severity, extra) {
  const wrap = el('details', `psr-notice psr-notice--${status}`);
  const sum = el('summary', 'psr-notice-head');
  sum.appendChild(el('span', 'psr-check-mark', status === 'not_checked' ? '?' : '!'));
  sum.appendChild(findingText(title));
  if (severity && status === 'needs_attention') sum.appendChild(el('span', `psr-sev psr-sev--${severity}`, severity));
  wrap.appendChild(sum);
  const body = el('div', 'psr-notice-body');
  facts.filter(([, v]) => v).forEach(([k, v]) => {
    const r = el('div', 'psr-nf');
    r.appendChild(el('span', 'psr-nf-k', k));
    r.appendChild(el('span', 'psr-nf-v', v));
    body.appendChild(r);
  });
  if (extra) body.appendChild(extra);
  wrap.appendChild(body);
  return wrap;
}

const MARKS = { pass: '✓', not_checked: '?', needs_info: '·', confirm: 'i' };
const markOf = (status) => MARKS[status] || '!';

function checkRow(i) {
  const row = el('div', `psr-check psr-check--${i.status}`);
  row.title = i.rule_id;
  row.appendChild(el('span', 'psr-check-mark', markOf(i.status)));
  row.appendChild(el('span', 'psr-check-text', i.title));
  if (i.where) row.appendChild(el('span', 'psr-where', i.where));
  return row;
}

function fold(label, items) {
  // Needs info and "please confirm" are not failures, so they never turn a form amber.
  const soft = (i) => i.status === 'pass' || i.status === 'needs_info' || i.status === 'confirm';
  const cleared = items.filter((i) => i.status === 'pass').length;
  const total = items.length;
  const clean = items.every(soft);
  const f = el('details', 'psr-fold' + (clean ? ' psr-fold--clean' : ' psr-fold--bad'));
  const sum = el('summary', 'psr-fold-head');
  sum.appendChild(el('span', 'psr-fold-form', label));
  sum.appendChild(el('span', `psr-fold-meta psr-fold-meta--${clean ? 'ok' : 'bad'}`,
    clean ? (cleared === total ? t('r12.all_cleared', { n: total }) : t('review.cleared_soft', { a: cleared, b: total - cleared })) : t('r12.some_cleared', { a: cleared, b: total })));
  f.appendChild(sum);
  const bar = el('div', 'psr-bar');
  const fill = el('span', `psr-bar-fill psr-bar-fill--${clean ? 'ok' : 'bad'}`);
  fill.style.width = `${Math.round((cleared / total) * 100)}%`;
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

function mutedFold(label, count, rows) {
  const s = el('section', 'psr-block');
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

const sourceText = (src) => (src?.kind === 'doc' ? t('ref.source.doc', { label: src.label }) : t('ref.source.staff'));
const openReference = () => document.dispatchEvent(new CustomEvent('v2-open-stage', { detail: 'evidence_zero' }));

function renderResult(r, mount, checklist) {
  mount.textContent = '';
  const caseLabel = checklist.case_type.label;
  const stageLabel = t(`stage.${r.stageKey}`);

  // ── Header: what was reviewed, and the D-23 state ──
  const head = el('div', 'psr-head');
  const left = el('div');
  const files = r.scope === 'individual' ? [t('review.individual_file', { form: r.formKey })] : r.fixture.files.map((f) => f.filename);
  left.appendChild(el('div', 'psr-file', files.length === 1 ? files[0] : t('review.n_files', { n: files.length })));
  left.appendChild(el('div', 'psr-casetype', [caseLabel, stageLabel, t(`scope.${r.scope}`)].join(' · ')));
  head.appendChild(left);
  const right = el('div', 'psr-head-right');
  right.appendChild(el('div', `psr-verdict psr-verdict--${r.state.key === 'incomplete' ? 'incomplete' : r.state.key === 'attention' ? 'attention' : 'clear'}`, r.state.phrase));
  head.appendChild(right);
  mount.appendChild(head);
  mount.appendChild(el('p', 'v2-reminder', t('state.reminder')));

  // D-98: evidence against the forms, before everything else.
  if (r.match?.length) {
    r.matchItems.forEach((i) => mount.appendChild(notice('needs_attention', i.title)));
    renderMatchBlock(mount, r.match);
  }
  if (r.cross?.length) {
    r.crossItems.forEach((i) => mount.appendChild(notice('needs_attention', i.title)));
    renderCrossBlock(mount, r.cross);
  }

  // Optional Pre-flight corrections check, shown first when it was run.
  if (r.corrections) renderCorrections(r.corrections, mount);

  // ── Our errors: inconsistencies, and reference vs draft ──
  const ourCount = r.consistencyAttention.length + r.mismatches.length;
  const our = block(t('review.our_errors'), ourCount);
  our.appendChild(el('p', 'v2-block-note', t('review.our_errors.note')));
  r.consistencyAttention.forEach((i) => our.appendChild(notice('needs_attention', i.title, [[t('r12.where'), i.form]], i.severity)));
  r.mismatches.forEach((m) => {
    const fieldIn = t(`field_in.${m.field}`);
    if (DATE_KEYS.has(m.field)) { m.draft = fmtDate(m.draft); m.ref = fmtDate(m.ref); }
    if (m.field === 'ssn') { m.draft = m.draft && shownSsn(m.draft); m.ref = shownSsn(m.ref); }
    const role = m.role ? t(`role.${m.role}`).toLowerCase() : null;
    const title = role
      ? t(m.draft ? 'review.mismatch_person' : 'review.mismatch_person_blank', { form: m.formKey, field: fieldIn, draft: m.draft, ref: m.ref, role })
      : m.draft
        ? t('review.mismatch', { form: m.formKey, field: fieldIn, draft: m.draft, ref: m.ref })
        : t('review.mismatch_blank', { form: m.formKey, field: fieldIn, ref: m.ref });
    const edit = button(t('review.edit_reference'), 'v2-link', openReference);
    our.appendChild(notice('needs_attention', title, [
      [t('review.draft_value'), [m.draft || t('review.blank'), [m.formKey, m.where].filter(Boolean).join(' ')].join(' · ')],
      [t('review.reference_value'), [m.ref, sourceText(m.source)].join(' · ')],
      [t('review.resolve_label'), t('review.resolve_text')],
    ], null, edit));
  });
  const consistencyItems = r.active.filter((i) => i.consistency);
  if (consistencyItems.length) our.appendChild(fold(t('review.consistency_group'), consistencyItems));
  if (!ourCount && !consistencyItems.length) our.appendChild(el('p', 'v2-block-empty', t('review.our_errors.none')));
  mount.appendChild(our);

  // ── Checklist items, one fixed group per form (N-023) ──
  const counted = r.stageKey === 'draft_review' ? r.missingForms : [];
  const ck = block(t('review.checklist'), r.checklistAttention.length + counted.length);
  counted.forEach((c) => ck.appendChild(notice('needs_attention',
    t('review.missing_form', { form: itemKey(c), case_type: caseLabel }), [[t('review.expected_by'), t('review.expected_by_text', { case_type: caseLabel })]])));
  r.checklistAttention.forEach((i) => ck.appendChild(notice('needs_attention', i.title,
    [[t('r12.expects'), i.expected], [t('r12.where'), [i.form, i.where].filter(Boolean).join(' · ')], [t('r12.note'), i.note]], i.severity)));
  const order = checklist.composition.map((c) => c.form);
  const groups = new Map();
  r.active.filter((i) => !i.consistency).forEach((i) => {
    const k = i.form || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  [...groups.entries()]
    .sort((a, b) => (a[0] ? order.indexOf(a[0]) : 99) - (b[0] ? order.indexOf(b[0]) : 99))
    .forEach(([form, items]) => ck.appendChild(fold(form || t('r12.package_group'), items)));
  mount.appendChild(ck);

  // The files reviewed are listed once, in the drop zone above; not repeated here.

  // ── Draft Review: needs info (D-47). Never counted, never alarming. ──
  if (r.stageKey === 'draft_review' && (r.needsInfo.size || r.needsInfoChecks.length)) {
    const ni = block(t('review.needs_info'), r.needsInfo.size + r.needsInfoChecks.length, 'v2-needs-info');
    ni.appendChild(el('p', 'v2-block-note', t('review.needs_info.note')));
    r.needsInfo.forEach((formsList, field) => {
      const row = el('div', 'v2-info-row');
      row.appendChild(el('span', 'v2-info-mark', '·'));
      row.appendChild(findingText(t('review.needs_info_row', { field: t(`field.${field}`), forms: formsList.join(', ') })));
      ni.appendChild(row);
    });
    r.needsInfoChecks.forEach((i) => {
      const row = el('div', 'v2-info-row');
      row.appendChild(el('span', 'v2-info-mark', '·'));
      row.appendChild(findingText(t('review.needs_info_check', { form: i.form || '', title: i.title.replace(/\.$/, '') })));
      ni.appendChild(row);
    });
    if (r.needsInfo.size) ni.appendChild(button(t('review.edit_reference'), 'v2-link', openReference));
    mount.appendChild(ni);
  }

  // ── Please confirm: gentle, never counted (Max 2026-10-02) ──
  if (r.confirms.length) {
    const cb = block(t('review.confirm'), r.confirms.length, 'v2-confirm');
    cb.appendChild(el('p', 'v2-block-note', t('review.confirm.note')));
    r.confirms.forEach((i) => {
      const row = el('div', 'v2-info-row');
      row.appendChild(el('span', 'v2-info-mark', 'i'));
      row.appendChild(findingText(t('review.confirm_row', { title: i.title.replace(/\.$/, '') })));
      cb.appendChild(row);
    });
    mount.appendChild(cb);
  }

  // ── Pre-flight: light notifications and the open questions (D-57, Q-46) ──
  if (r.stageKey === 'preflight') {
    const rows = [];
    // Max 2026-10-02: no missing-evidence note in Pre-flight either (supersedes D-57's).
    // Max 2026-10-02: Pre-flight only covers the pages that needed correcting, so a
    // form left out is never flagged, not even as a heads-up.
    // D-102: General never shows the "not on the case card yet" note.
    if (state.caseType !== 'general') r.noReference.forEach((formsList, field) => {
      const row = el('div', 'v2-info-row');
      // Max 2026-10-02 (Q-46): never added to the record = a light heads-up.
      row.appendChild(el('span', 'v2-info-mark', 'i'));
      row.appendChild(findingText(t('review.pf_no_reference', { field: t(`field.${field}`), forms: formsList.join(', ') })));
      rows.push(row);
    });
    if (rows.length) {
      const nb = block(t('review.notifications'), null, 'v2-notifications');
      nb.appendChild(el('p', 'v2-block-note', t('review.notifications.note')));
      rows.forEach((x) => nb.appendChild(x));
      mount.appendChild(nb);
    }
  }

  // ── Stage mapping: pending, not applicable, unmapped (sample, Q-44) ──
  const mapRows = (list, cls) => list.map(({ rule, entry }) => {
    const row = el('div', `psr-check v2-check--${cls}`);
    row.title = rule.rule_id;
    row.appendChild(el('span', 'psr-check-mark', '–'));
    row.appendChild(el('span', 'psr-check-text', [rule.form, rule.title].filter(Boolean).join(' · ')));
    const why = (r.stageKey === 'preflight' && entry?.preflight_reason) || entry?.sample_reason;
    if (why) row.appendChild(el('span', 'psr-where', why));
    return row;
  });
  if (r.buckets.pending.length) mount.appendChild(mutedFold(t('review.pending'), r.buckets.pending.length, mapRows(r.buckets.pending, 'pending')));
  if (r.buckets.not_applicable.length) mount.appendChild(mutedFold(t('review.not_applicable'), r.buckets.not_applicable.length, mapRows(r.buckets.not_applicable, 'na')));
  if (r.buckets.unmapped.length) {
    const rows = mapRows(r.buckets.unmapped, 'unmapped');
    rows.unshift(openTag('Q-44', t('review.unmapped')));
    mount.appendChild(mutedFold(t('review.unmapped_label'), r.buckets.unmapped.length, rows));
  }

  // ── Not checked, same shape as 1.2 ──
  if (r.notChecked.length) {
    mount.appendChild(mutedFold(t('r12.not_checked'), r.notChecked.length,
      r.notChecked.map((i) => notice('not_checked', i.title, [[t('r12.where'), [i.form, i.where].filter(Boolean).join(' · ')], [t('r12.why_not_checked'), i.reason]]))));
  }

  // ── Possible issues, below Not checked, powerless (D-36, D-59) ──
  renderPossibleIssues(mount);
}

// D-99 (General): people found in the forms get a case card if they have none yet.
// Their values are marked as coming from the drafts, so they are shown but never
// treated as evidence.
function cardsFromForms(fixture) {
  Object.entries(fixture.forms || {}).forEach(([form, entries]) => {
    const role = entries._person;
    if (!role) return;
    const src = { kind: 'forms', label: form };
    let card = personByRole(role);
    if (!card) {
      const p = newPerson(role);
      state.others.push(p);
      card = p;
    }
    // Fill only empty fields, across all of this person's forms; evidence values are never overwritten.
    PERSON_FIELDS.forEach((k) => {
      const v = entries[k]?.value;
      if (!v || card.fields[k].value) return;
      if (card.id === 'main') setField(k, v, src);
      else card.fields[k] = { value: v, source: src };
    });
  });
  document.dispatchEvent(new CustomEvent('v2-reference-changed'));
}

// D-98 (General): the Evidence Zero documents against the forms in this review.
function evidenceRows(fixture, identified) {
  const roleOf = (id) => (id === 'main' ? state.reference.role : state.others.find((p) => p.id === id)?.role);
  const evidence = state.docs.filter((d) => d.status === 'current' && d.owners)
    .map((d) => ({ label: d.sample.type_label, owners: d.owners.map(roleOf).filter(Boolean), facts: d.sample.facts }));
  const forms = identified.map((key) => {
    const entries = fixture.forms?.[key] || {};
    return { form: key, person: entries._person, values: Object.fromEntries(Object.entries(entries).filter(([k]) => k !== '_person').map(([k, v]) => [k, v.value])) };
  });
  return matchEvidence(evidence, forms);
}

export async function renderReviewStage(mount, stageKey) {
  const general = state.caseType === 'general';
  const [[base, dacaChecklist], stageMap, fixtures, individualSource] = await Promise.all([
    loadRules(),
    loadJSON('/v2-lab/stage-map.sample.json'),
    Promise.all((general ? GENERAL_FIXTURES : FIXTURES)[stageKey].map((f) => loadJSON(`/v2-lab/fixtures/${f}`))),
    loadJSON(`/v2-lab/fixtures/${INDIVIDUAL_SOURCE[stageKey]}`),
  ]);
  const checklist = general ? GENERAL_CHECKLIST : dacaChecklist;
  const forms = checklist.composition.filter((c) => !isEvidence(c));
  const local = { scope: 'whole', formKey: forms[0] ? itemKey(forms[0]) : null, fixture: null, corrections: null };
  const correctionsSample = stageKey === 'preflight' && !general ? await loadJSON('/v2-lab/fixtures/pf-corrections.json') : null;

  // D-69 to D-73 decided the DACA stage mapping, so the Q-44 sample banner is gone.
  if (stageKey === 'preflight') mount.appendChild(el('p', 'v2-hint v2-stage-intro', t('review.preflight.optional')));

  const setup = section(t('review.files'));
  const results = section(t('review.results'));
  results.wrap.hidden = true;
  const resultCard = el('div', 'card ps-report v2-result');
  const signMount = el('div');
  const emailMount = el('div');
  results.body.append(resultCard, signMount, emailMount);
  mount.append(setup.wrap, results.wrap);

  const run = () => {
    if (general) cardsFromForms(local.fixture);
    // Corrections first, so a value already sent to Evidence Zero for confirmation
    // is not also reported as a mismatch against the old reference value.
    const corrections = evaluateCorrections(local.corrections, local.scope === 'whole' ? local.fixture : null);
    const r = evaluate({ base, checklist, stageMap, stageKey, fixture: local.fixture, scope: local.scope, formKey: local.formKey, corrections: local.corrections });
    r.corrections = corrections;
    // D-98: in General, each Evidence Zero document is checked against its owner's forms.
    if (general) {
      r.match = evidenceRows(local.fixture, r.identified);
      r.matchItems = matchItems(r.match);
      r.attention += r.matchItems.length;
      // D-100 #1: every shared fact across the forms, per person.
      r.cross = crossFormRows(r.identified.map((key) => {
        const entries = local.fixture.forms?.[key] || {};
        return { form: key, person: entries._person, values: Object.fromEntries(Object.entries(entries).filter(([k]) => k !== '_person').map(([k, x]) => [k, x.value])) };
      }));
      // A difference already raised against the case card or the evidence is not counted twice.
      const cardDiffs = r.mismatches.map((m) => ({ ok: false, field: m.field, form: m.formKey, ev: { owners: [m.role || state.reference.role] } }));
      r.crossItems = crossFormItems(r.cross, [...r.match, ...cardDiffs]);
      r.attention += r.crossItems.length;
      r.state = reportState(r.attention, r.notChecked.length);
    }
    // Max 2026-10-02: a correction that was not made counts as attention.
    if (r.corrections) {
      r.attention += r.corrections.rows.filter((c) => c.status === 'not_fixed' || c.status === 'no_page').length;
      // A correction not carried to another form is a consistency failure. It turns
      // the matching consistency check red once, instead of counting twice.
      r.corrections.rows.filter((c) => c.status === 'not_carried').forEach((c) => {
        const item = r.active.find((i) => i.rule_id === FIELD_RULE[c.field]);
        if (!item) { r.attention += 1; return; }
        if (item.status !== 'needs_attention') {
          item.status = 'needs_attention';
          item.title = t('pf.corr.consistency', { field: t(`field_in.${c.field}`) });
          r.consistencyAttention.push(item);
          r.attention += 1;
        }
      });
      r.state = reportState(r.attention, r.notChecked.length);
    }
    results.wrap.hidden = false;
    renderResult(r, resultCard, checklist);
    reveal(resultCard);
    renderEmail(emailMount, { caseLabel: checklist.case_type.label, stageLabel: t(`stage.${stageKey}`), phrase: r.state.phrase });
    state.runs[stageKey] = r.state.key;
    state.signedOff[stageKey] = false; // a fresh run needs a fresh sign-off
    signMount.textContent = '';
    signMount.appendChild(signOff(stageKey));
    document.dispatchEvent(new CustomEvent('v2-progress'));
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    results.wrap.scrollIntoView({ block: 'start', behavior });
  };

  const drawSetup = () => {
    const b = setup.body;
    b.textContent = '';

    // Scope (D-56, D-57)
    const scopeRow = el('div', 'v2-scope');
    scopeRow.setAttribute('role', 'group');
    scopeRow.setAttribute('aria-label', t('scope.label'));
    (general ? ['whole'] : ['individual', 'whole']).forEach((s) => {
      const btn = button('', 'v2-scope-btn', () => {
        if (local.scope === s) return;
        local.scope = s; local.fixture = null; results.wrap.hidden = true; drawSetup();
      });
      btn.setAttribute('aria-pressed', String(local.scope === s));
      btn.appendChild(el('span', 'v2-scope-name', t(`scope.${s}`)));
      btn.appendChild(el('span', 'v2-scope-desc', t(`scope.${s}.${stageKey}`)));
      scopeRow.appendChild(btn);
    });
    b.appendChild(scopeRow);

    // Add files: the 1.2 drop zone. Nothing is read; samples stand in for files.
    const pick = (f) => { local.fixture = f; local.landed = true; results.wrap.hidden = true; drawSetup(); };
    if (local.scope === 'individual') {
      const row = el('div', 'v2-form-pick');
      const lab = el('label', 'v2-add-label', t('review.pick_form'));
      lab.htmlFor = 'v2-review-form';
      const sel = el('select', 'ps-select v2-inline-select');
      sel.id = 'v2-review-form';
      forms.forEach((c) => {
        const o = el('option', null, itemKey(c));
        o.value = itemKey(c);
        o.selected = itemKey(c) === local.formKey;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { local.formKey = sel.value; local.fixture = null; results.wrap.hidden = true; drawSetup(); });
      row.append(lab, sel);
      b.appendChild(row);
    }
    const f = local.fixture;
    let files = [];
    if (f && local.scope === 'whole') {
      files = f.files.map((x) => ({
        name: x.filename,
        meta: t(x.pages === 1 ? 'files.page' : 'files.pages', { n: x.pages }),
        tags: f.forms_identified.filter((g) => g.file === x.filename).map((g) => g.key),
      }));
    } else if (f) {
      const g = f.forms_identified.find((x) => x.key === local.formKey);
      const x = f.files.find((y) => y.filename === g?.file);
      files = [{ name: x?.filename || local.formKey, meta: x ? t(x.pages === 1 ? 'files.page' : 'files.pages', { n: x.pages }) : '', tags: [local.formKey] }];
    }
    b.appendChild(dropZone({
      title: f ? t('review.drop.ready') : t(`review.drop.title.${stageKey}`),
      meta: f ? t(files.length === 1 ? 'files.one' : 'files.many', { n: files.length }) : t(`review.drop.meta.${local.scope}`),
      ready: Boolean(f),
      landed: Boolean(f && local.landed),
      files,
      choices: local.scope === 'whole'
        ? fixtures.filter((x) => x !== f).map((x) => ({ label: f ? t('files.use_instead', { label: x.label }) : x.label, onPick: () => pick(x) }))
        : (f ? [] : [{ label: t('review.add_individual'), onPick: () => pick(individualSource) }]),
      note: f ? null : t('limit.note'),
    }));
    local.landed = false;

    // Pre-flight only, optional: the client's marked-up pages and the corrected pages.
    if (stageKey === 'preflight' && correctionsSample) {
      const c = local.corrections;
      const zone = dropZone({
        title: c ? t('pf.corr.drop.ready') : t('pf.corr.drop.title'),
        meta: c ? null : t('pf.corr.optional'),
        ready: Boolean(c),
        landed: Boolean(c && local.corrLanded),
        files: c ? [
          { name: c.marked_file, meta: t('pf.corr.file.marked'), tags: [...new Set(c.corrections.map((x) => x.form))] },
          { name: c.corrected_file, meta: t('pf.corr.file.corrected'), tags: [...new Set(c.corrections.filter((x) => x.corrected != null).map((x) => x.form))] },
        ] : [],
        choices: c ? [] : [{ label: correctionsSample.label, onPick: () => { local.corrections = correctionsSample; local.corrLanded = true; results.wrap.hidden = true; drawSetup(); } }],
      });
      zone.classList.add('v2-drop--secondary');
      if (c) zone.appendChild(button(t('ez.doc.remove'), 'v2-link', () => { local.corrections = null; results.wrap.hidden = true; drawSetup(); }));
      local.corrLanded = false;
      b.appendChild(zone);
    }

    const bar = el('div', 'dk-toolbar');
    bar.appendChild(scanButton(t(`review.run.${stageKey}`), run, !local.fixture));
    b.appendChild(bar);
  };
  drawSetup();
}
