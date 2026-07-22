// Unit tests for the invoice trust-release flow (migration 1526 era):
//   1. /api/release-invoice-trust — auth/method/param guards and RPC wiring
//      (the disbursement + mark-paid logic itself lives in the SQL RPC)
//   2. /api/send-invoice routes the payment link to the invoice's account_type,
//      falling back to the firm's trust_first setting (migration 1536) when the
//      invoice doesn't specify one. trust_first defaults ON, so a firm that has
//      never touched the setting keeps collecting into the trust account.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

const paymentMock = vi.hoisted(() => ({ getPaymentAdapter: vi.fn() }));
vi.mock('../../functions/api/_adapters/payment/index.js', () => paymentMock);

const billingMock = vi.hoisted(() => ({ getBillingAdapter: vi.fn(() => null) }));
vi.mock('../../functions/api/_adapters/billing/index.js', () => billingMock);

import { onRequest as releaseInvoiceTrust } from '../../functions/api/release-invoice-trust.js';
import { onRequest as sendInvoice }         from '../../functions/api/send-invoice.js';

function post(path, body) {
  return new Request(`http://portal.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Chainable stub whose terminal single()/maybeSingle()/await resolves to the value.
function chainResolving(value) {
  const chain = {};
  for (const m of ['select', 'eq', 'update', 'order', 'limit', 'in']) chain[m] = () => chain;
  chain.single      = async () => ({ data: value, error: null });
  chain.maybeSingle = async () => ({ data: value, error: null });
  chain.then        = (resolve) => resolve({ data: value, error: null });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'user-1' } });
});

describe('/api/release-invoice-trust', () => {
  it('rejects non-POST', async () => {
    const res = await releaseInvoiceTrust({
      request: new Request('http://portal.test/api/release-invoice-trust'), env: {},
    });
    expect(res.status).toBe(405);
  });

  it('gates on trust_accounting write and surfaces auth errors', async () => {
    helpersMock.verifyAuth.mockResolvedValue({ httpError: { status: 403, message: 'nope' } });
    const res = await releaseInvoiceTrust({ request: post('/api/release-invoice-trust', { invoice_id: 'i1' }), env: {} });
    expect(res.status).toBe(403);
    expect(helpersMock.verifyAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'write', 'trust_accounting');
  });

  it('requires invoice_id', async () => {
    const res = await releaseInvoiceTrust({ request: post('/api/release-invoice-trust', {}), env: {} });
    expect(res.status).toBe(400);
  });

  it('calls the RPC with the actor and optional check number, returns its payload', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true, ledger_entry_id: 'led-9', invoice_status: 'paid' }, error: null }));
    helpersMock.makeAdminClient.mockReturnValue({ rpc });

    const res  = await releaseInvoiceTrust({
      request: post('/api/release-invoice-trust', { invoice_id: 'inv-1', check_number: '1042' }), env: {},
    });
    const body = await res.json();

    expect(rpc).toHaveBeenCalledWith('release_invoice_from_trust', {
      p_invoice_id:   'inv-1',
      p_actor:        'user-1',
      p_check_number: '1042',
      p_note:         null,
    });
    expect(res.status).toBe(200);
    expect(body.ledger_entry_id).toBe('led-9');
  });

  it('maps RPC refusals (duplicate release, insufficient balance, …) to a 400 with the message', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'Invoice INV-0007 already has a trust release recorded' } }));
    helpersMock.makeAdminClient.mockReturnValue({ rpc });

    const res  = await releaseInvoiceTrust({ request: post('/api/release-invoice-trust', { invoice_id: 'inv-1' }), env: {} });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/already has a trust release/);
  });
});

describe('/api/send-invoice — trust-first payment-link routing', () => {
  function makeInvoice(accountType) {
    return {
      id: 'inv-1', status: 'draft', amount: 250, description: 'Legal Services',
      account_type: accountType, invoice_line_items: [],
      matters: { id: 'm1', case_number: 'C-1', clients: { id: 'c1', first_name: 'Jane', last_name: 'Doe', email: 'j@d.com' } },
    };
  }

  // Dispatch by table name rather than call order: send-invoice reads
  // firm_settings (for trust_first) in between fetching and updating the
  // invoice, and an ordered mock silently mis-wires when that changes.
  // trustFirst === undefined simulates a deployment without migration 1536.
  function run(invoice, { trustFirst } = {}) {
    let invoiceReads = 0;
    helpersMock.makeAdminClient.mockReturnValue({
      from: vi.fn((table) => {
        if (table === 'firm_settings') {
          return chainResolving(trustFirst === undefined ? {} : { trust_first: trustFirst });
        }
        invoiceReads += 1;
        return invoiceReads === 1
          ? chainResolving(invoice)                        // fetch
          : chainResolving({ ...invoice, status: 'sent' }); // update
      }),
    });
    const createPaymentRequest = vi.fn(async () => ({ paymentLink: 'https://pay/x', requestId: 'pl_1' }));
    paymentMock.getPaymentAdapter.mockReturnValue({ createPaymentRequest });
    return { createPaymentRequest, res: sendInvoice({ request: post('/api/send-invoice', { invoice_id: 'inv-1' }), env: { PAYMENT_PROVIDER: 'payload' } }) };
  }

  it("sends the invoice's account_type to the payment adapter", async () => {
    const { createPaymentRequest, res } = run(makeInvoice('operating'));
    expect((await res).status).toBe(200);
    expect(createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({ accountType: 'operating' }));
  });

  it("the invoice's own account_type wins even when the firm is trust-first", async () => {
    const { createPaymentRequest, res } = run(makeInvoice('operating'), { trustFirst: true });
    expect((await res).status).toBe(200);
    expect(createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({ accountType: 'operating' }));
  });

  it('falls back to TRUST when account_type is missing and the firm is trust-first', async () => {
    const { createPaymentRequest, res } = run(makeInvoice(null), { trustFirst: true });
    expect((await res).status).toBe(200);
    expect(createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({ accountType: 'trust' }));
  });

  it('falls back to OPERATING when account_type is missing and trust_first is off', async () => {
    const { createPaymentRequest, res } = run(makeInvoice(null), { trustFirst: false });
    expect((await res).status).toBe(200);
    expect(createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({ accountType: 'operating' }));
  });

  it('falls back to TRUST when firm_settings has no trust_first column (pre-1536 deployment)', async () => {
    const { createPaymentRequest, res } = run(makeInvoice(null));
    expect((await res).status).toBe(200);
    expect(createPaymentRequest).toHaveBeenCalledWith(expect.objectContaining({ accountType: 'trust' }));
  });
});
