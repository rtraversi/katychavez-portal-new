-- Migration 1525: Recurring charges (monthly admin fee) + billable expenses
-- Two standing-billing primitives:
--   recurring_charges — a per-client charge that recurs (the firm's flat $100/mo
--                       administrative fee: every client except opt-outs). The
--                       daily cron (process-recurring-charges) generates a DRAFT
--                       invoice on/after each charge's day_of_month, once a month.
--   expenses          — hard costs advanced on a matter (postage, copies, filing)
--                       that get billed back. Reimbursed out of the client's trust
--                       funds (confirmed with the firm 2026-07-13), so account_type
--                       defaults to 'trust'.
-- Nothing here auto-charges a card: the cron only creates DRAFT invoices for
-- review, and only for clients with an ACTIVE recurring_charge row.
-- Applied: dev ☑  prod ☑ (SSL xdzgkagyfiauyfxbbdxv, 2026-07-13)

-- ── Recurring charges (e.g. monthly admin fee) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.recurring_charges (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID          NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  charge_type    TEXT          NOT NULL DEFAULT 'admin_fee',
  description    TEXT          NOT NULL DEFAULT 'Monthly administrative fee',
  amount         DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  frequency      TEXT          NOT NULL DEFAULT 'monthly'
                               CHECK (frequency IN ('monthly')),
  day_of_month   SMALLINT      NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  -- Which account the charge is billed against. In a trust-accounting firm the
  -- retainer sits in trust (unearned); an earned fee is drawn FROM trust and
  -- released to operating at invoice time — so the charge is billed against
  -- 'trust' (confirmed with the firm 2026-07-13). Firms that bill a standing fee
  -- straight to operating can override per charge.
  account_type   TEXT          NOT NULL DEFAULT 'trust'
                               CHECK (account_type IN ('operating', 'trust')),
  active         BOOLEAN       NOT NULL DEFAULT TRUE,
  last_charged_on DATE,
  created_by     UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- One standing charge of a given type per client.
  UNIQUE (client_id, charge_type)
);

CREATE INDEX IF NOT EXISTS idx_recurring_charges_active
  ON public.recurring_charges (active) WHERE active;

CREATE TRIGGER set_recurring_charges_updated_at
  BEFORE UPDATE ON public.recurring_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.recurring_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_charges_read" ON public.recurring_charges
  FOR SELECT USING (public.can_read('billing'));

CREATE POLICY "recurring_charges_write" ON public.recurring_charges
  FOR ALL USING (public.can_write('billing'));

-- ── Billable expenses (hard costs advanced on a matter) ──────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id      UUID          NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  client_id      UUID          REFERENCES public.clients(id) ON DELETE SET NULL,
  expense_date   DATE          NOT NULL DEFAULT CURRENT_DATE,
  category       TEXT          NOT NULL DEFAULT 'other'
                               CHECK (category IN ('postage', 'copies', 'filing_fee', 'mailing', 'other')),
  description    TEXT          NOT NULL,
  amount         DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  -- Hard costs advanced on a matter are reimbursed out of the client's trust
  -- funds (confirmed with the firm 2026-07-13), so this defaults to 'trust'.
  account_type   TEXT          DEFAULT 'trust'
                               CHECK (account_type IN ('operating', 'trust')),
  billed         BOOLEAN       NOT NULL DEFAULT FALSE,
  invoice_id     UUID          REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by     UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_matter   ON public.expenses (matter_id);
CREATE INDEX IF NOT EXISTS idx_expenses_unbilled ON public.expenses (matter_id) WHERE NOT billed;

CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_read" ON public.expenses
  FOR SELECT USING (public.can_read('billing'));

CREATE POLICY "expenses_write" ON public.expenses
  FOR ALL USING (public.can_write('billing'));
