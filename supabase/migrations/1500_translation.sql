-- 1500_translation.sql
-- Document Translation module — stores translated documents and extracted entities.
-- Supabase manages TOTP/auth; this table is for translation output only.

CREATE TABLE IF NOT EXISTS public.translations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename         TEXT NOT NULL,
  translator_name  TEXT,
  translated_text  TEXT,                        -- blocks-v1 JSON or legacy flat text
  extracted_people JSONB,                       -- [{ full_name, first_name, last_name, role, a_number }]
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | completed | error
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS translations_created_at_idx ON public.translations (created_at DESC);

ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

-- Staff only — no client-facing access to this table
CREATE POLICY "translations_service_only"
  ON public.translations
  FOR ALL
  USING (false);
