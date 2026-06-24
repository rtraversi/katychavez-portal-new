-- Recovery codes for TOTP MFA.
-- Supabase manages TOTP secrets in auth.mfa_factors; this table stores
-- single-use recovery codes (hashed with SHA-256) as a fallback.

CREATE TABLE public.user_mfa_recovery_codes (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash  text        NOT NULL,
  used_at    timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX user_mfa_recovery_codes_user_id_idx ON public.user_mfa_recovery_codes(user_id);

ALTER TABLE public.user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

-- No client-side access — only the service role (worker) reads/writes this table.
-- Users see their plain codes once at enrollment (never stored plain).
