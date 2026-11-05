-- 2401_bank_feeds_schema.sql
-- Schema for Bank Accounts (bank feeds). Range 2400-2499 = Bank Feeds.
--
--   bank_connections         one link to a provider (one SimpleFIN setup token claimed),
--                            which can cover several institutions and accounts
--   bank_connection_secrets  the provider credential for that link, encrypted. No
--                            policies: only the Worker (service_role) can touch it
--   bank_accounts            each account the provider reports, with its last balance
--   bank_transactions        posted transactions per account
--
-- Reads: whoever can read the bank_feeds module (Owner by default) reads accounts,
-- transactions and connection status straight from the tables through RLS.
-- Writes: every write comes from a provider sync, so it goes through the Worker with the
-- service role.

-- ── Connections ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_connections (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  provider         text        NOT NULL CHECK (provider IN ('simplefin')),
  label            text        NOT NULL,

  -- active   syncing normally (it may still carry a warning in last_error)
  -- revoked  the provider refused the credential; the Owner must reconnect
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),

  -- last_attempt_at  every sync attempt, success or failure; also throttles "Sync now"
  -- last_synced_at   the last attempt the provider answered
  -- last_error       the latest problem, which may be a warning the provider sent along
  --                  with good data (e.g. "First Flight needs you to log in again").
  --                  Cleared by a clean sync.
  last_attempt_at  timestamptz,
  last_synced_at   timestamptz,
  last_error       text,

  created_by       uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS bank_connections_updated_at ON public.bank_connections;
CREATE TRIGGER bank_connections_updated_at
  BEFORE UPDATE ON public.bank_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Connection secrets (Worker only) ───────────────────────────────────────
-- secret_enc is the provider credential (for SimpleFIN, the Access URL with its embedded
-- Basic Auth), AES-256-GCM encrypted by the Worker. RLS is on with NO policies, so
-- anon/authenticated are denied even if a blanket grant (supabase/grants/) covers the
-- table. service_role bypasses RLS.
CREATE TABLE IF NOT EXISTS public.bank_connection_secrets (
  connection_id  uuid        PRIMARY KEY REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  secret_enc     text        NOT NULL
);

-- ── Accounts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  connection_id        uuid        NOT NULL REFERENCES public.bank_connections(id) ON DELETE CASCADE,
  -- The provider's own account id. Only unique within one connection.
  provider_account_id  text        NOT NULL,
  UNIQUE (connection_id, provider_account_id),

  name                 text        NOT NULL,
  institution          text,
  currency             text        NOT NULL DEFAULT 'USD',

  -- Unscaled numeric: the provider sends decimal strings, and rounding to cents here
  -- would silently change a non-USD balance.
  balance              numeric,
  available_balance    numeric,
  -- When the provider says the balance was true. Not when the portal last looked.
  balance_date         timestamptz,

  -- Seen in the latest sync. False once the provider stops reporting the account (closed,
  -- or unticked at the provider). Kept so its transactions stay readable.
  present              boolean     NOT NULL DEFAULT true
);

DROP TRIGGER IF EXISTS bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Transactions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),

  account_id       uuid        NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  -- The provider's transaction id. SimpleFIN only promises uniqueness within one account
  -- (its demo reuses ids across accounts), hence the composite key.
  provider_txn_id  text        NOT NULL,
  UNIQUE (account_id, provider_txn_id),

  posted_at        timestamptz NOT NULL,
  transacted_at    timestamptz,
  -- Positive = money in, negative = money out (the provider's sign, kept as sent).
  amount           numeric     NOT NULL,
  description      text,
  payee            text,
  memo             text
);

-- The page lists newest first, per account or across all of them.
CREATE INDEX IF NOT EXISTS bank_transactions_account_posted_idx
  ON public.bank_transactions (account_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_posted_idx
  ON public.bank_transactions (posted_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.bank_connections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions       ENABLE ROW LEVEL SECURITY;

-- DROP before CREATE keeps this migration re-runnable.
DROP POLICY IF EXISTS "bank_connections_read" ON public.bank_connections;
CREATE POLICY "bank_connections_read"
  ON public.bank_connections FOR SELECT
  USING (public.can_read('bank_feeds'));

DROP POLICY IF EXISTS "bank_accounts_read" ON public.bank_accounts;
CREATE POLICY "bank_accounts_read"
  ON public.bank_accounts FOR SELECT
  USING (public.can_read('bank_feeds'));

DROP POLICY IF EXISTS "bank_transactions_read" ON public.bank_transactions;
CREATE POLICY "bank_transactions_read"
  ON public.bank_transactions FOR SELECT
  USING (public.can_read('bank_feeds'));

-- bank_connection_secrets: no policies, on purpose (see above).

-- ── Data API grants ─────────────────────────────────────────────────────────
-- New tables no longer get Data API grants automatically (see supabase/grants/).
-- Narrowed: the browser only ever reads these tables, and every write is the Worker's.
-- The REVOKE comes first because older projects still carry default privileges that
-- hand anon/authenticated everything on a new table (including TRUNCATE, which RLS
-- does not cover). RLS is the real gate; this makes the narrowing true on every project.
REVOKE ALL ON public.bank_connections, public.bank_connection_secrets,
              public.bank_accounts, public.bank_transactions FROM anon, authenticated;
GRANT SELECT                        ON public.bank_connections  TO authenticated;
GRANT SELECT                         ON public.bank_accounts     TO authenticated;
GRANT SELECT                         ON public.bank_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_connections, public.bank_accounts,
                                        public.bank_transactions  TO service_role;
-- The credential table: the Worker only.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_connection_secrets TO service_role;
