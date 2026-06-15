-- Migration 500: E-sign module — initial schema
-- Module: esign | Branch: module/esign
-- Number range for this module: 500–599
-- Apply AFTER migrations 001–005 (core schema, RBAC, RLS, uploads, client portal).

-- ── TABLES ─────────────────────────────────────────────────────────────────────

-- Signature requests: one row per document sent for signing.
-- Supports 1-signer (client only) and 2-signer (client → attorney counter-sign).
CREATE TABLE public.signature_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  matter_id             uuid NOT NULL REFERENCES public.matters(id)   ON DELETE CASCADE,
  requested_by          uuid NOT NULL REFERENCES public.users(id),
  status                text NOT NULL DEFAULT 'pending_client'
                          CHECK (status IN ('pending_client','pending_attorney','completed','declined','expired')),
  requires_countersign  boolean NOT NULL DEFAULT true,
  token                 text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  message               text,
  expires_at            timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Individual signature events: one row per signer.
CREATE TABLE public.signatures (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id     uuid NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  signer_user_id           uuid REFERENCES public.users(id),
  signer_client_id         uuid REFERENCES public.clients(id),
  signer_role              text NOT NULL CHECK (signer_role IN ('client','attorney')),
  signed_at                timestamptz NOT NULL DEFAULT now(),
  ip_address               text,
  user_agent               text,
  document_hash_before     text NOT NULL,
  document_hash_after      text,
  signature_image          text NOT NULL,
  audit_log                jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX ON public.signature_requests (document_id);
CREATE INDEX ON public.signature_requests (matter_id);
CREATE INDEX ON public.signature_requests (status);
CREATE INDEX ON public.signatures (signature_request_id);

CREATE OR REPLACE FUNCTION public.set_esign_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER signature_requests_updated_at
  BEFORE UPDATE ON public.signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_esign_updated_at();

-- ── MODULE REGISTRATION ─────────────────────────────────────────────────────────

INSERT INTO public.modules (key, name, description)
VALUES ('esign', 'E-Sign', 'Request and capture legally-binding e-signatures with SHA-256 audit trail')
ON CONFLICT (key) DO NOTHING;

-- ── RLS ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "esign_requests_staff_select"
  ON public.signature_requests FOR SELECT
  USING (public.can_read('esign'));

CREATE POLICY "esign_requests_staff_write"
  ON public.signature_requests FOR ALL
  USING (public.can_write('esign'));

-- Clients see their own requests via matter linkage
CREATE POLICY "esign_requests_client_select"
  ON public.signature_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
        JOIN public.matters m ON m.client_id = c.id
      WHERE c.auth_id = auth.uid()
        AND m.id = signature_requests.matter_id
    )
  );

CREATE POLICY "esign_signatures_staff_select"
  ON public.signatures FOR SELECT
  USING (public.can_read('esign'));

CREATE POLICY "esign_signatures_staff_write"
  ON public.signatures FOR ALL
  USING (public.can_write('esign'));

CREATE POLICY "esign_signatures_client_select"
  ON public.signatures FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.signature_requests sr
        JOIN public.matters m ON m.id = sr.matter_id
        JOIN public.clients c ON c.id = m.client_id
      WHERE sr.id = signatures.signature_request_id
        AND c.auth_id = auth.uid()
    )
  );
