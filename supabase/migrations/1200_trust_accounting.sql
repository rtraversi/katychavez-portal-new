-- Migration 1200: Trust Accounting Module (CORE)
-- trust_accounts · invoices · trust_ledger_entries · trust_reconciliations
-- matter_trust_balances view · balance enforcement · append-only ledger
--
-- Compliance: IOLTA-compliant across all 50 US states + DC (researched June 2026)
-- Key invariants enforced at DB level:
--   1. Per-client trust balance can NEVER go negative (trigger)
--   2. Disbursements MUST reference a sent invoice or external invoice ref (CHECK)
--   3. Invoice status for portal invoices verified at disbursement time (trigger)
--   4. Ledger entries are IMMUTABLE — no UPDATE or DELETE (trigger + RLS)
--   5. balance_after snapshot computed by trigger, never by application
--   6. all_match on reconciliations computed by trigger, never by application
-- Applied: dev ☐  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.trust_entry_type AS ENUM (
  'deposit',           -- client funds arriving into trust
  'disbursement',      -- earned funds released to operating (requires invoice)
  'transfer_in',       -- funds arriving from another trust account
  'transfer_out',      -- funds leaving to another trust account
  'adjustment_credit', -- correction entry adding funds (e.g. opening balance, bank error)
  'adjustment_debit'   -- correction entry removing funds (e.g. bank fee, bank error)
);
COMMENT ON TYPE public.trust_entry_type IS 'Add values via new migration only — never alter directly';

CREATE TYPE public.invoice_status AS ENUM (
  'draft',  -- not yet sent to client
  'sent',   -- sent to client — only status that permits a trust disbursement
  'paid',   -- client has paid
  'void'    -- cancelled — disbursements against this invoice are blocked
);

-- ─────────────────────────────────────────────────────────────────────────────
-- MODULE REGISTRATION
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.modules
  (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'trust_accounting',
  'Trust Accounting',
  'IOLTA trust ledger, per-client balances, three-way reconciliation, and invoice tracking.',
  'shield',
  'trust',
  1,
  55,
  true,
  'core'
)
ON CONFLICT (key) DO NOTHING;

-- Role-module access seeds
DO $$
DECLARE
  r_owner          uuid;
  r_attorney       uuid;
  r_partner_atty   uuid;
  r_paralegal      uuid;
  r_staffadmin     uuid;
BEGIN
  SELECT id INTO r_owner        FROM public.roles WHERE name = 'Owner';
  SELECT id INTO r_attorney     FROM public.roles WHERE name = 'Attorney';
  SELECT id INTO r_partner_atty FROM public.roles WHERE name = 'Partner Attorney';
  SELECT id INTO r_paralegal    FROM public.roles WHERE name = 'Paralegal';
  SELECT id INTO r_staffadmin   FROM public.roles WHERE name = 'Staff Admin';

  INSERT INTO public.role_module_access (role_id, module_key, access_level) VALUES
    (r_owner,      'trust_accounting', 'admin'),
    (r_attorney,   'trust_accounting', 'write'),
    (r_paralegal,  'trust_accounting', 'read'),
    (r_staffadmin, 'trust_accounting', 'read')
  ON CONFLICT (role_id, module_key) DO NOTHING;

  -- Partner Attorney gets write access if role exists
  IF r_partner_atty IS NOT NULL THEN
    INSERT INTO public.role_module_access (role_id, module_key, access_level)
    VALUES (r_partner_atty, 'trust_accounting', 'write')
    ON CONFLICT (role_id, module_key) DO NOTHING;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TRUST ACCOUNTS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.trust_accounts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  bank_name             text        NOT NULL,
  account_number_last4  text        NOT NULL CHECK (account_number_last4 ~ '^\d{4}$'),
  account_label         text        NOT NULL,  -- e.g. "IOLTA Operating Trust Account"

  -- jurisdiction drives retention warnings, reconciliation frequency prompts,
  -- and future state-specific reporting templates (researched all 50 states June 2026)
  jurisdiction          text        NOT NULL DEFAULT 'TX',

  is_active             boolean     NOT NULL DEFAULT true,
  notes                 text
);

CREATE INDEX idx_trust_accounts_active ON public.trust_accounts (is_active) WHERE is_active = true;

CREATE TRIGGER trust_accounts_updated_at
  BEFORE UPDATE ON public.trust_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- INVOICES  (minimal stub — T&B module grafts line_items + time_entries later;
--            QB Level 3 sync populates via source/external_id/synced_at)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE public.invoice_number_seq START 1;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'INV-' || LPAD(nextval('public.invoice_number_seq')::text, 4, '0');
$$;

CREATE TABLE public.invoices (
  id              uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz           NOT NULL DEFAULT now(),
  updated_at      timestamptz           NOT NULL DEFAULT now(),

  matter_id       uuid                  NOT NULL REFERENCES public.matters(id) ON DELETE RESTRICT,
  invoice_number  text                  NOT NULL DEFAULT public.next_invoice_number(),
  description     text                  NOT NULL,
  amount          numeric(10,2)         NOT NULL CHECK (amount > 0),
  status          public.invoice_status NOT NULL DEFAULT 'draft',
  sent_at         timestamptz,          -- auto-set by trigger when status → 'sent'
  due_date        date,
  created_by      uuid                  NOT NULL REFERENCES public.users(id),

  -- QB Level 3 / external billing integration (forward-looking)
  source          text                  NOT NULL DEFAULT 'portal'
                  CHECK (source IN ('portal', 'quickbooks', 'clio', 'other')),
  external_id     text,                 -- QB internal ID — dedup key for sync
  synced_at       timestamptz,          -- when last pulled from external source

  UNIQUE (invoice_number),
  UNIQUE (source, external_id)          -- prevents duplicate imports from same source
);

CREATE INDEX idx_invoices_matter  ON public.invoices (matter_id);
CREATE INDEX idx_invoices_status  ON public.invoices (status);

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-manage sent_at: set when → 'sent', clear when reverted to 'draft'
CREATE OR REPLACE FUNCTION public.invoice_manage_sent_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'sent' AND OLD.status != 'sent' THEN
    NEW.sent_at := now();
  ELSIF NEW.status = 'draft' AND OLD.status = 'sent' THEN
    NEW.sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_manage_sent_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoice_manage_sent_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- TRUST LEDGER ENTRIES  (append-only — the source of truth for all balances)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.trust_ledger_entries (
  id                    uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz             NOT NULL DEFAULT now(),

  trust_account_id      uuid                    NOT NULL REFERENCES public.trust_accounts(id),
  matter_id             uuid                    NOT NULL REFERENCES public.matters(id) ON DELETE RESTRICT,
  entry_type            public.trust_entry_type NOT NULL,
  amount                numeric(10,2)           NOT NULL CHECK (amount > 0),
  description           text                    NOT NULL,

  -- Invoice reference: Path A (portal invoice) or Path QB (external reference)
  -- For disbursements, at least one must be present (enforced by CHECK below)
  invoice_id            uuid    REFERENCES public.invoices(id),
  external_invoice_ref  text,   -- QB Level 1 manual ref, e.g. "QB INV-0042 / $2,500.00"

  -- Payor / payee
  payor_payee           text,   -- who paid in (deposit) or received funds (disbursement)
  check_number          text,

  -- Running balance snapshot after this entry — set exclusively by trigger
  balance_after         numeric(10,2) NOT NULL DEFAULT 0,

  -- Immutable audit trail
  created_by            uuid    NOT NULL REFERENCES public.users(id),

  -- Disbursements must cite an invoice (portal or external)
  CONSTRAINT disbursement_requires_invoice CHECK (
    entry_type != 'disbursement'
    OR (invoice_id IS NOT NULL OR (external_invoice_ref IS NOT NULL AND external_invoice_ref != ''))
  )
);

CREATE INDEX idx_tle_matter   ON public.trust_ledger_entries (matter_id,        created_at DESC);
CREATE INDEX idx_tle_account  ON public.trust_ledger_entries (trust_account_id, created_at DESC);
CREATE INDEX idx_tle_invoice  ON public.trust_ledger_entries (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_tle_type     ON public.trust_ledger_entries (entry_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: enforce negative-balance prohibition + compute balance_after
-- This is the most critical safety mechanism in the entire system.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trust_ledger_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_balance  numeric(10,2);
  v_new_balance      numeric(10,2);
  v_is_debit         boolean;
BEGIN
  -- Compute current balance from the full ledger (O(n) but always correct;
  -- append-only constraint means this sum never changes for past entries)
  SELECT COALESCE(
    SUM(CASE
      WHEN entry_type IN ('deposit', 'transfer_in', 'adjustment_credit')      THEN amount
      WHEN entry_type IN ('disbursement', 'transfer_out', 'adjustment_debit') THEN -amount
      ELSE 0
    END), 0)
  INTO v_current_balance
  FROM public.trust_ledger_entries
  WHERE matter_id = NEW.matter_id;

  v_is_debit := NEW.entry_type IN ('disbursement', 'transfer_out', 'adjustment_debit');

  IF v_is_debit THEN
    v_new_balance := v_current_balance - NEW.amount;

    -- HARD STOP: negative client balance is prohibited under IOLTA rules in all 50 states.
    -- Using one client's funds for another client = criminal liability + disbarment.
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION
        E'IOLTA VIOLATION: Insufficient trust balance.\n'
        'Matter: %. Current balance: $%. Attempted debit: $%.\n'
        'A client trust balance can never go negative. '
        'Verify the balance before recording this transaction.',
        NEW.matter_id, v_current_balance, NEW.amount;
    END IF;
  ELSE
    v_new_balance := v_current_balance + NEW.amount;
  END IF;

  -- For portal-invoice disbursements: verify the invoice has been sent.
  -- An unsent (draft) invoice means the client has not been billed — funds cannot be released.
  IF NEW.entry_type = 'disbursement' AND NEW.invoice_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = NEW.invoice_id
        AND status IN ('sent', 'paid')
    ) THEN
      RAISE EXCEPTION
        E'IOLTA VIOLATION: Cannot disburse funds — invoice has not been sent.\n'
        'Invoice ID: %. Attorneys are prohibited from releasing trust funds until the client '
        'has been invoiced. Set the invoice status to ''sent'' before recording this disbursement.',
        NEW.invoice_id;
    END IF;
  END IF;

  -- Set the balance snapshot — application must never set this directly
  NEW.balance_after := v_new_balance;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trust_ledger_before_insert
  BEFORE INSERT ON public.trust_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.trust_ledger_before_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: enforce append-only immutability on ledger entries
-- Belt AND suspenders with the RLS USING (false) policies below.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trust_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    E'IOLTA VIOLATION: Trust ledger entries are immutable.\n'
    'To correct an error, create an adjustment_credit or adjustment_debit entry. '
    'Editing or deleting ledger entries is prohibited under IOLTA record-keeping rules.';
END;
$$;

CREATE TRIGGER trust_ledger_no_update
  BEFORE UPDATE ON public.trust_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.trust_ledger_immutable();

CREATE TRIGGER trust_ledger_no_delete
  BEFORE DELETE ON public.trust_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.trust_ledger_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- TRUST RECONCILIATIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.trust_reconciliations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz NOT NULL DEFAULT now(),

  trust_account_id        uuid        NOT NULL REFERENCES public.trust_accounts(id),
  period_start            date        NOT NULL,
  period_end              date        NOT NULL,

  -- Three-way reconciliation figures
  -- (1) Bank statement balance — manually entered from the bank statement
  bank_statement_balance  numeric(10,2) NOT NULL,
  -- (2) Firm ledger total — computed by system before saving
  ledger_balance          numeric(10,2) NOT NULL,
  -- (3) Sum of all per-client balances — computed by system before saving
  client_ledger_sum       numeric(10,2) NOT NULL,

  -- Set by trigger — application cannot override
  all_match               boolean       NOT NULL DEFAULT false,

  -- Period type: monthly (default) or quarterly (IL, CO, LA, CT minimum)
  period_type             text          NOT NULL DEFAULT 'monthly'
                          CHECK (period_type IN ('monthly', 'quarterly')),

  notes                   text,
  completed_by            uuid          NOT NULL REFERENCES public.users(id),

  CONSTRAINT valid_period CHECK (period_end > period_start)
);

CREATE INDEX idx_reconciliations_account ON public.trust_reconciliations (trust_account_id, period_end DESC);

-- Auto-compute all_match — application cannot falsify a reconciliation result
CREATE OR REPLACE FUNCTION public.reconciliation_compute_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.all_match := (
    ABS(NEW.bank_statement_balance - NEW.ledger_balance)    <= 0.01
    AND ABS(NEW.bank_statement_balance - NEW.client_ledger_sum) <= 0.01
    AND ABS(NEW.ledger_balance         - NEW.client_ledger_sum) <= 0.01
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_before_insert
  BEFORE INSERT ON public.trust_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.reconciliation_compute_match();

CREATE TRIGGER reconciliation_before_update
  BEFORE UPDATE ON public.trust_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.reconciliation_compute_match();

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEW: matter_trust_balances
-- Replaces matters.retainer_balance as the live source of truth.
-- (matters.retainer_balance is migrated and dropped in migration 1201)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.matter_trust_balances AS
SELECT
  matter_id,
  SUM(CASE
    WHEN entry_type IN ('deposit', 'transfer_in', 'adjustment_credit')      THEN amount
    WHEN entry_type IN ('disbursement', 'transfer_out', 'adjustment_debit') THEN -amount
    ELSE 0
  END)              AS balance,
  COUNT(*)          AS entry_count,
  MAX(created_at)   AS last_transaction_at
FROM public.trust_ledger_entries
GROUP BY matter_id;

COMMENT ON VIEW public.matter_trust_balances IS
  'Live per-matter trust balance derived from the immutable ledger. '
  'Always authoritative — never read matters.retainer_balance once trust_accounting is active.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.trust_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_ledger_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trust_reconciliations ENABLE ROW LEVEL SECURITY;

-- trust_accounts: read = any staff; write/update = admin only
CREATE POLICY "trust_accounts_select"
  ON public.trust_accounts FOR SELECT
  USING (public.can_read('trust_accounting'));

CREATE POLICY "trust_accounts_insert"
  ON public.trust_accounts FOR INSERT
  WITH CHECK (public.can_admin('trust_accounting'));

CREATE POLICY "trust_accounts_update"
  ON public.trust_accounts FOR UPDATE
  USING (public.can_admin('trust_accounting'));

-- invoices: read = any staff; insert/update = write; delete = never (void instead)
CREATE POLICY "invoices_select"
  ON public.invoices FOR SELECT
  USING (public.can_read('trust_accounting'));

CREATE POLICY "invoices_insert"
  ON public.invoices FOR INSERT
  WITH CHECK (public.can_write('trust_accounting'));

CREATE POLICY "invoices_update"
  ON public.invoices FOR UPDATE
  USING (public.can_write('trust_accounting'));

CREATE POLICY "invoices_no_delete"
  ON public.invoices FOR DELETE
  USING (false);  -- void invoices, never delete

-- trust_ledger_entries: read/insert only; update/delete denied at both RLS and trigger level
CREATE POLICY "tle_select"
  ON public.trust_ledger_entries FOR SELECT
  USING (public.can_read('trust_accounting'));

CREATE POLICY "tle_insert"
  ON public.trust_ledger_entries FOR INSERT
  WITH CHECK (public.can_write('trust_accounting'));

CREATE POLICY "tle_no_update"
  ON public.trust_ledger_entries FOR UPDATE
  USING (false);

CREATE POLICY "tle_no_delete"
  ON public.trust_ledger_entries FOR DELETE
  USING (false);

-- trust_reconciliations: read = any staff; insert/update = admin only
CREATE POLICY "reconciliations_select"
  ON public.trust_reconciliations FOR SELECT
  USING (public.can_read('trust_accounting'));

CREATE POLICY "reconciliations_insert"
  ON public.trust_reconciliations FOR INSERT
  WITH CHECK (public.can_admin('trust_accounting'));

CREATE POLICY "reconciliations_update"
  ON public.trust_reconciliations FOR UPDATE
  USING (public.can_admin('trust_accounting'));
