# Library Module + Intake Helpful-Hints — Build & Deploy Plan

**Status:** SCOPED, not built. Waiting on (1) Anita's choice of delivery method
(link vs. attachment) and (2) Cloudflare access to create the public bucket.
**Branch when built:** `module/library` off master. **Migration range:** assign a
free range at build (e.g. 650–699) per `modules/registry.js`.

Origin: Anita wants her **"Helpful Hints"** document sent as part of intake. Rob's
framing: a firm-level **Library** where staff self-manage non-client reference docs
(helpful hints, process docs, firm info), and the correct Helpful Hints file is
auto-included with an intake based on the matter's case type.

---

## 1. This is a THIRD document system — do not conflate

| System | Purpose |
|---|---|
| Intake Document Templates (`document_checklists`) | checklists of docs to **collect from** the client |
| Word Templates (`draft_templates`) | `.docx` merge templates for **drafting** |
| **🆕 Library** (this plan) | static firm reference material **humans read** — helpful hints, process docs, firm info |

See the template-systems architecture note before building so this lands in the right place.

---

## 2. Storage architecture — TWO buckets

Non-sensitive public docs are physically isolated from client files so no public-link
feature can ever leak a client document.

- **Private bucket (existing, e.g. `savagelaw-portal-prod`)** — all client documents +
  any Library docs marked `internal`. Served only via short-lived presigned URLs / the worker.
- **🆕 Public bucket (e.g. `savagelaw-public`)** — holds ONLY Library docs marked `public`.
  World-readable via a custom domain. Contains nothing client-specific or sensitive.

**Safety rails**
- Every Library doc carries a **`visibility` flag: `public` | `internal`.** Only `public`
  docs are copied to / served from the public bucket. `internal` docs never leave the
  private store (staff-only).
- Use **unguessable object keys** (uuid-based) even in the public bucket.
- Risk profile: read-only static hosting of non-sensitive PDFs — same as a PDF on the firm
  website. This is NOT the unauthenticated write/sign surface rejected for E-Sign external send.

---

## 3. Per-client infrastructure setup (done in Cloudflare — user/Rob, not automated)

1. Create a public R2 bucket: `<client>-public` (e.g. `savagelaw-public`).
2. R2 → Settings → **Public access → Connect a custom domain** → `resources.<clientdomain>`
   (SSL: `resources.divorcedifferently.com`).
3. **Hand the R2-provided CNAME target to whoever manages the client's website/DNS**
   (Rob doesn't manage Anita's site) so they add the `resources` CNAME record.
4. In `wrangler.toml`: add an `R2_PUBLIC` binding to the new bucket + env var
   `R2_PUBLIC_BASE_URL=https://resources.<clientdomain>`.
5. Deploy. (`wrangler.toml.example` gets the placeholder rows too.)

---

## 4. Data model (migration in the module's range)

`library_documents`
- `id uuid pk`
- `folder text` — e.g. 'Helpful Hints', 'Process Docs', 'Firm Info' (managed list)
- `name text`, `file_name text`, `content_type text`, `file_size bigint`
- `r2_key text` — object key (in whichever bucket matches visibility)
- `visibility text CHECK (visibility IN ('public','internal')) DEFAULT 'internal'`
- `case_types public.case_type[]` — for Helpful-Hints auto-matching (empty = not case-tagged)
- `is_active boolean DEFAULT true`
- `uploaded_by uuid`, `created_at`, `updated_at`
- RLS: staff read/write via `can_read/can_write('library')`; no client policy (clients never
  query the table — they only receive a link/attachment pushed to them).

Folders: start with a text column + a small managed set. Reuse File Manager's folder-UI
patterns if a tree is wanted later. (Phase 2.)

---

## 5. API (all staff-auth, no new public endpoints)

- `POST /api/library-upload` — upload-proxy; routes bytes to the **public** or **private**
  bucket based on `visibility`; inserts the row. (Reuses the existing R2 upload-proxy pattern.)
- `GET  /api/library-list` — list docs (folder filter).
- `POST /api/library-update` — rename, re-tag `case_types`, toggle `visibility`
  (flipping visibility moves the object between buckets), set `is_active`.
- `POST /api/library-delete` — soft/hard delete + remove object.
- Register routes in `_worker.js`; register module in `modules/registry.js`.

---

## 6. Intake wiring — the auto-include

`matters.case_type` is `NOT NULL`, so it is guaranteed present when `send-intake` runs.
In `functions/api/send-intake.js`, after loading the matter:

1. Look up the Helpful Hints doc:
   `library_documents` WHERE `folder='Helpful Hints'` AND `is_active` AND
   `case_types @> ARRAY[matter.case_type]`, most-recent first.
2. Fallbacks: no match → send intake normally (no hints); optional firm-wide "default hints"
   row (empty/`{}` case_types) as a catch-all; multiple matches → newest wins.
3. Deliver by the chosen method (below).

---

## 7. Delivery — BOTH methods written up (Anita to choose)

### Method A — Email LINK to the public bucket  ⭐ recommended
- Build `url = ${R2_PUBLIC_BASE_URL}/${doc.r2_key}` (permanent, no expiry).
- Modify `notifyIntakeRequest` (in `_notifications.js`) to accept optional
  `helpfulHintsUrl` + `helpfulHintsName` and render a button:
  *"📄 Please review these Helpful Hints before we begin."*
- Pros: no expiry (a presigned link would die after 7 days), light email, works forever,
  in-context. Requires the public bucket + custom domain (section 3).
- Requires the doc be `visibility='public'`.

### Method B — Email ATTACHMENT ("send it as a file")
- Fetch the doc bytes from its bucket, base64-encode, and pass to Resend.
- Modify `sendEmail` in `_notifications.js` to support Resend's
  `attachments: [{ filename, content }]` array.
- Pros: closest to Anita's "send it along" mental model; works even without the public
  bucket. Cons: heavier email, more spam-prone, Resend size limits (keep the PDF small).
- Works with either `visibility` value (no public exposure needed).

> **Decision pending:** Rob to confirm with Anita whether she wants the **link** (A) or the
> **file/attachment** (B). Build supports either; A is recommended. Could ship both and let
> the doc/firm setting pick.

---

## 8. Reuse
File Manager folder-UI patterns · R2 upload-proxy · presigned-URL helper (for `internal`
docs viewed in-portal) · existing intake email/notification plumbing.

---

## 9. Phasing
- **Phase 1:** Library CRUD (folders + upload + visibility + case-type tags), public bucket,
  and auto-include on Send Intake. Delivers Anita's whole ask.
- **Phase 2 (natural extension):** client-facing **"Resources"** area in the portal so clients
  can browse selected `public` Library docs anytime, not just at intake; optional folder tree.

---

## 10. Open items
- Anita: link (A) vs attachment (B).
- CF access to create the bucket + custom domain (currently down / can't log in).
- Confirm a free migration range against `registry.js` at build.
- Multiple hints per case type / a firm-wide default hints doc — confirm desired behavior.
- Module tier: propose CORE (broadly useful, low cost) — confirm.
- Related but distinct from the E-Sign external-send "firm-level library" idea (signed docs vs
  reference docs) — keep separate.
