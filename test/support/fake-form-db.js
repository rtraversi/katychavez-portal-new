// An in-memory stand-in for the slice of the supabase-js query builder the
// USCIS form filler uses (Drafter 1.0.4 tests). Test-only.
//
// Tables are arrays of plain rows. Embedded selects ("template:form_templates(...)")
// are resolved through the foreign keys below and return the whole related row;
// column lists are not trimmed. Constraints are not enforced here: migration
// 1627's are checked against real Postgres (scripts/drafter-dbcheck/run.sh).

const FK = {
  matter_forms:       { form_templates: 'template_id' },
  form_package_items: { form_templates: 'template_id' },
  generated_forms:    { form_templates: 'template_id', matter_forms: 'matter_form_id', matters: 'matter_id' },
  matters:            { clients: 'client_id' },
};

let seq = 0;
const newId = (table) => `${table}-${++seq}`;

// "id, template:form_templates(id, form_key), copy:matter_forms(fee_amount)"
// -> [{ alias: 'template', table: 'form_templates', inner: 'id, form_key' }, ...]
function embeds(cols) {
  const out = [];
  const s = String(cols || '');
  const re = /(\w+):(\w+)\(/g;
  let m;
  while ((m = re.exec(s))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < s.length && depth; i++) depth += s[i] === '(' ? 1 : s[i] === ')' ? -1 : 0;
    out.push({ alias: m[1], table: m[2], inner: s.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

export function createFormDb(initial = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  const table = (name) => (tables[name] ||= []);
  const writes = [];

  function attach(name, row, cols) {
    const out = { ...row };
    for (const e of embeds(cols)) {
      const col = FK[name]?.[e.table];
      const hit = col ? table(e.table).find((r) => r.id === row[col]) : null;
      out[e.alias] = hit ? attach(e.table, hit, e.inner) : null;
    }
    return out;
  }

  function builder(name) {
    let op = 'select';
    let cols = '*';
    let head = false;
    let payload = null;
    let upsertOpts = null;
    let returning = false;
    const filters = [];
    let order = null;
    let limit = null;

    const api = {
      select(c = '*', opts = {}) { if (op === 'select') { cols = c; head = !!opts.head; } else returning = true; return api; },
      insert(rows) { op = 'insert'; payload = [].concat(rows); return api; },
      upsert(rows, opts = {}) { op = 'upsert'; payload = [].concat(rows); upsertOpts = opts; return api; },
      update(patch) { op = 'update'; payload = patch; return api; },
      delete() { op = 'delete'; return api; },
      eq(c, v) { filters.push((r) => r[c] === v); return api; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return api; },
      is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return api; },
      order(c, { ascending = true } = {}) { order = { c, ascending }; return api; },
      limit(n) { limit = n; return api; },
      single: async () => { const { data } = run(); return { data: data?.[0] ?? null, error: data?.length ? null : { message: 'not found' } }; },
      maybeSingle: async () => { const { data } = run(); return { data: data?.[0] ?? null, error: null }; },
      then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
    };

    function run() {
      const rows = table(name);
      const match = (r) => filters.every((f) => f(r));
      if (op === 'insert' || op === 'upsert') {
        const keys = upsertOpts?.onConflict ? upsertOpts.onConflict.split(',') : null;
        const added = [];
        for (const p of payload) {
          if (keys && rows.some((r) => keys.every((k) => r[k] === p[k]))) continue;
          const row = { id: newId(name), ...structuredClone(p) };
          rows.push(row);
          added.push(row);
        }
        writes.push({ table: name, op, rows: added });
        return { data: returning ? structuredClone(added) : null, error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, structuredClone(payload)));
        writes.push({ table: name, op, rows: hit.map((r) => ({ ...r })), patch: payload });
        return { data: returning ? structuredClone(hit) : null, error: null };
      }
      if (op === 'delete') {
        const removed = rows.filter(match);
        tables[name] = rows.filter((r) => !match(r));
        writes.push({ table: name, op, rows: removed });
        return { data: null, error: null };
      }
      let out = rows.filter(match);
      if (order) {
        out = [...out].sort((a, b) => {
          const c = a[order.c] < b[order.c] ? -1 : a[order.c] > b[order.c] ? 1 : 0;
          return order.ascending ? c : -c;
        });
      }
      if (limit != null) out = out.slice(0, limit);
      if (head) return { count: out.length, data: null, error: null };
      return { data: out.map((r) => attach(name, structuredClone(r), cols)), error: null };
    }
    return api;
  }

  return { from: builder, tables, rows: table, writes };
}

// R2 in memory: put/get/delete by key.
export function createR2(initial = {}) {
  const objects = new Map(Object.entries(initial));
  return {
    objects,
    put: async (key, bytes) => { objects.set(key, new Uint8Array(bytes)); },
    get: async (key) => {
      const b = objects.get(key);
      if (!b) return null;
      return { body: new Blob([b]).stream(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    },
    delete: async (keys) => { [].concat(keys).forEach((k) => objects.delete(k)); },
  };
}
