// evidence-match.js: D-98, "THE EVIDENCE MATCHES w the forms. that is the BIGGEST
// thing it must take into account." Every fact a document carries is compared
// with the forms about the same person (or the same couple, for a marriage
// certificate). The server decides; the AI only reports what each page says.
import { el, t, fmtDate } from '/v2-lab/ui.js';

// D-100: the full fact list, not just names and dates.
const FIELDS = ['first_name', 'last_name', 'date_of_birth', 'a_number', 'country_of_birth', 'country_of_citizenship',
  'phone', 'email', 'i94_number', 'i94_expiry', 'last_entry_date', 'port_of_entry', 'employer', 'marriage_date', 'marriage_place'];
const DATES = new Set(['date_of_birth', 'marriage_date', 'i94_expiry', 'last_entry_date']);
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digits = (v) => String(v ?? '').replace(/\D/g, '');

function same(field, a, b) {
  if (field === 'a_number' || field === 'phone') return digits(a) === digits(b);
  if (DATES.has(field)) return String(a) === String(b);
  return norm(a) === norm(b);
}
const show = (field, v) => (DATES.has(field) ? fmtDate(v) : v);

// evidence: [{ label, owners: [role], facts }]
// forms:    [{ form, person: role, values: { field: value } }]
export function matchEvidence(evidence, forms) {
  const rows = [];
  evidence.forEach((ev) => {
    Object.entries(ev.facts || {}).filter(([k, v]) => FIELDS.includes(k) && v).forEach(([field, evValue]) => {
      forms.filter((f) => ev.owners.includes(f.person) && f.values?.[field]).forEach((f) => {
        rows.push({ ev, field, evValue, form: f.form, formValue: f.values[field], ok: same(field, evValue, f.values[field]) });
      });
    });
  });
  return rows;
}

const ownerText = (owners) => owners.map((r) => t(`role.${r}`).toLowerCase()).join(` ${t('match.and')} `);

// One attention item per difference, in the report's own item shape.
export function matchItems(rows) {
  return rows.filter((r) => !r.ok).map((r) => ({
    rule_id: `evidence:${r.ev.label}:${r.field}:${r.form}`, status: 'needs_attention', severity: null,
    title: t('match.diff', {
      owner: ownerText(r.ev.owners), evidence: r.ev.label.toLowerCase(), field: t(`field_in.${r.field}`),
      ev: show(r.field, r.evValue), form: r.form, fv: show(r.field, r.formValue),
    }),
    reason: '', evidence: '', expected: '', note: '', form: null, where: '', locations: [],
  }));
}

// A block that lists every document and whether it matched, so a clean result is
// visible too, not just the differences.
export function renderMatchBlock(container, rows) {
  if (!rows.length) return;
  const b = el('section', 'psr-block v2-match');
  const h = el('h3', 'psr-block-head');
  h.appendChild(el('span', null, t('match.heading')));
  const bad = rows.filter((r) => !r.ok).length;
  if (bad) h.appendChild(el('span', 'psr-count', String(bad)));
  b.appendChild(h);
  b.appendChild(el('p', 'v2-block-note', t('match.note')));
  const byDoc = new Map();
  rows.forEach((r) => {
    if (!byDoc.has(r.ev)) byDoc.set(r.ev, []);
    byDoc.get(r.ev).push(r);
  });
  byDoc.forEach((list, ev) => {
    const ok = list.every((r) => r.ok);
    const row = el('div', `v2-match-row v2-match-row--${ok ? 'ok' : 'bad'}`);
    row.appendChild(el('span', 'v2-match-mark', ok ? '✓' : '!'));
    const text = el('div', 'v2-match-text');
    const forms = [...new Set(list.map((r) => r.form))].join(', ');
    const fields = [...new Set(list.map((r) => t(`field_in.${r.field}`)))].join(', ');
    text.appendChild(el('strong', null, t('match.doc', { owner: ownerText(ev.owners), evidence: ev.label.toLowerCase() })));
    text.appendChild(el('span', 'v2-match-detail', ok
      ? t('match.ok', { forms, fields })
      : list.filter((r) => !r.ok).map((r) => t('match.bad_short', { field: t(`field_in.${r.field}`), ev: show(r.field, r.evValue), form: r.form, fv: show(r.field, r.formValue) })).join(' ')));
    row.appendChild(text);
    b.appendChild(row);
  });
  container.appendChild(b);
}

// ── D-100 #1: every shared fact matches across the forms, per person ─────────
// Names, A-Number and address keep their own checks (PS-301 to PS-303); this
// covers every other fact that appears on more than one form for one person.
const CROSS = FIELDS.filter((f) => !['first_name', 'last_name', 'a_number'].includes(f));

export function crossFormRows(forms) {
  const rows = [];
  const people = [...new Set(forms.map((f) => f.person).filter(Boolean))];
  people.forEach((person) => {
    const mine = forms.filter((f) => f.person === person);
    CROSS.forEach((field) => {
      const withIt = mine.filter((f) => f.values?.[field]);
      if (withIt.length < 2) return;
      const first = withIt[0];
      const odd = withIt.filter((f) => !same(field, f.values[field], first.values[field]));
      rows.push({ person, field, forms: withIt.map((f) => f.form), ok: !odd.length,
        a: { form: first.form, v: first.values[field] }, b: odd[0] ? { form: odd[0].form, v: odd[0].values[field] } : null });
    });
  });
  return rows;
}

// One root cause, one item: a cross-form difference the evidence check already
// flagged (same person, same fact, same form) is not counted again.
export function crossFormItems(rows, matchRows = []) {
  const already = (r) => matchRows.some((m) => !m.ok && m.field === r.field && m.ev.owners.includes(r.person) && (m.form === r.a.form || m.form === r.b?.form));
  return rows.filter((r) => !r.ok && !already(r)).map((r) => ({
    rule_id: `crossform:${r.person}:${r.field}`, status: 'needs_attention', severity: null,
    title: t('cross.diff', { owner: t(`role.${r.person}`).toLowerCase(), field: t(`field_in.${r.field}`),
      a: r.a.form, av: show(r.field, r.a.v), b: r.b.form, bv: show(r.field, r.b.v) }),
    reason: '', evidence: '', expected: '', note: '', form: null, where: '', locations: [],
  }));
}

export function renderCrossBlock(container, rows) {
  if (!rows.length) return;
  const b = el('section', 'psr-block v2-match');
  const h = el('h3', 'psr-block-head');
  h.appendChild(el('span', null, t('cross.heading')));
  const bad = rows.filter((r) => !r.ok).length;
  if (bad) h.appendChild(el('span', 'psr-count', String(bad)));
  b.appendChild(h);
  b.appendChild(el('p', 'v2-block-note', t('cross.note')));
  const byPerson = new Map();
  rows.forEach((r) => { if (!byPerson.has(r.person)) byPerson.set(r.person, []); byPerson.get(r.person).push(r); });
  byPerson.forEach((list, person) => {
    const ok = list.every((r) => r.ok);
    const row = el('div', `v2-match-row v2-match-row--${ok ? 'ok' : 'bad'}`);
    row.appendChild(el('span', 'v2-match-mark', ok ? '✓' : '!'));
    const text = el('div', 'v2-match-text');
    text.appendChild(el('strong', null, t('cross.person', { owner: t(`role.${person}`) })));
    const fields = list.filter((r) => r.ok).map((r) => t(`field_in.${r.field}`)).join(', ');
    const badText = list.filter((r) => !r.ok).map((r) => t('cross.bad_short', { field: t(`field_in.${r.field}`), a: r.a.form, av: show(r.field, r.a.v), b: r.b.form, bv: show(r.field, r.b.v) })).join(' ');
    text.appendChild(el('span', 'v2-match-detail', [badText, fields && t('cross.ok', { fields })].filter(Boolean).join(' ')));
    row.appendChild(text);
    b.appendChild(row);
  });
  container.appendChild(b);
}

// ── D-100 #6: foreign-language evidence needs a translation (counted rule) ──
export function translationItems(evidence) {
  return evidence.filter((ev) => ev.language && ev.language.toLowerCase() !== 'english' && ev.translation === false).map((ev) => ({
    rule_id: `translation:${ev.label}:${ev.owners.join('+')}`, status: 'needs_attention', severity: null,
    title: t('translation.missing', { owner: ownerText(ev.owners), evidence: ev.label.toLowerCase(), language: ev.language }),
    reason: '', evidence: '', expected: '', note: '', form: null, where: '', locations: [],
  }));
}

// ── D-100 #5: expired evidence is a Possible issue only ───────────────────────
export function expiredIssues(evidence, today = new Date().toISOString().slice(0, 10)) {
  return evidence.filter((ev) => ev.expires && ev.expires < today).map((ev) => ({
    title: t('expired.title', { evidence: ev.label.toLowerCase() }),
    description: t('expired.desc', { owner: ownerText(ev.owners), evidence: ev.label.toLowerCase(), date: fmtDate(ev.expires) }),
    source: t('expired.source', { evidence: ev.label }),
    excerpt: t('expired.excerpt', { date: fmtDate(ev.expires) }),
  }));
}
