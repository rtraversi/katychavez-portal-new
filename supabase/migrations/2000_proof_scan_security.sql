-- Migration 2000: Proof Scan tables become staff only
--
-- WHY: migration 1300 gave proof_scans and proof_scan_config a policy of
-- `FOR ALL USING (true)` with no role named. In Postgres a policy with no TO
-- clause applies to PUBLIC, which includes the `anon` role (the public key the
-- browser holds) and every logged-in client. So anyone with the portal's public
-- key, and any client login, could read, change, or delete every saved scan
-- report (client names, A-Numbers) and the firm-wide Proof Scan settings
-- (custom instructions, notification email). This is a LIVE exposure on every
-- portal that ran 1300, not only a v2 concern. Found 2026-10-06
-- (PROOF-SCAN-V2-SPECS.md section B).
--
-- FIX: the same module checks the rest of the portal uses. Module 'proof_scan'
-- grants Owner, Attorney, Partner Attorney and Paralegal (1300). The Client role
-- has no row for it, so can_read/can_write return false for client logins, and
-- for anon (no public.users row at all).
--
-- form_editions is public USCIS reference data (no client data). It keeps read
-- access, but for logged-in users only.
--
-- Idempotent: safe to run twice.

-- ── Drop the open policies from 1300 ─────────────────────────────────────────
DROP POLICY IF EXISTS "staff_read_form_editions"    ON public.form_editions;
DROP POLICY IF EXISTS "staff_all_proof_scan_config" ON public.proof_scan_config;
DROP POLICY IF EXISTS "staff_all_proof_scans"       ON public.proof_scans;

ALTER TABLE public.form_editions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_scan_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_scans       ENABLE ROW LEVEL SECURITY;

-- Belt and braces: anon gets no table privilege at all, so even a future
-- mistaken policy cannot expose these tables to the public key.
REVOKE ALL ON TABLE public.proof_scans       FROM anon;
REVOKE ALL ON TABLE public.proof_scan_config FROM anon;
REVOKE ALL ON TABLE public.form_editions     FROM anon;

-- Make sure no Client role ever carries Proof Scan access.
DELETE FROM public.role_module_access
WHERE module_key = 'proof_scan'
  AND role_id IN (SELECT id FROM public.roles WHERE name = 'Client');

-- ── form_editions: read for logged-in users ──────────────────────────────────
-- Writes stay server-side (service role) as they are today.
DROP POLICY IF EXISTS "form_editions_read_authenticated" ON public.form_editions;
CREATE POLICY "form_editions_read_authenticated" ON public.form_editions
  FOR SELECT TO authenticated USING (true);

-- ── proof_scans: staff only ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "proof_scans_staff_read"   ON public.proof_scans;
DROP POLICY IF EXISTS "proof_scans_staff_insert" ON public.proof_scans;
DROP POLICY IF EXISTS "proof_scans_staff_update" ON public.proof_scans;
DROP POLICY IF EXISTS "proof_scans_staff_delete" ON public.proof_scans;

CREATE POLICY "proof_scans_staff_read" ON public.proof_scans
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scans_staff_insert" ON public.proof_scans
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scans_staff_update" ON public.proof_scans
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scans_staff_delete" ON public.proof_scans
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

-- ── proof_scan_config: staff only ────────────────────────────────────────────
DROP POLICY IF EXISTS "proof_scan_config_staff_read"   ON public.proof_scan_config;
DROP POLICY IF EXISTS "proof_scan_config_staff_insert" ON public.proof_scan_config;
DROP POLICY IF EXISTS "proof_scan_config_staff_update" ON public.proof_scan_config;
DROP POLICY IF EXISTS "proof_scan_config_staff_delete" ON public.proof_scan_config;

CREATE POLICY "proof_scan_config_staff_read" ON public.proof_scan_config
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_config_staff_insert" ON public.proof_scan_config
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_config_staff_update" ON public.proof_scan_config
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_config_staff_delete" ON public.proof_scan_config
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

-- After applying, confirm on the live database (Rob):
--   as anon:          select count(*) from proof_scans;        -- permission denied
--   as a client login: select count(*) from proof_scans;       -- 0 rows
--   as a paralegal:    select count(*) from proof_scans;       -- real count
