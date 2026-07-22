// Stripe payment adapter (future alternative to Confido)
// Env vars required when active:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Docs: https://stripe.com/docs/api

export class StripeAdapter {
  constructor(env) {
    this.env = env;
    this.secretKey = env.STRIPE_SECRET_KEY;
  }

  // Create a Stripe Payment Link for an invoice.
  // Returns: { paymentLink: string, requestId: string }
  async createPaymentRequest({ invoiceId, amount, clientEmail, clientName, description }) {
    throw new Error('Stripe adapter: createPaymentRequest not yet implemented');
  }

  // Parse and validate an incoming Stripe webhook payload.
  // Returns: { invoiceId, amount, status, transactionId } or null for unhandled event types.
  async handleWebhook(rawBody, signature, env) {
    throw new Error('Stripe adapter: handleWebhook not yet implemented');
  }
}
