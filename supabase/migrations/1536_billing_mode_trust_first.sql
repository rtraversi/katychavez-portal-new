-- Migration 1536: billing_mode + trust_first firm settings
--
-- Consolidation pass (2026-07-19, see CONSOLIDATION-ANALYSIS.md). Two firm-level
-- switches that collapse redundant billing surface instead of deleting capability.
--
-- 1. billing_mode — the portal grew TWO full invoice-authoring paths: portal-native
--    composition (create-invoice / get-unbilled-time) and the FreshBooks-first mirror
--    flow (mirror-fb-invoice / fb-unpaid-invoices, migrations 1533/1534). Both are
--    needed across the client base, but no single firm needs both, and showing both
--    is the bulk of the billing bloat. One enum per firm decides which UI appears:
--      'portal'          → New Invoice UI + unbilled-time pull + FB time import
--      'freshbooks_first'→ From-FreshBooks panel + mirror/update-draft/PDF flow
--    View / resend / void / payment tracking stay visible in both modes.
--
--    DEFAULT 'portal': the generic, no-FreshBooks-dependency default for a new
--    client. FreshBooks-first firms are opted in explicitly.
--    ⚠️ SSL runs freshbooks_first and is already live on that flow — applying this
--    migration to SSL MUST be paired with the UPDATE at the bottom of this file,
--    or the From-FreshBooks panel disappears from their portal.
--
-- 2. trust_first — SSL's trust-first (IOLTA) operating model had leaked into the
--    template as hardcoded defaults: invoices.account_type DEFAULT 'trust' (1526)
--    plus `|| 'trust'` fallbacks in send-invoice.js, resend-invoice.js, and a
--    literal 'trust' in mirror-fb-invoice.js / request-retainer.js. One firm-level
--    flag now drives all of them.
--
--    DEFAULT true: trust-first is the conservative, IOLTA-safe default — unearned
--    client funds belong in trust. A firm that bills from an operating account
--    turns it off rather than the template silently assuming one model.
--    This also retires the operating/trust selector that had no live variation.
--
-- Depends on: 1513_firm_settings, 1526 (invoices.account_type).
-- Applied: dev ☐  prod ☐

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS trust_first  boolean NOT NULL DEFAULT true;

-- Guard the enum at the DB layer so a bad write can't silently hide the whole
-- billing UI (an unrecognised value would match neither mode in the front end).
ALTER TABLE public.firm_settings
  DROP CONSTRAINT IF EXISTS firm_settings_billing_mode_check;

ALTER TABLE public.firm_settings
  ADD CONSTRAINT firm_settings_billing_mode_check
  CHECK (billing_mode IN ('portal', 'freshbooks_first'));

COMMENT ON COLUMN public.firm_settings.billing_mode IS
  'Which invoice-authoring workflow this firm uses: portal (compose in the portal from unbilled time) or freshbooks_first (compose in FreshBooks as a draft, send from the portal). Drives which billing UI is shown; does not delete either code path.';

COMMENT ON COLUMN public.firm_settings.trust_first IS
  'When true (default), invoices and retainer requests route to the trust/IOLTA account unless a specific invoice overrides it. Turn off for firms that bill from an operating account.';

-- ---------------------------------------------------------------------------
-- SSL / FreshBooks-first deployments ONLY — uncomment before applying.
-- Leave commented in the template: a fresh client defaults to portal mode.
-- ---------------------------------------------------------------------------
-- UPDATE public.firm_settings SET billing_mode = 'freshbooks_first';
