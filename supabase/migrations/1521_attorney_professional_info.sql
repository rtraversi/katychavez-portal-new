-- Migration 1521: per-attorney professional info for USCIS form autofill
--
-- The G-28 wants the attorney's licensing authority (Pt2Line1a) and USCIS
-- Online Account Number (Pt1Line1); the I-765 attorney header wants the same
-- account number; several forms have an attorney fax box. bar_number (1512)
-- and phone (1515) already exist -- these complete the set.
--
-- Per-attorney by design: forms pull the matter's assigned attorney
-- (matters.assigned_attorney_id) at generate time, so multi-attorney firms
-- get the right attorney on each form automatically. Maintained via the
-- Settings -> Users editor (admin) and the topbar "My Profile" editor (self,
-- through /api/update-my-profile which whitelists these columns).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS licensing_authority  text,
  ADD COLUMN IF NOT EXISTS uscis_account_number text,
  ADD COLUMN IF NOT EXISTS fax                  text;

COMMENT ON COLUMN public.users.licensing_authority  IS 'Bar licensing authority as shown on G-28 Part 2 (e.g. "State Bar of Texas")';
COMMENT ON COLUMN public.users.uscis_account_number IS 'USCIS Online Account Number (12 chars), G-28 Part 1 / I-765 attorney header';
COMMENT ON COLUMN public.users.fax                  IS 'Attorney fax number, digits only preferred';
