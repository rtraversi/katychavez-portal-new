-- Migration 1227: matters.retainer_requested (informational field)
--
-- The retainer amount the firm ASKED the client for — a staff/attorney reference
-- figure only. It is NOT trust money and has NOTHING to do with IOLTA/trust
-- accounting: the trust ledger (matter_trust_balances) remains the sole source of
-- truth for funds actually held. This is deliberately SEPARATE from the legacy
-- matters.retainer_balance column, which is left untouched.
--
-- Idempotent — safe to re-run.
-- Applied: dev ☐  prod ☐

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS retainer_requested numeric(10,2);

COMMENT ON COLUMN public.matters.retainer_requested IS
  'Informational: retainer amount requested from the client (staff/attorney reference). '
  'Not trust funds — see the trust ledger for funds actually held.';
