-- 2400_bank_feeds_module.sql
-- Register Bank Accounts (bank feeds) as a premium module.
--
-- The firm's Owner links the firm's own bank accounts through a bank-data provider
-- and the portal shows each account's current balance and recent transactions under
-- Finance. Read-only: nothing here moves money.
--
-- The provider sits behind functions/api/_adapters/bank-feed/ (tier-2 adapter). SimpleFIN
-- is the first one. Every provider call is made by the Worker, and the provider credential
-- is stored encrypted in a table the browser can never read.
--
-- Range 2400-2499 = Bank Feeds.

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'bank_feeds',
  'Bank Accounts',
  'Current balances and recent transactions from the firm''s own bank accounts. Owner only.',
  'credit-card',
  'bank-accounts',
  1,
  58,
  false,
  'premium'
)
ON CONFLICT (key) DO NOTHING;

-- Owner only. Bank balances and transactions are the firm's own books, so no other role
-- gets access by default. The Owner can grant a role read access later in
-- Settings > Permissions (for example, a bookkeeper).
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'bank_feeds', 'admin'::public.access_level
FROM public.roles
WHERE name = 'Owner'
ON CONFLICT (role_id, module_key) DO NOTHING;

-- NOTE: deliberately NO `INSERT INTO public.enabled_modules` here. A firm opts in with:
--
--   INSERT INTO public.enabled_modules (module_key) VALUES ('bank_feeds');
--
-- The Worker encrypts the provider credential with BANK_FEED_ENCRYPTION_KEY (64-char hex)
-- and falls back to SSN_ENCRYPTION_KEY when that is unset. See wrangler.toml.example.
