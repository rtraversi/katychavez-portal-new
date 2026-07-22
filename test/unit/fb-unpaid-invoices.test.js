// Unit tests for /api/fb-unpaid-invoices — the "From FreshBooks" picker's
// source list, with best-effort matter guessing. See FB-FIRST-INVOICE-PLAN.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

const billingMock = vi.hoisted(() => ({ getBillingAdapter: vi.fn() }));
vi.mock('../../functions/api/_adapters/billing/index.js', () => billingMock);

import { onRequest as fbUnpaidInvoices } from '../../functions/api/fb-unpaid-invoices.js';

function get() {
  return new Request('http://portal.test/api/fb-unpaid-invoices', { method: 'GET' });
}

function makeAdmin(clientsByEmail, mirroredExtIds = []) {
  return {
    from(table) {
      if (table === 'clients') {
        return {
          select: () => ({
            in: async (_col, emails) => ({
              data: emails.map(e => clientsByEmail[e]).filter(Boolean),
              error: null,
            }),
          }),
        };
      }
      if (table === 'invoices') {
        // Cross-reference for already-mirrored FB invoices (source='freshbooks').
        return {
          select: () => ({
            eq: () => ({
              in: async (_col, ids) => ({
                data: ids
                  .filter(id => mirroredExtIds.includes(String(id)))
                  .map(id => ({ external_id: String(id) })),
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/fb-unpaid-invoices', () => {
  it('reports not connected when no billing adapter is configured', async () => {
    helpersMock.verifyAuth.mockResolvedValue({ admin: makeAdmin({}) });
    billingMock.getBillingAdapter.mockReturnValue(null);

    const res  = await fbUnpaidInvoices({ request: get(), env: {} });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.connected).toBe(false);
    expect(body.invoices).toEqual([]);
  });

  it('502s when the FreshBooks call fails', async () => {
    helpersMock.verifyAuth.mockResolvedValue({ admin: makeAdmin({}) });
    billingMock.getBillingAdapter.mockReturnValue({
      listUnpaidInvoices: vi.fn(async () => { throw new Error('FreshBooks API error 401'); }),
    });

    const res = await fbUnpaidInvoices({ request: get(), env: {} });
    expect(res.status).toBe(502);
  });

  it('sets matter_guess for a client with exactly one active matter', async () => {
    const admin = makeAdmin({
      'larry@x.com': { email: 'larry@x.com', matters: [{ id: 'm1', case_number: 'CN-1', status: 'active' }] },
    });
    helpersMock.verifyAuth.mockResolvedValue({ admin });
    billingMock.getBillingAdapter.mockReturnValue({
      listUnpaidInvoices: vi.fn(async () => [{ externalId: '1', clientEmail: 'larry@x.com', amount: 100, outstanding: 100 }]),
    });

    const res  = await fbUnpaidInvoices({ request: get(), env: {} });
    const body = await res.json();
    expect(body.invoices[0].matter_guess).toEqual({ id: 'm1', case_number: 'CN-1' });
    expect(body.invoices[0].matter_options).toEqual([]);
  });

  it('offers matter_options (no single guess) when a client has multiple active matters', async () => {
    const admin = makeAdmin({
      'larry@x.com': {
        email: 'larry@x.com',
        matters: [
          { id: 'm1', case_number: 'CN-1', status: 'active' },
          { id: 'm2', case_number: 'CN-2', status: 'intake' },
        ],
      },
    });
    helpersMock.verifyAuth.mockResolvedValue({ admin });
    billingMock.getBillingAdapter.mockReturnValue({
      listUnpaidInvoices: vi.fn(async () => [{ externalId: '1', clientEmail: 'larry@x.com', amount: 100, outstanding: 100 }]),
    });

    const res  = await fbUnpaidInvoices({ request: get(), env: {} });
    const body = await res.json();
    expect(body.invoices[0].matter_guess).toBeNull();
    expect(body.invoices[0].matter_options).toHaveLength(2);
  });

  it('ignores closed/inactive matters when guessing', async () => {
    const admin = makeAdmin({
      'larry@x.com': {
        email: 'larry@x.com',
        matters: [{ id: 'm1', case_number: 'CN-1', status: 'closed' }],
      },
    });
    helpersMock.verifyAuth.mockResolvedValue({ admin });
    billingMock.getBillingAdapter.mockReturnValue({
      listUnpaidInvoices: vi.fn(async () => [{ externalId: '1', clientEmail: 'larry@x.com', amount: 100, outstanding: 100 }]),
    });

    const res  = await fbUnpaidInvoices({ request: get(), env: {} });
    const body = await res.json();
    expect(body.invoices[0].matter_guess).toBeNull();
    expect(body.invoices[0].matter_options).toEqual([]);
  });

  it('excludes FB invoices already mirrored into the portal', async () => {
    const admin = makeAdmin(
      { 'larry@x.com': { email: 'larry@x.com', matters: [{ id: 'm1', case_number: 'CN-1', status: 'active' }] } },
      ['27'], // #27 already mirrored → should be dropped
    );
    helpersMock.verifyAuth.mockResolvedValue({ admin });
    billingMock.getBillingAdapter.mockReturnValue({
      listUnpaidInvoices: vi.fn(async () => [
        { externalId: '27', clientEmail: 'larry@x.com', amount: 1475, outstanding: 1475 },
        { externalId: '28', clientEmail: 'larry@x.com', amount: 100,  outstanding: 100  },
      ]),
    });

    const res  = await fbUnpaidInvoices({ request: get(), env: {} });
    const body = await res.json();
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0].externalId).toBe('28');
  });

  it('leaves matter_guess null when the FB invoice has no client email', async () => {
    helpersMock.verifyAuth.mockResolvedValue({ admin: makeAdmin({}) });
    billingMock.getBillingAdapter.mockReturnValue({
      listUnpaidInvoices: vi.fn(async () => [{ externalId: '1', clientEmail: null, amount: 100, outstanding: 100 }]),
    });

    const res  = await fbUnpaidInvoices({ request: get(), env: {} });
    const body = await res.json();
    expect(body.invoices[0].matter_guess).toBeNull();
  });
});
