-- Migration 1627: a form can be on a case more than once (Drafter 1.0.4)
--
-- ROB APPLIES THIS BEFORE DEPLOYING DRAFTER 1.0.4. The 1.0.4 Worker reads and
-- writes the columns added here; deploying it first breaks the USCIS Forms tab.
-- Idempotent: safe to run twice.
--
-- Why: a DACA case files two G-1450s (the I-821D fee and the I-765 fee), each
-- with its own amount (RT-9, RT-13, D-19). Until now one form per case was a
-- database rule in three places:
--   matter_forms        UNIQUE (matter_id, template_id)               (1605)
--   form_field_edits    UNIQUE (matter_id, template_id, field_name)   (1603)
--   generated_forms     UNIQUE (matter_id, template_id, version_num)  (1511)
-- and form_package_items UNIQUE (package_id, template_id) (1511) kept a
-- package from listing a form twice.
--
-- What this does:
--   1. matter_forms: a form may repeat on a case. Adds fee_amount (whole
--      dollars, for the G-1450's AuthorizedPaymentAmt; the payment amount, not
--      card data) and package_item_id (which package line seeded the row, so
--      seeding stays idempotent now that template_id can repeat).
--   2. generated_forms and form_field_edits point at their matter_forms row
--      (matter_form_id), so each copy has its own files, versions and edits.
--      Existing rows are backfilled to their case's single row for that form.
--      Rows of a case whose list was never materialized have no row to point
--      at and stay NULL; the Worker adopts them when it seeds that case.
--   3. form_package_items: a package may list a form twice, and the DACA
--      package gets its second G-1450.
--
-- Which forms may repeat is decided by the Worker (an allowlist: G-1450 only,
-- functions/api/_form-copies.js), not here.

-- Drops every UNIQUE constraint on exactly these columns, whatever it is named.
CREATE OR REPLACE FUNCTION pg_temp.drop_unique(tbl regclass, cols text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = tbl AND con.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k)
          = (SELECT array_agg(x ORDER BY x) FROM unnest(cols) x)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, c.conname);
  END LOOP;
END;
$$;

-- ── 1. matter_forms ───────────────────────────────────────────────────────────

SELECT pg_temp.drop_unique('public.matter_forms', ARRAY['matter_id', 'template_id']);

ALTER TABLE public.matter_forms
  ADD COLUMN IF NOT EXISTS fee_amount      integer,
  ADD COLUMN IF NOT EXISTS package_item_id uuid REFERENCES public.form_package_items(id) ON DELETE SET NULL;

ALTER TABLE public.matter_forms DROP CONSTRAINT IF EXISTS matter_forms_fee_amount_chk;
ALTER TABLE public.matter_forms ADD CONSTRAINT matter_forms_fee_amount_chk
  CHECK (fee_amount IS NULL OR (fee_amount >= 0 AND fee_amount <= 9999999));

COMMENT ON COLUMN public.matter_forms.fee_amount IS
  'Whole dollars this copy of the form pays (G-1450 AuthorizedPaymentAmt). NULL = not set yet.';

-- Seeding a case from its package inserts one row per package line; this is
-- what makes a double-click a no-op. Manual rows (NULL) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS matter_forms_matter_package_item_key
  ON public.matter_forms (matter_id, package_item_id);

CREATE INDEX IF NOT EXISTS idx_matter_forms_matter_template
  ON public.matter_forms (matter_id, template_id);

-- ── 2. generated_forms and form_field_edits follow the row ────────────────────

ALTER TABLE public.generated_forms
  ADD COLUMN IF NOT EXISTS matter_form_id uuid REFERENCES public.matter_forms(id) ON DELETE CASCADE;
ALTER TABLE public.form_field_edits
  ADD COLUMN IF NOT EXISTS matter_form_id uuid REFERENCES public.matter_forms(id) ON DELETE CASCADE;

-- Backfill: each case's single row for that form (the first by list order,
-- should a case somehow hold two already).
WITH first_row AS (
  SELECT DISTINCT ON (matter_id, template_id) id, matter_id, template_id
  FROM public.matter_forms
  ORDER BY matter_id, template_id, sort_order, created_at, id
)
UPDATE public.generated_forms g
SET matter_form_id = f.id
FROM first_row f
WHERE g.matter_form_id IS NULL AND g.matter_id = f.matter_id AND g.template_id = f.template_id;

WITH first_row AS (
  SELECT DISTINCT ON (matter_id, template_id) id, matter_id, template_id
  FROM public.matter_forms
  ORDER BY matter_id, template_id, sort_order, created_at, id
)
UPDATE public.form_field_edits e
SET matter_form_id = f.id
FROM first_row f
WHERE e.matter_form_id IS NULL AND e.matter_id = f.matter_id AND e.template_id = f.template_id;

-- Versions count per copy now, and edits belong to one copy.
SELECT pg_temp.drop_unique('public.generated_forms', ARRAY['matter_id', 'template_id', 'version_num']);
SELECT pg_temp.drop_unique('public.form_field_edits', ARRAY['matter_id', 'template_id', 'field_name']);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_forms_matter_form_version_key') THEN
    ALTER TABLE public.generated_forms
      ADD CONSTRAINT generated_forms_matter_form_version_key UNIQUE (matter_form_id, version_num);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_field_edits_matter_form_field_key') THEN
    ALTER TABLE public.form_field_edits
      ADD CONSTRAINT form_field_edits_matter_form_field_key UNIQUE (matter_form_id, field_name);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_generated_forms_matter_form ON public.generated_forms (matter_form_id);
CREATE INDEX IF NOT EXISTS idx_form_field_edits_matter_form ON public.form_field_edits (matter_form_id);

-- ── 3. form_package_items: a package may list a form twice ───────────────────

SELECT pg_temp.drop_unique('public.form_package_items', ARRAY['package_id', 'template_id']);

-- The DACA package's second G-1450 (one for the I-821D fee, one for the
-- I-765's). Added only while the package lists exactly one, so a rerun, or a
-- firm that already set its package up by hand, is left alone.
INSERT INTO public.form_package_items (package_id, template_id, sort_order, required)
SELECT i.package_id, i.template_id, i.sort_order + 1, i.required
FROM public.form_package_items i
JOIN public.form_packages  p  ON p.id = i.package_id
JOIN public.case_types     ct ON ct.id = p.case_type_id AND ct.key = 'daca'
JOIN public.form_templates t  ON t.id = i.template_id AND t.form_key = 'g-1450'
WHERE (SELECT count(*) FROM public.form_package_items x
       WHERE x.package_id = i.package_id AND x.template_id = i.template_id) = 1;
