-- Migration 1528: Recurring charges are OPT-IN — default active = FALSE.
-- The monthly admin-fee cron (process-recurring-charges) only bills ACTIVE rows.
-- Many firms don't use automatic monthly billing (e.g. Scroggins, who bills the
-- admin fee by hand as an expense), so no client may ever be silently activated.
-- Flip the column default so a recurring charge stays inactive until a human
-- explicitly enables it in Settings → Billing Rates. The billing-rates API
-- already sets `active` explicitly; this is defense-in-depth against any insert
-- that omits it, and prevents accidental monthly invoicing.
-- Applied: dev ☐  prod ☐

ALTER TABLE public.recurring_charges ALTER COLUMN active SET DEFAULT FALSE;
