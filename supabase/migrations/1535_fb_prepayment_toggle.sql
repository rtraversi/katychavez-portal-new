-- Migration 1535: FreshBooks auto-prepayment toggle
--
-- When a retainer payment lands (invoice-payment-webhook), the portal can
-- optionally record it in FreshBooks as a Prepayment credit under the client,
-- so FreshBooks shows the money available to apply against future invoices
-- (FB-first invoice flow — see FB-FIRST-INVOICE-PLAN.md).
--
-- DEFAULT OFF: the FreshBooks credit_notes API's 'prepayment' type is
-- unverified against a live FB account (decided with Rob 2026-07-17 — no test
-- FB access, so ship dark). While off, staff get the retainer-paid email with
-- a reminder to record the prepayment in FreshBooks manually. Flip the toggle
-- in Settings > Billing & Payments once the mechanism is verified live.
--
-- Depends on: 1513_firm_settings.
-- Applied: dev ☐  prod ☐

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS fb_auto_prepayment boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.firm_settings.fb_auto_prepayment IS
  'When true, a paid retainer is also recorded in FreshBooks as a Prepayment credit under the client (best-effort). Off = staff record it manually from the retainer-paid email.';
