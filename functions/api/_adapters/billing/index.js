import { FreshbooksAdapter } from './freshbooks.js';
import { QuickbooksAdapter } from './quickbooks.js';

// Returns the configured billing adapter, or null for portal-only mode.
// Set BILLING_PROVIDER env var to 'freshbooks' or 'quickbooks' to activate.
export function getBillingAdapter(env) {
  const provider = env.BILLING_PROVIDER;
  if (provider === 'freshbooks') return new FreshbooksAdapter(env);
  if (provider === 'quickbooks') return new QuickbooksAdapter(env);
  return null;
}
