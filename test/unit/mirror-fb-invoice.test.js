// Unit tests for /api/mirror-fb-invoice — the FreshBooks-first invoice flow
// (see FB-FIRST-INVOICE-PLAN.md): mirror a FB invoice, attach a Payload trust
// pay-link, mark it Sent in FreshBooks, best-effort store the PDF.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:       vi.fn(),
  sanitizeFilename: (s) => s.replace(/[^a-zA-Z0-9._-]/g, '_'),
  deleteR2Object:   vi.fn(async () => {}),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

const billingMock = vi.hoisted(() => ({ getBillingAdapter: vi.fn() }));
vi.mock('../../functions/api/_adapters/billing/index.js', () => billingMock);

const paymentMock = vi.hoisted(() => ({ getPaymentAdapter: vi.fn() }));
vi.mock('../../functions/api/_adapters/payment/index.js', () => paymentMock);

import { onRequest as mirrorFbInvoice } from '../../functions/api/mirror-fb-invoice.js';

function post(body) {
  return new Request('http://portal.test/api/mirror-fb-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MATTER = {
  id: 'm1', case_number: 'CN-1',
  clients: { id: 'c1', first_name: 'Larry', last_name: 'Robinson', email: 'larry@x.com' },
};

function makeAdmin({ existingInvoice = null, matter = MATTER, lineItemsError = null, documentsError = null } = {}) {
  const state = { insertedInvoice: null, updates: {}, lineItems: null, documentInsert: null, versionInsert: null };

  const admin = {
    from(table) {
      if (table === 'invoices') {
        return {
          select() {
            const b = {
              eq()          { return b; },
              maybeSingle: async () => ({ data: existingInvoice, error: null }),
              single:      async () => ({
                data: { id: 'inv-1', invoice_number: 'INV-0001', ...state.insertedInvoice, ...state.updates },
                error: null,
              }),
            };
            return b;
          },
          insert(row) {
            state.insertedInvoice = row;
            return { select: () => ({ single: async () => ({ data: { id: 'inv-1', invoice_number: 'INV-0001', ...row }, error: null }) }) };
          },
          update(updates) {
            Object.assign(state.updates, updates);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'matters') {
        return { select: () => ({ eq: () => ({ single: async () => (matter ? { data: matter, error: null } : { data: null, error: { message: 'not found' } }) }) }) };
      }
      if (table === 'invoice_line_items') {
        return { insert: async (items) => { state.lineItems = items; return { error: lineItemsError }; } };
      }
      if (table === 'documents') {
        return { insert: async (row) => { state.documentInsert = row; return { error: documentsError }; } };
      }
      if (table === 'document_versions') {
        return { insert: async (row) => { state.versionInsert = row; return { error: null }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin, state };
}

const FB_INVOICE = {
  externalId: '25', invoiceNumber: '0000025', clientName: 'Larry Robinson', clientEmail: 'larry@x.com',
  amount: 5340, outstanding: 5340, description: 'Legal services',
  lineItems: [{ name: 'Time', amount: 5340, quantity: 1, unitCost: 5340 }],
};

function makeBillingAdapter(overrides = {}) {
  return {
    getInvoice:               vi.fn(async () => FB_INVOICE),
    sendInvoiceWithPaymentLink: vi.fn(async () => {}),
    getInvoicePdf:            vi.fn(async () => ({ buffer: new ArrayBuffer(8), contentType: 'application/pdf' })),
    ...overrides,
  };
}

function makePaymentAdapter(overrides = {}) {
  return {
    createPaymentRequest: vi.fn(async () => ({ paymentLink: 'https://pay.example/x', requestId: 'req_1' })),
    ...overrides,
  };
}

const ENV = { R2: { put: vi.fn(async () => {}) }, PAYMENT_PROVIDER: 'payload' };

beforeEach(() => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'user-1' } });
});

describe('/api/mirror-fb-invoice — validation', () => {
  it('requires external_id and matter_id', async () => {
    const res = await mirrorFbInvoice({ request: post({}), env: ENV });
    expect(res.status).toBe(400);
  });
});

describe('/api/mirror-fb-invoice — happy path', () => {
  it('mirrors the invoice, generates a trust pay link, sends via FreshBooks, and stores the PDF', async () => {
    const { admin, state } = makeAdmin();
    helpersMock.verifyAuth.mockImplementation(async () => ({ admin, profile: { id: 'user-1' } }));
    const billingAdapter = makeBillingAdapter();
    const paymentAdapter = makePaymentAdapter();
    billingMock.getBillingAdapter.mockReturnValue(billingAdapter);
    paymentMock.getPaymentAdapter.mockReturnValue(paymentAdapter);

    const res  = await mirrorFbInvoice({ request: post({ external_id: '25', matter_id: 'm1' }), env: ENV });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(state.insertedInvoice).toMatchObject({
      matter_id: 'm1', amount: 5340, status: 'sent', source: 'freshbooks',
      external_id: '25', account_type: 'trust', created_by: 'user-1',
    });
    expect(state.insertedInvoice.sent_at).toBeTruthy();

    expect(paymentAdapter.createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({
      clientEmail: 'larry@x.com', accountType: 'trust',
    }));
    expect(billingAdapter.sendInvoiceWithPaymentLink).toHaveBeenCalledWith('25', 'https://pay.example/x', 'larry@x.com');

    expect(ENV.R2.put).toHaveBeenCalled();
    expect(state.documentInsert).toMatchObject({
      matter_id: 'm1', source: 'freshbooks', client_visible: true, scan_status: 'skipped', doc_type: 'financial',
    });
    expect(state.updates.pdf_document_id).toBe(state.documentInsert.id);
    expect(body.warnings).toEqual([]);
  });
});

describe('/api/mirror-fb-invoice — idempotency', () => {
  it('returns the existing mirror instead of creating a duplicate', async () => {
    const existing = { id: 'inv-existing', external_id: '25', source: 'freshbooks' };
    const { admin } = makeAdmin({ existingInvoice: existing });
    helpersMock.verifyAuth.mockImplementation(async () => ({ admin, profile: { id: 'user-1' } }));
    const billingAdapter = makeBillingAdapter();
    billingMock.getBillingAdapter.mockReturnValue(billingAdapter);

    const res  = await mirrorFbInvoice({ request: post({ external_id: '25', matter_id: 'm1' }), env: ENV });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.invoice.id).toBe('inv-existing');
    expect(body.warnings[0]).toMatch(/already mirrored/i);
    expect(billingAdapter.getInvoice).not.toHaveBeenCalled();
  });
});

describe('/api/mirror-fb-invoice — error paths', () => {
  it('404s when the matter does not exist', async () => {
    const { admin } = makeAdmin({ matter: null });
    helpersMock.verifyAuth.mockImplementation(async () => ({ admin, profile: { id: 'user-1' } }));
    billingMock.getBillingAdapter.mockReturnValue(makeBillingAdapter());

    const res = await mirrorFbInvoice({ request: post({ external_id: '25', matter_id: 'm1' }), env: ENV });
    expect(res.status).toBe(404);
  });

  it('502s when no billing adapter is configured', async () => {
    const { admin } = makeAdmin();
    helpersMock.verifyAuth.mockImplementation(async () => ({ admin, profile: { id: 'user-1' } }));
    billingMock.getBillingAdapter.mockReturnValue(null);

    const res = await mirrorFbInvoice({ request: post({ external_id: '25', matter_id: 'm1' }), env: ENV });
    expect(res.status).toBe(502);
  });

  it('still returns the mirrored invoice (with a warning) when the FreshBooks send fails', async () => {
    const { admin, state } = makeAdmin();
    helpersMock.verifyAuth.mockImplementation(async () => ({ admin, profile: { id: 'user-1' } }));
    const billingAdapter = makeBillingAdapter({
      sendInvoiceWithPaymentLink: vi.fn(async () => { throw new Error('FreshBooks API error 401'); }),
    });
    billingMock.getBillingAdapter.mockReturnValue(billingAdapter);
    paymentMock.getPaymentAdapter.mockReturnValue(makePaymentAdapter());

    const res  = await mirrorFbInvoice({ request: post({ external_id: '25', matter_id: 'm1' }), env: ENV });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(state.insertedInvoice.status).toBe('sent'); // mirror still happened
    expect(body.warnings.some(w => /FreshBooks/i.test(w))).toBe(true);
  });

  it('still returns the mirrored invoice (with a warning) when the PDF cannot be fetched', async () => {
    const { admin } = makeAdmin();
    helpersMock.verifyAuth.mockImplementation(async () => ({ admin, profile: { id: 'user-1' } }));
    const billingAdapter = makeBillingAdapter({ getInvoicePdf: vi.fn(async () => null) });
    billingMock.getBillingAdapter.mockReturnValue(billingAdapter);
    paymentMock.getPaymentAdapter.mockReturnValue(makePaymentAdapter());

    const res  = await mirrorFbInvoice({ request: post({ external_id: '25', matter_id: 'm1' }), env: ENV });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.warnings.some(w => /PDF/i.test(w))).toBe(true);
    expect(ENV.R2.put).not.toHaveBeenCalled();
  });

  it('rejects a FreshBooks invoice with no outstanding balance', async () => {
    const { admin } = makeAdmin();
    helpersMock.verifyAuth.mockImplementation(async () => ({ admin, profile: { id: 'user-1' } }));
    billingMock.getBillingAdapter.mockReturnValue(makeBillingAdapter({
      getInvoice: vi.fn(async () => ({ ...FB_INVOICE, amount: 0, outstanding: 0 })),
    }));

    const res = await mirrorFbInvoice({ request: post({ external_id: '25', matter_id: 'm1' }), env: ENV });
    expect(res.status).toBe(400);
  });
});
