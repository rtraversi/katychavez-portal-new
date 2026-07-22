// Unit tests for /api/void-invoice — voiding must return BOTH the time
// entries and the expenses to the unbilled pool. (Expenses were stranded
// before: create-invoice stamps expenses.invoice_id/billed, but void never
// released them, so they could never be billed again.)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { onRequest as voidInvoice } from '../../functions/api/void-invoice.js';

function post(body) {
  return new Request('http://portal.test/api/void-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function voidAdmin({ invoice, hasDisbursement = false } = {}) {
  const ops = { timeUpdate: null, expenseUpdate: null, statusUpdate: null };
  const admin = {
    from(table) {
      if (table === 'invoices') {
        return {
          select() { return this; },
          eq()     { return this; },
          single:  async () => ({ data: invoice, error: null }),
          update(vals) {
            ops.statusUpdate = vals;
            return { eq: () => ({ select: () => ({ single: async () => ({ data: { ...invoice, ...vals }, error: null }) }) }) };
          },
        };
      }
      if (table === 'trust_ledger_entries') {
        return {
          select() { return this; },
          eq()     { return this; },
          limit()  { return this; },
          single:  async () => ({ data: hasDisbursement ? { id: 'tl-1' } : null, error: null }),
        };
      }
      if (table === 'time_entries') {
        return {
          update(vals) { return { in: async (col, ids) => { ops.timeUpdate = { vals, ids }; return { error: null }; } }; },
        };
      }
      if (table === 'expenses') {
        return {
          update(vals) { return { eq: async (col, val) => { ops.expenseUpdate = { vals, col, val }; return { error: null }; } }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin, ops };
}

beforeEach(() => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'user-1' } });
});

describe('/api/void-invoice', () => {
  const INVOICE = {
    id: 'inv-1',
    status: 'sent',
    invoice_line_items: [
      { time_entry_id: 'te-1' },
      { time_entry_id: null },   // expense line
    ],
  };

  it('returns time entries AND expenses to the unbilled pool', async () => {
    const { admin, ops } = voidAdmin({ invoice: INVOICE });
    helpersMock.makeAdminClient.mockReturnValue(admin);

    const res = await voidInvoice({ request: post({ invoice_id: 'inv-1' }), env: {} });
    expect(res.status).toBe(200);
    expect(ops.timeUpdate.vals).toEqual({ status: 'unbilled' });
    expect(ops.timeUpdate.ids).toEqual(['te-1']);
    expect(ops.expenseUpdate.vals).toEqual({ billed: false, invoice_id: null });
    expect(ops.expenseUpdate.col).toBe('invoice_id');
    expect(ops.expenseUpdate.val).toBe('inv-1');
    expect(ops.statusUpdate).toEqual({ status: 'void' });
  });

  it('refuses when trust disbursements exist and releases nothing', async () => {
    const { admin, ops } = voidAdmin({ invoice: INVOICE, hasDisbursement: true });
    helpersMock.makeAdminClient.mockReturnValue(admin);

    const res = await voidInvoice({ request: post({ invoice_id: 'inv-1' }), env: {} });
    expect(res.status).toBe(400);
    expect(ops.timeUpdate).toBeNull();
    expect(ops.expenseUpdate).toBeNull();
  });

  it('rejects paid and already-void invoices', async () => {
    for (const status of ['paid', 'void']) {
      const { admin } = voidAdmin({ invoice: { ...INVOICE, status } });
      helpersMock.makeAdminClient.mockReturnValue(admin);
      const res = await voidInvoice({ request: post({ invoice_id: 'inv-1' }), env: {} });
      expect(res.status).toBe(400);
    }
  });
});
