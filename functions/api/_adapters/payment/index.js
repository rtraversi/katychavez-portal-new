import { ConfidoAdapter } from './confido.js';
import { StripeAdapter }  from './stripe.js';
import { PayloadAdapter } from './payload.js';

// Returns the configured payment adapter, or null for manual payment tracking only.
// Set PAYMENT_PROVIDER env var to 'confido', 'stripe', or 'payload' to activate.
export function getPaymentAdapter(env) {
  const provider = env.PAYMENT_PROVIDER;
  if (provider === 'confido') return new ConfidoAdapter(env);
  if (provider === 'stripe')  return new StripeAdapter(env);
  if (provider === 'payload') return new PayloadAdapter(env);
  return null;
}
