// Payload payment adapter — https://payload.com
// REST API: https://api.payload.com
// Auth: HTTP Basic — secret key as username, empty password
//
// Env vars (set when PAYMENT_PROVIDER=payload):
//   PAYLOAD_SECRET_KEY            — API secret key from Payload dashboard  (required)
//   PAYLOAD_TRUST_ACCOUNT_ID      — processing_id of the IOLTA/trust processing account
//   PAYLOAD_OPERATING_ACCOUNT_ID  — processing_id of the operating processing account
//   PAYLOAD_WEBHOOK_SECRET        — random shared token embedded in the registered
//                                   webhook URL as ?key=… (Payload sends webhooks as
//                                   plain POSTs with NO signature header)
//   At least ONE of the two account IDs is required.
//
// Account routing (createPaymentRequest accountType):
//   'trust'     → PAYLOAD_TRUST_ACCOUNT_ID      (retainers / IOLTA pre-payments)
//   'operating' → PAYLOAD_OPERATING_ACCOUNT_ID  (earned-fee invoices)  [default]
// The requested account MUST be configured — we NEVER cross-route (we throw instead),
// so trust funds can never land in the operating account or vice-versa. Silently
// misrouting either direction is an IOLTA trust-accounting violation.
//
// Fee separation is a MERCHANT-LEVEL config, not a per-transaction field. The trust
// processing account is set to GROSS deposits (the full amount lands in IOLTA) and its
// monthly processing fees are debited from a separate operating billing account,
// arranged with Payload at enrollment. So we always send the gross amount — no fee math
// on our side.
//
// Deployment note (trust-only enrollments): a firm may onboard ONLY its trust account
// as a merchant/processing account, with the operating account existing as a fee-billing
// account *inside* the trust processing account rather than as a routing target. In that
// setup leave PAYLOAD_OPERATING_ACCOUNT_ID unset — the adapter then routes everything to
// the trust account and Payload debits fees per the enrollment arrangement above.
// (The live processing_id is per-firm; it belongs in the client's wrangler.toml, never here.)
//
// Payment link expiration: 60 days (not configurable). Use /api/resend-invoice
// to regenerate a fresh link for overdue unpaid invoices.

export class PayloadAdapter {
  constructor(env) {
    this.env         = env;
    this.baseUrl     = 'https://api.payload.com';
    this.secretKey   = env.PAYLOAD_SECRET_KEY;
    this.operatingId = env.PAYLOAD_OPERATING_ACCOUNT_ID;
    this.trustId     = env.PAYLOAD_TRUST_ACCOUNT_ID;
  }

  static isConfigured(env) {
    return !!(env.PAYLOAD_SECRET_KEY &&
      (env.PAYLOAD_TRUST_ACCOUNT_ID || env.PAYLOAD_OPERATING_ACCOUNT_ID));
  }

  // Resolve the processing_id for the requested account type. Never cross-routes:
  // if the requested account isn't configured we throw rather than fall back to the
  // other account, so trust funds can never land in operating (or vice-versa).
  _resolveProcessingId(accountType) {
    if (accountType === 'trust') {
      if (!this.trustId) {
        throw new Error('Payload: a trust payment was requested but PAYLOAD_TRUST_ACCOUNT_ID is not configured — refusing to route trust funds to the operating account (IOLTA compliance).');
      }
      return this.trustId;
    }
    if (!this.operatingId) {
      throw new Error('Payload: an operating payment was requested but PAYLOAD_OPERATING_ACCOUNT_ID is not configured.');
    }
    return this.operatingId;
  }

  // Create a hosted payment link for an invoice.
  // Returns: { paymentLink: string, requestId: string }
  async createPaymentRequest({ invoiceId, amount, clientEmail, clientName, description, accountType = 'operating' }) {
    const processingId = this._resolveProcessingId(accountType);

    // Payload expects a one-off amount in decimal dollars (e.g. 59.99), not cents.
    // These are the only documented create attributes for a PaymentLink.
    //
    // NOTE: billing_contact is READ-ONLY on PaymentLink — it's derived from a linked
    // customer record, not settable at creation. Passing billing_contact[name]/[email]
    // made Payload return 500 InternalServerError (it doesn't reject readonly nested
    // attrs cleanly). We omit them; the payer supplies their details at checkout, and we
    // map the payment back to the matter/invoice by payment_link_id in the webhook — we
    // never depend on Payload's contact fields. (To prefill later: create a Customer via
    // POST /customers and pass customer_id here.)
    const params = {
      type:          'one_time',
      description:   description || 'Legal Services',
      processing_id: processingId,
    };
    // Omit `amount` for an OPEN-amount link: Payload then presents a checkout form
    // where the payer enters the amount themselves (used for retainer requests
    // where the client pays what they can — e.g. asked $5,000, pays $1,000). Only
    // send a positive fixed amount.
    if (amount != null && Number(amount) > 0) params.amount = amount;

    const res = await this._post('/payment_links/', params);
    return {
      paymentLink: res.url,
      requestId:   res.id,
    };
  }

  // Parse and verify an incoming Payload webhook.
  // Payload delivers webhooks as plain POSTs with NO signature header, so trust is
  // established two ways:
  //   1) a shared token in the registered webhook URL (?key=PAYLOAD_WEBHOOK_SECRET),
  //      which the endpoint passes here as `credential`;
  //   2) the transaction is READ BACK from the Payload API — status, amount and the
  //      originating payment link all come from Payload directly, so a forged body
  //      can never post money. (payment_link_id is a hidden field on Transaction and
  //      must be requested explicitly — the webhook body may not carry it at all.)
  //
  // Register the webhook with trigger 'payment' (fires when a payment completes) —
  // NOT 'processed', which is a transaction *status*, not a valid webhook trigger.
  // The body Payload POSTs (docs → APIs → Webhooks → Triggers):
  //   { "object": "webhook_trigger", "trigger": "payment",
  //     "triggered_on": { "id": "txn_…", "object": "transaction", "value": "processed" } }
  // We also tolerate a { type, data:{id} } shape defensively.
  // Returns: { invoiceId, paymentRequestId, transactionId, status: 'paid' } or null.
  async handleWebhook(rawBody, credential) {
    await this._verifyToken(credential);

    const body        = JSON.parse(rawBody);
    const triggeredOn = body.triggered_on || {};
    const objType     = triggeredOn.object || '';
    const txnId       = triggeredOn.id || body.data?.id || body.id || null;

    // Only act on transaction events. Use the body's status as a cheap pre-filter
    // (e.g. skip 'authorized'/'declined' without an API round-trip) — but never
    // trust it for the money; the read-back below is authoritative.
    if (!txnId || (objType && objType !== 'transaction')) return null;
    const bodyStatus = triggeredOn.value || body.type || '';
    if (bodyStatus && bodyStatus !== 'processed') return null;

    const txn = await this._get(`/transactions/${txnId}`, { fields: '*,payment_link_id' });
    if (txn.status !== 'processed') {
      throw new Error(`Transaction ${txnId} is '${txn.status}', not processed`);
    }

    return {
      invoiceId:        null,
      paymentRequestId: txn.payment_link_id || null,
      transactionId:    txn.id,
      // Actual amount paid (decimal dollars), read from Payload — authoritative for
      // open-amount retainer links where the payer chose the amount.
      amount:           txn.amount != null ? Number(txn.amount) : null,
      status:           'paid',
    };
  }

  // Constant-time comparison of the URL token against PAYLOAD_WEBHOOK_SECRET
  // (both HMAC'd with a fixed key so length/content never leak via timing).
  async _verifyToken(credential) {
    const secret = this.env.PAYLOAD_WEBHOOK_SECRET;
    if (!secret)     throw new Error('PAYLOAD_WEBHOOK_SECRET not configured');
    if (!credential) throw new Error('Missing webhook key');

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode('payload-webhook-token-cmp'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const a = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(secret)));
    const b = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(credential)));
    if (a.length !== b.length || !a.every((v, i) => v === b[i])) {
      throw new Error('Invalid webhook key');
    }
  }

  _authHeader() {
    return 'Basic ' + btoa(`${this.secretKey}:`);
  }

  async _get(path, params) {
    const qs  = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(`${this.baseUrl}${path}${qs}`, {
      headers: { 'Authorization': this._authHeader() },
    });
    if (!res.ok) throw new Error(`Payload API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // Payload's REST API takes application/x-www-form-urlencoded bodies (every docs
  // example uses `curl -d`), not JSON. Nested attributes use bracket-notation keys.
  async _post(path, params) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) form.append(k, String(v));
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method:  'POST',
      headers: {
        'Authorization': this._authHeader(),
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`Payload API error ${res.status}: ${await res.text()}`);
    return res.json();
  }
}
