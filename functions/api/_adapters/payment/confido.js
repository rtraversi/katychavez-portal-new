// Confido Legal (Gravity Legal) payment adapter
// GraphQL API at https://api.gravity-legal.com/
// Env vars required when active:
//   CONFIDO_API_KEY       — firm API key from Confido dashboard
//   CONFIDO_FIRM_ID       — firm ID from Confido dashboard
//   CONFIDO_WEBHOOK_SECRET — signing secret for webhook verification
//
// NOTE: Confido's exact GraphQL mutation/field names should be verified against
// their API docs or Postman collection before going live. The structure below
// matches standard Gravity Legal conventions.

export class ConfidoAdapter {
  constructor(env) {
    this.env      = env;
    this.endpoint = 'https://api.gravity-legal.com/v2';
    this.apiKey   = env.CONFIDO_API_KEY;
    this.firmId   = env.CONFIDO_FIRM_ID;
  }

  // Create a payment request in Confido.
  // Returns: { paymentLink: string, requestId: string }
  async createPaymentRequest({ invoiceId, amount, clientEmail, clientName, description }) {
    const cents = Math.round(amount * 100);

    const data = await this._query(`
      mutation CreatePaymentRequest($input: PaymentRequestInput!) {
        createPaymentRequest(input: $input) {
          id
          paymentLink
        }
      }
    `, {
      input: {
        firmId:      this.firmId,
        amount:      cents,
        clientEmail: clientEmail || null,
        clientName:  clientName  || null,
        description: description || 'Legal Services',
        reference:   invoiceId,   // echo back in webhook so we can match the portal invoice
      },
    });

    const req = data.createPaymentRequest;
    return {
      paymentLink: req.paymentLink,
      requestId:   req.id,
    };
  }

  // Parse and validate an incoming Confido webhook payload.
  // Returns: { invoiceId, paymentRequestId, amount, status, transactionId } or null.
  async handleWebhook(rawBody, signature) {
    await this._verifySignature(rawBody, signature);

    const payload = JSON.parse(rawBody);

    // Confido fires multiple event types — only act on payment completion
    const type = payload.type || payload.eventType || '';
    if (!type.toLowerCase().includes('payment') || !type.toLowerCase().includes('complet')) {
      return null;
    }

    const d = payload.data || payload;
    return {
      invoiceId:        d.reference  || null,        // portal invoice ID we embedded at creation
      paymentRequestId: d.paymentRequestId || d.id,  // Confido payment request ID (fallback lookup key)
      amount:           (d.amount || 0) / 100,
      status:           'paid',
      transactionId:    d.transactionId || d.paymentId || d.id,
    };
  }

  async _verifySignature(rawBody, signature) {
    const secret = this.env.CONFIDO_WEBHOOK_SECRET;
    if (!secret) throw new Error('CONFIDO_WEBHOOK_SECRET not configured');
    if (!signature) throw new Error('Missing webhook signature');

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    let sigBytes;
    try {
      sigBytes = _hexToBytes(signature);
    } catch {
      sigBytes = _base64ToBytes(signature);
    }

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(rawBody));
    if (!valid) throw new Error('Invalid webhook signature');
  }

  async _query(gql, variables = {}) {
    const res = await fetch(this.endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query: gql, variables }),
    });
    if (!res.ok) throw new Error(`Confido API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.errors?.length) throw new Error(data.errors[0].message);
    return data.data;
  }
}

function _hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function _base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
