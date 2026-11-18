-- 2404_bank_category_not_counted.sql
-- A third category kind, 'excluded' (shown as "Not counted"), beside income and expense.
-- Range 2400-2499 = Bank Feeds.
--
-- For money that moves but isn't income or an expense:
--   * transfers between the firm's own accounts. Paying the credit card from checking
--     shows up twice, as a payment out of checking and a payment received on the card.
--     Both go to a Not counted category, so only the card's purchases count as expenses.
--   * the owner's draw (a sole proprietor taking money out).
-- The report shows them in their own section, outside the income, expense and overall
-- totals; the overview tiles leave them out.
--
-- No new table, so no new grants. RLS on bank_categories (2403) is unchanged.

-- The kind CHECK is the inline one from 2403, named by Postgres. Drop whatever check on
-- this table mentions kind rather than trusting the generated name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.bank_categories'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.bank_categories DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.bank_categories
  ADD CONSTRAINT bank_categories_kind_check CHECK (kind IN ('income', 'expense', 'excluded'));

-- Quicken files transfers as "[Account]", which the import stores as "Transfer:Account".
-- Those were never income or expense in Quicken's own report either.
UPDATE public.bank_categories
SET kind = 'excluded'
WHERE kind <> 'excluded'
  AND (lower(name) IN ('transfer', 'transfers') OR lower(name) LIKE 'transfer:%' OR lower(name) LIKE 'transfers:%');
