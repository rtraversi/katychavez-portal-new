-- Migration 1605: per-matter form lists
--
-- Until now a matter's USCIS form set was read straight off the case type:
-- form_packages has UNIQUE (case_type_id), so every matter of a given case
-- type got exactly the same forms. Real filings vary — an adjustment-of-status
-- matter whose I-130 was already filed shouldn't be handed an I-130.
--
-- matter_forms makes the case-type package a STARTING POINT rather than a rule.
-- The matter owns its list once it exists; forms can be added or removed
-- per matter without touching the shared package.
--
-- Materialize-on-write: reads fall back to form_package_items when a matter
-- has no rows here yet (see functions/api/_fill-context.js). The first
-- mutating action seeds the whole package, then applies the change. This
-- keeps GET pure — draft_forms has a read-only tier (can_read vs can_write),
-- and a read-only user opening the tab must not create data.

CREATE TABLE IF NOT EXISTS public.matter_forms (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid        NOT NULL REFERENCES public.matters(id)        ON DELETE CASCADE,
  template_id uuid        NOT NULL REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  sort_order  int         NOT NULL DEFAULT 0,
  required    boolean     NOT NULL DEFAULT true,
  -- 'package' = seeded from the case-type package; 'manual' = added by staff
  -- for this matter only. Informational: both behave identically once here.
  source      text        NOT NULL DEFAULT 'package'
                            CHECK (source IN ('package', 'manual')),
  added_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_matter_forms_matter ON public.matter_forms (matter_id);

CREATE TRIGGER set_matter_forms_updated_at
  BEFORE UPDATE ON public.matter_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.matter_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matter_forms_read"  ON public.matter_forms FOR SELECT USING (can_read('draft_forms'));
CREATE POLICY "matter_forms_write" ON public.matter_forms FOR ALL    USING (can_write('draft_forms'));

-- ── generated_forms.package_id becomes optional ───────────────────────────────
--
-- A manually-added form has no package to point at. Existing rows keep their
-- package_id, so generated history is unchanged; only new rows for manual
-- forms carry NULL.

ALTER TABLE public.generated_forms ALTER COLUMN package_id DROP NOT NULL;
