-- Migration 2001: Proof Scan v2 core tables
--
-- Proof Scan v2 keeps a case open across four stages: Evidence Zero, Draft
-- Review, Pre-flight, Physical Scan (D-52). This migration adds the folder that
-- holds a case (D-83), one case card per person (D-94), the Evidence Zero
-- document cards (D-84: facts only, no file is ever stored), proposed changes to
-- a person's record (D-55, D-72), stage sign-offs (D-75), Possible issues
-- (D-59, D-86) and firm-wide suppressed reasoning (D-59).
--
-- SECURITY: every table here is staff only, the same pattern as migration 2000:
-- policies TO authenticated using public.can_read('proof_scan') /
-- public.can_write('proof_scan'), and no privilege for anon. Neither the public
-- key nor a client login can read any row.
--
-- SSN (D-80): never stored in plaintext. proof_scan_people.ssn_encrypted holds
-- the portal's existing AES-256-GCM format (functions/api/_helpers.js ssnEncrypt:
-- hex(iv):hex(tag):hex(ciphertext)), written and decrypted only by server code
-- that logs every write and reveal to public.sensitive_field_audit with
-- entity_type 'proof_scan_people', exactly as save-ssn.js / reveal-ssn.js do for
-- clients. The key never reaches the browser.
--
-- Depends on: 003 (can_read/can_write), 1300 to 1303 (proof_scans), 2000.

-- Shared updated_at stamp.
CREATE OR REPLACE FUNCTION public.proof_scan_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── Cases: the folder (D-83) ─────────────────────────────────────────────────
-- Holds the locked case type (D-77), the people and their reference records,
-- the Evidence Zero cards, each stage's sign-off, and every report (through
-- proof_scans.case_id). Deliberately NOT linked to matters or clients (D-83).
CREATE TABLE IF NOT EXISTS public.proof_scan_cases (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type   text        NOT NULL CHECK (case_type IN ('daca_renewal', 'general')),
  label       text        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  created_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL DEFAULT public.my_user_id(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.proof_scan_cases.label IS
  'Client name, so staff can find the folder. Not a link to clients (D-83).';

CREATE INDEX IF NOT EXISTS proof_scan_cases_label_idx   ON public.proof_scan_cases (lower(label));
CREATE INDEX IF NOT EXISTS proof_scan_cases_created_idx ON public.proof_scan_cases (created_at DESC);

-- D-77: the case type is locked once the case starts.
CREATE OR REPLACE FUNCTION public.proof_scan_cases_lock_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_type IS DISTINCT FROM OLD.case_type THEN
    RAISE EXCEPTION 'The case type of a Proof Scan case cannot be changed once it starts'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_scan_cases_lock_type ON public.proof_scan_cases;
CREATE TRIGGER proof_scan_cases_lock_type
  BEFORE UPDATE ON public.proof_scan_cases
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_cases_lock_type();

DROP TRIGGER IF EXISTS proof_scan_cases_touch ON public.proof_scan_cases;
CREATE TRIGGER proof_scan_cases_touch
  BEFORE UPDATE ON public.proof_scan_cases
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_touch_updated_at();

-- ── People: one case card per person (D-94) ──────────────────────────────────
-- Each person carries their own reference record (D-12, D-64, D-81, D-82).
-- Fields mirror the v2 Lab's REFERENCE_FIELDS. Optional address parts
-- (in_care_of, province, postal_code, country) stay NULL until a source has
-- them (D-82).
CREATE TABLE IF NOT EXISTS public.proof_scan_people (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 uuid        NOT NULL REFERENCES public.proof_scan_cases(id) ON DELETE CASCADE,
  role                    text        NOT NULL CHECK (role IN ('applicant', 'beneficiary', 'petitioner',
                                                               'sponsor', 'joint_sponsor', 'household_member')),
  is_main                 boolean     NOT NULL DEFAULT false,

  -- Name
  first_name              text,
  middle_name             text,
  last_name               text,

  -- Address, per G-28 Part 3 item 12 (D-64)
  street                  text,
  apt_type                text        CHECK (apt_type IS NULL OR apt_type IN ('Apt.', 'Ste.', 'Flr.')),
  apt_number              text,
  city                    text,
  state                   text,
  zip                     text,
  in_care_of              text,
  province                text,
  postal_code             text,
  country                 text,

  -- Identity
  date_of_birth           date,
  a_number                text        CHECK (a_number IS NULL OR a_number ~ '^[0-9]{7,9}$'),
  ead_expiration          date,

  -- Contact
  phone                   text,
  email                   text,

  -- D-100: the other facts the portal's form maps fill per person. All optional;
  -- a card holds only what a document, form or scan actually carried.
  uscis_account_number    text,
  country_of_birth        text,
  country_of_citizenship  text,
  i94_number              text,
  i94_expiration          date,
  last_entry_date         date,
  port_of_entry           text,
  employer                text,
  marriage_date           date,
  marriage_place          text,

  -- SSN (D-13: may be pending; D-80: full SSN, encrypted, audited)
  ssn_encrypted           text        CHECK (ssn_encrypted IS NULL
                                             OR ssn_encrypted ~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$'),
  ssn_last4               char(4)     CHECK (ssn_last4 IS NULL OR ssn_last4 ~ '^[0-9]{4}$'),

  -- Where each value came from, keyed by field name, e.g.
  -- {"a_number": {"kind": "document", "document_id": "...", "label": "EAD"},
  --  "street":   {"kind": "staff"}}
  field_sources           jsonb       NOT NULL DEFAULT '{}'::jsonb
                                      CHECK (jsonb_typeof(field_sources) = 'object'),

  -- Approval (D-10): the record as a whole; every field stays editable.
  approved_at             timestamptz,
  approved_by             uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  changed_since_approval  boolean     NOT NULL DEFAULT false,

  -- D-74 follow-up, D-91: the deliberate "there is no evidence for this case" step.
  no_evidence             boolean     NOT NULL DEFAULT false,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT proof_scan_people_ssn_pair
    CHECK ((ssn_encrypted IS NULL) = (ssn_last4 IS NULL))
);

COMMENT ON COLUMN public.proof_scan_people.ssn_encrypted IS
  'AES-256-GCM encrypted full SSN (D-80). Same format and key as clients.ssn_encrypted. '
  'Written and revealed only by server code that logs to sensitive_field_audit.';
COMMENT ON COLUMN public.proof_scan_people.a_number IS
  'Digits only. The "A-" prefix is display format, not data (D-64, N-016).';

CREATE INDEX IF NOT EXISTS proof_scan_people_case_idx     ON public.proof_scan_people (case_id);
CREATE INDEX IF NOT EXISTS proof_scan_people_a_number_idx ON public.proof_scan_people (a_number) WHERE a_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS proof_scan_people_name_idx     ON public.proof_scan_people (lower(last_name), lower(first_name));

-- At most one main person per case.
CREATE UNIQUE INDEX IF NOT EXISTS proof_scan_people_one_main
  ON public.proof_scan_people (case_id) WHERE is_main;

-- D-94: "DACA stays one person."
CREATE OR REPLACE FUNCTION public.proof_scan_people_daca_single()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT case_type FROM public.proof_scan_cases WHERE id = NEW.case_id) = 'daca_renewal'
     AND EXISTS (SELECT 1 FROM public.proof_scan_people
                 WHERE case_id = NEW.case_id AND id <> NEW.id) THEN
    RAISE EXCEPTION 'A DACA renewal case has one person'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_scan_people_daca_single ON public.proof_scan_people;
CREATE TRIGGER proof_scan_people_daca_single
  BEFORE INSERT OR UPDATE OF case_id ON public.proof_scan_people
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_people_daca_single();

DROP TRIGGER IF EXISTS proof_scan_people_touch ON public.proof_scan_people;
CREATE TRIGGER proof_scan_people_touch
  BEFORE UPDATE ON public.proof_scan_people
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_touch_updated_at();

-- ── Documents: Evidence Zero cards (D-53, D-84) ─────────────────────────────
-- A short card per document with the facts it carries. NO file is kept (D-84).
-- facts never holds a full SSN: the full number lives only in
-- proof_scan_people.ssn_encrypted. At most a last four is allowed here.
CREATE TABLE IF NOT EXISTS public.proof_scan_documents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            uuid        NOT NULL REFERENCES public.proof_scan_cases(id) ON DELETE CASCADE,
  doc_type           text        NOT NULL CHECK (length(btrim(doc_type)) BETWEEN 1 AND 80),
  type_corrected     boolean     NOT NULL DEFAULT false,      -- staff changed the identified type (Q-45)
  read_quality       text        NOT NULL CHECK (read_quality IN ('clear', 'partial', 'unreadable')),
  unreadable_fields  text[]      NOT NULL DEFAULT '{}',
  filename           text        CHECK (filename IS NULL OR length(filename) <= 255),
  facts              jsonb       NOT NULL DEFAULT '{}'::jsonb
                                 CHECK (jsonb_typeof(facts) = 'object'),
  status             text        NOT NULL DEFAULT 'current'
                                 CHECK (status IN ('current', 'replaced', 'source_review')),
  replaced_by        uuid        REFERENCES public.proof_scan_documents(id) ON DELETE SET NULL,
  created_by         uuid        REFERENCES public.users(id) ON DELETE SET NULL DEFAULT public.my_user_id(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- One-way on purpose: deleting the newer card sets replaced_by to NULL and the
  -- older card must still be allowed to say 'replaced'.
  CONSTRAINT proof_scan_documents_replaced_shape
    CHECK (replaced_by IS NULL OR status = 'replaced'),
  CONSTRAINT proof_scan_documents_not_self_replaced
    CHECK (replaced_by IS NULL OR replaced_by <> id),
  -- D-80 / D-84: a full SSN never lands in the facts. Nine digits in a row, or
  -- the 3-2-4 SSN shape, anywhere in an "ssn" value is refused; a last four is fine.
  CONSTRAINT proof_scan_documents_no_full_ssn
    CHECK (NOT (facts ? 'ssn')
           OR (jsonb_typeof(facts -> 'ssn') = 'string'
               AND regexp_replace(facts ->> 'ssn', '[^0-9]', '', 'g') ~ '^[0-9]{0,4}$'))
);

COMMENT ON TABLE public.proof_scan_documents IS
  'Evidence Zero cards. Facts read from a document, never the file itself (D-84).';

CREATE INDEX IF NOT EXISTS proof_scan_documents_case_idx ON public.proof_scan_documents (case_id, created_at DESC);

-- ── Which person(s) a document belongs to (D-94) ─────────────────────────────
-- A marriage certificate belongs to both spouses. The AI proposes, staff can
-- correct (proposed_by).
CREATE TABLE IF NOT EXISTS public.proof_scan_document_people (
  document_id  uuid        NOT NULL REFERENCES public.proof_scan_documents(id) ON DELETE CASCADE,
  person_id    uuid        NOT NULL REFERENCES public.proof_scan_people(id)    ON DELETE CASCADE,
  proposed_by  text        NOT NULL DEFAULT 'ai' CHECK (proposed_by IN ('ai', 'staff')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, person_id)
);

CREATE INDEX IF NOT EXISTS proof_scan_document_people_person_idx ON public.proof_scan_document_people (person_id);

-- A document and its person must sit in the same case.
CREATE OR REPLACE FUNCTION public.proof_scan_document_people_same_case()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT case_id FROM public.proof_scan_documents WHERE id = NEW.document_id)
     IS DISTINCT FROM
     (SELECT case_id FROM public.proof_scan_people WHERE id = NEW.person_id) THEN
    RAISE EXCEPTION 'A document can only belong to a person in the same case'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_scan_document_people_same_case ON public.proof_scan_document_people;
CREATE TRIGGER proof_scan_document_people_same_case
  BEFORE INSERT OR UPDATE ON public.proof_scan_document_people
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_document_people_same_case();

-- ── Suggestions: proposed changes, never auto-applied (D-55, D-72) ──────────
-- 'used' = staff copied the value into the record; 'kept' = staff kept the
-- existing value.
--
-- SSN (D-97): a different SSN from a newer document is a suggestion too, stored
-- exactly like proof_scan_people.ssn_encrypted (same AES-256-GCM format, same
-- key, same audited server path) in value_encrypted + value_last4. It never
-- uses the plaintext `value` column, and no other field may use the encrypted
-- pair.
CREATE TABLE IF NOT EXISTS public.proof_scan_suggestions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid        NOT NULL REFERENCES public.proof_scan_people(id) ON DELETE CASCADE,
  field         text        NOT NULL CHECK (field IN (
                              'first_name', 'middle_name', 'last_name',
                              'street', 'apt_type', 'apt_number', 'city', 'state', 'zip',
                              'in_care_of', 'province', 'postal_code', 'country',
                              'date_of_birth', 'a_number', 'ead_expiration',
                              'phone', 'email', 'ssn',
                              'uscis_account_number', 'country_of_birth', 'country_of_citizenship',
                              'i94_number', 'i94_expiration', 'last_entry_date', 'port_of_entry',
                              'employer', 'marriage_date', 'marriage_place')),
  value            text,
  value_encrypted  text        CHECK (value_encrypted IS NULL
                                      OR value_encrypted ~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$'),
  value_last4      char(4)     CHECK (value_last4 IS NULL OR value_last4 ~ '^[0-9]{4}$'),
  source_label  text        NOT NULL CHECK (length(btrim(source_label)) BETWEEN 1 AND 200),
  document_id   uuid        REFERENCES public.proof_scan_documents(id) ON DELETE SET NULL,
  run_id        uuid        REFERENCES public.proof_scans(id) ON DELETE SET NULL,
  status        text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'used', 'kept')),
  decided_by    uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT proof_scan_suggestions_decided_shape
    CHECK ((status = 'open') = (decided_at IS NULL)),
  -- The encrypted pair is set together or not at all.
  CONSTRAINT proof_scan_suggestions_ssn_pair
    CHECK ((value_encrypted IS NULL) = (value_last4 IS NULL)),
  -- An SSN suggestion carries only the encrypted pair; every other field
  -- carries only the plaintext value.
  CONSTRAINT proof_scan_suggestions_value_shape
    CHECK (CASE WHEN field = 'ssn'
                THEN value IS NULL AND value_encrypted IS NOT NULL
                ELSE value IS NOT NULL AND value_encrypted IS NULL END),
  -- Belt and braces: a value shaped like an SSN (123-45-6789) is refused in the
  -- plaintext column whatever field it claims to be.
  CONSTRAINT proof_scan_suggestions_no_plain_ssn
    CHECK (value IS NULL OR value !~ '^\s*[0-9]{3}-[0-9]{2}-[0-9]{4}\s*$')
);

CREATE INDEX IF NOT EXISTS proof_scan_suggestions_person_open_idx
  ON public.proof_scan_suggestions (person_id) WHERE status = 'open';

-- ── proof_scans: reports save into the folder (D-83) ─────────────────────────
-- Additive. Everything 1302 / 1303 added is kept. case_id is nullable so every
-- v1.2 and legacy report keeps working unchanged.
ALTER TABLE public.proof_scans ADD COLUMN IF NOT EXISTS case_id
  uuid REFERENCES public.proof_scan_cases(id) ON DELETE RESTRICT;
ALTER TABLE public.proof_scans ADD COLUMN IF NOT EXISTS stage            text;
ALTER TABLE public.proof_scans ADD COLUMN IF NOT EXISTS scope            text;
ALTER TABLE public.proof_scans ADD COLUMN IF NOT EXISTS rule_set_version integer;

ALTER TABLE public.proof_scans DROP CONSTRAINT IF EXISTS proof_scans_stage_check;
ALTER TABLE public.proof_scans ADD CONSTRAINT proof_scans_stage_check
  CHECK (stage IS NULL OR stage IN ('evidence_zero', 'draft_review', 'preflight', 'physical_scan'));

-- D-56: individual / whole applies to Draft Review and Pre-flight only.
ALTER TABLE public.proof_scans DROP CONSTRAINT IF EXISTS proof_scans_scope_check;
ALTER TABLE public.proof_scans ADD CONSTRAINT proof_scans_scope_check
  CHECK (scope IS NULL
         OR (scope IN ('individual', 'whole') AND stage IN ('draft_review', 'preflight')));

-- A v2 report (one inside a folder) always records its stage and the rule-set
-- version it ran against (D-60), so history stays tied to the rules of the day.
ALTER TABLE public.proof_scans DROP CONSTRAINT IF EXISTS proof_scans_v2_shape;
ALTER TABLE public.proof_scans ADD CONSTRAINT proof_scans_v2_shape
  CHECK (case_id IS NULL
         OR (stage IS NOT NULL AND rule_set_version IS NOT NULL AND rule_set_version >= 1));

CREATE INDEX IF NOT EXISTS proof_scans_case_stage_idx
  ON public.proof_scans (case_id, stage, created_at DESC) WHERE case_id IS NOT NULL;

-- ── Sign-offs (D-75) ─────────────────────────────────────────────────────────
-- "Mark this stage reviewed". One per case and stage. A new run of that stage
-- clears it (trigger below). The report itself is never changed by a sign-off.
CREATE TABLE IF NOT EXISTS public.proof_scan_signoffs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid        NOT NULL REFERENCES public.proof_scan_cases(id) ON DELETE CASCADE,
  stage      text        NOT NULL CHECK (stage IN ('draft_review', 'preflight', 'physical_scan')),
  run_id     uuid        NOT NULL REFERENCES public.proof_scans(id) ON DELETE CASCADE,
  signed_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL DEFAULT public.my_user_id(),
  signed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, stage)
);

-- The signed run must belong to the same case and stage.
CREATE OR REPLACE FUNCTION public.proof_scan_signoffs_match_run()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.proof_scans
                 WHERE id = NEW.run_id AND case_id = NEW.case_id AND stage = NEW.stage) THEN
    RAISE EXCEPTION 'A sign-off must point at a run of the same case and stage'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_scan_signoffs_match_run ON public.proof_scan_signoffs;
CREATE TRIGGER proof_scan_signoffs_match_run
  BEFORE INSERT OR UPDATE ON public.proof_scan_signoffs
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_signoffs_match_run();

-- A new run of a stage clears that stage's sign-off (D-75). SECURITY DEFINER so
-- the clear always happens whoever stored the run; it only ever deletes the
-- sign-off for the run's own case and stage.
CREATE OR REPLACE FUNCTION public.proof_scans_clear_signoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.case_id IS NOT NULL AND NEW.stage IS NOT NULL THEN
    DELETE FROM public.proof_scan_signoffs
    WHERE case_id = NEW.case_id AND stage = NEW.stage AND run_id <> NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.proof_scans_clear_signoff() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS proof_scans_clear_signoff ON public.proof_scans;
CREATE TRIGGER proof_scans_clear_signoff
  AFTER INSERT ON public.proof_scans
  FOR EACH ROW EXECUTE FUNCTION public.proof_scans_clear_signoff();

-- ── Possible issues (D-35 to D-39, D-59, D-86) ──────────────────────────────
-- Powerless by design (D-36): nothing here feeds the attention count, report
-- state, history summary or email. A suggestion says four things (D-37): what
-- was noticed, where its evidence is, why it might matter, what makes it
-- uncertain. reasoning_key lets a firm-wide suppression match it (D-59).
CREATE TABLE IF NOT EXISTS public.proof_scan_possible_issues (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid        NOT NULL REFERENCES public.proof_scans(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  description     text        NOT NULL,
  evidence        text        NOT NULL,
  why_it_matters  text        NOT NULL,
  uncertainty     text        NOT NULL,
  reasoning_key   text        CHECK (reasoning_key IS NULL OR reasoning_key ~ '^[a-z0-9_]{1,80}$'),
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  -- Same durable reason ids as pages/proof-scan/exploration-model.js.
  dismiss_reason  text        CHECK (dismiss_reason IS NULL OR dismiss_reason IN
                                     ('not_an_issue_here', 'not_useful', 'never_suggest_reasoning')),
  decided_by      uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT proof_scan_possible_issues_dismiss_shape
    CHECK ((status = 'dismissed') = (dismiss_reason IS NOT NULL)),
  CONSTRAINT proof_scan_possible_issues_decided_shape
    CHECK ((status = 'open') = (decided_at IS NULL))
);

CREATE INDEX IF NOT EXISTS proof_scan_possible_issues_run_idx ON public.proof_scan_possible_issues (run_id);

-- ── Suppressed reasoning (D-59) ──────────────────────────────────────────────
-- Firm-wide, all case types. Any Proof Scan user may add one ("Never suggest
-- this reasoning again"). Seeded with signature date order (R-1).
CREATE TABLE IF NOT EXISTS public.proof_scan_suppressions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reasoning_key  text        NOT NULL UNIQUE CHECK (reasoning_key ~ '^[a-z0-9_]{1,80}$'),
  label          text        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 300),
  origin         text        NOT NULL CHECK (origin IN ('firm_decision', 'possible_issue', 'staff')),
  created_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL DEFAULT public.my_user_id(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.proof_scan_suppressions (reasoning_key, label, origin, created_by)
VALUES (
  'signature_date_order',
  'Signature date order, for example an attorney signing before the applicant. Not a requirement at this firm.',
  'firm_decision',
  NULL
)
ON CONFLICT (reasoning_key) DO NOTHING;

-- ── Row level security: staff only, every table above ───────────────────────
-- Same four policies on each table. TO authenticated keeps anon out even if a
-- grant slips back in; can_read/can_write('proof_scan') keeps client logins out.

ALTER TABLE public.proof_scan_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_cases FROM anon;
DROP POLICY IF EXISTS "proof_scan_cases_staff_read" ON public.proof_scan_cases;
DROP POLICY IF EXISTS "proof_scan_cases_staff_insert" ON public.proof_scan_cases;
DROP POLICY IF EXISTS "proof_scan_cases_staff_update" ON public.proof_scan_cases;
DROP POLICY IF EXISTS "proof_scan_cases_staff_delete" ON public.proof_scan_cases;
CREATE POLICY "proof_scan_cases_staff_read" ON public.proof_scan_cases
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_cases_staff_insert" ON public.proof_scan_cases
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_cases_staff_update" ON public.proof_scan_cases
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_cases_staff_delete" ON public.proof_scan_cases
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

ALTER TABLE public.proof_scan_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_people FROM anon;
DROP POLICY IF EXISTS "proof_scan_people_staff_read" ON public.proof_scan_people;
DROP POLICY IF EXISTS "proof_scan_people_staff_insert" ON public.proof_scan_people;
DROP POLICY IF EXISTS "proof_scan_people_staff_update" ON public.proof_scan_people;
DROP POLICY IF EXISTS "proof_scan_people_staff_delete" ON public.proof_scan_people;
CREATE POLICY "proof_scan_people_staff_read" ON public.proof_scan_people
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_people_staff_insert" ON public.proof_scan_people
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_people_staff_update" ON public.proof_scan_people
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_people_staff_delete" ON public.proof_scan_people
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

ALTER TABLE public.proof_scan_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_documents FROM anon;
DROP POLICY IF EXISTS "proof_scan_documents_staff_read" ON public.proof_scan_documents;
DROP POLICY IF EXISTS "proof_scan_documents_staff_insert" ON public.proof_scan_documents;
DROP POLICY IF EXISTS "proof_scan_documents_staff_update" ON public.proof_scan_documents;
DROP POLICY IF EXISTS "proof_scan_documents_staff_delete" ON public.proof_scan_documents;
CREATE POLICY "proof_scan_documents_staff_read" ON public.proof_scan_documents
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_documents_staff_insert" ON public.proof_scan_documents
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_documents_staff_update" ON public.proof_scan_documents
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_documents_staff_delete" ON public.proof_scan_documents
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

ALTER TABLE public.proof_scan_document_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_document_people FROM anon;
DROP POLICY IF EXISTS "proof_scan_document_people_staff_read" ON public.proof_scan_document_people;
DROP POLICY IF EXISTS "proof_scan_document_people_staff_insert" ON public.proof_scan_document_people;
DROP POLICY IF EXISTS "proof_scan_document_people_staff_update" ON public.proof_scan_document_people;
DROP POLICY IF EXISTS "proof_scan_document_people_staff_delete" ON public.proof_scan_document_people;
CREATE POLICY "proof_scan_document_people_staff_read" ON public.proof_scan_document_people
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_document_people_staff_insert" ON public.proof_scan_document_people
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_document_people_staff_update" ON public.proof_scan_document_people
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_document_people_staff_delete" ON public.proof_scan_document_people
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

ALTER TABLE public.proof_scan_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_suggestions FROM anon;
DROP POLICY IF EXISTS "proof_scan_suggestions_staff_read" ON public.proof_scan_suggestions;
DROP POLICY IF EXISTS "proof_scan_suggestions_staff_insert" ON public.proof_scan_suggestions;
DROP POLICY IF EXISTS "proof_scan_suggestions_staff_update" ON public.proof_scan_suggestions;
DROP POLICY IF EXISTS "proof_scan_suggestions_staff_delete" ON public.proof_scan_suggestions;
CREATE POLICY "proof_scan_suggestions_staff_read" ON public.proof_scan_suggestions
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_suggestions_staff_insert" ON public.proof_scan_suggestions
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_suggestions_staff_update" ON public.proof_scan_suggestions
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_suggestions_staff_delete" ON public.proof_scan_suggestions
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

ALTER TABLE public.proof_scan_signoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_signoffs FROM anon;
DROP POLICY IF EXISTS "proof_scan_signoffs_staff_read" ON public.proof_scan_signoffs;
DROP POLICY IF EXISTS "proof_scan_signoffs_staff_insert" ON public.proof_scan_signoffs;
DROP POLICY IF EXISTS "proof_scan_signoffs_staff_update" ON public.proof_scan_signoffs;
DROP POLICY IF EXISTS "proof_scan_signoffs_staff_delete" ON public.proof_scan_signoffs;
CREATE POLICY "proof_scan_signoffs_staff_read" ON public.proof_scan_signoffs
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_signoffs_staff_insert" ON public.proof_scan_signoffs
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_signoffs_staff_update" ON public.proof_scan_signoffs
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_signoffs_staff_delete" ON public.proof_scan_signoffs
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

ALTER TABLE public.proof_scan_possible_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_possible_issues FROM anon;
DROP POLICY IF EXISTS "proof_scan_possible_issues_staff_read" ON public.proof_scan_possible_issues;
DROP POLICY IF EXISTS "proof_scan_possible_issues_staff_insert" ON public.proof_scan_possible_issues;
DROP POLICY IF EXISTS "proof_scan_possible_issues_staff_update" ON public.proof_scan_possible_issues;
DROP POLICY IF EXISTS "proof_scan_possible_issues_staff_delete" ON public.proof_scan_possible_issues;
CREATE POLICY "proof_scan_possible_issues_staff_read" ON public.proof_scan_possible_issues
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_possible_issues_staff_insert" ON public.proof_scan_possible_issues
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_possible_issues_staff_update" ON public.proof_scan_possible_issues
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_possible_issues_staff_delete" ON public.proof_scan_possible_issues
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

ALTER TABLE public.proof_scan_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_suppressions FROM anon;
DROP POLICY IF EXISTS "proof_scan_suppressions_staff_read" ON public.proof_scan_suppressions;
DROP POLICY IF EXISTS "proof_scan_suppressions_staff_insert" ON public.proof_scan_suppressions;
DROP POLICY IF EXISTS "proof_scan_suppressions_staff_update" ON public.proof_scan_suppressions;
DROP POLICY IF EXISTS "proof_scan_suppressions_staff_delete" ON public.proof_scan_suppressions;
CREATE POLICY "proof_scan_suppressions_staff_read" ON public.proof_scan_suppressions
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_suppressions_staff_insert" ON public.proof_scan_suppressions
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_suppressions_staff_update" ON public.proof_scan_suppressions
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_suppressions_staff_delete" ON public.proof_scan_suppressions
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));
