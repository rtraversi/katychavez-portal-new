-- Migration 1504: Invoice integrity guards + IOLTA compliance fixes
-- Addresses audit findings F1, F2, W6:
--   F1 — invoices.amount can drift from line items (add sync trigger)
--   F2 — invoice_line_items editable after invoice is sent/paid (tighten RLS)
--   W6 — time_entries.created_by ON DELETE SET NULL loses audit trail (→ RESTRICT)
-- Applied: dev ☐  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- F1: Keep invoices.amount in sync with SUM(invoice_line_items.amount)
-- Trigger fires after any insert/update/delete on line items while invoice is draft.
-- Sent/paid/void invoice amounts are frozen — no sync attempted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_invoice_amount()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_invoice_id uuid;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  UPDATE public.invoices
  SET amount = (
    SELECT COALESCE(SUM(amount), 0)
    FROM public.invoice_line_items
    WHERE invoice_id = v_invoice_id
  )
  WHERE id = v_invoice_id
    AND status = 'draft';  -- only sync while editable; other statuses are immutable

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS invoice_line_items_sync_amount ON public.invoice_line_items;
CREATE TRIGGER invoice_line_items_sync_amount
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_amount();

-- ─────────────────────────────────────────────────────────────────────────────
-- F2: Lock line items once invoice leaves draft status
-- Drop and recreate the write policies with an invoice status guard.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "line_items_insert" ON public.invoice_line_items;
DROP POLICY IF EXISTS "line_items_update" ON public.invoice_line_items;
DROP POLICY IF EXISTS "line_items_delete" ON public.invoice_line_items;

-- INSERT: only allowed on draft invoices
CREATE POLICY "line_items_insert"
  ON public.invoice_line_items FOR INSERT
  WITH CHECK (
    public.can_write('billing')
    AND EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND status = 'draft'
    )
  );

-- UPDATE: only allowed on draft invoices
CREATE POLICY "line_items_update"
  ON public.invoice_line_items FOR UPDATE
  USING (
    public.can_write('billing')
    AND EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND status = 'draft'
    )
  );

-- DELETE: only allowed on draft invoices
CREATE POLICY "line_items_delete"
  ON public.invoice_line_items FOR DELETE
  USING (
    public.can_write('billing')
    AND EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND status = 'draft'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- W6: Prevent silent audit-trail loss when a user is deleted
-- time_entries.created_by was ON DELETE SET NULL — silently nullifying the
-- audit record. RESTRICT is correct: delete the user's entries first.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.time_entries
  DROP CONSTRAINT IF EXISTS time_entries_created_by_fkey;

ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;
