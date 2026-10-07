-- Migration 2002: Proof Scan v2 rules as data
--
-- v1.2 kept the DACA rules in a JSON file in code
-- (functions/api/proof-scan-profiles/daca-renewal.v1.json). v2 needs them
-- editable in the product (D-61, D-65, D-76), learnable (D-60) and stage-aware
-- (D-57, D-69 to D-73). Spec: PROOF-SCAN-V2-SPECS.md section D.
--
-- Tables:
--   proof_scan_rule_sets            one row per case type per version
--   proof_scan_package_items        what a final package must contain, per version
--   proof_scan_rules                one row per check, per version
--   proof_scan_rule_stage_settings  per rule and stage: checked / if_filled /
--                                   if_marked / later / not_this_stage
--   proof_scan_rule_changes         internal change log (not shown, D-61)
--
-- VERSIONING (D-60, D-76): a rule-set version is never edited after a run has
-- used it. Editing a rule, adding one, or retiring one creates a new version.
-- Triggers below refuse any insert, update or delete that would change a version
-- a stored run points at (proof_scans.case_id -> case_type + rule_set_version).
-- Only the is_current flag may move on a used version.
--
-- Evidence Zero is not a check stage (D-53), so stage settings exist for the
-- three review stages only.
--
-- SECURITY: staff only, same pattern as 2000 / 2001.
-- The seed (DACA renewal + General) is migration 2003, generated from
-- functions/api/proof-scan-profiles/v2-seed.json by scripts/proof-scan-v2-seed.mjs.

-- ── Rule sets ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proof_scan_rule_sets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type    text        NOT NULL CHECK (case_type IN ('daca_renewal', 'general')),
  version      integer     NOT NULL CHECK (version >= 1),
  is_current   boolean     NOT NULL DEFAULT false,
  label        text        NOT NULL,
  source_note  text,
  created_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL DEFAULT public.my_user_id(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_type, version)
);

-- Exactly one current version per case type (at most one by index; the seed
-- creates the first).
CREATE UNIQUE INDEX IF NOT EXISTS proof_scan_rule_sets_one_current
  ON public.proof_scan_rule_sets (case_type) WHERE is_current;

-- ── Package items ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proof_scan_package_items (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id  uuid    NOT NULL REFERENCES public.proof_scan_rule_sets(id) ON DELETE CASCADE,
  item_id      text    NOT NULL CHECK (item_id ~ '^[A-Z0-9][A-Z0-9-]{1,80}$'),
  form         text    NOT NULL,
  instance     text,
  label        text    NOT NULL,
  pages        integer NOT NULL CHECK (pages >= 1),
  -- 'form' = a filed form; 'evidence' = a supporting document (the EAD card copy).
  -- Draft Review asks only for forms; Physical Scan expects both (D-58, D-66).
  kind         text    NOT NULL DEFAULT 'form' CHECK (kind IN ('form', 'evidence')),
  sort_order   integer NOT NULL,
  UNIQUE (rule_set_id, item_id)
);

-- ── Rules ────────────────────────────────────────────────────────────────────
-- Same fields as a v1.2 profile rule, plus scope, origin and retired.
CREATE TABLE IF NOT EXISTS public.proof_scan_rules (
  id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id          uuid    NOT NULL REFERENCES public.proof_scan_rule_sets(id) ON DELETE CASCADE,
  rule_id              text    NOT NULL CHECK (rule_id ~ '^[A-Z0-9][A-Z0-9-]{1,80}$'),
  title                text    NOT NULL,
  severity             text    NOT NULL CHECK (severity IN ('fatal', 'warning')),
  check_kind           text    NOT NULL DEFAULT 'pdf' CHECK (check_kind IN ('pdf')),
  form                 text,
  page                 text,
  item                 text,
  expected             text,
  pass_text            text,
  note                 text,
  source_note          text,
  applies_to_item_ids  text[]  NOT NULL DEFAULT '{}',
  scope                text    NOT NULL CHECK (scope IN ('firm', 'case_type')),
  origin               text    NOT NULL CHECK (origin IN ('firm_checklist', 'general_rules',
                                                          'staff_added', 'possible_issue')),
  retired              boolean NOT NULL DEFAULT false,
  sort_order           integer NOT NULL,
  UNIQUE (rule_set_id, rule_id)
);

CREATE INDEX IF NOT EXISTS proof_scan_rules_set_idx ON public.proof_scan_rules (rule_set_id, sort_order);

-- ── Stage settings ───────────────────────────────────────────────────────────
-- checked         the check runs at this stage
-- if_filled       runs only if the field is filled in; blank = needs info (D-70)
-- if_marked       runs only if the client's markups show it (D-71 departures)
-- later           not expected yet; a later stage checks it (D-3, D-57)
-- not_this_stage  not checked at this stage
CREATE TABLE IF NOT EXISTS public.proof_scan_rule_stage_settings (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_pk          uuid    NOT NULL REFERENCES public.proof_scan_rules(id) ON DELETE CASCADE,
  stage            text    NOT NULL CHECK (stage IN ('draft_review', 'preflight', 'physical_scan')),
  state            text    NOT NULL CHECK (state IN ('checked', 'if_filled', 'if_marked',
                                                     'later', 'not_this_stage')),
  -- Optional stage wording (D-69: the I-765WS template sentence at Draft Review).
  stage_title      text,
  stage_pass_text  text,
  stage_expected   text,
  -- D-70: an English answer of NO is a gentle "was this intended?", Draft
  -- Review only. A normal check at Pre-flight and Physical Scan.
  gentle_if_no     boolean NOT NULL DEFAULT false,
  UNIQUE (rule_pk, stage),
  CONSTRAINT proof_scan_rule_stage_settings_gentle_draft_only
    CHECK (NOT gentle_if_no OR stage = 'draft_review')
);

-- ── Rule changes log (internal, D-61: no visible history) ────────────────────
-- Enough to rebuild how a version came to be. Append only for staff.
CREATE TABLE IF NOT EXISTS public.proof_scan_rule_changes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id           uuid        NOT NULL REFERENCES public.proof_scan_rule_sets(id) ON DELETE CASCADE,
  previous_rule_set_id  uuid        REFERENCES public.proof_scan_rule_sets(id) ON DELETE SET NULL,
  rule_id               text,
  action                text        NOT NULL CHECK (action IN ('add', 'edit', 'retire', 'restore',
                                                               'stage_change', 'package_change')),
  before_value          jsonb,
  after_value           jsonb,
  possible_issue_id     uuid        REFERENCES public.proof_scan_possible_issues(id) ON DELETE SET NULL,
  changed_by            uuid        REFERENCES public.users(id) ON DELETE SET NULL DEFAULT public.my_user_id(),
  changed_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proof_scan_rule_changes_set_idx ON public.proof_scan_rule_changes (rule_set_id, changed_at);

-- ── Versions in use are frozen (D-60) ────────────────────────────────────────
-- SECURITY DEFINER so the check sees every stored run regardless of RLS.
CREATE OR REPLACE FUNCTION public.proof_scan_rule_set_in_use(p_rule_set_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.proof_scan_rule_sets rs
    JOIN public.proof_scan_cases c ON c.case_type = rs.case_type
    JOIN public.proof_scans s      ON s.case_id = c.id AND s.rule_set_version = rs.version
    WHERE rs.id = p_rule_set_id
  );
$$;
REVOKE ALL ON FUNCTION public.proof_scan_rule_set_in_use(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proof_scan_rule_set_in_use(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.proof_scan_rule_sets_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.proof_scan_rule_set_in_use(OLD.id) THEN
      RAISE EXCEPTION 'Rule set % v% is used by a stored scan and cannot be deleted', OLD.case_type, OLD.version
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: only is_current may change on a version in use.
  IF public.proof_scan_rule_set_in_use(OLD.id)
     AND (NEW.case_type, NEW.version, NEW.label, NEW.source_note, NEW.created_by, NEW.created_at)
         IS DISTINCT FROM
         (OLD.case_type, OLD.version, OLD.label, OLD.source_note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Rule set % v% is used by a stored scan; create a new version instead', OLD.case_type, OLD.version
      USING ERRCODE = 'check_violation';
  END IF;
  -- case_type and version are identity; never renumber.
  IF (NEW.case_type, NEW.version) IS DISTINCT FROM (OLD.case_type, OLD.version) THEN
    RAISE EXCEPTION 'A rule set''s case type and version cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_scan_rule_sets_freeze ON public.proof_scan_rule_sets;
CREATE TRIGGER proof_scan_rule_sets_freeze
  BEFORE UPDATE OR DELETE ON public.proof_scan_rule_sets
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_rule_sets_freeze();

-- Rules and package items: refuse any change to a version in use. Covers
-- INSERT (adding to a used version), UPDATE (both old and new parent) and DELETE.
CREATE OR REPLACE FUNCTION public.proof_scan_rule_children_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND public.proof_scan_rule_set_in_use(OLD.rule_set_id) THEN
    RAISE EXCEPTION 'This rule-set version is used by a stored scan; create a new version instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND public.proof_scan_rule_set_in_use(NEW.rule_set_id) THEN
    RAISE EXCEPTION 'This rule-set version is used by a stored scan; create a new version instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_scan_rules_freeze ON public.proof_scan_rules;
CREATE TRIGGER proof_scan_rules_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON public.proof_scan_rules
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_rule_children_freeze();

DROP TRIGGER IF EXISTS proof_scan_package_items_freeze ON public.proof_scan_package_items;
CREATE TRIGGER proof_scan_package_items_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON public.proof_scan_package_items
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_rule_children_freeze();

-- Stage settings reach their rule set through the rule.
CREATE OR REPLACE FUNCTION public.proof_scan_rule_stage_settings_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_rule uuid;
BEGIN
  FOREACH v_rule IN ARRAY ARRAY[
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.rule_pk END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.rule_pk END
  ] LOOP
    IF v_rule IS NOT NULL AND public.proof_scan_rule_set_in_use(
         (SELECT rule_set_id FROM public.proof_scan_rules WHERE id = v_rule)) THEN
      RAISE EXCEPTION 'This rule-set version is used by a stored scan; create a new version instead'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_scan_rule_stage_settings_freeze ON public.proof_scan_rule_stage_settings;
CREATE TRIGGER proof_scan_rule_stage_settings_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON public.proof_scan_rule_stage_settings
  FOR EACH ROW EXECUTE FUNCTION public.proof_scan_rule_stage_settings_freeze();

-- ── A v2 run must point at a rule set that exists for its case type ─────────
CREATE OR REPLACE FUNCTION public.proof_scans_check_rule_set()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_id IS NOT NULL AND NOT EXISTS (
       SELECT 1
       FROM public.proof_scan_cases c
       JOIN public.proof_scan_rule_sets rs ON rs.case_type = c.case_type
       WHERE c.id = NEW.case_id AND rs.version = NEW.rule_set_version) THEN
    RAISE EXCEPTION 'No rule set version % exists for this case type', NEW.rule_set_version
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proof_scans_check_rule_set ON public.proof_scans;
CREATE TRIGGER proof_scans_check_rule_set
  BEFORE INSERT OR UPDATE OF case_id, rule_set_version ON public.proof_scans
  FOR EACH ROW EXECUTE FUNCTION public.proof_scans_check_rule_set();

-- ── Row level security: staff only ───────────────────────────────────────────
ALTER TABLE public.proof_scan_rule_sets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_scan_package_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_scan_rules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_scan_rule_stage_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_scan_rule_changes        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.proof_scan_rule_sets           FROM anon;
REVOKE ALL ON TABLE public.proof_scan_package_items       FROM anon;
REVOKE ALL ON TABLE public.proof_scan_rules               FROM anon;
REVOKE ALL ON TABLE public.proof_scan_rule_stage_settings FROM anon;
REVOKE ALL ON TABLE public.proof_scan_rule_changes        FROM anon;

DROP POLICY IF EXISTS "proof_scan_rule_sets_staff_read"   ON public.proof_scan_rule_sets;
DROP POLICY IF EXISTS "proof_scan_rule_sets_staff_insert" ON public.proof_scan_rule_sets;
DROP POLICY IF EXISTS "proof_scan_rule_sets_staff_update" ON public.proof_scan_rule_sets;
DROP POLICY IF EXISTS "proof_scan_rule_sets_staff_delete" ON public.proof_scan_rule_sets;
CREATE POLICY "proof_scan_rule_sets_staff_read" ON public.proof_scan_rule_sets
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_rule_sets_staff_insert" ON public.proof_scan_rule_sets
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_rule_sets_staff_update" ON public.proof_scan_rule_sets
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_rule_sets_staff_delete" ON public.proof_scan_rule_sets
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

DROP POLICY IF EXISTS "proof_scan_package_items_staff_read"   ON public.proof_scan_package_items;
DROP POLICY IF EXISTS "proof_scan_package_items_staff_insert" ON public.proof_scan_package_items;
DROP POLICY IF EXISTS "proof_scan_package_items_staff_update" ON public.proof_scan_package_items;
DROP POLICY IF EXISTS "proof_scan_package_items_staff_delete" ON public.proof_scan_package_items;
CREATE POLICY "proof_scan_package_items_staff_read" ON public.proof_scan_package_items
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_package_items_staff_insert" ON public.proof_scan_package_items
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_package_items_staff_update" ON public.proof_scan_package_items
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_package_items_staff_delete" ON public.proof_scan_package_items
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

DROP POLICY IF EXISTS "proof_scan_rules_staff_read"   ON public.proof_scan_rules;
DROP POLICY IF EXISTS "proof_scan_rules_staff_insert" ON public.proof_scan_rules;
DROP POLICY IF EXISTS "proof_scan_rules_staff_update" ON public.proof_scan_rules;
DROP POLICY IF EXISTS "proof_scan_rules_staff_delete" ON public.proof_scan_rules;
CREATE POLICY "proof_scan_rules_staff_read" ON public.proof_scan_rules
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_rules_staff_insert" ON public.proof_scan_rules
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_rules_staff_update" ON public.proof_scan_rules
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_rules_staff_delete" ON public.proof_scan_rules
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

DROP POLICY IF EXISTS "proof_scan_rule_stage_settings_staff_read"   ON public.proof_scan_rule_stage_settings;
DROP POLICY IF EXISTS "proof_scan_rule_stage_settings_staff_insert" ON public.proof_scan_rule_stage_settings;
DROP POLICY IF EXISTS "proof_scan_rule_stage_settings_staff_update" ON public.proof_scan_rule_stage_settings;
DROP POLICY IF EXISTS "proof_scan_rule_stage_settings_staff_delete" ON public.proof_scan_rule_stage_settings;
CREATE POLICY "proof_scan_rule_stage_settings_staff_read" ON public.proof_scan_rule_stage_settings
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_rule_stage_settings_staff_insert" ON public.proof_scan_rule_stage_settings
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_rule_stage_settings_staff_update" ON public.proof_scan_rule_stage_settings
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_rule_stage_settings_staff_delete" ON public.proof_scan_rule_stage_settings
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

-- Change log: staff read and append. No update or delete policy, so it is
-- append only for every logged-in user.
DROP POLICY IF EXISTS "proof_scan_rule_changes_staff_read"   ON public.proof_scan_rule_changes;
DROP POLICY IF EXISTS "proof_scan_rule_changes_staff_insert" ON public.proof_scan_rule_changes;
CREATE POLICY "proof_scan_rule_changes_staff_read" ON public.proof_scan_rule_changes
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_rule_changes_staff_insert" ON public.proof_scan_rule_changes
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
