-- Migration 005: Client portal foundation
-- Adds: auth_id on clients, Client role, Partner Attorney role,
--       client_portal module, RLS SELECT policies for client self-service.
-- Apply AFTER migrations 001–004.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. LINK CLIENTS TO AUTH USERS
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS auth_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_auth_id ON public.clients (auth_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. NEW ROLES
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO public.roles (name, description, is_system_role) VALUES
  ('Client',
   'Portal access for firm clients — view own matter, upload documents. Cannot see other clients.',
   true),
  ('Partner Attorney',
   'Full attorney access. Cannot manage users or firm settings.',
   false)
ON CONFLICT (name) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. CLIENT PORTAL MODULE
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES ('client_portal', 'My Matter', 'Client-facing view of their own matter and documents.',
        'user', 'client-portal', 0, 5, true)
ON CONFLICT (key) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. ROLE → MODULE ACCESS
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r_client  uuid;
  r_partner uuid;
BEGIN
  SELECT id INTO r_client  FROM public.roles WHERE name = 'Client';
  SELECT id INTO r_partner FROM public.roles WHERE name = 'Partner Attorney';

  -- Client: only the client_portal module (uploads happen through functions, not module access)
  INSERT INTO public.role_module_access (role_id, module_key, access_level)
  VALUES (r_client, 'client_portal', 'write')
  ON CONFLICT (role_id, module_key) DO NOTHING;

  -- Partner Attorney: same access as Attorney
  INSERT INTO public.role_module_access (role_id, module_key, access_level) VALUES
    (r_partner, 'core',         'write'),
    (r_partner, 'tasks',        'write'),
    (r_partner, 'uploads',      'write'),
    (r_partner, 'messaging',    'write'),
    (r_partner, 'billing',      'read'),
    (r_partner, 'ai_brain',     'read'),
    (r_partner, 'draft_forms',  'write'),
    (r_partner, 'esign',        'write'),
    (r_partner, 'dashboard',    'read'),
    (r_partner, 'word_embed',   'write')
  ON CONFLICT (role_id, module_key) DO NOTHING;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. RLS HELPER: identify the current user's client record
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.my_client_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.clients WHERE auth_id = auth.uid() AND active = true LIMIT 1;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. ADDITIVE RLS SELECT POLICIES FOR CLIENTS
-- Postgres ORs multiple permissive policies — these add to existing staff policies,
-- not replace them. Staff see all rows via existing policies; clients only see their own.
-- ──────────────────────────────────────────────────────────────────────────────

-- Clients can read their own client record
CREATE POLICY "clients_select_own"
  ON public.clients FOR SELECT
  USING (auth_id = auth.uid());

-- Clients can read their own matters (DV records excluded)
CREATE POLICY "matters_select_client"
  ON public.matters FOR SELECT
  USING (
    client_id = public.my_client_id()
    AND NOT is_dv_confidential
  );

-- Clients can read key dates for their matters
CREATE POLICY "keydates_select_client"
  ON public.key_dates FOR SELECT
  USING (
    matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

-- Add deleted_at here so the policy below can reference it.
-- Migration 400 adds it idempotently; doing it here ensures ordering safety.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Clients can read documents for their matters (non-deleted only)
CREATE POLICY "docs_select_client"
  ON public.documents FOR SELECT
  USING (
    deleted_at IS NULL
    AND matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

-- Clients can read the modules table (needed for menu rendering)
-- Note: "modules_read" already covers auth.uid() IS NOT NULL, so this is redundant
-- but explicit for clarity — no change needed.

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. ENABLE RLS ON client_portal tables (modules already has RLS from migration 003)
-- Nothing new to enable — client_portal is a UI route, not a new table.
-- ──────────────────────────────────────────────────────────────────────────────
