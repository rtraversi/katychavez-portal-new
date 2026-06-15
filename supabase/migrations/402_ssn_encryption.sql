-- Migration 402: SSN last-4 columns + sensitive field audit log
--
-- ssn_last4 (4 chars, plaintext) lets the UI show ●●●–●●–XXXX without a
-- server round-trip on every page load.  Full SSN is only accessible via
-- the reveal-ssn Netlify function, which logs every read.
--
-- Apply AFTER migrations 001–004 and 400–401.

-- ── ssn_last4 columns ────────────────────────────────────────────────────────

ALTER TABLE public.clients                      ADD COLUMN IF NOT EXISTS ssn_last4 char(4);
ALTER TABLE public.opposing_parties             ADD COLUMN IF NOT EXISTS ssn_last4 char(4);
ALTER TABLE public.children                     ADD COLUMN IF NOT EXISTS ssn_last4 char(4);
ALTER TABLE public.children_other_relationships ADD COLUMN IF NOT EXISTS ssn_last4 char(4);

COMMENT ON COLUMN public.clients.ssn_last4                      IS 'Last 4 digits of SSN — plaintext, safe for display. Full SSN in ssn_encrypted.';
COMMENT ON COLUMN public.opposing_parties.ssn_last4             IS 'Last 4 digits of SSN — plaintext, safe for display.';
COMMENT ON COLUMN public.children.ssn_last4                     IS 'Last 4 digits of SSN — plaintext, safe for display.';
COMMENT ON COLUMN public.children_other_relationships.ssn_last4 IS 'Last 4 digits of SSN — plaintext, safe for display.';

-- ── Sensitive field audit log ─────────────────────────────────────────────────
-- Logs every write (save) and read (reveal) of encrypted fields.
-- Inserted by server-side functions using the service_role key (bypasses RLS).
-- Readable by any portal user with write-level core access.

CREATE TABLE IF NOT EXISTS public.sensitive_field_audit (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  entity_type  text        NOT NULL,   -- 'clients' | 'opposing_parties' | 'children' | 'children_other_relationships'
  entity_id    uuid        NOT NULL,
  field_name   text        NOT NULL DEFAULT 'ssn',
  action       text        NOT NULL CHECK (action IN ('write', 'read')),
  performed_by uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  ip_address   text
);

CREATE INDEX IF NOT EXISTS idx_ssn_audit_entity ON public.sensitive_field_audit (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ssn_audit_user   ON public.sensitive_field_audit (performed_by);
CREATE INDEX IF NOT EXISTS idx_ssn_audit_time   ON public.sensitive_field_audit (created_at DESC);

ALTER TABLE public.sensitive_field_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_insert" ON public.sensitive_field_audit
  FOR INSERT WITH CHECK (public.can_write('core'));

CREATE POLICY "audit_select" ON public.sensitive_field_audit
  FOR SELECT USING (public.can_write('core'));
