// Unit tests for the FreshBooks billed-time dedupe (migration 1533).
//
// Provider-pulled time entries ("fb_344181434") were invisible to the portal's
// billed-state tracking: line items stored time_entry_id NULL and FreshBooks
// never learned its entries were invoiced, so the same entry could land on two
// live invoices (observed: duplicate $80 drafts INV-0035/0040 on SSL 2026-07-16).
// The fix: line items carry external_entry_id, get-unbilled-time filters
// consumed ids out of the pull, and create/update reject stale submissions.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

const adapterMock = vi.hoisted(() => ({ getBillingAdapter: vi.fn() }));
vi.mock('../../functions/api/_adapters/billing/index.js', () => adapterMock);
vi.mock('../../functions/api/_billing-rates.js', () => ({
  buildRateResolver: async () => null,
}));
vi.mock('../../functions/api/_billing-increment.js', () => ({
  getBillingIncrementMinutes: async () => 6,
  roundHoursUpToIncrement:    (h) => h,
}));

import { isExternalEntryId, fetchConsumedExternalIds } from '../../functions/api/_external-entry.js';
import { onRequest as createInvoice }      from '../../functions/api/create-invoice.js';
import { onRequest as updateDraftInvoice } from '../../functions/api/update-draft-invoice.js';
import { onRequest as getUnbilledTime }    from '../../functions/api/get-unbilled-time.js';

function post(path, body) {
  return new Request(`http://portal.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'user-1' } });
  adapterMock.getBillingAdapter.mockReturnValue(null);
});

// ── isExternalEntryId ─────────────────────────────────────────────────────────

describe('isExternalEntryId', () => {
  it.each(['fb_344181434', 'fb_1', 'qb_99', 'FB_7'])('accepts provider id %s', (v) => {
    expect(isExternalEntryId(v)).toBe(true);
  });
  it.each([UUID, 'fb_', 'fb_abc', '_123', 'fb-123', '', null, undefined, 42])(
    'rejects %s', (v) => { expect(isExternalEntryId(v)).toBe(false); });
});

// ── fetchConsumedExternalIds ──────────────────────────────────────────────────

describe('fetchConsumedExternalIds', () => {
  it('returns the ids as a Set and scopes the query to non-void invoices', async () => {
    const calls = { select: null, not: null, neq: null };
    const admin = {
      from(table) {
        expect(table).toBe('invoice_line_items');
        const c = {
          select(cols) { calls.select = cols; return c; },
          not(...a)    { calls.not = a;      return c; },
          neq(...a)    { calls.neq = a;      return c; },
          then(resolve) {
            resolve({ data: [{ external_entry_id: 'fb_1' }, { external_entry_id: 'fb_2' }], error: null });
          },
        };
        return c;
      },
    };
    const set = await fetchConsumedExternalIds(admin);
    expect(set).toEqual(new Set(['fb_1', 'fb_2']));
    expect(calls.select).toContain('invoices!inner(status)'); // join needed for the status filter
    expect(calls.not).toEqual(['external_entry_id', 'is', null]);
    expect(calls.neq).toEqual(['invoices.status', 'void']);   // void frees the entry
  });

  it('throws on a query error', async () => {
    const admin = {
      from() {
        const c = { select: () => c, not: () => c, neq: () => c, then: (r) => r({ data: null, error: { message: 'boom' } }) };
        return c;
      },
    };
    await expect(fetchConsumedExternalIds(admin)).rejects.toThrow('boom');
  });
});

// ── /api/create-invoice ───────────────────────────────────────────────────────

function createAdmin({ consumedRows = [] } = {}) {
  const ops = { insertedLines: null, timeUpdate: null };
  const admin = {
    from(table) {
      if (table === 'invoices') {
        return {
          insert(row) { return { select: () => ({ single: async () => ({ data: { id: 'inv-1', ...row }, error: null }) }) }; },
          delete()    { return { eq: async () => ({ error: null }) }; },
        };
      }
      if (table === 'invoice_line_items') {
        return {
          select() { const c = { not: () => c, neq: () => c, then: (r) => r({ data: consumedRows, error: null }) }; return c; },
          insert: async (rows) => { ops.insertedLines = rows; return { error: null }; },
        };
      }
      if (table === 'time_entries') {
        return { update(vals) { return { in: async (_c, ids) => { ops.timeUpdate = { vals, ids }; return { error: null }; } }; } };
      }
      if (table === 'expenses') {
        return { update() { const c = { in: () => c, eq: () => c, then: (r) => r({ error: null }) }; return c; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin, ops };
}

describe('/api/create-invoice external-entry dedupe', () => {
  const LINES = [
    { time_entry_id: 'fb_101', description: 'FB pulled', hours: 0.5, rate: 300, amount: 150, item_type: 'time' },
    { time_entry_id: UUID,     description: 'Portal',    hours: 0.1, rate: 500, amount: 50,  item_type: 'time' },
  ];

  it('persists external_entry_id for provider lines and leaves it null for portal lines', async () => {
    const { admin, ops } = createAdmin();
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await createInvoice({
      request: post('/api/create-invoice', { matter_id: 'm1', line_items: LINES }), env: {},
    });
    expect(res.status).toBe(201);
    expect(ops.insertedLines[0].external_entry_id).toBe('fb_101');
    expect(ops.insertedLines[0].time_entry_id).toBeNull();
    expect(ops.insertedLines[1].external_entry_id).toBeNull();
    expect(ops.insertedLines[1].time_entry_id).toBe(UUID);
  });

  it('409s when a submitted provider entry is already on a live invoice (stale screen)', async () => {
    const { admin, ops } = createAdmin({ consumedRows: [{ external_entry_id: 'fb_101' }] });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await createInvoice({
      request: post('/api/create-invoice', { matter_id: 'm1', line_items: LINES }), env: {},
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already on another invoice/i);
    expect(ops.insertedLines).toBeNull(); // nothing written
  });

  it('skips the consumed lookup entirely for portal-only invoices', async () => {
    let lineItemsTouched = 0;
    const { admin, ops } = createAdmin();
    const origFrom = admin.from.bind(admin);
    admin.from = (table) => {
      if (table === 'invoice_line_items') lineItemsTouched++;
      return origFrom(table);
    };
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await createInvoice({
      request: post('/api/create-invoice', { matter_id: 'm1', line_items: [LINES[1]] }), env: {},
    });
    expect(res.status).toBe(201);
    expect(lineItemsTouched).toBe(1); // insert only — no select round-trip
    expect(ops.insertedLines).toHaveLength(1);
  });
});

// ── /api/update-draft-invoice ─────────────────────────────────────────────────

describe('/api/update-draft-invoice external-entry dedupe', () => {
  const DRAFT = {
    id: 'inv-1', status: 'draft', matter_id: 'm1',
    invoice_line_items: [
      { id: UUID, time_entry_id: null, expense_id: null, item_type: 'time', amount: 100, sort_order: 0 },
    ],
  };

  function draftAdmin({ consumedRows = [] } = {}) {
    const ops = { insertedLines: null };
    const admin = {
      from(table) {
        if (table === 'invoices') {
          return {
            select() { return this; },
            eq()     { return this; },
            single: async () => ({ data: DRAFT, error: null }),
            update() { return { eq: async () => ({ error: null }) }; },
          };
        }
        if (table === 'invoice_line_items') {
          return {
            select() { const c = { not: () => c, neq: () => c, then: (r) => r({ data: consumedRows, error: null }) }; return c; },
            insert: async (rows) => { ops.insertedLines = rows; return { error: null }; },
            delete() { return { in: () => ({ eq: async () => ({ error: null }) }) }; },
          };
        }
        if (table === 'time_entries') {
          return { update() { return { in: async () => ({ error: null }) }; } };
        }
        if (table === 'expenses') {
          return { update() { const c = { in: () => c, eq: () => c, then: (r) => r({ error: null }) }; return c; } };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    return { admin, ops };
  }

  it('409s when an added provider entry is already on a live invoice', async () => {
    const { admin, ops } = draftAdmin({ consumedRows: [{ external_entry_id: 'fb_500' }] });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', {
        invoice_id: 'inv-1',
        add_items: [{ time_entry_id: 'fb_500', description: 'dupe', hours: 1, rate: 100, amount: 100, item_type: 'time' }],
      }),
      env: {},
    });
    expect(res.status).toBe(409);
    expect(ops.insertedLines).toBeNull();
  });

  it('409s on the same provider entry twice in one payload', async () => {
    const { admin, ops } = draftAdmin();
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const item = { time_entry_id: 'fb_7', description: 'x', hours: 1, rate: 100, amount: 100, item_type: 'time' };
    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', { invoice_id: 'inv-1', add_items: [item, { ...item }] }),
      env: {},
    });
    expect(res.status).toBe(409);
    expect(ops.insertedLines).toBeNull();
  });

  it('accepts a fresh provider entry and stores its external_entry_id', async () => {
    const { admin, ops } = draftAdmin();
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', {
        invoice_id: 'inv-1',
        add_items: [{ time_entry_id: 'fb_7', description: 'fresh', hours: 1, rate: 100, amount: 100, item_type: 'time' }],
      }),
      env: {},
    });
    expect(res.status).toBe(200);
    expect(ops.insertedLines[0].external_entry_id).toBe('fb_7');
    expect(ops.insertedLines[0].time_entry_id).toBeNull();
  });
});

// ── /api/get-unbilled-time ────────────────────────────────────────────────────

describe('/api/get-unbilled-time consumed filter', () => {
  function unbilledAdmin({ consumedRows = [] } = {}) {
    return {
      from(table) {
        if (table === 'matters') {
          return {
            select() { return this; },
            eq()     { return this; },
            single: async () => ({
              data: { client_id: 'c1', clients: { id: 'c1', email: 'x@y.com', first_name: 'A', last_name: 'B' } },
              error: null,
            }),
          };
        }
        if (table === 'billing_identity_map') {
          const c = { select: () => c, then: (r) => r({ data: [], error: null }) };
          return c;
        }
        if (table === 'users') {
          const c = { select: () => c, eq: () => c, then: (r) => r({ data: [], error: null }) };
          return c;
        }
        if (table === 'time_entries') {
          const c = { select: () => c, eq: () => c, is: () => c, order: () => c, then: (r) => r({ data: [], error: null }) };
          return c;
        }
        if (table === 'invoice_line_items') {
          const c = { select: () => c, not: () => c, neq: () => c, then: (r) => r({ data: consumedRows, error: null }) };
          return c;
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  const PULLED = [
    { id: 'fb_1', entry_date: '2026-07-01', hours: 1, amount: 100, identity_id: 9 },
    { id: 'fb_2', entry_date: '2026-07-02', hours: 2, amount: 200, identity_id: 9 },
  ];

  function request() {
    return new Request('http://portal.test/api/get-unbilled-time?matter_id=m1');
  }

  it('drops pulled entries already on a live invoice', async () => {
    helpersMock.makeAdminClient.mockReturnValue(unbilledAdmin({ consumedRows: [{ external_entry_id: 'fb_1' }] }));
    adapterMock.getBillingAdapter.mockReturnValue({ pullUnbilledTimeEntries: async () => [...PULLED] });

    const res  = await getUnbilledTime({ request: request(), env: { BILLING_PROVIDER: 'freshbooks' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.time_entries.map(e => e.id)).toEqual(['fb_2']);
  });

  it('returns everything when nothing is consumed', async () => {
    helpersMock.makeAdminClient.mockReturnValue(unbilledAdmin());
    adapterMock.getBillingAdapter.mockReturnValue({ pullUnbilledTimeEntries: async () => [...PULLED] });

    const res  = await getUnbilledTime({ request: request(), env: { BILLING_PROVIDER: 'freshbooks' } });
    const body = await res.json();
    expect(body.time_entries.map(e => e.id)).toEqual(['fb_1', 'fb_2']);
  });
});
