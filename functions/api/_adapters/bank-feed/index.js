// Bank-feed adapters: read-only balances + transactions for the firm's own bank accounts.
//
// Every adapter exposes:
//   provider                         'simplefin' | ...  (stored on bank_connections.provider)
//   maxWindowDays                    longest span one fetchAccounts call should cover
//   claim(token)              → secret   one-time exchange of what the Owner pastes or
//                                        completes for a long-lived credential
//   fetchAccounts(secret, {start, end})  (seconds since epoch)
//                             → { accounts: [{ providerAccountId, name, institution,
//                                 currency, balance, availableBalance, balanceDate,
//                                 transactions: [{ providerTxnId, postedAt, transactedAt,
//                                 amount, description, payee, memo }] }],
//                                 warnings: [string] }
//   Failures throw BankFeedError (kind: invalid_token | already_claimed | revoked |
//   unavailable | bad_response).
//
// The provider is chosen per connection, not per deployment, so a firm could hold links
// from two providers at once. Adding one (e.g. Plaid): write the adapter, add it below,
// and widen the bank_connections.provider CHECK in a 24xx migration.

import { SimpleFinAdapter, BankFeedError } from './simplefin.js';

export { BankFeedError };

export const BANK_FEED_PROVIDERS = ['simplefin'];

export function getBankFeedAdapter(provider, env, fetchFn) {
  if (provider === 'simplefin') return new SimpleFinAdapter(env, fetchFn);
  throw new Error(`Unknown bank-feed provider: ${provider}`);
}
