-- Migration 1620: Case Builder schema foundation
--
-- Turns the case-type form list from a developer-authored, one-shape-per-case-type
-- row into something the firm authors and varies. See CASE-BUILDER-PLAN.md.
--
-- Four changes, all additive and safe on existing data:
--
--   1. Several named packages per case type. form_packages had UNIQUE (case_type_id),
--      so "Adjustment of Status" could only ever be ONE list. Dropping it lets a case
--      type carry variants (e.g. "AOS" and "AOS -- I-130 already filed"); a partial
--      unique index keeps exactly one of them the default so a matter created with no
--      explicit choice still gets a sensible list.
--   2. case_types.active -- deactivate instead of delete (case_types.key is referenced
--      by field maps, doc templates and intake; a hard delete would strand them). Same
--      pattern as form_templates.active.
--   3. form_templates.practice_area_id -- categorize the form library by practice area,
--      matching how the rest of the portal is organized (case_types already reference
--      practice_areas). Powers the library search/filter once it grows past 100 forms.
--
-- Idempotent: IF EXISTS / IF NOT EXISTS throughout, safe to re-run.

-- ── 1. Several named packages per case type ──────────────────────────────────
ALTER TABLE public.form_packages DROP CONSTRAINT IF EXISTS form_packages_case_type_id_key;

ALTER TABLE public.form_packages ADD COLUMN IF NOT EXISTS is_default  boolean NOT NULL DEFAULT false;
ALTER TABLE public.form_packages ADD COLUMN IF NOT EXISTS description text;

-- Every package that exists today was the sole list for its case type (the dropped
-- UNIQUE guaranteed it), so each becomes that case type's default.
UPDATE public.form_packages SET is_default = true WHERE is_default = false;

-- Exactly one default per case type; additional named packages are is_default = false.
CREATE UNIQUE INDEX IF NOT EXISTS form_packages_one_default_per_case_type
  ON public.form_packages (case_type_id) WHERE is_default;

-- ── 2. Deactivate case types instead of deleting ─────────────────────────────
ALTER TABLE public.case_types ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- ── 3. Categorize the form library by practice area ──────────────────────────
ALTER TABLE public.form_templates
  ADD COLUMN IF NOT EXISTS practice_area_id uuid REFERENCES public.practice_areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_templates_practice_area
  ON public.form_templates (practice_area_id);

-- Backfill: every template in the library today is a USCIS immigration form.
-- Guarded on the immigration practice area existing so this is safe on any client DB.
UPDATE public.form_templates
SET practice_area_id = (SELECT id FROM public.practice_areas WHERE key = 'immigration')
WHERE practice_area_id IS NULL
  AND EXISTS (SELECT 1 FROM public.practice_areas WHERE key = 'immigration');
