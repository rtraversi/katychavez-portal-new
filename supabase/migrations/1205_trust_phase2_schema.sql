-- Migration 1205: Trust Accounting Phase 2 — Firm Buffer + Stale Check + Cleared Date
--
-- Adds:
--   trust_accounts.minimum_balance  — firm's own funds required to stay in the account
--                                      (per bar rules, firms may keep a small amount to cover
--                                       bank fees; this field tracks and alerts on that buffer)
--   trust_accounts.stale_check_days — days before an outstanding check is flagged stale (default 90)
--   trust_ledger_entries.cleared_at — date the bank cleared this entry (for check tracking)
--
-- Industry standard:
--   minimum_balance: $100 default, configured per account (varies by bank fee schedule)
--   stale_check_days: 90 default, per account (some firms use 60 or 120 based on bank)
--
-- Applied: dev ☐  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- TRUST ACCOUNTS: buffer + stale check threshold
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.trust_accounts
  ADD COLUMN IF NOT EXISTS minimum_balance   numeric(10,2) NOT NULL DEFAULT 100.00,
  ADD COLUMN IF NOT EXISTS stale_check_days  int           NOT NULL DEFAULT 90;

COMMENT ON COLUMN public.trust_accounts.minimum_balance IS
  'Minimum balance the firm must maintain in this account to cover bank fees (firm own funds, not client funds). '
  'Alert shown in UI when (ledger_balance − minimum_balance) falls below this threshold.';

COMMENT ON COLUMN public.trust_accounts.stale_check_days IS
  'Number of days after which an outstanding (uncleared) disbursement check is flagged stale. '
  'Industry default is 90 days. Varies 60–180 by firm preference.';

-- ─────────────────────────────────────────────────────────────────────────────
-- TRUST LEDGER ENTRIES: cleared date for check tracking
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.trust_ledger_entries
  ADD COLUMN IF NOT EXISTS cleared_at  date;

COMMENT ON COLUMN public.trust_ledger_entries.cleared_at IS
  'Date the bank cleared this transaction. NULL means uncleared/outstanding. '
  'Used to identify outstanding checks (disbursements with check_number != NULL and cleared_at IS NULL). '
  'Set by staff when reconciling against the bank statement.';
