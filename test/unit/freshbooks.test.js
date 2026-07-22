// Unit tests for the FreshBooks billing adapter's unbilled-time pull.
//
// Correctness guarantee under test: invoicing is ALWAYS scoped to a single
// client. The adapter must (a) refuse — never fall back to every client's time —
// when the client can't be matched in FreshBooks, and (b) return ONLY the matched
// client's entries even if the FreshBooks API hands back others.
import { describe, it, expect } from 'vitest';
import { FreshbooksAdapter } from '../../functions/api/_adapters/billing/freshbooks.js';

// Build an adapter with the network/token machinery stubbed out so we exercise
// only the scoping logic. _findClientIdByEmail resolves `matchEmail` -> 42.
function makeAdapter(entries, matchEmail, incrementMinutes = 1) {
  const a = new FreshbooksAdapter({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_KEY: 'x' });
  a._loadRow = async () => {};
  a.businessId = 'biz_1';
  a._findClientIdByEmail = async (email) => (email === matchEmail ? 42 : null);
  a._getBillingIncrement = async () => incrementMinutes;
  a._lastGetPath = null;
  a._get = async (path) => { a._lastGetPath = path; return { time_entries: entries }; };
  return a;
}

const ENTRIES = [
  { id: 1, client_id: 42, duration: 3600, billable_rate: '250', note: 'Client A work',  started_at: '2026-07-01T10:00:00Z' },
  { id: 2, client_id: 99, duration: 7200, billable_rate: '250', note: 'Client B work',  started_at: '2026-07-01T11:00:00Z' },
  { id: 3, client_id: 42, duration: 1800, billable_rate: '250', note: 'Client A more',  started_at: '2026-07-02T09:00:00Z' },
];

describe('FreshbooksAdapter.pullUnbilledTimeEntries — per-client scoping', () => {
  it('throws (never pulls all) when the matter has no client email', async () => {
    const a = makeAdapter(ENTRIES, 'a@x.com');
    await expect(a.pullUnbilledTimeEntries('m1', '')).rejects.toThrow(/no email on file/i);
  });

  it('throws (never pulls all) when no FreshBooks client matches the email', async () => {
    const a = makeAdapter(ENTRIES, 'a@x.com');
    await expect(a.pullUnbilledTimeEntries('m1', 'nobody@x.com')).rejects.toThrow(/no freshbooks client matches/i);
  });

  it("returns ONLY the matched client's entries, even if the API returns others", async () => {
    const a = makeAdapter(ENTRIES, 'a@x.com');
    const out = await a.pullUnbilledTimeEntries('m1', 'a@x.com');
    const ids = out.map(e => e.fb_entry_id).sort();
    expect(ids).toEqual([1, 3]);
    expect(out.some(e => e.fb_entry_id === 2)).toBe(false);
  });

  it('scopes the query by client_id and billed=false (not the invalid is_invoiced)', async () => {
    const a = makeAdapter(ENTRIES, 'a@x.com');
    await a.pullUnbilledTimeEntries('m1', 'a@x.com');
    expect(a._lastGetPath).toMatch(/client_id=42/);
    expect(a._lastGetPath).toMatch(/billed=false/);
    expect(a._lastGetPath).not.toMatch(/is_invoiced/);
  });

  it("requests the whole team's entries (team=true), not just the OAuth owner's", async () => {
    // Without team=true FreshBooks silently returns only entries logged by the
    // OAuth connection's owner — every other team member's time disappears.
    const a = makeAdapter(ENTRIES, 'a@x.com');
    await a.pullUnbilledTimeEntries('m1', 'a@x.com');
    expect(a._lastGetPath).toMatch(/team=true/);
  });

  it('trims surrounding whitespace on the email before matching', async () => {
    const a = makeAdapter(ENTRIES, 'a@x.com');
    const out = await a.pullUnbilledTimeEntries('m1', '  a@x.com  ');
    expect(out).toHaveLength(2);
  });
});

describe('FreshbooksAdapter.pullUnbilledTimeEntries — name fallback + unbillable', () => {
  it('falls back to a first+last name match when the FreshBooks email is blank', async () => {
    // Simulates the real bug: portal client HAS an email, but the FreshBooks
    // client record has a blank email, so the email search returns nothing.
    const a = new FreshbooksAdapter({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_KEY: 'x' });
    a._loadRow   = async () => {};
    a._getBillingIncrement = async () => 1;
    a.businessId = 'biz_1';
    a.accountId  = 'acct_1';
    a._get = async (path) => {
      if (path.includes('search[email]')) return { response: { result: { clients: [] } } };
      if (path.includes('/users/clients')) {
        return { response: { result: { pages: 1, clients: [
          { id: 77, fname: 'Kelly', lname: 'Benavides', organization: '', email: '' },
        ] } } };
      }
      return { time_entries: [
        { id: 5, client_id: 77, duration: 3600, billable_rate: '0', started_at: '2026-07-01T10:00:00Z' },
      ] };
    };
    const out = await a.pullUnbilledTimeEntries('m1', 'kelly@portal.com', null,
      { first_name: 'Kelly', last_name: 'Benavides' });
    expect(out).toHaveLength(1);
    expect(out[0].fb_entry_id).toBe(5);
  });

  it('matches by name when the PORTAL has no email on file (e.g. intake clients)', async () => {
    const a = new FreshbooksAdapter({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_KEY: 'x' });
    a._loadRow   = async () => {};
    a._getBillingIncrement = async () => 1;
    a.businessId = 'biz_1';
    a.accountId  = 'acct_1';
    a._get = async (path) => {
      if (path.includes('search[email]')) throw new Error('email search should not run without an email');
      if (path.includes('/users/clients')) {
        return { response: { result: { pages: 1, clients: [
          { id: 88, fname: 'Philip', lname: 'Hiatt Haigh', organization: '', email: '' },
        ] } } };
      }
      return { time_entries: [
        { id: 9, client_id: 88, duration: 1800, billable_rate: '0', started_at: '2026-07-01T10:00:00Z' },
      ] };
    };
    const out = await a.pullUnbilledTimeEntries('m1', '', null,
      { first_name: 'Philip', last_name: 'Hiatt Haigh' });
    expect(out).toHaveLength(1);
    expect(out[0].fb_entry_id).toBe(9);
  });

  it('still throws when neither email nor name matches a FreshBooks client', async () => {
    const a = new FreshbooksAdapter({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_KEY: 'x' });
    a._loadRow   = async () => {};
    a._getBillingIncrement = async () => 1;
    a.businessId = 'biz_1';
    a.accountId  = 'acct_1';
    a._get = async () => ({ response: { result: { pages: 1, clients: [] } } });
    await expect(
      a.pullUnbilledTimeEntries('m1', 'x@y.com', null, { first_name: 'No', last_name: 'One' })
    ).rejects.toThrow(/no freshbooks client matches/i);
  });

  it('marks a non-billable entry as no-charge (amount 0, rate null) but still returns it', async () => {
    const a = makeAdapter([
      { id: 1, client_id: 42, duration: 720,  billable_rate: '250', billable: false, started_at: '2026-07-01T10:00:00Z' },
      { id: 2, client_id: 42, duration: 3600, billable_rate: '250', billable: true,  started_at: '2026-07-01T11:00:00Z' },
    ], 'a@x.com');
    const out  = await a.pullUnbilledTimeEntries('m1', 'a@x.com');
    const byId = Object.fromEntries(out.map(e => [e.fb_entry_id, e]));
    expect(byId[1].billable).toBe(false);
    expect(byId[1].amount).toBe(0);
    expect(byId[1].rate).toBe(null);
    expect(byId[2].billable).toBe(true);
    expect(byId[2].amount).toBe(250);   // 1.0h × 250
  });
});

describe('FreshbooksAdapter.pullUnbilledTimeEntries — billing increment rounding', () => {
  // FreshBooks tracks to the minute; firms bill in fixed increments (6 min =
  // 0.1 hr standard). Billed hours round UP; actual_hours preserves the
  // tracked time so the UI can show every adjustment.
  it('rounds billed hours UP to a 6-minute increment and bills the rounded time', async () => {
    const a = makeAdapter([
      { id: 1, client_id: 42, duration: 240,  billable_rate: '250', started_at: '2026-07-01T10:00:00Z' }, // 4m call
      { id: 2, client_id: 42, duration: 1500, billable_rate: '250', started_at: '2026-07-01T11:00:00Z' }, // 25m draft
    ], 'a@x.com', 6);
    const out  = await a.pullUnbilledTimeEntries('m1', 'a@x.com');
    const byId = Object.fromEntries(out.map(e => [e.fb_entry_id, e]));
    expect(byId[1].hours).toBe(0.1);          // 4m  → 0.1h
    expect(byId[1].actual_hours).toBe(0.07);  // tracked time preserved
    expect(byId[1].amount).toBe(25);          // 0.1 × 250, not 0.07 × 250
    expect(byId[2].hours).toBe(0.5);          // 25m → 0.5h
    expect(byId[2].amount).toBe(125);
  });

  it('leaves time already on an increment boundary unchanged', async () => {
    const a = makeAdapter([
      { id: 1, client_id: 42, duration: 360,  billable_rate: '250', started_at: '2026-07-01T10:00:00Z' }, // exactly 6m
      { id: 2, client_id: 42, duration: 3600, billable_rate: '250', started_at: '2026-07-01T11:00:00Z' }, // exactly 1h
    ], 'a@x.com', 6);
    const out  = await a.pullUnbilledTimeEntries('m1', 'a@x.com');
    const byId = Object.fromEntries(out.map(e => [e.fb_entry_id, e]));
    expect(byId[1].hours).toBe(0.1);
    expect(byId[2].hours).toBe(1);
  });

  it('increment 1 (default) preserves the historical faithful conversion', async () => {
    const a = makeAdapter([
      { id: 1, client_id: 42, duration: 240, billable_rate: '250', started_at: '2026-07-01T10:00:00Z' },
    ], 'a@x.com', 1);
    const out = await a.pullUnbilledTimeEntries('m1', 'a@x.com');
    expect(out[0].hours).toBe(0.07);         // 4m tracked, 4m billed
    expect(out[0].actual_hours).toBe(0.07);
    expect(out[0].amount).toBe(17.5);
  });

  it('a zero-duration entry stays zero — never rounded up to a billable block', async () => {
    const a = makeAdapter([
      { id: 1, client_id: 42, duration: 0, billable_rate: '250', started_at: '2026-07-01T10:00:00Z' },
    ], 'a@x.com', 6);
    const out = await a.pullUnbilledTimeEntries('m1', 'a@x.com');
    expect(out[0].hours).toBe(0);
    expect(out[0].amount).toBe(0);
  });
});
