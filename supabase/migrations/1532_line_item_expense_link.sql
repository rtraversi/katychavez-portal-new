-- 1532: Link expense line items back to their expense row.
--
-- Draft-invoice editing (Review Pending Invoices) needs to un-bill an expense
-- when its line is removed from a draft. Time lines already carry
-- time_entry_id; expense lines had no pointer, so removal couldn't release
-- the expense. Additive column; old rows stay NULL (their removal falls back
-- to "void and recreate").

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_expense
  ON public.invoice_line_items (expense_id) WHERE expense_id IS NOT NULL;
