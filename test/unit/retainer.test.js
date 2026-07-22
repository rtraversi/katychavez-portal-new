// Unit tests for the retainer / trust-routing path of the Payload payment adapter.
// The compliance-critical guarantee: a retainer (accountType:'trust') is sent to the
// IOLTA processing account, never the operating account. Fees are handled Payload-side.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PayloadAdapter } from '../../functions/api/_adapters/payment/payload.js';

const ENV = {
  PAYLOAD_SECRET_KEY:           'sk_test_123',
  PAYLOAD_OPERATING_ACCOUNT_ID: 'acct_operating',
  PAYLOAD_TRUST_ACCOUNT_ID:     'acct_trust',
  PAYLOAD_WEBHOOK_SECRET:       'whsec_abc',
};

let lastRequest;
let txnResponse; // what GET /transactions/{id} returns (webhook read-back)

beforeEach(() => {
  lastRequest = null;
  txnResponse = { id: 'txn_1', status: 'processed', type: 'payment', payment_link_id: 'pl_link_789', amount: 5000 };
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    // Webhook verification reads the transaction back from the API (GET).
    if (String(url).includes('/transactions/')) {
      lastRequest = { url, opts };
      return { ok: true, status: 200, json: async () => txnResponse };
    }
    // Adapter sends application/x-www-form-urlencoded, not JSON.
    const body = Object.fromEntries(new URLSearchParams(opts.body).entries());
    lastRequest = { url, opts, body };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'pl_link_789', url: 'https://pay.payload.com/pl_link_789' }),
    };
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('PayloadAdapter — trust routing', () => {
  it('routes a retainer to the TRUST processing account', async () => {
    const adapter = new PayloadAdapter(ENV);
    const res = await adapter.createPaymentRequest({
      amount: 5000, clientEmail: 'c@example.com', clientName: 'Jane Doe',
      description: 'Retainer', accountType: 'trust',
    });

    expect(lastRequest.body.processing_id).toBe('acct_trust');
    expect(lastRequest.body.amount).toBe('5000'); // form-urlencoded → string
    expect(lastRequest.body.type).toBe('one_time');
    // billing_contact is READ-ONLY on PaymentLink — sending it makes Payload 500,
    // so we must NOT include it in the create request.
    expect(lastRequest.body['billing_contact[name]']).toBeUndefined();
    expect(lastRequest.body['billing_contact[email]']).toBeUndefined();
    expect(lastRequest.opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(res.paymentLink).toBe('https://pay.payload.com/pl_link_789');
    expect(res.requestId).toBe('pl_link_789');
  });

  it('routes a normal invoice payment to the OPERATING account', async () => {
    const adapter = new PayloadAdapter(ENV);
    await adapter.createPaymentRequest({
      amount: 250, clientEmail: 'c@example.com', clientName: 'Jane Doe', description: 'Invoice',
    });
    expect(lastRequest.body.processing_id).toBe('acct_operating');
  });

  it('THROWS on a trust payment when no trust account is configured (never cross-routes to operating)', async () => {
    const adapter = new PayloadAdapter({ ...ENV, PAYLOAD_TRUST_ACCOUNT_ID: undefined });
    await expect(
      adapter.createPaymentRequest({ amount: 100, accountType: 'trust', description: 'X' })
    ).rejects.toThrow(/IOLTA compliance/);
    expect(lastRequest).toBeNull(); // no API call was made
  });

  it('works trust-only: isConfigured true and retainer routes to trust with operating unset', async () => {
    const trustOnly = { ...ENV, PAYLOAD_OPERATING_ACCOUNT_ID: undefined };
    expect(PayloadAdapter.isConfigured(trustOnly)).toBe(true);
    const adapter = new PayloadAdapter(trustOnly);
    await adapter.createPaymentRequest({ amount: 5000, accountType: 'trust', description: 'Retainer' });
    expect(lastRequest.body.processing_id).toBe('acct_trust');
  });

  it('THROWS on an operating payment when no operating account is configured', async () => {
    const adapter = new PayloadAdapter({ ...ENV, PAYLOAD_OPERATING_ACCOUNT_ID: undefined });
    await expect(
      adapter.createPaymentRequest({ amount: 250, description: 'Invoice' })
    ).rejects.toThrow(/PAYLOAD_OPERATING_ACCOUNT_ID is not configured/);
  });

  it('sends the gross amount unchanged (no fee math on our side)', async () => {
    const adapter = new PayloadAdapter(ENV);
    await adapter.createPaymentRequest({ amount: 3333.33, accountType: 'trust', description: 'Retainer' });
    expect(lastRequest.body.amount).toBe('3333.33');
  });

  it('omits amount for an OPEN-amount link so the payer enters it at checkout', async () => {
    const adapter = new PayloadAdapter(ENV);
    await adapter.createPaymentRequest({ accountType: 'trust', description: 'Retainer' }); // no amount
    expect(lastRequest.body.amount).toBeUndefined();
    expect(lastRequest.body.processing_id).toBe('acct_trust');
    expect(lastRequest.body.type).toBe('one_time');
  });
});

describe('PayloadAdapter — webhook verification (URL token + API read-back)', () => {
  // Payload sends webhooks as plain POSTs with no signature header. The adapter
  // verifies a shared token from the webhook URL, then reads the transaction back
  // from the API — status and payment_link_id come from Payload, not the body.
  const TOKEN = ENV.PAYLOAD_WEBHOOK_SECRET;

  // Real Payload webhook body: { object:'webhook_trigger', trigger:'payment',
  //   triggered_on:{ id:'txn_…', object:'transaction', value:'processed' } }
  const paymentWebhook = (txnId, value = 'processed') => JSON.stringify({
    object: 'webhook_trigger', trigger: 'payment',
    triggered_on: { id: txnId, object: 'transaction', value },
  });

  it('verifies a processed event via API read-back (payment_link_id is a hidden field)', async () => {
    const adapter = new PayloadAdapter(ENV);
    const raw = paymentWebhook('txn_1'); // body carries no link id — only the txn id

    const result = await adapter.handleWebhook(raw, TOKEN);
    expect(result).toEqual({
      invoiceId: null,
      paymentRequestId: 'pl_link_789',   // from the API read-back, not the body
      transactionId: 'txn_1',
      amount: 5000,                      // actual paid amount, from the API read-back
      status: 'paid',
    });
    expect(lastRequest.url).toContain('/transactions/txn_1');
    expect(lastRequest.url).toContain('payment_link_id'); // hidden field explicitly requested
  });

  it('ignores non-processed events without calling the API', async () => {
    const adapter = new PayloadAdapter(ENV);
    const raw = paymentWebhook('txn_1', 'authorized');
    expect(await adapter.handleWebhook(raw, TOKEN)).toBeNull();
    expect(lastRequest).toBeNull();
  });

  it('rejects a webhook with a bad token before any API call', async () => {
    const adapter = new PayloadAdapter(ENV);
    const raw = JSON.stringify({ type: 'processed', data: { id: 'txn_1' } });
    await expect(adapter.handleWebhook(raw, 'wrong-token')).rejects.toThrow(/Invalid webhook key/);
    expect(lastRequest).toBeNull();
  });

  it('rejects a webhook with no token (Payload sends no signature headers)', async () => {
    const adapter = new PayloadAdapter(ENV);
    const raw = JSON.stringify({ type: 'processed', data: { id: 'txn_1' } });
    await expect(adapter.handleWebhook(raw, null)).rejects.toThrow(/Missing webhook key/);
  });

  it('refuses a forged body whose transaction is not actually processed', async () => {
    // Body claims a processed payment, but the API read-back says declined.
    txnResponse = { id: 'txn_1', status: 'declined', type: 'payment', payment_link_id: 'pl_link_789' };
    const adapter = new PayloadAdapter(ENV);
    const raw = paymentWebhook('txn_1'); // triggered_on.value = 'processed' (forged), API disagrees
    await expect(adapter.handleWebhook(raw, TOKEN)).rejects.toThrow(/not processed/);
  });
});
