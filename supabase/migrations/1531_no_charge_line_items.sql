-- 1531: Allow $0 ("no charge") invoice line items.
--
-- 1503 created invoice_line_items with CHECK (amount > 0), which made any
-- invoice containing a no-charge time entry fail wholesale ("violates check
-- constraint invoice_line_items_amount_check"). No-charge lines are standard
-- legal-billing practice — the client sees the work that was done at no cost —
-- and including them marks the underlying time entries billed so they stop
-- accumulating in the unbilled list.
--
-- Negative amounts stay blocked; the create-invoice endpoint keeps its
-- "invoice total must be > 0" guard, so an all-zero invoice is still rejected.

ALTER TABLE public.invoice_line_items
  DROP CONSTRAINT IF EXISTS invoice_line_items_amount_check;

ALTER TABLE public.invoice_line_items
  ADD CONSTRAINT invoice_line_items_amount_check CHECK (amount >= 0);
