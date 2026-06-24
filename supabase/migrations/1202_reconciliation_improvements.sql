-- Migration 1202: Reconciliation improvements + jurisdiction compliance fields
--
-- Fixes the three-way reconciliation formula to use adjusted bank balance:
--   Adjusted Bank Balance = Bank Statement Balance + Deposits in Transit − Outstanding Checks
--   all_match: Adjusted Bank Balance ≈ Firm Ledger Total ≈ Sum of Client Ledgers
--
-- The old schema compared raw bank_statement_balance directly, which fails any time
-- there are uncleared deposits or outstanding checks — i.e., nearly every real reconciliation.
--
-- Also adds jurisdiction-specific compliance tracking to trust_accounts:
--   TX: tajf_notified_at (notify Texas Access to Justice Foundation within 30 days)
--   FL: fl_cert_last_year (annual certification, June 1 – Aug 15)
--   All: retention_years (state-specific override; 5/6/7 yr depending on state)
--
-- Applied: dev ☐  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- RECONCILIATIONS: add adjusted balance fields
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.trust_reconciliations
  ADD COLUMN IF NOT EXISTS deposits_in_transit   numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_checks    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_bank_balance numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.trust_reconciliations.deposits_in_transit IS
  'Deposits recorded in the firm ledger not yet reflected on the bank statement';
COMMENT ON COLUMN public.trust_reconciliations.outstanding_checks IS
  'Checks issued (in firm ledger) but not yet cleared by the bank';
COMMENT ON COLUMN public.trust_reconciliations.adjusted_bank_balance IS
  'Bank Statement Balance + Deposits in Transit − Outstanding Checks. Set by trigger only.';

-- Backfill existing rows: adjusted = bank (no DIT/OC on old rows)
UPDATE public.trust_reconciliations
  SET adjusted_bank_balance = bank_statement_balance
  WHERE adjusted_bank_balance = 0 AND bank_statement_balance != 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE TRIGGER: correct 3-way formula uses adjusted_bank_balance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reconciliation_compute_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Step 1: Compute adjusted bank balance
  -- Adjusted = Bank Statement + Deposits in Transit − Outstanding Checks
  -- This is the figure that must match the firm ledger and client ledger sum.
  NEW.adjusted_bank_balance :=
    NEW.bank_statement_balance
    + COALESCE(NEW.deposits_in_transit, 0)
    - COALESCE(NEW.outstanding_checks,  0);

  -- Step 2: all_match — all three figures must agree within $0.01 rounding tolerance
  NEW.all_match := (
    ABS(NEW.adjusted_bank_balance - NEW.ledger_balance)        <= 0.01
    AND ABS(NEW.adjusted_bank_balance - NEW.client_ledger_sum) <= 0.01
    AND ABS(NEW.ledger_balance        - NEW.client_ledger_sum) <= 0.01
  );

  RETURN NEW;
END;
$$;

-- Triggers already exist and reference the function by name — no DROP/CREATE needed.
-- The OR REPLACE above updates the function in place.

-- ─────────────────────────────────────────────────────────────────────────────
-- TRUST ACCOUNTS: jurisdiction compliance fields
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.trust_accounts
  ADD COLUMN IF NOT EXISTS retention_years    int         NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS tajf_notified_at   timestamptz,
  ADD COLUMN IF NOT EXISTS fl_cert_last_year  int;

COMMENT ON COLUMN public.trust_accounts.retention_years IS
  'Record retention in years. 5: most states (TX/CA/AZ/GA/etc). 6: FL/NC/SC/WI. 7: NY/IL/CO/OH/NJ/CT/RI/MA (default).';
COMMENT ON COLUMN public.trust_accounts.tajf_notified_at IS
  'TX only: timestamp when firm notified Texas Access to Justice Foundation of this account (required within 30 days of opening/closing).';
COMMENT ON COLUMN public.trust_accounts.fl_cert_last_year IS
  'FL only: calendar year of last completed annual trust accounting certification (due June 1 – Aug 15).';

-- Set retention_years based on jurisdiction for any existing accounts
UPDATE public.trust_accounts SET retention_years = CASE
  WHEN jurisdiction IN ('FL','NC','SC','WI')                   THEN 6
  WHEN jurisdiction IN ('NY','IL','CO','OH','NJ','CT','RI','MA') THEN 7
  ELSE 5
END;
