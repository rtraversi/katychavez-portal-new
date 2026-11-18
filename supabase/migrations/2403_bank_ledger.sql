-- 2403_bank_ledger.sql
-- Bank Accounts as a bookkeeping ledger. Range 2400-2499 = Bank Feeds.
--
--   bank_categories        the firm's category list, each one Income or Expense. A colon
--                          in the name makes a subcategory, the way Quicken does it
--                          ("Office:Software" sits under "Office" in the report).
--   bank_transactions      gains a stored category. One set by hand beats every rule;
--                          with none set, the rules still decide (at render time, as in
--                          2402). It also gains `source`, so history imported from Quicken
--                          can sit next to what the bank feed pulled.
--   bank_category_rules    gains category_id, so renaming a category keeps its rules.
--
-- Who writes what:
--   * categories and rules: the browser, directly (RLS can_write('bank_feeds'))
--   * a transaction's category: the browser, directly, and ONLY the category columns
--     (column grant + a guard trigger, below)
--   * transactions themselves (bank sync, Quicken import): the Worker, service role

-- ── Categories ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- "Payroll" or "Payroll:Payroll Taxes". Trimmed, no empty segments.
  name        text        NOT NULL CHECK (
                char_length(name) BETWEEN 1 AND 80
                AND name = btrim(name)
                AND name !~ '(^:|:$|::|\s:|:\s)'
              ),
  -- Which half of the report it lands in. A refund in an expense category still
  -- counts there, reducing the expense, as in Quicken.
  kind        text        NOT NULL DEFAULT 'expense' CHECK (kind IN ('income', 'expense')),

  created_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_categories_name_key ON public.bank_categories (lower(name));

DROP TRIGGER IF EXISTS bank_categories_updated_at ON public.bank_categories;
CREATE TRIGGER bank_categories_updated_at
  BEFORE UPDATE ON public.bank_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.bank_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_categories_read" ON public.bank_categories;
CREATE POLICY "bank_categories_read"
  ON public.bank_categories FOR SELECT
  USING (public.can_read('bank_feeds'));

DROP POLICY IF EXISTS "bank_categories_insert" ON public.bank_categories;
CREATE POLICY "bank_categories_insert"
  ON public.bank_categories FOR INSERT
  WITH CHECK (public.can_write('bank_feeds'));

DROP POLICY IF EXISTS "bank_categories_update" ON public.bank_categories;
CREATE POLICY "bank_categories_update"
  ON public.bank_categories FOR UPDATE
  USING (public.can_write('bank_feeds'))
  WITH CHECK (public.can_write('bank_feeds'));

DROP POLICY IF EXISTS "bank_categories_delete" ON public.bank_categories;
CREATE POLICY "bank_categories_delete"
  ON public.bank_categories FOR DELETE
  USING (public.can_write('bank_feeds'));

REVOKE ALL ON public.bank_categories FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_categories TO authenticated, service_role;

-- ── Rules point at a category ───────────────────────────────────────────────
-- Deleting a category deletes its rules: a rule with nowhere to send things is noise.
-- The text column stays (NOT NULL, from 2402) and the page keeps it in step on rename.
ALTER TABLE public.bank_category_rules
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.bank_categories(id) ON DELETE CASCADE;

-- Backfill: every category a rule already uses becomes a list entry. Income when all of
-- its rules are money-in-only, otherwise Expense; the Owner can flip it on the page.
INSERT INTO public.bank_categories (name, kind)
SELECT min(btrim(category)),
       CASE WHEN bool_and(direction = 'in') THEN 'income' ELSE 'expense' END
FROM public.bank_category_rules
WHERE btrim(category) <> ''
GROUP BY lower(btrim(category))
ON CONFLICT DO NOTHING;

UPDATE public.bank_category_rules r
SET category_id = c.id
FROM public.bank_categories c
WHERE r.category_id IS NULL AND lower(btrim(r.category)) = lower(c.name);

-- ── Transactions: a stored category, and where the row came from ────────────
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS category_id     uuid        REFERENCES public.bank_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS category_set_by uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  -- provider = pulled by the bank feed; import = loaded from a Quicken export
  ADD COLUMN IF NOT EXISTS source          text        NOT NULL DEFAULT 'provider'
                                                       CHECK (source IN ('provider', 'import'));

CREATE INDEX IF NOT EXISTS bank_transactions_category_idx
  ON public.bank_transactions (category_id) WHERE category_id IS NOT NULL;

-- The browser may set a transaction's category and nothing else. The column grant
-- below says so, but a project rebuilt from migrations runs the blanket grants file
-- last (supabase/grants/), which hands authenticated UPDATE on every column. This
-- trigger holds the line either way: for anyone but the Worker, every other column
-- must come through unchanged.
CREATE OR REPLACE FUNCTION public.bank_transactions_category_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       NEW.account_id, NEW.provider_txn_id, NEW.posted_at, NEW.transacted_at, NEW.amount,
       NEW.description, NEW.payee, NEW.memo, NEW.source, NEW.created_at
     ) IS DISTINCT FROM (
       OLD.account_id, OLD.provider_txn_id, OLD.posted_at, OLD.transacted_at, OLD.amount,
       OLD.description, OLD.payee, OLD.memo, OLD.source, OLD.created_at
     ) THEN
    RAISE EXCEPTION 'Only the category of a bank transaction can be changed here.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bank_transactions_category_only ON public.bank_transactions;
CREATE TRIGGER bank_transactions_category_only
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.bank_transactions_category_only();

DROP POLICY IF EXISTS "bank_transactions_update_category" ON public.bank_transactions;
CREATE POLICY "bank_transactions_update_category"
  ON public.bank_transactions FOR UPDATE
  USING (public.can_write('bank_feeds'))
  WITH CHECK (public.can_write('bank_feeds'));

GRANT UPDATE (category_id, category_set_at, category_set_by) ON public.bank_transactions TO authenticated;
