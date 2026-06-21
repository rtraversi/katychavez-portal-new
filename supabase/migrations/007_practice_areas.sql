-- Migration 007: Practice Areas & Case Types
-- Replaces the hardcoded case_type enum with a table-driven system.
-- Supports multiple practice areas per firm (family law, immigration, etc.)
-- Enabled practice areas are controlled via enabled_practice_areas (mirrors enabled_modules pattern).

-- ── Reference tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.practice_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_area_id uuid NOT NULL REFERENCES public.practice_areas(id) ON DELETE CASCADE,
  key              text NOT NULL,
  name             text NOT NULL,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_area_id, key)
);

-- ── Enabled practice areas (per-firm gate, like enabled_modules) ──────────────

CREATE TABLE IF NOT EXISTS public.enabled_practice_areas (
  practice_area_key text PRIMARY KEY,
  enabled_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Convert case_type columns from ENUM to text ───────────────────────────────
-- The practice area refactor supersedes the case_type ENUM.
-- We keep matters.case_type as a text column for backward compat (doc template filtering still uses it).
-- task_reminder_rules.applies_to_case_types becomes text[] for the same reason.

ALTER TABLE public.matters
  ALTER COLUMN case_type TYPE text USING case_type::text,
  ALTER COLUMN case_type DROP NOT NULL;

ALTER TABLE public.task_reminder_rules
  ALTER COLUMN applies_to_case_types TYPE text[] USING applies_to_case_types::text[];

-- ── Extend matters with FK columns ────────────────────────────────────────────

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS practice_area_id uuid REFERENCES public.practice_areas(id),
  ADD COLUMN IF NOT EXISTS case_type_id     uuid REFERENCES public.case_types(id);

-- ── Practice-area extension tables (stubs) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_family_law (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id  uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_immigration (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id             uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  a_number              text,
  visa_category         text,
  priority_date         date,
  receipt_number        text,
  petitioner_name       text,
  beneficiary_name      text,
  nationality           text,
  country_of_birth      text,
  last_entry_date       date,
  authorized_stay_until date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Seed: Family Law ──────────────────────────────────────────────────────────

INSERT INTO public.practice_areas (key, name, description, sort_order) VALUES
  ('family_law',  'Family Law',   'Divorce, custody, child support, adoption, and related matters', 10),
  ('immigration', 'Immigration',  'Visas, green cards, naturalization, removal defense, and related matters', 20)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('divorce',                   'Divorce',                          10),
  ('sapcr_original',            'SAPCR – Original',                 20),
  ('sapcr_modification',        'SAPCR – Modification',             30),
  ('enforcement',               'Enforcement',                      40),
  ('custody',                   'Custody',                          50),
  ('custody_modification',      'Custody Modification',             60),
  ('child_support',             'Child Support',                    70),
  ('child_support_modification','Child Support Modification',       80),
  ('paternity',                 'Paternity',                        90),
  ('prenuptial_agreement',      'Prenuptial Agreement',            100),
  ('postnuptial_agreement',     'Postnuptial Agreement',           110),
  ('protective_order',          'Protective Order',                120),
  ('adoption',                  'Adoption',                        130),
  ('other',                     'Other',                           999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'family_law'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- ── Seed: Immigration ─────────────────────────────────────────────────────────

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('family_based_petition',   'Family-Based Petition',         10),
  ('adjustment_of_status',    'Adjustment of Status',          20),
  ('consular_processing',     'Consular Processing',           30),
  ('naturalization',          'Naturalization / Citizenship',  40),
  ('daca',                    'DACA / Deferred Action',        50),
  ('asylum',                  'Asylum',                        60),
  ('removal_defense',         'Removal Defense',               70),
  ('nonimmigrant_visa',       'Nonimmigrant Visa',             80),
  ('u_visa',                  'U Visa / VAWA',                 90),
  ('t_visa',                  'T Visa (Human Trafficking)',   100),
  ('employment_authorization','Employment Authorization',      110),
  ('other',                   'Other',                        999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'immigration'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.practice_areas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_types             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enabled_practice_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_family_law      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_immigration     ENABLE ROW LEVEL SECURITY;

-- Reference tables: readable by all authenticated users, writable by admins only
CREATE POLICY "practice_areas_select" ON public.practice_areas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "case_types_select" ON public.case_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "enabled_practice_areas_select" ON public.enabled_practice_areas
  FOR SELECT TO authenticated USING (true);

-- Extension tables: firm staff read/write their own matters
CREATE POLICY "client_immigration_select" ON public.client_immigration
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "client_immigration_insert" ON public.client_immigration
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "client_immigration_update" ON public.client_immigration
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "client_immigration_delete" ON public.client_immigration
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "client_family_law_select" ON public.client_family_law
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "client_family_law_insert" ON public.client_family_law
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "client_family_law_update" ON public.client_family_law
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "client_family_law_delete" ON public.client_family_law
  FOR DELETE TO authenticated USING (true);
