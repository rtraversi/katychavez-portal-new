# WebDAV Share Module — Build Plan

**Decided 2026-07-11 (Rob).** Expose each firm's portal files as a browsable WebDAV share so staff
can work in Windows File Explorer (mapped drive) or any WebDAV client, decoupled from the portal UI.

- **Strategy:** build the WebDAV endpoint as the standard offering; recommend **Mountain Duck**
  ($49/user one-time, 30% off with a Cyberduck donation key) as the paid comfort upgrade for firms
  that find the native Windows client lacking. Rob buys one Mountain Duck license for client demos.
- **Ruled out:** Cyberduck as the recommended client (separate non-Explorer UI); custom sync client
  / Cloud Files API app (months of desktop software; Storage Sync + Dropbox already covers offline
  sync); building nothing (native Explorer WebDAV alone is too flaky to be the whole story).

**Branch:** `module/webdav-share` off master (after `module/scheduling` merges).
**Migration:** `1950_webdav_share.sql` (range 1950–1999 verified free 2026-07-11).
**Tier:** PREMIUM, staff-only v1 — gated on `enabled_modules` row `webdav_share`.

---

## What already exists (reuse, don't rebuild)

`functions/api/webdav.js` (Office Edit round-trip) already implements, single-file scope:
- OPTIONS/PROPFIND/HEAD/GET/PUT/PROPPATCH/LOCK/UNLOCK with the exact header dance Word needs
  (`MS-Author-Via: DAV`, 207 multistatus XML, ETag discipline).
- **PUT pipeline:** new R2 key → `scanR2Object` AV scan (infected saves can never clobber the good
  copy) → `document_versions` insert → repoint `documents.r2_key` → `pruneVersions` (cap 20).
- Lock columns on `documents` (`edit_locked_by/at`, `edit_lock_token`).

Keep `webdav.js` untouched (its signed-token, single-doc flow stays for Office Edit). New handler
`functions/api/dav-share.js` on a new `/dav/*` route in `_worker.js`, sharing the PUT/scan/version
helpers (extract shared bits into `_dav-helpers.js` if needed).

## Auth — per-user app passwords (Basic over HTTPS)

File Explorer/Mountain Duck can't do portal bearer tokens; they speak HTTP Basic.
- Migration 1950: `dav_app_passwords` (id, user_id, label, secret_hash, salt, created_at,
  last_used_at, revoked_at).
- Passwords are **machine-generated high-entropy** (24+ chars base32, shown once in Settings) —
  salted SHA-256 is sufficient (no slow KDF needed for high-entropy secrets, and PBKDF2 per request
  would burn Workers CPU: WebDAV clients send MANY requests).
- Username = portal login email; password = app password. Verify → resolve portal user + role.
- Revoke button per password; `last_used_at` stamped (throttled, e.g. once/hour) so stale creds are
  visible. Auth failures rate-limited via the existing RL infra (same pattern as booking API).

## URL tree

```
/dav/                                → matters the user can access (staff: all active)
/dav/{Client Name – matter}/         → folder tree for that matter
/dav/{matter}/{folder}/.../file.pdf  → the document
```
- Matter display name: client name + matter label, deduped with a short id suffix on collision.
  Slug ↔ matter_id resolution server-side; R2 keys never appear in URLs.
- Folder tree = same merge the Files tab sidebar does: built-in MATTER_FOLDERS labels +
  `matter_folders` rows + paths carried only by docs (legacy storage-sync pulls).
- Files = `documents` where `deleted_at IS NULL` and status ≠ pending.

## Method map (v1)

| Method | Behavior |
|---|---|
| OPTIONS | capability ad (as today) |
| PROPFIND | **NEW: Depth 0/1 directory listings** over the tree above; `Depth: infinity` → 403 |
| GET/HEAD | stream from R2 (as today) |
| PUT | existing doc name → new version via existing pipeline; new name → create `documents` row + version 1 (same AV scan; align with the 100MB manual-upload cap) |
| MKCOL | insert `matter_folders` row |
| DELETE | **soft-delete → portal Trash** (30-day purge rules apply, never hard R2 delete) |
| MOVE | rename (update `file_name`/`name`) or move (update `folder_path`); folder rename = update subtree paths, same as the Files tab |
| COPY | 501 in v1 (rarely used by Explorer; add later if a client asks) |
| LOCK/UNLOCK | reuse existing advisory lock columns |
| PROPPATCH | acknowledge-without-storing (as today) |

Portal rules ride along free because everything goes through the same tables: version cap,
trash, staff-only visibility (v1 is staff-only anyway), AV scanning.

## Client compatibility notes (goes in the support doc)

- **Windows native:** Basic over HTTPS allowed by default; ~50MB per-file default cap
  (`HKLM\...\WebClient\Parameters\FileSizeLimitInBytes` fix); drives can drop after reboot —
  document `net use P: https://portal.../dav/ /persistent:yes`.
- **Mountain Duck** (recommended upgrade): caching, no size cap, proper drive letter. Demo license
  on Rob's machine.
- Send `Translate: f` handling + stable ETags; test matrix = Windows Explorer, Mountain Duck,
  Cyberduck (still fine as a free client even though we don't pitch it).

## Settings UI

Settings → new "WebDAV / Mapped Drive" card (staff, module-gated):
- Connection URL + step-by-step "Map network drive" instructions + Mountain Duck note.
- Generate app password (label, show-once), list with created/last-used, revoke.

## Security checklist

- Premium gate 404s everything without the `enabled_modules` row (booking-API pattern).
- Staff only in v1 — no client-role access, no anonymous surface.
- Rate limit auth failures; audit successful logins (activity log) with app-password label.
- Every PUT scanned; infected writes rejected before any table repoint (existing pipeline).
- App passwords hashed+salted, revocable, never logged.

## Phases

1. **Read-only** — auth + tree PROPFIND + GET/HEAD. Ship internally, validate with Explorer +
   Mountain Duck against sandbox. (Most of the demo value, near-zero write risk.)
2. **Write** — PUT (new doc + new version), MKCOL, DELETE→trash, MOVE, locks.
3. **Polish** — support doc (registry fix, map-drive walkthrough, Mountain Duck setup), Settings
   card copy, vitest coverage (auth, gate, PROPFIND XML shape, MOVE/DELETE mapping), demo script.

## Open questions

- Which roles get it beyond Owner/Attorney/Paralegal? (v1: any staff role with Files access.)
- Client-scoped read-only DAV someday? Out of scope v1 — new attack surface, needs its own review.
- Per-firm pricing of the module (premium tier) — Rob decides at rollout.

---

## Follow-on buildout: "IurisIQ Drive" (rclone + WinFsp wrapper) — APPROVED 2026-07-11

**Status:** saved buildout, start ~late July/August 2026, after WebDAV Phases 1–2 validate on
sandbox. Approved by Rob as the free branded middle tier between native Explorer (flaky) and
Mountain Duck ($49/seat).

**What:** a branded installer that mounts `/dav/*` as a real Windows drive letter using
rclone (MIT) over WinFsp (GPLv3 + FLOSS exception). No custom filesystem code — we maintain
packaging and config only; the sync/filesystem engine is upstream rclone/WinFsp.

**Components:**
1. **WinFsp** — installer downloads the official unmodified MSI at install time (cleanest GPL
   posture; we never link it — rclone does, and rclone is FLOSS-covered). Break-glass option if a
   client's IT ever objects: WinFsp commercial license, $6,000 / 3 years. Not needed for v1.
2. **rclone.exe** — single binary, speaks WebDAV natively with Basic auth = our app passwords.
3. **Inno Setup installer + first-run wizard** — portal URL + email + app password → test
   connection → write rclone.conf (obscured) → register logon task:
   `rclone mount iurisiq: I: --vfs-cache-mode writes` (cache mode `writes` required for Office
   save-back). Uninstall = unmount, delete task, revoke app password via API.
4. **v1.5 (optional) tray app** — status icon, remount on wake/network change, update check.
   v1 substitute: scheduled task also triggers on workstation unlock.

**Costs:** ~$120/yr Azure Artifact Signing ($9.99/mo, US individuals/orgs eligible) — signing is
REQUIRED (SmartScreen/AV at law firms). Everything else $0 license cost; per-seat $0; server
runtime ~$0 (R2 egress free, PROPFIND chatter is pennies inside Workers Paid 10M req/mo).

**Effort:** v1 ≈ 3–5 days (rclone flag tuning against `/dav/`, Office round-trip testing through
the mount, installer, support doc). Tray app +3–5 days later if remount pain shows up.

**Known limits (goes in support doc):**
- Mounted drive ≠ offline sync — offline lane stays Storage Sync/Dropbox.
- rclone issues no WebDAV LOCKs → advisory lock columns won't engage from the mount; conflict
  story = last-write-wins + 20-version history safety net.
- Align rclone upload behavior with the 100MB manual-upload cap.

**Sequencing:** Azure Artifact Signing account can be opened early (identity validation takes
days). Build gate: confirm during sandbox validation that native Explorer WebDAV is annoying
enough to justify it (expected: yes).

### Deferred upgrade path: true Cloud Files API client ("IurisIQ Drive Pro")

If the OneDrive-style placeholder/Files-On-Demand experience ever becomes a selling point:
**buy, never build.** IT Hit User File System (.NET engine implementing the whole Windows Cloud
Files API sync-provider layer) ships a white-label-able **WebDAV Drive sample** that rides the
same `/dav/*` endpoint + Basic-auth app passwords. Verified pricing 2026-07-11 (Rob screenshot):

| Tier | Initial | Early renewal | Notes |
|---|---|---|---|
| Enterprise | $4,548.90 | $2,047.00 | NO redistribution — unusable for us |
| **Redistribution** | **$5,846.90** | $2,631.11 | royalty-free shipping to client firms — the one we'd need |
| Redistribution + Source | $9,032.90 | $4,064.80 | escape-hatch tier if vendor risk worries |

Perpetual — keeps working without renewal; renew only for engine updates. Sample also needs
their WebDAV Client Library license (25% bundle discount on 2nd product) — get exact bundle
quote via the free 1-month trial. Effort on top ≈ 2–4 weeks (rebrand, app-password login,
trash/move semantics, signed installer). Their ready-made WebDAV Drive app is FREE ≤10
users/domain (their branding) — use as a 1-day spike during sandbox validation to feel out the
UX and compat-test our DAV implementation before spending anything.
