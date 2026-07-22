-- Migration 1524: Per-client billing rates + external identity map
-- Rates for this firm come from the signed CLIENT AGREEMENT, not the accounting
-- system: FreshBooks has no rates set (every project rate 0.00, staff rate null),
-- so amounts must be computed in the portal. The rate sheet is per-client AND
-- per-person (e.g. the lead attorney bills $500 while a second attorney bills
-- $325 on the SAME client), so a pure per-role model can't represent it — a rate
-- row therefore targets a specific staff member (user_id) OR a role fallback.
--
--   billing_rates        — (client_id, user_id|role) -> hourly rate
--   billing_identity_map — external provider identity (FreshBooks identity_id)
--                          -> portal user, so provider-sourced time entries can
--                          resolve the payer's per-client rate.
-- Applied: dev ☑  prod ☑ (SSL xdzgkagyfiauyfxbbdxv, 2026-07-13)

-- ── Per-client billing rates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_rates (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID          NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id     UUID          REFERENCES public.users(id) ON DELETE CASCADE,  -- specific staff member
  role        TEXT,                                                          -- OR a role fallback (roles.name)
  rate        DECIMAL(10,2) NOT NULL CHECK (rate >= 0),
  notes       TEXT,
  created_by  UUID          REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- Exactly one target: a specific person OR a role, never both/neither.
  CONSTRAINT billing_rates_one_target CHECK (num_nonnulls(user_id, role) = 1)
);

-- One rate per (client, person) and one per (client, role).
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_rates_client_user
  ON public.billing_rates (client_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_rates_client_role
  ON public.billing_rates (client_id, role) WHERE role IS NOT NULL;

CREATE TRIGGER set_billing_rates_updated_at
  BEFORE UPDATE ON public.billing_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.billing_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_rates_read" ON public.billing_rates
  FOR SELECT USING (public.can_read('billing'));

CREATE POLICY "billing_rates_write" ON public.billing_rates
  FOR ALL USING (public.can_write('billing'));

-- ── External billing-provider identity map ───────────────────────────────────
-- FreshBooks time entries identify the logger by numeric identity_id. To bill,
-- we map that identity to a portal user, whose per-client rate we then look up.
CREATE TABLE IF NOT EXISTS public.billing_identity_map (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT        NOT NULL DEFAULT 'freshbooks',
  identity_id  TEXT        NOT NULL,                                   -- provider's identity id (stored as text)
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, identity_id)
);

CREATE TRIGGER set_billing_identity_map_updated_at
  BEFORE UPDATE ON public.billing_identity_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.billing_identity_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_identity_map_read" ON public.billing_identity_map
  FOR SELECT USING (public.can_read('billing'));

CREATE POLICY "billing_identity_map_write" ON public.billing_identity_map
  FOR ALL USING (public.can_write('billing'));
