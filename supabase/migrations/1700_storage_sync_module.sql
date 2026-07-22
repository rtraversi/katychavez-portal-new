-- 1700_storage_sync_module.sql
-- Register Storage Sync as a premium module.
-- Multi-provider two-way file sync: portal files mirror out to the firm's
-- connected cloud storage (push), and files the firm drops into that storage
-- are pulled into the matching client matter on a 5-minute cron (pull).
-- Provider #1 is Dropbox; Google Drive / OneDrive / iDrive plug in behind the
-- same engine. Range 1700-1799 = Storage Sync.

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'storage_sync',
  'Storage Sync',
  'Two-way cloud-storage integration: portal uploads mirror to the firm''s storage provider, and files added there appear on the matching client matter.',
  'refresh-cw',
  'storage-sync',
  1,
  62,
  false,
  'premium'
)
ON CONFLICT (key) DO NOTHING;

-- Owner/Staff Admin administer (recon, unmatched queue, aliases);
-- attorneys and paralegals can view status and resolve their own matters.
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'storage_sync',
       CASE WHEN name IN ('Owner', 'Staff Admin') THEN 'admin' ELSE 'write' END::public.access_level
FROM public.roles
WHERE name IN ('Owner', 'Attorney', 'Partner Attorney', 'Paralegal', 'Staff Admin')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Enable for this firm (sandbox). Client deploys opt in per-firm.
INSERT INTO public.enabled_modules (module_key)
VALUES ('storage_sync')
ON CONFLICT DO NOTHING;
