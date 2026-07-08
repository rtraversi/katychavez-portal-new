-- Migration 1509: Case workflow stages
-- Allows firms to define a case pipeline per practice area.
-- Attorneys manually advance matters through stages; history is logged.

-- Stage definitions (firm-wide, per practice area)
CREATE TABLE IF NOT EXISTS public.workflow_stages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_area  TEXT NOT NULL,               -- PA key: 'family_law', 'immigration', etc.
  name           TEXT NOT NULL,
  order_index    INT  NOT NULL DEFAULT 0,
  color          TEXT NOT NULL DEFAULT 'gray', -- gray | blue | yellow | orange | green | red
  is_terminal    BOOLEAN NOT NULL DEFAULT false,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_stages_pa ON public.workflow_stages(practice_area, order_index);

-- Track current stage on matters
ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS current_stage_id UUID
    REFERENCES public.workflow_stages(id) ON DELETE SET NULL;

-- Full history of every stage change
CREATE TABLE IF NOT EXISTS public.matter_stage_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  stage_id    UUID REFERENCES public.workflow_stages(id) ON DELETE SET NULL,
  stage_name  TEXT,   -- snapshot in case stage is renamed/deleted
  changed_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matter_stage_history_matter ON public.matter_stage_history(matter_id, changed_at DESC);

-- RLS
ALTER TABLE public.workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users read workflow stages" ON public.workflow_stages;
CREATE POLICY "Authenticated users read workflow stages"
  ON public.workflow_stages FOR SELECT TO authenticated USING (true);

-- NOTE: this schema's RBAC helpers are can_read/can_write/can_admin(module) —
-- user_has_module_access() (used when this file was first written) never
-- existed here, which is what stalled the first apply attempt.
DROP POLICY IF EXISTS "Admins manage workflow stages" ON public.workflow_stages;
CREATE POLICY "Admins manage workflow stages"
  ON public.workflow_stages FOR ALL TO authenticated
  USING (public.can_admin('stages'))
  WITH CHECK (public.can_admin('stages'));

DROP POLICY IF EXISTS "Authenticated users read stage history" ON public.matter_stage_history;
CREATE POLICY "Authenticated users read stage history"
  ON public.matter_stage_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Write users log stage changes" ON public.matter_stage_history;
CREATE POLICY "Write users log stage changes"
  ON public.matter_stage_history FOR INSERT TO authenticated
  WITH CHECK (public.can_write('stages'));

-- Register in permissions matrix (CORE, always on)
INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'stages', 'Case Workflows',
  'Define pipeline stages per practice area and track matter progress.',
  'git-branch', 'settings/workflows', 0, 55, true
)
ON CONFLICT (key) DO NOTHING;

-- Grant Owner + Partner Attorney admin by default; Attorney write; Staff write
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'stages',
  CASE r.name
    WHEN 'Owner'             THEN 'admin'
    WHEN 'Partner Attorney'  THEN 'admin'
    WHEN 'Attorney'          THEN 'write'
    WHEN 'Paralegal'         THEN 'write'
    WHEN 'Staff'             THEN 'write'
    ELSE 'read'
  END::public.access_level
FROM public.roles r
ON CONFLICT (role_id, module_key) DO NOTHING;
