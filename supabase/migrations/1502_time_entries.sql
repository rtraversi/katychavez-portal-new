-- Migration 1502: Time entries
-- Foundation for the Billing & Invoicing module:
--   - hourly_rate default on users
--   - time_entries table (matter-scoped, soft-deletable)
--   - billing module permissions (attorneys → write, paralegal → read)
-- Applied: dev ☐  prod ☐

-- ── Users: default billing rate ──────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2) DEFAULT NULL;

-- ── Billing module: attorney write, partner attorney write, paralegal read ───
UPDATE public.role_module_access rma
SET access_level = 'write'
FROM public.roles r
WHERE rma.role_id = r.id
  AND r.name = 'Attorney'
  AND rma.module_key = 'billing';

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'billing', 'write'
FROM public.roles r
WHERE r.name = 'Partner Attorney'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_module_access x
    WHERE x.role_id = r.id AND x.module_key = 'billing'
  );

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'billing', 'read'
FROM public.roles r
WHERE r.name = 'Paralegal'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_module_access x
    WHERE x.role_id = r.id AND x.module_key = 'billing'
  );

-- ── Time entries table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.time_entries (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID         NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  user_id     UUID         NOT NULL REFERENCES public.users(id)   ON DELETE RESTRICT,
  entry_date  DATE         NOT NULL DEFAULT CURRENT_DATE,
  hours       DECIMAL(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  description TEXT         NOT NULL,
  rate        DECIMAL(10,2),
  status      VARCHAR(20)  NOT NULL DEFAULT 'unbilled'
                           CHECK (status IN ('unbilled','billed','written_off')),
  created_by  UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_time_entries_matter
  ON public.time_entries (matter_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_time_entries_user
  ON public.time_entries (user_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_time_entries_date
  ON public.time_entries (entry_date);

CREATE TRIGGER set_time_entries_updated_at
  BEFORE UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_entries_read" ON public.time_entries
  FOR SELECT USING (deleted_at IS NULL AND public.can_read('billing'));

CREATE POLICY "time_entries_write" ON public.time_entries
  FOR ALL USING (public.can_write('billing'));
