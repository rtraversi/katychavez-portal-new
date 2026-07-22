-- Migration 1604: Joint Sponsor — second party record on immigration matters
--
-- The I-864 allows a JOINT SPONSOR when the petitioner lacks the financial
-- means to sponsor alone. Same shape as the petitioner (full person record:
-- name/address/DOB/SSN/employment/income), so it is a second opposing_parties
-- row distinguished by a new party_role column rather than a new table.
--
--   party_role = 'primary'        the matter's main second party — opposing
--                                 party (family law), Party 2 (collaborative),
--                                 or petitioner (immigration)
--   party_role = 'joint_sponsor'  I-864 joint financial sponsor (immigration);
--                                 at most one per matter
--
-- Form filler exposes it as the joint_sponsor.* fill source (wired when the
-- I-864 field map is authored). The client card shows a Joint Sponsor section
-- on immigration matters only.

ALTER TABLE public.opposing_parties
  ADD COLUMN IF NOT EXISTS party_role text NOT NULL DEFAULT 'primary';

COMMENT ON COLUMN public.opposing_parties.party_role IS
  'primary = opposing party / Party 2 / petitioner (per practice area); joint_sponsor = I-864 joint financial sponsor';

CREATE UNIQUE INDEX IF NOT EXISTS opposing_parties_one_joint_sponsor
  ON public.opposing_parties (matter_id)
  WHERE party_role = 'joint_sponsor';
