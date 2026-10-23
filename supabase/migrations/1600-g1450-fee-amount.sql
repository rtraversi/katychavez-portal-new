-- Migration 1600-g1450-fee-amount: fill the G-1450's payment amount from the
-- case (Drafter 1.0.4, RT-13). jsonb || merge -- only this entry changes, the
-- rest of the map (and every card-holder field, still blank for PCI) is
-- untouched.
--
--   AuthorizedPaymentAmt  <- form.fee_amount  (matter_forms.fee_amount of
--                            THIS copy of the form; whole dollars, no "$",
--                            no cents: USCIS help text "1234 or 1,234", 7 chars)
--
-- The amount the firm authorizes is not card data. A DACA case has two
-- G-1450s, and each copy fills its own amount.
--
-- Requires 1627 (matter_forms.fee_amount) and the 1.0.4 Worker, which puts
-- the row being filled in the fill context as "form". Rob applies it with 1627.

UPDATE public.form_templates
SET field_map = field_map || '{
  "form1[0].#subform[0].AuthorizedPaymentAmt[0]": { "type": "text", "source": "form.fee_amount", "transform": "whole_dollars" }
}'::jsonb
WHERE form_key = 'g-1450';
