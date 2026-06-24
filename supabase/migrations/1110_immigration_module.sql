-- Migration 1110: Immigration module
-- Expands the client_immigration stub, adds family members table,
-- adds enabled_immigration_case_types for firm-level sub-tab config,
-- and grants Partner Attorney access to Practice Areas settings.

-- ── Expand client_immigration ─────────────────────────────────────────────────
-- Drop the placeholder stub columns (never used; replaced by proper schema)

ALTER TABLE public.client_immigration
  DROP COLUMN IF EXISTS visa_category,
  DROP COLUMN IF EXISTS priority_date,
  DROP COLUMN IF EXISTS receipt_number,
  DROP COLUMN IF EXISTS petitioner_name,
  DROP COLUMN IF EXISTS beneficiary_name,
  DROP COLUMN IF EXISTS nationality,
  DROP COLUMN IF EXISTS authorized_stay_until;

-- Rename last_entry_date to match the rest of the schema (additive + safe)
ALTER TABLE public.client_immigration
  RENAME COLUMN last_entry_date TO last_entry_date_tmp;

ALTER TABLE public.client_immigration
  ADD COLUMN IF NOT EXISTS last_entry_date date;

UPDATE public.client_immigration
  SET last_entry_date = last_entry_date_tmp
  WHERE last_entry_date_tmp IS NOT NULL;

ALTER TABLE public.client_immigration
  DROP COLUMN IF EXISTS last_entry_date_tmp;

-- Add universal immigration fields
ALTER TABLE public.client_immigration
  ADD COLUMN IF NOT EXISTS country_of_citizenship    text,
  ADD COLUMN IF NOT EXISTS languages                 text,
  ADD COLUMN IF NOT EXISTS immigration_status        text,
  ADD COLUMN IF NOT EXISTS port_of_entry             text,
  ADD COLUMN IF NOT EXISTS i94_number                text,
  ADD COLUMN IF NOT EXISTS i94_expiry                date,
  ADD COLUMN IF NOT EXISTS is_detained               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detention_facility        text,
  ADD COLUMN IF NOT EXISTS has_prior_removal_order   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prior_removal_order_notes text,
  ADD COLUMN IF NOT EXISTS has_criminal_history      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS criminal_history_notes    text,
  ADD COLUMN IF NOT EXISTS case_data                 jsonb NOT NULL DEFAULT '{}';

-- Ensure one row per matter
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_immigration_matter_id_unique'
  ) THEN
    ALTER TABLE public.client_immigration
      ADD CONSTRAINT client_immigration_matter_id_unique UNIQUE (matter_id);
  END IF;
END $$;

-- ── Immigration family members / dependents ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_immigration_family_members (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  immigration_id            uuid        NOT NULL REFERENCES public.client_immigration(id) ON DELETE CASCADE,
  matter_id                 uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  first_name                text        NOT NULL,
  last_name                 text,
  relationship              text        NOT NULL,
  dob                       date,
  country_of_birth          text,
  nationality               text,
  a_number                  text,
  immigration_status        text,
  is_derivative_beneficiary boolean     NOT NULL DEFAULT false,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_immigration_family_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "imm_family_members_select" ON public.client_immigration_family_members
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "imm_family_members_insert" ON public.client_immigration_family_members
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "imm_family_members_update" ON public.client_immigration_family_members
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "imm_family_members_delete" ON public.client_immigration_family_members
  FOR DELETE TO authenticated USING (true);

-- ── Immigration sub-tab configuration ────────────────────────────────────────
-- sub_tab_key values: family_based, employment_based, humanitarian,
--                     removal_defense, nonimmigrant, naturalization, habeas

CREATE TABLE IF NOT EXISTS public.enabled_immigration_case_types (
  sub_tab_key text        PRIMARY KEY,
  enabled_at  timestamptz NOT NULL DEFAULT now(),
  enabled_by  uuid        REFERENCES public.users(id)
);

ALTER TABLE public.enabled_immigration_case_types ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (needed for the client detail tab rendering)
CREATE POLICY "imm_case_types_select" ON public.enabled_immigration_case_types
  FOR SELECT TO authenticated USING (true);

-- Owner + Partner Attorney can manage
CREATE POLICY "imm_case_types_manage" ON public.enabled_immigration_case_types
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.auth_id = auth.uid()
        AND r.name IN ('Owner', 'Partner Attorney')
    )
  );

-- ── Give Partner Attorney access to the Practice Areas settings page ──────────

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'practice_areas_settings', 'read'::public.access_level
FROM public.roles r
WHERE r.name = 'Partner Attorney'
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ── Register immigration as a module ─────────────────────────────────────────

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'immigration',
  'Immigration',
  'Visas, green cards, naturalization, removal defense, and related matters.',
  'globe',
  'immigration',
  1,
  15,
  false
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'immigration', 'write'
FROM public.roles
WHERE name IN ('Owner', 'Attorney', 'Partner Attorney', 'Paralegal')
ON CONFLICT (role_id, module_key) DO NOTHING;
