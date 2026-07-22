-- Migration 1603: per-matter manual field edits for the form filler editor
--
-- Prima-style in-app editing: staff type into a generated form's fields in
-- the portal; each edit is stored here at the MATTER level (not on the
-- generated_forms version row), so manual answers survive Regenerate and
-- Reset. Fill precedence at generate time becomes:
--
--   manual edit  >  firm_overrides  >  field_map autofill
--
-- value semantics: the string as it should appear in the field. Checkboxes
-- store 'Yes'/'No'. An empty string means "deliberately cleared" (blanks the
-- field even if autofill has a value). Reverting to autofill DELETES the row.

CREATE TABLE IF NOT EXISTS public.form_field_edits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  field_name  text NOT NULL,
  value       text NOT NULL,
  updated_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, template_id, field_name)
);

CREATE INDEX IF NOT EXISTS form_field_edits_matter_template_idx
  ON public.form_field_edits (matter_id, template_id);

CREATE TRIGGER form_field_edits_updated_at
  BEFORE UPDATE ON public.form_field_edits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.form_field_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_field_edits_read"  ON public.form_field_edits FOR SELECT USING (can_read('draft_forms'));
CREATE POLICY "form_field_edits_write" ON public.form_field_edits FOR ALL    USING (can_write('draft_forms'));
