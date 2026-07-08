-- Migration 1513: firm_settings
--
-- Singleton table holding the firm's own info (name/address/phone/etc.) — a
-- "default" data source for form autofill (e.g. G-28 firm/attorney fields),
-- separate from per-client data. No firm-settings table existed before this;
-- functions/api/drafting-generate.js currently hardcodes '[Firm Name]' /
-- '[Firm Address]' placeholders — this table should replace those as a
-- follow-up (not in scope here).
--
-- For multi-tenant future: add firm_id column here before template extraction
-- (same note as enabled_modules in 1050_enabled_modules.sql).

CREATE TABLE IF NOT EXISTS public.firm_settings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_name      text,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  zip            text,
  phone          text,
  fax            text,
  email          text,
  website        text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

-- Enforce singleton: at most one row.
CREATE UNIQUE INDEX IF NOT EXISTS firm_settings_singleton ON public.firm_settings ((true));

CREATE TRIGGER set_firm_settings_updated_at
  BEFORE UPDATE ON public.firm_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.firm_settings ENABLE ROW LEVEL SECURITY;

-- All authenticated staff can read (needed for form autofill + any settings display)
CREATE POLICY "authenticated can read firm_settings"
  ON public.firm_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only Owners can edit
CREATE POLICY "owners can manage firm_settings"
  ON public.firm_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.auth_id = auth.uid() AND r.name = 'Owner'
    )
  );

-- Seed one empty row so the app always has a row to read/update.
INSERT INTO public.firm_settings (firm_name)
SELECT NULL
WHERE NOT EXISTS (SELECT 1 FROM public.firm_settings);
