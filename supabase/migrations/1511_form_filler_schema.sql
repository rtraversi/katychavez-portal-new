-- Migration 1511: Form Filler schema
--
-- form_templates      — one row per USCIS form (master template + hand-authored field map)
-- form_packages       — links a case_types.id to an ordered set of forms
-- form_package_items  — the ordered membership rows
-- generated_forms     — one row per matter+form+version, generated/filled output

-- ── form_templates ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.form_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  form_key      text        NOT NULL UNIQUE,        -- 'g-1450','g-1145','g-28','i-821d','i-765','i-765ws'
  label         text        NOT NULL,
  agency        text        NOT NULL DEFAULT 'USCIS',
  edition_date  text,                                -- USCIS edition date printed on the form; informational only
  r2_key        text,                                -- clean normalized template R2 key; NULL until normalized+uploaded
  field_count   int,                                 -- informational, set when template is normalized
  field_map     jsonb       NOT NULL DEFAULT '{}',   -- hand-authored dotted-path map, see functions/api/_form-fill.js
  active        boolean     NOT NULL DEFAULT true
);

CREATE TRIGGER set_form_templates_updated_at
  BEFORE UPDATE ON public.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── form_packages ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.form_packages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type_id  uuid        NOT NULL REFERENCES public.case_types(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_type_id)
);

-- ── form_package_items ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.form_package_items (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id    uuid    NOT NULL REFERENCES public.form_packages(id) ON DELETE CASCADE,
  template_id   uuid    NOT NULL REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  sort_order    int     NOT NULL DEFAULT 0,
  required      boolean NOT NULL DEFAULT true,
  UNIQUE (package_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_form_package_items_package ON public.form_package_items (package_id);

-- ── generated_forms ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.generated_forms (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  matter_id          uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  package_id         uuid        NOT NULL REFERENCES public.form_packages(id) ON DELETE RESTRICT,
  template_id        uuid        NOT NULL REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  batch_id           uuid        NOT NULL,             -- groups all forms generated together in one "Generate Package" click
  version_num        int         NOT NULL DEFAULT 1,
  r2_key             text        NOT NULL,             -- fillable draft PDF
  file_name          text        NOT NULL,
  status             text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','needs_review','finalized')),
  fields_filled      int,
  fields_total       int,
  generated_by       uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  finalized_at       timestamptz,
  finalized_by       uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  finalized_r2_key   text,                             -- flattened static PDF; set only on finalize
  UNIQUE (matter_id, template_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_generated_forms_matter ON public.generated_forms (matter_id);
CREATE INDEX IF NOT EXISTS idx_generated_forms_batch  ON public.generated_forms (batch_id);

CREATE TRIGGER set_generated_forms_updated_at
  BEFORE UPDATE ON public.generated_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.form_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_packages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_package_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_forms     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_templates_read"  ON public.form_templates FOR SELECT USING (can_read('draft_forms'));
CREATE POLICY "form_templates_write" ON public.form_templates FOR ALL    USING (can_write('draft_forms'));

CREATE POLICY "form_packages_read"  ON public.form_packages FOR SELECT USING (can_read('draft_forms'));
CREATE POLICY "form_packages_write" ON public.form_packages FOR ALL    USING (can_write('draft_forms'));

CREATE POLICY "form_package_items_read"  ON public.form_package_items FOR SELECT USING (can_read('draft_forms'));
CREATE POLICY "form_package_items_write" ON public.form_package_items FOR ALL    USING (can_write('draft_forms'));

CREATE POLICY "generated_forms_read"  ON public.generated_forms FOR SELECT USING (can_read('draft_forms'));
CREATE POLICY "generated_forms_write" ON public.generated_forms FOR ALL    USING (can_write('draft_forms'));

-- ── Seed: DACA Renewal package (case_type key = 'daca') ─────────────────────

INSERT INTO public.form_templates (form_key, label) VALUES
  ('g-1145',  'Form G-1145 — E-Notification of Application/Petition Acceptance'),
  ('g-28',    'Form G-28 — Notice of Entry of Appearance as Attorney or Accredited Representative'),
  ('i-821d',  'Form I-821D — Consideration of Deferred Action for Childhood Arrivals'),
  ('i-765',   'Form I-765 — Application for Employment Authorization'),
  ('i-765ws', 'Form I-765WS — Worksheet'),
  ('g-1450',  'Form G-1450 — Authorization for Credit Card Transactions')
ON CONFLICT (form_key) DO NOTHING;

INSERT INTO public.form_packages (case_type_id, name)
SELECT ct.id, 'DACA Renewal Package'
FROM public.case_types ct
WHERE ct.key = 'daca'
ON CONFLICT (case_type_id) DO NOTHING;

INSERT INTO public.form_package_items (package_id, template_id, sort_order)
SELECT fp.id, ft.id, x.sort_order
FROM public.form_packages fp
JOIN public.case_types ct ON ct.id = fp.case_type_id AND ct.key = 'daca'
JOIN (VALUES
  ('g-1145',  10),
  ('g-28',    20),
  ('i-821d',  30),
  ('i-765',   40),
  ('i-765ws', 50),
  ('g-1450',  60)
) AS x(form_key, sort_order) ON true
JOIN public.form_templates ft ON ft.form_key = x.form_key
ON CONFLICT (package_id, template_id) DO NOTHING;
