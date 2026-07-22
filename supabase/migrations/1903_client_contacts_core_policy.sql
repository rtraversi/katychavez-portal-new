-- Migration 1903: Fix client_contacts RLS — module key 'clients' doesn't exist.
--
-- 1902 gated client_contacts on can_read/can_write('clients'), but there is no
-- 'clients' row in role_module_access — the client/matter register is governed
-- by the 'core' module key (same as the clients and matters tables). The result
-- was can_write('clients') = false for every role, so every "Add person" insert
-- failed with "new row violates row-level security policy".
--
-- Idempotent — safe to re-run.
-- Applied: dev ☐  prod ☐

DROP POLICY IF EXISTS "client_contacts_read"  ON public.client_contacts;
DROP POLICY IF EXISTS "client_contacts_write" ON public.client_contacts;

CREATE POLICY "client_contacts_read"
  ON public.client_contacts FOR SELECT USING (public.can_read('core'));

CREATE POLICY "client_contacts_write"
  ON public.client_contacts FOR ALL USING (public.can_write('core'));
