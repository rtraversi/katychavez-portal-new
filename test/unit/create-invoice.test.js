// Unit tests for /api/create-invoice (migration 1531 era):
//   - $0 "no charge" line items are accepted alongside billable ones (the DB
//     check is now amount >= 0) and their time entries still get marked billed
//   - an all-zero invoice is still rejected by the endpoint's total guard
//   - a line-item insert failure rolls back the parent invoice (the failure
//     mode the old amount > 0 constraint used to trigger)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { onRequest as createInvoice } from '../../functions/api/create-invoice.js';

function post(body) {
  return new Request('http://portal.test/api/create-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Admin stub covering the tables create-invoice touches.
function makeAdmin({ itemsError = null } = {}) {
  const state = { invoiceRow: null, lineItems: null, deletedInvoiceIds: [], billedEntryIds: null };
  const admin = {
    from(table) {
      if (table === 'invoices') {
        return {
          insert(row) {
            state.invoiceRow = row;
            return { select: () => ({ single: async () => ({ data: { id: 'inv-1', ...row }, error: null }) }) };
          },
          delete() {
            return { eq: async (_col, id) => { state.deletedInvoiceIds.push(id); return { error: null }; } };
          },
        };
      }
      if (table === 'invoice_line_items') {
        return {
          insert: async (items) => { state.lineItems = items; return { error: itemsError }; },
          // consumed-external-ids lookup (1533): nothing consumed in these tests
          select() { const c = { not: () => c, neq: () => c, then: (resolve) => resolve({ data: [], error: null }) }; return c; },
        };
      }
      if (table === 'time_entries') {
        return { update: () => ({ in: async (_col, ids) => { state.billedEntryIds = ids; return { error: null }; } }) };
      }
      if (table === 'expenses') {
        const chain = { in: () => chain, eq: () => chain, then: (resolve) => resolve({ error: null }) };
        return { update: () => chain };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin, state };
}

const UUID_BILLABLE  = '11111111-1111-4111-8111-111111111111';
const UUID_NO_CHARGE = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'user-1' } });
});

describe('/api/create-invoice — no-charge line items', () => {
  it('accepts a $0 line alongside billable ones and marks both time entries billed', async () => {
    const { admin, state } = makeAdmin();
    helpersMock.makeAdminClient.mockReturnValue(admin);

    const res = await createInvoice({
      request: post({
        matter_id: 'm1',
        line_items: [
          { time_entry_id: UUID_BILLABLE,  description: 'Drafted motion',  hours: 1,   rate: 500, amount: 500, item_type: 'time' },
          { time_entry_id: UUID_NO_CHARGE, description: 'Courtesy call',   hours: 0.1, rate: 0,   amount: 0,   item_type: 'time' },
          { time_entry_id: 'fb_344181434', description: 'Pulled FB entry', hours: 0.5, rate: 175, amount: 87.5, item_type: 'time' },
          { expense_id: '33333333-3333-4333-8333-333333333333', description: 'Filing fee — Petition', amount: 350, item_type: 'expense' },
        ],
      }),
      env: {},
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(state.invoiceRow.amount).toBe(937.5);

    const byDesc = Object.fromEntries(state.lineItems.map(li => [li.description, li]));
    expect(byDesc['Courtesy call'].amount).toBe(0);
    expect(byDesc['Courtesy call'].time_entry_id).toBe(UUID_NO_CHARGE);
    expect(byDesc['Pulled FB entry'].time_entry_id).toBeNull();
    // Expense lines carry their expense pointer (1532) so draft editing can un-bill them.
    expect(byDesc['Filing fee — Petition'].expense_id).toBe('33333333-3333-4333-8333-333333333333');

    // No-charge portal entry is billed too — it must leave the unbilled list.
    expect(state.billedEntryIds).toEqual([UUID_BILLABLE, UUID_NO_CHARGE]);
    expect(body.invoice.invoice_line_items).toHaveLength(4);
  });

  it('still rejects an all-zero invoice before touching the DB', async () => {
    const res = await createInvoice({
      request: post({
        matter_id: 'm1',
        line_items: [{ time_entry_id: UUID_NO_CHARGE, description: 'Courtesy call', hours: 0.1, rate: 0, amount: 0, item_type: 'time' }],
      }),
      env: {},
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/greater than zero/);
    expect(helpersMock.makeAdminClient).not.toHaveBeenCalled();
  });

  it('rolls back the parent invoice when the line-item insert fails', async () => {
    const { admin, state } = makeAdmin({ itemsError: { message: 'violates check constraint "invoice_line_items_amount_check"' } });
    helpersMock.makeAdminClient.mockReturnValue(admin);

    const res = await createInvoice({
      request: post({
        matter_id: 'm1',
        line_items: [{ time_entry_id: UUID_BILLABLE, description: 'Drafted motion', hours: 1, rate: 500, amount: 500, item_type: 'time' }],
      }),
      env: {},
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/check constraint/);
    expect(state.deletedInvoiceIds).toEqual(['inv-1']);
    expect(state.billedEntryIds).toBeNull();
  });
});
