// Pure helpers for the Case Builder. No I/O, no env — kept separate so the
// slugification, key-collision and search-matching rules are unit-testable
// without mocking Supabase (see test/unit/case-builder.test.js).

// case_types.key is referenced by form field maps, doc templates and the intake
// flow, so it must be stable, snake_case and collision-free. Staff type a NAME;
// this derives the key. The key is immutable after creation (nothing follows a
// rename), so this only ever runs once per case type.
export function slugify(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // any run of non-alphanumerics -> single _
    .replace(/^_+|_+$/g, '')     // no leading/trailing _
    .slice(0, 60);
}

// Keys are unique within a practice area. If the slug is taken, suffix _2, _3…
export function uniqueKey(base, existingKeys) {
  const taken = new Set(existingKeys || []);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// Search normalization for the form-library picker. Strips ALL non-alphanumerics
// on both the haystack and the query so a form code matches however it's typed:
// "i130", "i-130" and "I 130" all normalize to "i130".
export function normalizeSearch(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Does a template match a free-text query? Matches across code + label + agency.
export function matchesQuery(template, query) {
  const q = normalizeSearch(query);
  if (!q) return true;
  const hay = normalizeSearch(
    [template.form_key, template.label, template.agency].filter(Boolean).join(' ')
  );
  return hay.includes(q);
}
