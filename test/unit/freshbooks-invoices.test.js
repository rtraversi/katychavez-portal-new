// Unit tests for the FreshBooks-first invoice flow adapter methods
// (listUnpaidInvoices, getInvoice, getInvoicePdf) — see FB-FIRST-INVOICE-PLAN.md.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FreshbooksAdapter } from '../../functions/api/_adapters/billing/freshbooks.js';

function makeAdapter() {
  const a = new FreshbooksAdapter({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_KEY: 'x' });
  a._loadRow  = async () => {};
  a.accountId = 'acct_1';
  return a;
}

describe('FreshbooksAdapter.listUnpaidInvoices', () => {
  it('excludes only paid, keeps draft/sent/viewed/partial/overdue', async () => {
    const a = makeAdapter();
    a._get = async () => ({
      response: { result: { pages: 1, invoices: [
        { id: 1, v3_status: 'draft',    organization: 'A' },
        { id: 2, v3_status: 'sent',     organization: 'B' },
        { id: 3, v3_status: 'paid',     organization: 'C' },
        { id: 4, v3_status: 'viewed',   organization: 'D' },
        { id: 5, v3_status: 'partial',  organization: 'E' },
        { id: 6, v3_status: 'overdue',  organization: 'F' },
      ] } },
    });
    const out = await a.listUnpaidInvoices();
    expect(out.map(i => i.externalId).sort()).toEqual(['1', '2', '4', '5', '6']);
  });

  it('normalizes amount/outstanding objects and client name fields', async () => {
    const a = makeAdapter();
    a._get = async () => ({
      response: { result: { pages: 1, invoices: [
        {
          id: 9, v3_status: 'sent', invoice_number: '0000009',
          fname: 'Larry', lname: 'Robinson', email: 'larry@x.com',
          amount: { amount: '5340.00', code: 'USD' },
          outstanding: { amount: '5340.00', code: 'USD' },
          create_date: '2026-07-16', notes: 'Legal services',
        },
      ] } },
    });
    const [out] = await a.listUnpaidInvoices();
    expect(out).toMatchObject({
      externalId: '9',
      invoiceNumber: '0000009',
      clientName: 'Larry Robinson',
      clientEmail: 'larry@x.com',
      amount: 5340,
      outstanding: 5340,
      v3Status: 'sent',
    });
  });

  it('paginates via _getAllPages', async () => {
    const a = makeAdapter();
    let calls = 0;
    a._get = async (path) => {
      calls++;
      const page = /page=(\d+)/.exec(path)[1];
      if (page === '1') return { response: { result: { pages: 2, invoices: [{ id: 1, v3_status: 'sent' }] } } };
      return { response: { result: { pages: 2, invoices: [{ id: 2, v3_status: 'sent' }] } } };
    };
    const out = await a.listUnpaidInvoices();
    expect(calls).toBe(2);
    expect(out.map(i => i.externalId).sort()).toEqual(['1', '2']);
  });
});

describe('FreshbooksAdapter.getInvoice', () => {
  it('normalizes a single invoice with line items', async () => {
    const a = makeAdapter();
    a._get = async () => ({
      response: { result: { invoice: {
        id: 25, v3_status: 'sent', invoice_number: '0000025',
        fname: 'Larry', lname: 'Robinson',
        outstanding: { amount: '5340.00' }, amount: { amount: '5340.00' },
        lines: [
          { name: 'Time', amount: { amount: '17.50' }, qty: '0.1', unit_cost: { amount: '175.00' } },
          { name: 'Time', amount: { amount: '2250.00' }, qty: '4.5', unit_cost: { amount: '500.00' } },
        ],
      } } },
    });
    const inv = await a.getInvoice('25');
    expect(inv.externalId).toBe('25');
    expect(inv.lineItems).toHaveLength(2);
    expect(inv.lineItems[0]).toMatchObject({ name: 'Time', amount: 17.5, quantity: 0.1, unitCost: 175 });
  });

  it('throws when FreshBooks returns no invoice', async () => {
    const a = makeAdapter();
    a._get = async () => ({ response: { result: {} } });
    await expect(a.getInvoice('999')).rejects.toThrow(/not found/i);
  });
});

describe('FreshbooksAdapter.getInvoicePdf — never throws, degrades gracefully', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns null (not a throw) when the FB API call itself fails', async () => {
    const a = makeAdapter();
    a._get = async () => { throw new Error('FreshBooks API error 500'); };
    const out = await a.getInvoicePdf('25');
    expect(out).toBeNull();
  });

  it('returns null when no share link is present on the response', async () => {
    const a = makeAdapter();
    a._get = async () => ({ response: { result: { invoice: {} } } });
    const out = await a.getInvoicePdf('25');
    expect(out).toBeNull();
  });

  it('returns null when the share link does not serve a PDF content-type', async () => {
    const a = makeAdapter();
    a._get = async () => ({ response: { result: { invoice: { share_link: 'https://fb.example/view/25' } } } });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html' },
    })));
    const out = await a.getInvoicePdf('25');
    expect(out).toBeNull();
  });

  it('returns the PDF buffer + contentType when the share link serves a real PDF', async () => {
    const a = makeAdapter();
    a._get = async () => ({ response: { result: { invoice: { share_link: 'https://fb.example/view/25' } } } });
    const fakeBuf = new ArrayBuffer(8);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/pdf' },
      arrayBuffer: async () => fakeBuf,
    })));
    const out = await a.getInvoicePdf('25');
    expect(out).toEqual({ buffer: fakeBuf, contentType: 'application/pdf' });
  });

  it('returns null when the share link fetch itself fails (non-ok response)', async () => {
    const a = makeAdapter();
    a._get = async () => ({ response: { result: { invoice: { share_link: 'https://fb.example/view/25' } } } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const out = await a.getInvoicePdf('25');
    expect(out).toBeNull();
  });
});

describe('FreshbooksAdapter.createPrepaymentCredit', () => {
  it('creates a prepayment credit_note under the matched FB client', async () => {
    const a = makeAdapter();
    a._findClientIdByEmail = async (email) => (email === 'kelly@x.com' ? 777 : null);
    let posted;
    a._post = async (path, body) => {
      posted = { path, body };
      return { response: { result: { credit_note: { id: 55, credit_number: 'CR-55' } } } };
    };

    const out = await a.createPrepaymentCredit({
      clientEmail: 'kelly@x.com',
      clientName:  { first_name: 'Kelly', last_name: 'Benevidez' },
      amount:      2500,
      date:        '2026-07-17T12:00:00Z',
      note:        'Retainer',
    });

    expect(out).toEqual({ creditId: '55', creditNumber: 'CR-55' });
    expect(posted.path).toBe('/accounting/account/acct_1/credit_notes/credit_notes');
    expect(posted.body.credit_note).toMatchObject({
      clientid:    777,
      credit_type: 'prepayment',
      create_date: '2026-07-17',
    });
    expect(posted.body.credit_note.lines[0].unit_cost.amount).toBe('2500');
  });

  it('falls back to name matching when the email finds no FB client', async () => {
    const a = makeAdapter();
    a._findClientIdByEmail = async () => null;
    a._findClientIdByName  = async (name) => (name?.first_name === 'Kelly' ? 888 : null);
    a._post = async () => ({ response: { result: { credit_note: { id: 56 } } } });

    const out = await a.createPrepaymentCredit({
      clientEmail: 'wrong@x.com',
      clientName:  { first_name: 'Kelly', last_name: 'Benevidez' },
      amount:      100,
    });
    expect(out.creditId).toBe('56');
  });

  it('throws (for the caller to catch) when no FB client matches', async () => {
    const a = makeAdapter();
    a._findClientIdByEmail = async () => null;
    a._findClientIdByName  = async () => null;
    await expect(a.createPrepaymentCredit({
      clientEmail: 'nobody@x.com',
      clientName:  { first_name: 'No', last_name: 'Body' },
      amount:      100,
    })).rejects.toThrow(/No FreshBooks client matches/i);
  });

  it('throws when FreshBooks returns no credit_note', async () => {
    const a = makeAdapter();
    a._findClientIdByEmail = async () => 777;
    a._post = async () => ({ response: { result: {} } });
    await expect(a.createPrepaymentCredit({ clientEmail: 'kelly@x.com', amount: 100 }))
      .rejects.toThrow(/no credit_note/i);
  });
});
