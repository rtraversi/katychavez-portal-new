// An in-memory stand-in for the slice of the supabase-js query builder the
// Proof Scan v2 store uses. Test-only.
//
// It is deliberately small and literal: tables are arrays of plain objects, and
// only the filters the store calls are implemented. It does NOT enforce the
// database's constraints, triggers or row level security; those are proved
// against real Postgres by scripts/proof-scan-v2-dbcheck/run.sh. What it does
// prove is that the routes read and write the rows they should.

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
let clock = Date.parse('2026-10-07T12:00:00Z');
const now = () => new Date(clock += 1000).toISOString();

// Unset columns come back as null from Postgres, not undefined.
const PERSON_COLUMNS = ['first_name', 'middle_name', 'last_name', 'street', 'apt_type', 'apt_number', 'city',
  'state', 'zip', 'in_care_of', 'province', 'postal_code', 'country', 'date_of_birth', 'a_number',
  'ead_expiration', 'phone', 'email'];

const DEFAULTS = {
  proof_scan_cases: () => ({ created_at: now(), updated_at: now() }),
  proof_scan_people: () => ({
    ...Object.fromEntries(PERSON_COLUMNS.map((c) => [c, null])),
    is_main: false, field_sources: {}, changed_since_approval: false, no_evidence: false,
    approved_at: null, approved_by: null, ssn_encrypted: null, ssn_last4: null,
    created_at: now(), updated_at: now(),
  }),
  proof_scan_documents: () => ({
    type_corrected: false, unreadable_fields: [], facts: {}, status: 'current', replaced_by: null,
    created_at: now(),
  }),
  proof_scan_document_people: () => ({ proposed_by: 'ai', created_at: now() }),
  proof_scan_suggestions: () => ({
    status: 'open', value: null, value_encrypted: null, value_last4: null,
    document_id: null, run_id: null, decided_by: null, decided_at: null, created_at: now(),
  }),
  proof_scans: () => ({ created_at: now() }),
  proof_scan_signoffs: () => ({ signed_at: now() }),
  proof_scan_possible_issues: () => ({
    status: 'open', dismiss_reason: null, decided_by: null, decided_at: null, reasoning_key: null, created_at: now(),
  }),
  proof_scan_suppressions: () => ({ created_at: now() }),
  proof_scan_rule_sets: () => ({ created_at: now() }),
  proof_scan_rule_changes: () => ({ changed_at: now() }),
};

const NO_ID = new Set(['proof_scan_document_people']);

export function createFakeSupabase(initial = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  const table = (name) => (tables[name] ||= []);
  const log = [];
  const failures = new Map(); // table -> error, to simulate a failing table

  function builder(name) {
    let op = 'select';
    let payload = null;
    const filters = [];
    let order = null;
    let limit = null;
    let returning = false;

    const matches = (row) => filters.every((f) => f(row));
    const api = {
      select() { if (op !== 'select') returning = true; return api; },
      insert(rows) { op = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return api; },
      update(patch) { op = 'update'; payload = patch; return api; },
      delete() { op = 'delete'; return api; },
      eq(col, v) { filters.push((r) => r[col] === v); return api; },
      neq(col, v) { filters.push((r) => r[col] !== v); return api; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return api; },
      is(col, v) { filters.push((r) => (v === null ? r[col] == null : r[col] === v)); return api; },
      ilike(col, pattern) {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
        filters.push((r) => re.test(String(r[col] ?? '')));
        return api;
      },
      order(col, { ascending = true } = {}) { order = { col, ascending }; return api; },
      limit(n) { limit = n; return api; },
      then(resolve, reject) {
        try { resolve(execute()); } catch (err) { reject(err); }
      },
    };

    function execute() {
      if (failures.has(name)) return { data: null, error: failures.get(name) };
      const rows = table(name);
      if (op === 'insert') {
        const inserted = payload.map((p) => ({
          ...(NO_ID.has(name) ? {} : { id: newId() }),
          ...(DEFAULTS[name]?.() || {}),
          ...structuredClone(p),
        }));
        rows.push(...inserted);
        log.push({ op, table: name, rows: inserted });
        return { data: structuredClone(inserted), error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(matches);
        for (const r of hit) Object.assign(r, structuredClone(payload));
        log.push({ op, table: name, rows: hit.map((r) => ({ ...r })), patch: payload });
        return { data: returning ? structuredClone(hit) : null, error: null };
      }
      if (op === 'delete') {
        const keep = rows.filter((r) => !matches(r));
        const removed = rows.length - keep.length;
        tables[name] = keep;
        log.push({ op, table: name, count: removed });
        return { data: null, error: null };
      }
      let out = rows.filter(matches);
      if (order) {
        out = [...out].sort((a, b) => {
          const x = a[order.col];
          const y = b[order.col];
          const c = x < y ? -1 : x > y ? 1 : 0;
          return order.ascending ? c : -c;
        });
      }
      if (limit != null) out = out.slice(0, limit);
      return { data: structuredClone(out), error: null };
    }

    return api;
  }

  return {
    from: (name) => builder(name),
    tables,
    rows: (name) => table(name),
    log,
    fail(name, error = { code: '500', message: 'simulated failure' }) { failures.set(name, error); },
  };
}
