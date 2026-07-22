-- Migration 1703: trust-asset questions on financial_info
--
-- Adds two yes/no + explain question pairs to the client intake's Financial
-- section: whether the client and/or their spouse have assets held in a
-- trust. NULL = not yet answered (distinct from "No").

ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS client_has_trust_assets     boolean;
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS client_trust_assets_explain text;
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS opposing_has_trust_assets     boolean;
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS opposing_trust_assets_explain text;
