-- Migration 950: Dashboard module — activate + extend access to later-added roles
-- The dashboard module row was seeded in migration 002 as 'Analytics' (disabled).
-- This migration renames it, moves it first in nav, enables it by default, and
-- grants access to Partner Attorney + Legal Assistant (added after the 002 seed).
-- Apply AFTER migrations 001–901.

-- Activate the module and rename it
UPDATE public.modules
SET
  name               = 'Dashboard',
  description        = 'Morning triage view — overdue tasks, missing docs, unread messages, pending signatures.',
  sort_order         = 1,
  enabled_by_default = true
WHERE key = 'dashboard';

-- Extend access to roles added after the migration 002 seed
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'dashboard',
  CASE r.name
    WHEN 'Partner Attorney' THEN 'read'::public.access_level
    WHEN 'Legal Assistant'  THEN 'read'::public.access_level
    ELSE                         'none'::public.access_level
  END
FROM public.roles r
WHERE r.name IN ('Partner Attorney', 'Legal Assistant')
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = EXCLUDED.access_level;
