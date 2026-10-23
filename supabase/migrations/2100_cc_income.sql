-- 2100_cc_income.sql
-- Card Income: Katy's credit-card receipts by day, month and year. Owner-only.
-- Range 2100-2199 = Card Income. KCL-only module (not part of the template).
--
-- Replaces the yearly "CC Income YYYY" Google Sheets. Three sources, one view:
--   cc_daily_totals    daily rows imported from the 2025+ sheets (web/terminal split)
--   cc_monthly_totals  monthly totals for years with no daily rows (2020-2024)
--   cc_transactions    one row per Converge gateway transaction (daily Worker sync)
--
-- The sheets are the record of everything up to the last day they cover; Converge
-- takes over the day after. Transactions back-filled from before that cutover are
-- kept for detail (cardholder, DACA renewals) but don't double-count in totals.
-- Terminal sales never reach Converge (only Payments Insider), which is one reason
-- the sheet totals stay authoritative for their period.
--
-- Access: Owner role only, via role_module_access. Reads go through RLS
-- (can_read); the Worker's service role does all inserts. Owners may relabel a
-- transaction (category / note) and nothing else -- enforced by column grants.

-- ── Module registration ─────────────────────────────────────────────────────
INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'cc_income',
  'Card Income',
  'Credit-card receipts by day, month and year, with year-over-year comparison. Owner-only.',
  'credit-card',
  'card-income',
  2,
  52,
  false,
  'premium'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'cc_income', 'admin'::public.access_level
FROM public.roles
WHERE name = 'Owner'
ON CONFLICT (role_id, module_key) DO NOTHING;

INSERT INTO public.enabled_modules (module_key)
VALUES ('cc_income')
ON CONFLICT DO NOTHING;

-- ── Daily totals (sheet history) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cc_daily_totals (
  day              date          PRIMARY KEY,
  web_amount       numeric(12,2) NOT NULL DEFAULT 0,   -- net of refunds, as the sheet kept it
  terminal_amount  numeric(12,2) NOT NULL DEFAULT 0,
  txn_count        integer       CHECK (txn_count >= 0),
  note             text,
  source           text          NOT NULL DEFAULT 'sheet',
  imported_at      timestamptz   NOT NULL DEFAULT now()
);

-- ── Monthly totals (years with no daily rows) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.cc_monthly_totals (
  month        date          PRIMARY KEY CHECK (extract(day FROM month) = 1),
  amount       numeric(12,2) NOT NULL,
  txn_count    integer       CHECK (txn_count >= 0),
  source       text          NOT NULL DEFAULT 'sheet',
  imported_at  timestamptz   NOT NULL DEFAULT now()
);

-- ── Converge transactions ───────────────────────────────────────────────────
-- Never stores a card number: last four only. `included` is decided by the sync
-- (approved, not voided); totals only count included rows.
CREATE TABLE IF NOT EXISTS public.cc_transactions (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id                text          NOT NULL UNIQUE,          -- Converge ssl_txn_id
  txn_at                timestamptz   NOT NULL,
  txn_date              date          NOT NULL,                 -- America/Chicago calendar day
  amount                numeric(12,2) NOT NULL,                 -- signed: refunds are negative
  txn_type              text          NOT NULL,                 -- SALE, RETURN, VOID, ...
  status                text,                                   -- ssl_trans_status (STL, PEN, ...)
  included              boolean       NOT NULL DEFAULT true,
  channel               text          NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'terminal')),
  card_brand            text,
  card_last4            text          CHECK (card_last4 ~ '^[0-9]{4}$'),
  cardholder            text,
  invoice_number        text,
  description           text,
  category              text,                                   -- e.g. daca_renewal; labels live in the page
  category_set_by_user  boolean       NOT NULL DEFAULT false,   -- sync never overwrites a user's label
  note                  text,
  synced_at             timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_transactions_date ON public.cc_transactions (txn_date);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.cc_daily_totals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cc_monthly_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cc_transactions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cc_daily_totals_read" ON public.cc_daily_totals;
CREATE POLICY "cc_daily_totals_read" ON public.cc_daily_totals
  FOR SELECT USING (public.can_read('cc_income'));

DROP POLICY IF EXISTS "cc_monthly_totals_read" ON public.cc_monthly_totals;
CREATE POLICY "cc_monthly_totals_read" ON public.cc_monthly_totals
  FOR SELECT USING (public.can_read('cc_income'));

DROP POLICY IF EXISTS "cc_transactions_read" ON public.cc_transactions;
CREATE POLICY "cc_transactions_read" ON public.cc_transactions
  FOR SELECT USING (public.can_read('cc_income'));

DROP POLICY IF EXISTS "cc_transactions_relabel" ON public.cc_transactions;
CREATE POLICY "cc_transactions_relabel" ON public.cc_transactions
  FOR UPDATE USING (public.can_write('cc_income')) WITH CHECK (public.can_write('cc_income'));

-- ── Views: one daily series and one monthly series across all three sources ──
-- security_invoker so the tables' RLS applies to whoever queries the view.
CREATE OR REPLACE VIEW public.cc_income_daily
WITH (security_invoker = true) AS
WITH cutover AS (
  SELECT max(day) AS last_sheet_day FROM public.cc_daily_totals
)
SELECT d.day,
       d.web_amount,
       d.terminal_amount,
       d.web_amount + d.terminal_amount AS amount,
       d.txn_count,
       d.note,
       d.source
FROM public.cc_daily_totals d
UNION ALL
SELECT t.txn_date                                                 AS day,
       coalesce(sum(t.amount) FILTER (WHERE t.channel = 'web'), 0)      AS web_amount,
       coalesce(sum(t.amount) FILTER (WHERE t.channel = 'terminal'), 0) AS terminal_amount,
       sum(t.amount)                                              AS amount,
       (count(*) FILTER (WHERE t.amount > 0))::integer             AS txn_count,
       NULL::text                                                 AS note,
       'converge'                                                 AS source
FROM public.cc_transactions t, cutover c
WHERE t.included
  AND (c.last_sheet_day IS NULL OR t.txn_date > c.last_sheet_day)
GROUP BY t.txn_date;

CREATE OR REPLACE VIEW public.cc_income_monthly
WITH (security_invoker = true) AS
WITH from_days AS (
  SELECT date_trunc('month', day)::date AS month,
         sum(amount)                    AS amount,
         sum(txn_count)::integer        AS txn_count,
         count(*)::integer              AS active_days,
         'daily'                        AS grain
  FROM public.cc_income_daily
  GROUP BY 1
)
SELECT month, amount, txn_count, active_days, grain FROM from_days
UNION ALL
SELECT m.month, m.amount, m.txn_count, NULL::integer, 'monthly'
FROM public.cc_monthly_totals m
WHERE NOT EXISTS (SELECT 1 FROM from_days f WHERE f.month = m.month);

-- ── Data API grants (explicit; see the global rule from 2026-10-30) ─────────
-- Owners read through RLS; only the service role writes, except the two
-- relabel columns on cc_transactions.
REVOKE ALL ON public.cc_daily_totals, public.cc_monthly_totals, public.cc_transactions,
              public.cc_income_daily, public.cc_income_monthly
  FROM anon, authenticated;

GRANT SELECT ON public.cc_daily_totals, public.cc_monthly_totals, public.cc_transactions,
               public.cc_income_daily, public.cc_income_monthly
  TO authenticated;
GRANT UPDATE (category, category_set_by_user, note) ON public.cc_transactions TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cc_daily_totals, public.cc_monthly_totals, public.cc_transactions
  TO service_role;
GRANT SELECT ON public.cc_income_daily, public.cc_income_monthly TO service_role;
