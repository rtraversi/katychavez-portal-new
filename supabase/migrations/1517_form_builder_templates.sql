-- Migration 1517: Form Builder template library schema
--
-- Ported from wilsonlakesavage's 1108_form_builder_templates.sql. Schema only
-- — the populated reference-form content that would use 'form_builder' rows
-- (WLS's 1202/1205/1206) is WLS-specific (TX Family Law Practice Manual
-- boilerplate), not template material, so it's not carried over. This
-- migration buys the capability for a firm to build its own form-builder
-- library; it does not seed one.
--
-- Adds template_set, form_number, group_number to draft_templates.
-- template_set = 'custom' (wizard templates) | 'form_builder' (reference forms).

ALTER TABLE public.draft_templates
  ADD COLUMN IF NOT EXISTS template_set  TEXT NOT NULL DEFAULT 'custom'
    CHECK (template_set IN ('custom', 'form_builder')),
  ADD COLUMN IF NOT EXISTS form_number   TEXT,    -- e.g. '3.13'
  ADD COLUMN IF NOT EXISTS group_number  SMALLINT; -- parsed from form_number prefix

-- Backfill: all existing rows are custom templates
UPDATE public.draft_templates SET template_set = 'custom' WHERE template_set IS NULL;
