// A tiny in-memory stand-in for the supabase-js query builder, enough for the
// Estate Planning endpoints: from().select/insert/update + eq/is/not/in/gte/order/
// limit + single/maybeSingle, awaitable. Nested selects are not modelled — seed rows
// with the embedded object already in place (e.g. matters[i].client = {...}).

export function fakeDb(tables = {}) {
  const db = { tables, log: [] };
  db.from = (t) => new Query(db, t);
  return db;
}

class Query {
  constructor(db, t) {
    this.db = db; this.t = t; this.filters = []; this.op = 'select';
    this.vals = null; this.mode = null; this.max = null;
  }
  // A flat column list is projected (so a test can prove a column is NOT returned);
  // anything with an embedded relation is returned whole.
  select(cols) {
    if (this.op === 'select' && typeof cols === 'string' && !cols.includes('(') && cols.trim() !== '*') {
      this.cols = cols.split(',').map(c => c.trim()).filter(Boolean);
    }
    return this;
  }
  eq(c, v)     { this.filters.push(r => r[c] === v); return this; }
  is(c, v)     { this.filters.push(r => (r[c] ?? null) === v); return this; }
  not(c, _o, v){ this.filters.push(r => (r[c] ?? null) !== v); return this; }
  in(c, arr)   { this.filters.push(r => arr.includes(r[c])); return this; }
  gte(c, v)    { this.filters.push(r => r[c] != null && r[c] >= v); return this; }
  order()      { return this; }
  limit(n)     { this.max = n; return this; }
  update(v)    { this.op = 'update'; this.vals = v; return this; }
  insert(v)    { this.op = 'insert'; this.vals = v; return this; }
  maybeSingle(){ this.mode = 'maybe'; return this.run(); }
  single()     { this.mode = 'single'; return this.run(); }
  then(res, rej) { return this.run().then(res, rej); }

  async run() {
    const rows = (this.db.tables[this.t] ||= []);
    let out;
    if (this.op === 'insert') {
      const arr = (Array.isArray(this.vals) ? this.vals : [this.vals]).map(v => ({ id: crypto.randomUUID(), ...v }));
      rows.push(...arr);
      this.db.log.push({ t: this.t, op: 'insert', vals: this.vals });
      out = arr;
    } else {
      const matched = rows.filter(r => this.filters.every(f => f(r)));
      if (this.op === 'update') {
        matched.forEach(r => Object.assign(r, this.vals));
        this.db.log.push({ t: this.t, op: 'update', vals: this.vals, n: matched.length });
      }
      out = matched;
    }
    if (this.max != null) out = out.slice(0, this.max);
    if (this.cols) out = out.map(r => Object.fromEntries(this.cols.map(c => [c, r[c]])));
    if (this.mode === 'maybe')  return { data: out[0] || null, error: null };
    if (this.mode === 'single') return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'not found' } };
    return { data: out, error: null };
  }
}

export function fakeR2(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async put(k, v) { store.set(k, v instanceof ArrayBuffer ? new Uint8Array(v) : v); },
    async get(k) {
      if (!store.has(k)) return null;
      const v = store.get(k);
      return { arrayBuffer: async () => (v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v) };
    },
  };
}
