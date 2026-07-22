// Unit tests for the per-client billing-rate engine:
//   1. buildRateResolver precedence (person → role → provider → default → 0)
//   2. FreshBooks adapter applies per-client rates by identity_id
//   3. recurring-charges cron generates one draft invoice/month, guarded
import { describe, it, expect } from 'vitest';
import { buildRateResolver } from '../../functions/api/_billing-rates.js';
import { FreshbooksAdapter } from '../../functions/api/_adapters/billing/freshbooks.js';
import { run as runRecurringCharges } from '../../functions/api/process-recurring-charges.js';

// ── A tiny awaitable/chainable Supabase stub ─────────────────────────────────
// Every table returns the same rows regardless of filters — fine because each
// test scopes its inputs. select()/eq()/order()/limit() are chainable; the chain
// is awaitable (resolves to {data}); maybeSingle() resolves to the first row.
function fakeAdmin(tables) {
  return {
    from(table) {
      const rows = tables[table] || [];
      const result = { data: rows, error: null };
      const chain = {
        select() { return chain; },
        eq()     { return chain; },
        order()  { return chain; },
        limit()  { return chain; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve) => resolve(result),
      };
      return chain;
    },
  };
}

describe('buildRateResolver — precedence', () => {
  const admin = fakeAdmin({
    billing_rates: [
      { user_id: 'u-anita', role: null, rate: '500' },
      { user_id: null, role: 'Paralegal', rate: '175' },
    ],
    billing_identity_map: [
      { identity_id: '14466269', user_id: 'u-anita', users: { hourly_rate: '250', roles: { name: 'Attorney' } } },
      { identity_id: '14471169', user_id: 'u-naomie', users: { hourly_rate: null, roles: { name: 'Paralegal' } } },
      { identity_id: '99999999', user_id: 'u-ghost', users: { hourly_rate: null, roles: { name: 'Attorney' } } },
    ],
  });

  it('forUser prefers the per-person rate', async () => {
    const r = await buildRateResolver(admin, 'c1');
    expect(r.forUser('u-anita', 'Attorney', 999)).toBe(500);
  });

  it('forUser falls back to the role rate, then the given fallback', async () => {
    const r = await buildRateResolver(admin, 'c1');
    expect(r.forUser('u-someone', 'Paralegal', 0)).toBe(175); // role match
    expect(r.forUser('u-someone', 'Attorney', 0)).toBe(0);    // no match → fallback
    expect(r.forUser('u-someone', 'Attorney', null)).toBeNull();
  });

  it('forIdentity resolves person → role → provider rate → user default', async () => {
    const r = await buildRateResolver(admin, 'c1');
    // Anita: person rate wins over provider rate.
    expect(r.forIdentity('14466269', 300)).toBe(500);
    // Naomie: no person rate, role (Paralegal) rate applies.
    expect(r.forIdentity('14471169', 0)).toBe(175);
    // Unknown identity: falls back to provider rate.
    expect(r.forIdentity('00000000', 120)).toBe(120);
  });

  it('forIdentity uses the provider rate before the user default when no portal rate', async () => {
    const r = await buildRateResolver(admin, 'c1');
    // Ghost user has no person/role rate; provider rate 130 beats hourly default.
    expect(r.forIdentity('99999999', 130)).toBe(130);
    // No provider rate and no portal rate → 0 (ghost hourly_rate is null).
    expect(r.forIdentity('99999999', 0)).toBe(0);
  });
});

describe('FreshbooksAdapter — applies per-client rates by identity_id', () => {
  function makeAdapter(entries, rates, idMap) {
    const a = new FreshbooksAdapter({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_KEY: 'x' });
    a._loadRow = async () => {};
    a.businessId = 'biz_1';
    a._findClientIdByEmail = async () => 42;
    a._get = async () => ({ time_entries: entries });
    a.admin = fakeAdmin({ billing_rates: rates, billing_identity_map: idMap });
    return a;
  }

  const ENTRIES = [
    { id: 1, client_id: 42, duration: 3600, billable_rate: '0', identity_id: 14466269, note: 'A', started_at: '2026-07-01T10:00:00Z' },
    { id: 2, client_id: 42, duration: 1800, billable_rate: '0', identity_id: 14471169, note: 'B', started_at: '2026-07-02T09:00:00Z' },
  ];

  it('computes amount = hours × per-client rate (not the 0 FreshBooks rate)', async () => {
    const a = makeAdapter(
      ENTRIES,
      [{ user_id: 'u-anita', role: null, rate: '500' }, { user_id: null, role: 'Paralegal', rate: '175' }],
      [
        { identity_id: '14466269', user_id: 'u-anita',  users: { hourly_rate: null, roles: { name: 'Attorney' } } },
        { identity_id: '14471169', user_id: 'u-naomie', users: { hourly_rate: null, roles: { name: 'Paralegal' } } },
      ],
    );
    const out = await a.pullUnbilledTimeEntries('m1', 'a@x.com', 'c1');
    const byId = Object.fromEntries(out.map(e => [e.fb_entry_id, e]));
    expect(byId[1].effective_rate).toBe(500);
    expect(byId[1].amount).toBe(500);   // 1.0h × 500
    expect(byId[2].effective_rate).toBe(175);
    expect(byId[2].amount).toBe(87.5);  // 0.5h × 175
  });

  it('without a clientId, falls back to the FreshBooks billable_rate', async () => {
    const entries = [{ id: 9, client_id: 42, duration: 3600, billable_rate: '250', identity_id: 1, started_at: '2026-07-01T10:00:00Z' }];
    const a = makeAdapter(entries, [], []);
    const out = await a.pullUnbilledTimeEntries('m1', 'a@x.com'); // no clientId
    expect(out[0].amount).toBe(250);
  });
});

// ── recurring-charges cron ───────────────────────────────────────────────────
function cronAdmin({ charges, matter }) {
  const inserted = { invoices: [], lineItems: [], updates: [] };
  let seq = 0;
  const admin = {
    from(table) {
      return {
        select() { return this; },
        eq()     { return this; },
        order()  { return this; },
        limit()  { return this; },
        maybeSingle: async () => ({ data: table === 'matters' ? matter : null, error: null }),
        insert(row) {
          if (table === 'invoices') {
            const inv = { id: `inv_${++seq}`, ...row };
            inserted.invoices.push(row);
            return { select: () => ({ single: async () => ({ data: inv, error: null }) }) };
          }
          if (table === 'invoice_line_items') { inserted.lineItems.push(row); return Promise.resolve({ error: null }); }
          return Promise.resolve({ error: null });
        },
        update(vals) { inserted.updates.push({ table, vals }); return { eq: async () => ({ error: null }) }; },
        then: (resolve) => resolve({ data: table === 'recurring_charges' ? charges : [], error: null }),
      };
    },
  };
  return { admin, inserted };
}

describe('process-recurring-charges cron', () => {
  const today = new Date();
  const day   = today.getUTCDate();

  it('creates a draft invoice + flat_fee line item for a due, un-charged fee', async () => {
    const { admin, inserted } = cronAdmin({
      charges: [{ id: 'rc1', client_id: 'c1', description: 'Monthly administrative fee', amount: '100', day_of_month: 1, last_charged_on: null }],
      matter:  { id: 'm1' },
    });
    const res = await runRecurringCharges({}, admin);
    expect(res.created).toBe(1);
    expect(inserted.invoices[0]).toMatchObject({ matter_id: 'm1', amount: '100', status: 'draft', source: 'portal' });
    expect(inserted.lineItems[0]).toMatchObject({ item_type: 'flat_fee', amount: '100' });
    expect(inserted.updates[0].vals.last_charged_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('skips a fee already charged this calendar month', async () => {
    const stamp = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const { admin, inserted } = cronAdmin({
      charges: [{ id: 'rc1', client_id: 'c1', description: 'x', amount: '100', day_of_month: 1, last_charged_on: stamp }],
      matter:  { id: 'm1' },
    });
    const res = await runRecurringCharges({}, admin);
    expect(res.created).toBe(0);
    expect(inserted.invoices).toHaveLength(0);
  });

  it('skips a fee not yet due this month (day_of_month in the future)', async () => {
    if (day >= 28) return; // can't test a future day near month-end
    const { admin, inserted } = cronAdmin({
      charges: [{ id: 'rc1', client_id: 'c1', description: 'x', amount: '100', day_of_month: 28, last_charged_on: null }],
      matter:  { id: 'm1' },
    });
    const res = await runRecurringCharges({}, admin);
    expect(res.created).toBe(0);
    expect(inserted.invoices).toHaveLength(0);
  });

  it('skips a client with no matter to attach the invoice to', async () => {
    const { admin, inserted } = cronAdmin({
      charges: [{ id: 'rc1', client_id: 'c1', description: 'x', amount: '100', day_of_month: 1, last_charged_on: null }],
      matter:  null,
    });
    const res = await runRecurringCharges({}, admin);
    expect(res.created).toBe(0);
    expect(inserted.invoices).toHaveLength(0);
  });
});
