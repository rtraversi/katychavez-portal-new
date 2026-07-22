-- Migration 1503: Invoicing module — line items + payment adapter columns
-- Extends the invoices stub from migration 1200 (trust_accounting) with:
--   - invoice_line_items (time entry linkage, manual line items, flat fees)
--   - payment_adapter / payment_link / payment_reference / paid_at on invoices
--   - viewed_at timestamp for client tracking
--   - freshbooks added to source CHECK
-- Applied: dev ☐  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- EXTEND INVOICES
-- ─────────────────────────────────────────────────────────────────────────────

-- Add freshbooks to the allowed source values
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_source_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_source_check
  CHECK (source IN ('portal', 'quickbooks', 'freshbooks', 'clio', 'other'));

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_adapter   text CHECK (payment_adapter IN ('confido', 'stripe', 'manual')),
  ADD COLUMN IF NOT EXISTS payment_link      text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS paid_at           timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_at         timestamptz;

-- Auto-set paid_at when status transitions to 'paid'
CREATE OR REPLACE FUNCTION public.invoice_manage_paid_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    NEW.paid_at := COALESCE(NEW.paid_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_manage_paid_at ON public.invoices;
CREATE TRIGGER invoices_manage_paid_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoice_manage_paid_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- INVOICE LINE ITEMS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),

  invoice_id      uuid          NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  time_entry_id   uuid          REFERENCES public.time_entries(id) ON DELETE SET NULL,

  description     text          NOT NULL,
  hours           decimal(5,2),
  rate            decimal(10,2),
  amount          decimal(10,2) NOT NULL CHECK (amount > 0),
  sort_order      integer       NOT NULL DEFAULT 0,
  item_type       text          NOT NULL DEFAULT 'time'
                  CHECK (item_type IN ('time', 'flat_fee', 'expense', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice    ON public.invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_time_entry ON public.invoice_line_items (time_entry_id)
  WHERE time_entry_id IS NOT NULL;

DROP TRIGGER IF EXISTS invoice_line_items_updated_at ON public.invoice_line_items;
CREATE TRIGGER invoice_line_items_updated_at
  BEFORE UPDATE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "line_items_select" ON public.invoice_line_items;
CREATE POLICY "line_items_select"
  ON public.invoice_line_items FOR SELECT
  USING (public.can_read('billing'));

DROP POLICY IF EXISTS "line_items_insert" ON public.invoice_line_items;
CREATE POLICY "line_items_insert"
  ON public.invoice_line_items FOR INSERT
  WITH CHECK (public.can_write('billing'));

DROP POLICY IF EXISTS "line_items_update" ON public.invoice_line_items;
CREATE POLICY "line_items_update"
  ON public.invoice_line_items FOR UPDATE
  USING (public.can_write('billing'));

DROP POLICY IF EXISTS "line_items_delete" ON public.invoice_line_items;
CREATE POLICY "line_items_delete"
  ON public.invoice_line_items FOR DELETE
  USING (public.can_write('billing'));

-- ─────────────────────────────────────────────────────────────────────────────
-- MODULE REGISTRATION
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'billing',
  'Billing & Invoicing',
  'Create invoices from time entries, send to clients, and track payments.',
  'file-text',
  'billing',
  1,
  50,
  false,
  'premium'
)
ON CONFLICT (key) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon;
