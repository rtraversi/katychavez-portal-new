// Estate-planning answers: visibility, sanitising, and required-field checks.
//
// The stored payload is BUILT from the questionnaire definition, never filtered from
// the input — a key the definition doesn't declare cannot reach the database, and a
// value that isn't one of a choice's options is dropped rather than stored.
//
// Two modes:
//   'draft'  — autosave while the client is mid-form. Everything sanitised is kept,
//              including answers in sections currently hidden (toggling "married" off
//              and on again must not lose the spouse's name). No required checks.
//   'submit' — the final submission, and staff edits. Hidden sections/fields are
//              dropped, and required fields in visible sections are enforced.
//
// js/ep-intake.js carries a browser copy of isVisible(); keep the two in step
// (test/unit/ep-intake.test.js pins the semantics).

const MAX_LEN = { text: 300, textarea: 4000, email: 254, tel: 40, date: 10, money: 60 };
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getPath(answers, path) {
  const [sec, field] = String(path).split('.');
  const s = answers?.[sec];
  return s && typeof s === 'object' && !Array.isArray(s) ? s[field] : undefined;
}

function test(value, cond) {
  if ('eq' in cond) return value === cond.eq;
  if ('ne' in cond) return value !== cond.ne;
  if ('in' in cond) return Array.isArray(cond.in) && cond.in.includes(value);
  return true;
}

// cond: undefined | condition | condition[] (all must hold)
export function isVisible(cond, answers, row) {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every(c => isVisible(c, answers, row));
  if (cond.row) return test(row ? row[cond.row] : undefined, cond);
  if (cond.f)   return test(getPath(answers, cond.f), cond);
  return true;
}

function cleanScalar(field, raw) {
  if (raw == null) return undefined;
  const type = field.type;

  if (type === 'multi') {
    if (!Array.isArray(raw)) return undefined;
    const allowed = new Set((field.options || []).map(o => o.value));
    const out = [...new Set(raw.filter(v => typeof v === 'string' && allowed.has(v)))];
    return out.length ? out : undefined;
  }

  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;

  if (type === 'select' || type === 'choice') {
    return (field.options || []).some(o => o.value === s) ? s : undefined;
  }
  if (type === 'date') return DATE_RE.test(s) ? s : undefined;

  const max = MAX_LEN[type] || MAX_LEN.text;
  return s.slice(0, max);
}

function cleanRow(group, raw, answers, mode) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = {};
  for (const f of group.fields) {
    const v = cleanScalar(f, raw[f.key]);
    if (v !== undefined) row[f.key] = v;
  }
  if (mode === 'submit') {
    for (const f of group.fields) if (!isVisible(f.showIf, answers, row)) delete row[f.key];
  }
  return Object.keys(row).length ? row : null;   // blank rows are dropped
}

function label(obj, lang = 'en') {
  if (!obj) return '';
  return typeof obj === 'string' ? obj : (obj[lang] || obj.en || '');
}

/**
 * @param {object} definition  questionnaire from _ep-questionnaire.js
 * @param {object} input       raw answers from the browser
 * @param {'draft'|'submit'} mode
 * @returns {{ answers: object, errors: Array<{section,field,message}> }}
 */
export function validateAnswers(definition, input, mode = 'draft', lang = 'en') {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const answers = {};

  // Pass 1 — sanitise everything the definition knows about.
  for (const sec of definition.sections) {
    const rawSec = src[sec.key];
    if (!rawSec || typeof rawSec !== 'object' || Array.isArray(rawSec)) continue;
    const out = {};
    for (const f of sec.fields) {
      if (f.type === 'group') {
        if (!Array.isArray(rawSec[f.key])) continue;
        const rows = rawSec[f.key]
          .slice(0, f.max || 20)
          .map(r => cleanRow(f, r, src, 'draft'))
          .filter(Boolean);
        if (rows.length) out[f.key] = rows;
      } else {
        const v = cleanScalar(f, rawSec[f.key]);
        if (v !== undefined) out[f.key] = v;
      }
    }
    if (Object.keys(out).length) answers[sec.key] = out;
  }

  if (mode !== 'submit') return { answers, errors: [] };

  // Pass 2 — drop what is hidden, judged against the sanitised answers, then
  // enforce required fields in what remains visible.
  const errors = [];
  for (const sec of definition.sections) {
    if (!isVisible(sec.showIf, answers)) { delete answers[sec.key]; continue; }
    const out = answers[sec.key] || {};
    for (const f of sec.fields) {
      if (!isVisible(f.showIf, answers)) { delete out[f.key]; continue; }
      if (f.type === 'group') {
        const rows = (out[f.key] || []).map(r => cleanRow(f, r, answers, 'submit')).filter(Boolean);
        if (rows.length) out[f.key] = rows; else delete out[f.key];
        rows.forEach((r, i) => {
          for (const rf of f.fields) {
            if (rf.required && isVisible(rf.showIf, answers, r) && r[rf.key] === undefined) {
              errors.push({ section: sec.key, field: `${f.key}.${i}.${rf.key}`,
                message: `${label(sec.title, lang)} — ${label(f.itemLabel, lang)} ${i + 1}: ${label(rf.label, lang)}` });
            }
          }
        });
      } else {
        if (f.type === 'email' && out[f.key] !== undefined && !EMAIL_RE.test(out[f.key])) {
          errors.push({ section: sec.key, field: f.key, message: `${label(sec.title, lang)} — ${label(f.label, lang)}` });
        }
        if (f.required && out[f.key] === undefined) {
          errors.push({ section: sec.key, field: f.key, message: `${label(sec.title, lang)} — ${label(f.label, lang)}` });
        }
      }
    }
    if (Object.keys(out).length) answers[sec.key] = out; else delete answers[sec.key];
  }
  return { answers, errors };
}

// The definition as the browser needs it — the frozen object serialises as-is,
// this just strips nothing today but is the one place to do it if a field ever
// carries server-only metadata.
export function publicDefinition(definition) {
  return JSON.parse(JSON.stringify(definition));
}
