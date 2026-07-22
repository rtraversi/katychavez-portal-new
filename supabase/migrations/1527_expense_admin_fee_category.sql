-- Migration 1527: Add 'admin_fee' to the billable-expense category enum.
-- Some firms (e.g. Scroggins/Anita) bill their monthly administrative fee by hand
-- as a one-off expense line on each invoice rather than via the recurring_charges
-- cron. This adds "Admin Fee" as a selectable expense category so it can be entered
-- like any other hard cost. The recurring_charges primitive (1525) is unchanged.
-- Applied: dev ☐  prod ☐

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_category_check
  CHECK (category IN ('postage', 'copies', 'filing_fee', 'mailing', 'admin_fee', 'other'));
