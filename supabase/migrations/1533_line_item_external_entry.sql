-- 1533: Track provider time entries on invoice lines (FreshBooks dedupe).
--
-- Unbilled time for FB-connected firms is read live from FreshBooks, but the
-- portal never consumed that pool: FB-pulled lines store time_entry_id NULL
-- (FB ids aren't portal uuids), and the FB invoice we create carries plain
-- lines, so FB never flips the entry's billed flag either. Result: time
-- already on a draft/sent invoice re-appeared in the unbilled list and could
-- be invoiced twice (observed: duplicate $80 drafts INV-0035/0040 on SSL).
--
-- external_entry_id stores the provider-scoped id exactly as the pull layer
-- names it ("fb_344181434"; QuickBooks later: "qb_…"). get-unbilled-time
-- filters pulled entries against ids on non-void invoices, so removing a line
-- or voiding an invoice releases the entry automatically. Additive; old rows
-- stay NULL (pre-1533 invoices keep relying on staff discipline).

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS external_entry_id text;

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_external_entry
  ON public.invoice_line_items (external_entry_id) WHERE external_entry_id IS NOT NULL;
