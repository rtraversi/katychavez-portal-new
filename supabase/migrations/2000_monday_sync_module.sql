-- 2000_monday_sync_module.sql
-- Register Monday.com Client Sync as a premium module.
--
-- Pulls new clients from a monday.com board group into the portal. Built for one firm
-- whose client list was bulk-imported from monday.com and who keep working there, so
-- clients appear on the board first and need to reach the portal without re-typing.
--
-- Deliberately narrow, per the decisions taken 2026-07-20:
--   * new clients only — never updates an existing portal client, because monday's data
--     is sparse and would overwrite staff-cleaned records
--   * a client leaving the board group flags for review and changes nothing; matters,
--     documents and forms stay live
--   * manual, preview-then-confirm. No unattended job creates client records.
--
-- Range 2000-2099 = Monday Sync.

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'monday_sync',
  'Monday Sync',
  'Pull new clients from a monday.com board into the portal, with a preview and confirm step before anything is created.',
  'refresh-cw',
  'monday-sync',
  1,
  63,
  false,
  'premium'
)
ON CONFLICT (key) DO NOTHING;

-- Creating client records is an administrative act — Owner and Staff Admin only.
-- Attorneys and paralegals can see sync status and the review queue but not run an
-- import, so a mis-click cannot manufacture 110 clients.
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'monday_sync',
       CASE WHEN name IN ('Owner', 'Staff Admin') THEN 'admin' ELSE 'read' END::public.access_level
FROM public.roles
WHERE name IN ('Owner', 'Attorney', 'Partner Attorney', 'Paralegal', 'Staff Admin')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- NOTE: deliberately NO `INSERT INTO public.enabled_modules` here.
--
-- The storage_sync migration ends with an unconditional enable commented "for this firm
-- (sandbox)", which means every deploy running it silently turns a premium module on.
-- This module is genuinely one-firm and creates client records, so it stays off until a
-- firm opts in explicitly:
--
--   INSERT INTO public.enabled_modules (module_key) VALUES ('monday_sync');
