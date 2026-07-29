-- Migration 1621: Case Builder RLS
--
-- Authoring the firm's reusable case templates (case types and their form packages)
-- is a more privileged act than editing one matter's form list, so it is gated at
-- ADMIN on draft_forms. Per-matter editing (matter_forms, migration 1605) stays at
-- can_write; reading stays at can_read (or public, for case_types).
--
-- Note: the case-builder API routes use verifyAuth('admin','draft_forms') + a
-- service-role client, so these policies are defense-in-depth for any direct-JWT
-- access, and keep the access model coherent at the table level.
--
-- Drop-before-create so this is safe to re-run (CREATE POLICY has no IF NOT EXISTS).

-- ── case_types: public read stays; add admin write ───────────────────────────
DROP POLICY IF EXISTS "case_types_write" ON public.case_types;
CREATE POLICY "case_types_write" ON public.case_types
  FOR ALL USING (can_admin('draft_forms')) WITH CHECK (can_admin('draft_forms'));

-- ── form_packages: tighten write from can_write to can_admin ──────────────────
DROP POLICY IF EXISTS "form_packages_write" ON public.form_packages;
CREATE POLICY "form_packages_write" ON public.form_packages
  FOR ALL USING (can_admin('draft_forms')) WITH CHECK (can_admin('draft_forms'));

-- ── form_package_items: tighten write from can_write to can_admin ─────────────
DROP POLICY IF EXISTS "form_package_items_write" ON public.form_package_items;
CREATE POLICY "form_package_items_write" ON public.form_package_items
  FOR ALL USING (can_admin('draft_forms')) WITH CHECK (can_admin('draft_forms'));
