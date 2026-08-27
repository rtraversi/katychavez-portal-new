-- Migration 1626: Package Builder
--
-- The firm sends a client a finalized USCIS form package to sign; the client
-- scans the signed pages back — sometimes as one combined PDF, sometimes as
-- loose page scans. Package Builder routes each returned page to the form and
-- page slot it belongs to, flags edition / signature / footer problems, and
-- splices the approved pages into a NEW signed copy of the form.
--
-- Two shaping decisions, both deliberate:
--
-- 1. "Flag, don't hold." The three checks (edition / signed+dated / footer) are
--    advisory, not gates — a routed page with a generated target is always
--    Apply-able and the human decides. So package_builder_pages.status is a
--    lifecycle, not a verdict: 'pending' (analyzed, not yet applied) | 'applied'
--    | 'skipped' (unrouted or unanalyzable — nothing to do). Whether a pending
--    page is actually applyable is derived from target_generated_form_id.
--
-- 2. Apply writes a NEW signed copy and never touches the clean generated PDF,
--    so generated_forms gains signed_r2_key / signed_at / signed_by. The splice
--    targets the LATEST generated version (draft or finalized) and accumulates
--    into signed_r2_key across applies — sign page 4, then page 11, one PDF.
--
-- Part of the draft_forms premium module — no new module row. RLS mirrors
-- generated_forms. See PACKAGE-BUILDER-PLAN.md.

-- ── package_builder_batches ───────────────────────────────────────────────────
-- One row per "run" — a set of uploaded documents analyzed together.

CREATE TABLE IF NOT EXISTS public.package_builder_batches (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  matter_id    uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'ready'
                  CHECK (status IN ('analyzing','ready','applied','error')),
  source_count int,                                  -- documents analyzed in this run
  tokens_used  int,
  created_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_package_builder_batches_matter ON public.package_builder_batches (matter_id);

DROP TRIGGER IF EXISTS set_package_builder_batches_updated_at ON public.package_builder_batches;
CREATE TRIGGER set_package_builder_batches_updated_at
  BEFORE UPDATE ON public.package_builder_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── package_builder_pages ─────────────────────────────────────────────────────
-- One row per page the AI detected across the run's documents. This is the
-- audit trail of what was routed where and why — kept even for skipped pages so
-- a reviewer can see the reason a file was not spliced.

CREATE TABLE IF NOT EXISTS public.package_builder_pages (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  batch_id                 uuid        NOT NULL REFERENCES public.package_builder_batches(id) ON DELETE CASCADE,

  -- Where the page came from (the uploaded document + its 0-based page index)
  source_document_id       uuid        REFERENCES public.documents(id) ON DELETE SET NULL,
  source_page_index        int,

  -- Where the AI thinks it goes
  form_key                 text,                       -- lowercased USCIS number, e.g. 'i-765'; NULL if unrecognized
  target_template_id       uuid        REFERENCES public.form_templates(id)  ON DELETE SET NULL,
  target_generated_form_id uuid        REFERENCES public.generated_forms(id) ON DELETE SET NULL,
  target_page_number       int,                        -- 1-based page # from the footer "Page X of Y"
  form_total_pages         int,

  -- Validation (advisory — see "flag, don't hold" above)
  edition_detected         text,
  edition_expected         text,
  checks                   jsonb       NOT NULL DEFAULT '{}',  -- { edition_ok, signed, dated, footer_visible }
  confidence               numeric,
  reason                   text,

  status                   text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','applied','skipped')),

  -- Filled in by the splice
  applied_r2_key           text,
  applied_at               timestamptz,
  applied_by               uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_package_builder_pages_batch  ON public.package_builder_pages (batch_id);
CREATE INDEX IF NOT EXISTS idx_package_builder_pages_target ON public.package_builder_pages (target_generated_form_id);

DROP TRIGGER IF EXISTS set_package_builder_pages_updated_at ON public.package_builder_pages;
CREATE TRIGGER set_package_builder_pages_updated_at
  BEFORE UPDATE ON public.package_builder_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── generated_forms: the signed copy ──────────────────────────────────────────
-- Never mutate r2_key / finalized_r2_key. The splice writes here instead, so the
-- clean generated form stays downloadable and every apply is reversible.
ALTER TABLE public.generated_forms
  ADD COLUMN IF NOT EXISTS signed_r2_key text,
  ADD COLUMN IF NOT EXISTS signed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by     uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ── RLS (mirrors generated_forms — draft_forms module) ────────────────────────

ALTER TABLE public.package_builder_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_builder_pages   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "package_builder_batches_read"  ON public.package_builder_batches;
DROP POLICY IF EXISTS "package_builder_batches_write" ON public.package_builder_batches;
CREATE POLICY "package_builder_batches_read"  ON public.package_builder_batches FOR SELECT USING (can_read('draft_forms'));
CREATE POLICY "package_builder_batches_write" ON public.package_builder_batches FOR ALL    USING (can_write('draft_forms'));

DROP POLICY IF EXISTS "package_builder_pages_read"  ON public.package_builder_pages;
DROP POLICY IF EXISTS "package_builder_pages_write" ON public.package_builder_pages;
CREATE POLICY "package_builder_pages_read"  ON public.package_builder_pages FOR SELECT USING (can_read('draft_forms'));
CREATE POLICY "package_builder_pages_write" ON public.package_builder_pages FOR ALL    USING (can_write('draft_forms'));
