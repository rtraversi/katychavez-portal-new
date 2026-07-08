-- Migration 1600-g28-r2key: record G-28's normalized template R2 key
--
-- Gap found while porting to katychavez-portal-new: the other five DACA-package
-- forms get their r2_key from their 1600-<formid>.sql migrations, but G-28's
-- was only ever set by hand in the sandbox DB (its field map arrived earlier
-- via 1514 before the r2_key convention settled). Without this, a fresh client
-- deployment shows G-28 as "Template not yet uploaded" forever.
--
-- Idempotent; harmless on databases where the key is already set.

UPDATE public.form_templates
SET r2_key = 'form-templates/g-28.pdf'
WHERE form_key = 'g-28' AND r2_key IS NULL;
