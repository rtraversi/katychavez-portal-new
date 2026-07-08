-- Migration 1520: firm-editable template defaults for the USCIS form filler
--
-- Attorneys historically kept their own pre-filled copy of each USCIS PDF
-- (standing answers like the I-821D Part 4 "No" boxes) and copied it per
-- client. This column is that layer, portal-native: a jsonb map in the same
-- shape as field_map, holding literal values the firm wants on every
-- generated draft. Populated by the "edit template defaults" round-trip
-- (download fillable template -> attorney fills standing values in any PDF
-- viewer -> upload; see functions/api/form-filler-template-defaults.js).
--
-- At generate time it is merged OVER field_map ({...field_map,
-- ...firm_overrides}), so the firm can override package literals and fill
-- unmapped/blank fields, but data-driven autofill entries are protected at
-- upload time (the API refuses to convert them into literals).
--
-- Kept separate from field_map on purpose: field_map ships from the template
-- repo via 1600-<formid> migrations and is overwritten on form-edition
-- updates; firm_overrides is per-deployment attorney config that survives
-- those updates (keyed by AcroForm field name).

ALTER TABLE public.form_templates
  ADD COLUMN IF NOT EXISTS firm_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
