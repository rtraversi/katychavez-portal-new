// _proof-scan-v2-merge.js: one Needs attention item per wrong fact (D-135). NOT a route.
//
// Pure. The engine finds differences four ways: the forms against the case
// card (Draft Review and Pre-flight, per form), the package against the card
// (Physical Scan), each document against the forms (PS-304), and form against
// form (PS-305). Before v2.1 each was its own item, so one wrong date of birth
// could be listed once per form and once per document. Max, 2026-10-16: "yes
// build it as one needs attention". Each wrong fact is one item naming every
// source that disagrees with the forms; name parts fold into one name and
// address parts into one address. The server does this, so the count, the
// result line and the email agree (D-18).
//
// Every item carries a stable key so a clear survives a re-run that finds the
// same thing (D-132): role, fact and a hash of the values, never the values.

import { NAME_FIELDS, ADDRESS_FIELDS, FIELD_LABELS, ROLE_LABELS, normText } from './_proof-scan-v2-common.js';

// FNV-1a, 32 bits: enough to tell values apart in a key; not a secret.
export function valueHash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const groupOf = (field) => (NAME_FIELDS.includes(field) ? 'name' : ADDRESS_FIELDS.includes(field) ? 'address' : field);
const roleWord = (role) => (ROLE_LABELS[role] || 'person').toLowerCase();
const norm = (v) => normText(v);

// "Birth certificate" reads mid-sentence as "birth certificate"; "EAD" stays.
export const docWord = (label) => String(label || '').split(' ')
  .map((w) => (/^[A-Z0-9-]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');

// parts: [{ role, group, form, forms_value, source, source_value, part }]
//   source: 'the case card' or 'the <document>'; part: the original finding,
//   kept under the item so nothing a person might want to see is lost.
export function mergeFacts(parts) {
  const byFact = new Map();
  for (const p of parts) {
    const k = `${p.role}|${p.group}`;
    if (!byFact.has(k)) byFact.set(k, { role: p.role, group: p.group, values: new Map(), sources: new Map(), slots: new Map(), docs: new Set(), parts: [] });
    const f = byFact.get(k);
    const v = norm(p.forms_value);
    if (!f.values.has(v)) f.values.set(v, { value: p.forms_value, forms: new Map() });
    // A form counted once per source and field ("G-1450 ×2" for two G-1450s,
    // never ×4 because both the first and last name differ on each).
    // The same document on file and in the package is one source, not two.
    const slot = `${p.source}|${p.copy || ""}|${p.field || p.group}|${v}`;
    if (!f.slots.has(slot)) f.slots.set(slot, new Map());
    const per = f.slots.get(slot);
    for (const form of [].concat(p.forms || p.form)) {
      if (form) per.set(form, (per.get(form) || 0) + 1);
    }
    for (const [form, n] of per) {
      const forms = f.values.get(v).forms;
      forms.set(form, Math.max(forms.get(form) || 0, n));
    }
    if (p.source) {
      const sv = norm(p.source_value);
      if (!f.sources.has(sv)) f.sources.set(sv, { value: p.source_value, labels: [] });
      if (!f.sources.get(sv).labels.includes(p.source)) f.sources.get(sv).labels.push(p.source);
    }
    if (p.doc) f.docs.add(p.doc);
    f.parts.push(p.part);
  }
  return [...byFact.values()].map((f) => {
    const onForms = [...f.values.values()].map((x) => ({ value: x.value, forms: [...x.forms].map(([form, n]) => ({ form, n })) }));
    const sources = [...f.sources.values()].map((x) => ({ value: x.value, labels: x.labels }));
    const label = FIELD_LABELS[f.group] || String(f.group).replace(/_/g, ' ');
    const keyText = `${onForms.map((x) => norm(x.value)).sort().join('|')}#${sources.map((x) => norm(x.value)).sort().join('|')}`;
    const fixOn = [];
    for (const x of onForms) for (const { form, n } of x.forms) {
      const have = fixOn.find((y) => y.form === form);
      if (have) have.n = Math.max(have.n, n); else fixOn.push({ form, n });
    }
    return {
      kind: 'fact',
      key: `fact:${f.role}:${f.group}:${valueHash(keyText)}`,
      person_role: f.role,
      field: f.group,
      title: sources.length
        ? `The ${roleWord(f.role)}'s ${label} does not match`
        : `The forms disagree on the ${roleWord(f.role)}'s ${label}`,
      on_forms: onForms,
      sources,
      fix_on: sources.length ? fixOn : [],
      forms: fixOn.map((x) => x.form),
      source_docs: [...f.docs],
      parts: f.parts,
    };
  });
}

// One line naming the sources for "On the {sources}": "case card, EAD and intake".
export function sourceNames(labels) {
  const names = labels.map((l) => l.replace(/^the /, ''));
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
