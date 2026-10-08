# Proof Scan v2: pre-build findings and specs

**Written:** 2026-10-06, by Claude, at Max's request ("if u can do all of those urself go
ahead"). Companion to `PROOF-SCAN-V2-BUILD-PLAN.md`. Read-only work: nothing in the portal
was changed, migrated, pushed, or deployed. The only outside action was a `git fetch` of
the portal repo, which updates the local copy of GitHub and touches nothing live.

Labels: **[verified]** = checked in code or docs this session. **[unverified]** = not
checked. **[Claude]** = recommendation.

---

## A. Repo sync (plan step 3.1): done

[verified] `git fetch origin` ran. GitHub's `main` is at `556118c` (2026-09-21). Since the
v1.2 branch split off, `main` gained 5 commits: a self-hosted copy of the Supabase
browser library (login no longer depends on a CDN), help-chat prompt caching, and two
Proof Scan handoff docs. **None touch Proof Scan code.** The v1.2 branch is 15 commits
ahead and 5 behind, so bringing `main` in before the v2 build should be clean.
[unverified] until a merge is actually tried.

Also noticed: an untracked `NOTICE-PARSER-SCOPING.md` sits in the portal working tree,
so another workstream may be using that checkout. The v2 build should run on its own
branch or worktree.

---

## B. Security check (plan step 3.3): a real problem, and it exists today

**What I found [verified in the migrations]:**
- The rest of the portal locks tables with role checks (`can_write('core')`,
  `can_admin(...)`, `my_user_id()`).
- The Proof Scan tables do not. Migration `1300_proof_scan.sql` gives `proof_scans` and
  `proof_scan_config` a policy of `FOR ALL USING (true)` with **no role named**, which in
  Postgres means it applies to everyone, including the public "anon" role.
- The browser holds the public Supabase key (`APP_CONFIG.supabaseAnonKey`, used in
  `js/supabase-client.js`), and clients log in as real users (`clients.auth_id`,
  migration `005_client_portal.sql`).
- No later migration tightens these policies.

**What that likely means [unverified on the live database]:** anyone holding the portal's
public key, and any logged-in client, may be able to **read, change, or delete every
saved scan report and the firm-wide Proof Scan settings** (custom instructions,
notification email). Old scan reports contain client names and A-Numbers. Whether this
is actually reachable depends on table grants in the live database, which I did not and
should not query.

**Why it matters now, not just for v2:** if the old checker is live (it is), its tables
were created by this same migration.

**Fix, for Rob [Claude]:** replace the three `USING (true)` policies with staff-only
role checks matching the rest of the portal, scoped to the Proof Scan module, and confirm
in the live database that anon and client logins get nothing back. Every v2 table gets
the same rule from day one.

---

## C. Limits (plan section 6): what a v2 request can carry

[verified, Anthropic API reference bundled with Claude Code, cached 2026-09-25]
- A single API request can be up to **32 MB**.
- PDFs can be up to **600 pages** per request on 1M-context models (the current
  `claude-sonnet-4-6` is one); 100 pages on 200K-context models.
- Several documents can go in one request.
- A **Files API** lets a document be uploaded once and referred to by ID afterwards.

[verified, `wrangler.toml`] The portal runs as a Cloudflare Worker with a 60-second CPU
limit. Waiting for the AI does not count as CPU time; base64 encoding does a little.

[verified, `_schemas.js`] v1.2 caps one PDF at 12 MB. Base64 makes it about 16 MB in the
request, so the 32 MB ceiling leaves room for roughly one more package-sized file.

**What that means for v2 [Claude]:**
- **Evidence Zero:** one request per document. EADs and intakes are small. Upload each
  once with the Files API and refer to it by ID in later stages, so it is not re-sent
  every time.
- **Draft Review / Pre-flight with separate files:** a full DACA set is about 22 pages,
  far under 600. Several files fit in one request as long as the total stays under about
  24 MB of original file size. Pre-flight's markups plus corrected pages also fit.
- **Physical Scan:** unchanged from v1.2: one scanned package.
- **Keep the 12 MB per-file cap**, add a per-request total check, and use the Files API
  for anything reused. If firms start uploading large evidence sets (AOS, later), split
  into one request per file and combine the results on the server.
- [unverified] Cloudflare's own request-size limit for the firm's plan. The browser sends
  the file to the Worker first; check the plan's limit before raising any cap.

---

## D. Spec: rules move into the database (plan Batch 2)

Today the DACA rules are a JSON file in code (`functions/api/proof-scan-profiles/
daca-renewal.v1.json`, 8 package items, 39 checks). v2 needs them editable in the
product (D-61, D-76), learnable (D-60), and stage-aware (D-57, D-69 to D-73).

**Tables (all staff-only, per section B):**

1. **Rule sets**: one row per case type per version. Holds the case type, version
   number, when it was created, who created it, and whether it is the current one.
   A version is never edited after a scan has used it; an edit makes a new version.
2. **Package items**: what a final package must contain (the 8 DACA items: two G-1450s
   by amount, G-1145, G-28, I-821D, I-765, I-765WS, EAD front and back), with page
   counts. Belongs to a rule-set version.
3. **Rules**: one row per check, belonging to a rule-set version. Same fields the v1.2
   profile has (ID, wording, form, page, item, expected answer, note, severity, which
   package items it depends on), plus:
   - **scope**: firm-wide or this case type
   - **origin**: firm checklist, general rules, added by staff, suggested from a
     possible issue
   - **retired**: true when removed, so history stays readable
4. **Stage settings**: for each rule and each stage, one of: checked, checked only if
   filled in, checked only if the client marked it, not checked yet (a later stage),
   not checked at this stage. Optional stage wording (the I-765WS template sentence at
   Draft Review, D-69). Optional "gentle if NO" (English questions, Draft Review only,
   D-70).
5. **Suppressed reasoning**: firm-wide, all case types (D-59). Seeded with signature
   date order (R-1).
6. **Rule changes log** (internal only; D-61 says no visible history log): who changed
   what and when. Needed so a version can be rebuilt, not shown in the rulebook.

**Seeding DACA v2.** Copy the 39 checks and 8 package items from the v1.2 profile
unchanged, then apply the stage settings Max decided:
- Draft Review: everything checked, except signatures, G-1450 card and cardholder
  details, I-821D departures (wait); G-28 "EAD home or office" checked only if filled in;
  I-765WS checks only the template sentence; English questions gentle (D-69, D-70).
- Pre-flight: corrections, signatures, card details, name / A-Number / address
  consistency; departures only if the client marked any; nothing else (D-71, D-72).
- Physical Scan: the full set (D-58).

**Added 2026-10-07 (D-98): "Evidence matches the forms".** A new firm-wide check, in every
case type and every stage that has evidence: each fact a document carries (names, dates
of birth, marriage date, A-Number) is compared with the forms about the same person, or
both people for a shared document. One attention item per difference. Not yet in the
Batch 1 seed; add it in the next batch.

**How a run picks its rules.** At the start of each run the server loads the current
rule-set version for the case type, keeps the rules whose stage setting is "checked" (or
the conditional ones whose condition is met), and records the version number on the run.
Re-opening an old run uses its recorded version (D-60), the same way v1.2 already
re-composes old results by profile version.

**What the rulebook screen does with this.** Add a rule = new version with one more
rule. Edit a rule = new version with that rule changed. The screen always shows the
current version.

---

## E. Spec: what the AI is asked and must return (plan Batch 4)

Principle carried over from v1.2, unchanged: **the AI reports observations only; the
server decides everything else** (D-18). Every check ID it is given must come back
exactly once, or the run fails rather than passing (D-19, D-20). Output is forced into a
JSON schema built from the rules, as v1.2 does today (`output_config.format`,
`json_schema`).

**E.1 Evidence Zero: read one document.**
- Input: one file.
- Return:
  - **what it is** (EAD, intake, other) and how sure it is
  - **read quality** (clear, or damaged / partly unreadable, with which fields)
  - **whose document it is** (which person on the case; possibly more than one, D-94)
  - **the case facts it carries**, each with the value as printed and where on the page:
    name parts, date of birth, A-Number, EAD expiration, address parts (including In
    Care Of / province / postal code / country only if present, D-82), phone, email,
    full SSN
- The server, not the AI, decides what fills the record, what becomes a suggestion, and
  what is held for source review (D-45, D-54, D-55).

**E.2 Draft Review / Pre-flight / Physical Scan: check a set of forms.**
- Input: the files for this run, the rules active at this stage (with their stage
  wording), and the reference record values the forms should match.
- Return, per check ID: one of
  - **clear**: read it, it holds
  - **needs attention**: read it, it does not hold
  - **blank**: the field is empty (the server turns this into "needs info" where the
    stage says "checked only if filled in")
  - **not checked**: could not read it, with the reason
- Return, per form found: which file, which pages, **which person each entry is about**
  (D-94), and the values it shows for each reference field, as printed (the server compares them, per form, D-81, and treats
  A-Number formatting as the same number, N-016).
- The server applies "gentle if NO" (Draft Review only) and all counting.

**E.3 Pre-flight corrections: read the markups.**
- Input: the client's marked-up pages and the corrected pages.
- Return, per markup: form, page, field, the old printed value, what the handwriting
  seems to say, **how sure the read is**, and what the corrected page now says (or that
  no corrected page exists for that form).
- The server decides fixed / not fixed / check / unreadable / left out on purpose / no
  corrected page / not carried to other forms (D-68, D-72, D-73).

**E.4 Changes from v1.2 that are deliberate.**
- **Full SSN comes back** (D-80). v1.2's prompt asks for the last four only and the
  server rejects a full SSN (`containsFullSsn` in `proof-scan-contract.js`). v2 removes
  that rule on purpose; the server stores the SSN encrypted and the screen shows it
  masked until the eye is pressed.
- **The firm-wide custom-instructions box goes away.** Its job moves into the rulebook.
- **Model** stays `claude-sonnet-4-6` until Rob answers Q-28.

**E.5 What still needs proving, in dev** (plan section 5): whether the AI reliably
identifies documents, reads EAD fields, returns "blank" distinctly from "needs
attention", and reads handwriting well enough. The schema can force the shape of the
answer; only real packages show whether the answers are right.
