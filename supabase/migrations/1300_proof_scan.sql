-- Migration 1300: Proof Scan module tables

CREATE TABLE IF NOT EXISTS form_editions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  form_number   text NOT NULL UNIQUE,
  pages         integer NOT NULL,
  edition_date  text NOT NULL,
  updated_at    timestamptz DEFAULT now()
);

-- Seed current USCIS form editions (as of 2026-06-24)
INSERT INTO form_editions (form_number, pages, edition_date) VALUES
  ('G-1145', 1,  '09/26/14'),
  ('G-1450', 1,  '06/03/25'),
  ('G-1650', 1,  '06/03/25'),
  ('G-28',   4,  '09/17/18'),
  ('I-90',   7,  '01/20/25'),
  ('I-130',  12, '04/01/24'),
  ('I-130A', 6,  '04/01/24'),
  ('I-131',  14, '01/20/25'),
  ('I-485',  24, '01/20/25'),
  ('I-751',  11, '04/01/24'),
  ('I-765',  7,  '08/21/25'),
  ('I-765WS',1,  '08/21/25'),
  ('I-821D', 7,  '01/20/25'),
  ('I-864',  12, '10/17/24'),
  ('N-400',  14, '01/20/25')
ON CONFLICT (form_number) DO UPDATE SET
  pages = EXCLUDED.pages,
  edition_date = EXCLUDED.edition_date,
  updated_at = now();

CREATE TABLE IF NOT EXISTS proof_scan_config (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  custom_instructions text,
  updated_at          timestamptz DEFAULT now(),
  updated_by          uuid REFERENCES users(id)
);

-- Only one config row per firm (singleton)
CREATE UNIQUE INDEX IF NOT EXISTS proof_scan_config_singleton ON proof_scan_config ((true));

CREATE TABLE IF NOT EXISTS proof_scans (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  filename    text NOT NULL,
  result_html text NOT NULL,
  status      text NOT NULL DEFAULT 'pass' CHECK (status IN ('pass', 'needs_correction')),
  tokens_used integer DEFAULT 0,
  scanned_by  uuid REFERENCES users(id),
  created_at  timestamptz DEFAULT now()
);

-- RLS: staff can read/write their own firm's data (inherits from existing RLS policies)
ALTER TABLE form_editions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_scan_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_scans      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_read_form_editions"    ON form_editions    FOR SELECT USING (true);
CREATE POLICY "staff_all_proof_scan_config" ON proof_scan_config FOR ALL    USING (true);
CREATE POLICY "staff_all_proof_scans"       ON proof_scans      FOR ALL    USING (true);
