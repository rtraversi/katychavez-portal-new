-- 2402_bank_category_rules.sql
-- Category rules for Bank Accounts (bank feeds). Range 2400-2499 = Bank Feeds.
--
-- A rule says "a transaction whose payee/description/memo mentions <pattern> belongs to
-- <category>", optionally only for money in or only for money out. The same vendor can
-- appear both ways: a card processor's deposits are income, while its monthly fee
-- comes out of the same account under the same name.
--
-- Rules are the firm's own data (which vendor is "Payroll", which is "Office Software"),
-- so the template ships the table EMPTY. Each firm fills it in from the Bank Accounts
-- page. Categories are applied when the page renders, not stored on transactions, so
-- editing a rule recategorizes history immediately.
--
-- Matching: case-insensitive substring. Lowest priority wins; ties go to the oldest rule.

CREATE TABLE IF NOT EXISTS public.bank_category_rules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  pattern     text        NOT NULL CHECK (char_length(btrim(pattern)) BETWEEN 2 AND 100),
  category    text        NOT NULL CHECK (char_length(btrim(category)) BETWEEN 1 AND 60),
  -- any = both directions; in = deposits only; out = payments only
  direction   text        NOT NULL DEFAULT 'any' CHECK (direction IN ('any', 'in', 'out')),
  priority    integer     NOT NULL DEFAULT 100,

  created_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS bank_category_rules_updated_at ON public.bank_category_rules;
CREATE TRIGGER bank_category_rules_updated_at
  BEFORE UPDATE ON public.bank_category_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: whoever can read Bank Accounts sees the rules (they explain the page's numbers);
-- whoever can write it edits them. Owner only by default (2400). Rules hold no bank
-- data and touch no provider, so the browser writes them directly; no Worker route.
ALTER TABLE public.bank_category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_category_rules_read" ON public.bank_category_rules;
CREATE POLICY "bank_category_rules_read"
  ON public.bank_category_rules FOR SELECT
  USING (public.can_read('bank_feeds'));

DROP POLICY IF EXISTS "bank_category_rules_insert" ON public.bank_category_rules;
CREATE POLICY "bank_category_rules_insert"
  ON public.bank_category_rules FOR INSERT
  WITH CHECK (public.can_write('bank_feeds'));

DROP POLICY IF EXISTS "bank_category_rules_update" ON public.bank_category_rules;
CREATE POLICY "bank_category_rules_update"
  ON public.bank_category_rules FOR UPDATE
  USING (public.can_write('bank_feeds'))
  WITH CHECK (public.can_write('bank_feeds'));

DROP POLICY IF EXISTS "bank_category_rules_delete" ON public.bank_category_rules;
CREATE POLICY "bank_category_rules_delete"
  ON public.bank_category_rules FOR DELETE
  USING (public.can_write('bank_feeds'));

-- Data API grants (new tables get none automatically; see supabase/grants/). REVOKE first
-- because older projects' default privileges still hand anon everything.
REVOKE ALL ON public.bank_category_rules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_category_rules TO authenticated, service_role;
