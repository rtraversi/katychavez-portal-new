-- Migration 1201: Fix matter_trust_balances view security
-- Supabase advisor flags the view as SECURITY DEFINER (PostgreSQL default),
-- which bypasses RLS on trust_ledger_entries.
-- Adding security_invoker = true makes it run as the calling user instead.

CREATE OR REPLACE VIEW public.matter_trust_balances
WITH (security_invoker = true)
AS
SELECT
  matter_id,
  SUM(CASE
    WHEN entry_type IN ('deposit', 'transfer_in', 'adjustment_credit')      THEN amount
    WHEN entry_type IN ('disbursement', 'transfer_out', 'adjustment_debit') THEN -amount
    ELSE 0
  END)              AS balance,
  COUNT(*)          AS entry_count,
  MAX(created_at)   AS last_transaction_at
FROM public.trust_ledger_entries
GROUP BY matter_id;

COMMENT ON VIEW public.matter_trust_balances IS
  'Live per-matter trust balance derived from the immutable ledger. '
  'Always authoritative — never read matters.retainer_balance once trust_accounting is active.';
