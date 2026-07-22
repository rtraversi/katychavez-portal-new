# ============================================================================
#  scroggins-sync-modules.ps1  -  Port 3 template features into Scroggins &
#  Savage (SSL). Written 2026-07-11. (rev2: filesystem backup + CRLF-safe patch)
#
#  RUN FROM ANY POWERSHELL WINDOW (fully self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-modules.ps1
#
#  WHAT IT PORTS (all three merged to template master @ 377e6af, 118 green):
#    1. Conflict Checker - prior-inquiry search  (module/conflict-prior-inquiry)
#         Adds conflict_checks as a 3rd search source so a prospect who only ever
#         inquired (never retained) still surfaces (ABA Model Rule 1.18).
#    2. File Manager - nested folder tree         (module/file-manager-tree)
#         Sidebar folder tree + subfolder-as-navigable-row in the matter Files tab.
#    3. Per-user attorney signatures              (module/per-user-signatures)
#         Signatures keyed per staff member (R2 firm/signatures/<users.id>.png)
#         instead of one shared firm signature. Each person manages their OWN.
#
#  *** NO DATABASE MIGRATION for any of the three. ***
#
#  ROLLBACK: SSL is NOT a git repo, so this script takes a FILESYSTEM backup of
#  every file it touches into  _pre-sync-backup-<timestamp>\  BEFORE overwriting.
#  Roll back by copying that folder's contents back over the tree (exact command
#  is printed at the end). The LIVE worker is untouched until you deploy, so the
#  deployed site is always the ultimate fallback.
#
#  HOW IT SOURCES FILES: byte-faithful from the template's *master* ref via
#  `git archive` -> tar (NOT the working tree) - correct regardless of which
#  branch the template is on, immune to the parked FreshBooks WIP.
#
#  It copies ONLY feature files. It NEVER touches SSL's per-client files
#  (wrangler.toml, js/config.js, branding assets, .env, js/auth.js MFA edit) and
#  NEVER touches SSL's FreshBooks/Payload work (those are SSL-specific and absent
#  from the 13 files below). It does NOT deploy.
#
#  Targets:  Supabase xdzgkagyfiauyfxbbdxv | R2 savagelaw-portal-prod
#            Worker = whatever SSL's own wrangler.toml names (savagelaw-v2 clone).
# ============================================================================

$ErrorActionPreference = 'Stop'
$TEMPLATE = 'C:\Sites\iurisiq-portal-template'
$SSL      = 'C:\Sites\scrogginssavage'

# ---- 0. Sanity -------------------------------------------------------------
if (-not (Test-Path (Join-Path $TEMPLATE '_worker.js'))) { throw "Template not found at $TEMPLATE." }
if (-not (Test-Path $SSL))                               { throw "SSL clone not found at $SSL." }
if (-not (Test-Path (Join-Path $SSL '_worker.js')))      { throw "Not the SSL portal root ($SSL) - _worker.js missing." }
if (-not (& git -C $TEMPLATE rev-parse --verify --quiet master)) { throw "Template has no 'master' branch." }
Write-Host "== Source: $TEMPLATE (master ref)" -ForegroundColor Cyan
Write-Host "== Target: $SSL"                    -ForegroundColor Cyan

# The 11 feature-scoped files copied WHOLESALE from master (self-contained
# page/API files). _worker.js and js/menu.js are patched surgically below.
$copyFiles = @(
  'functions/api/run-conflict-check.js',
  'pages/conflict-checker/conflict-checker.js',
  'pages/clients/detail/detail.js',
  'pages/clients/detail/index.html',
  'functions/api/get-attorney-signature.js',
  'functions/api/save-attorney-signature.js',
  'functions/api/list-signatures.js',
  'pages/settings/signature/index.html',
  'pages/settings/signature/signature.js',
  'pages/sig-stamp/index.html',
  'pages/sig-stamp/sig-stamp.js'
)
# Everything the script mutates (for the pre-sync backup): the 11 + the 2 patched.
$touched = $copyFiles + @('_worker.js', 'js/menu.js')

# ---- 1. Filesystem backup of every file we will touch ----------------------
$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $SSL "_pre-sync-backup-$stamp"
Write-Host "`n== [1/5] Backing up files to $backupDir ..." -ForegroundColor Cyan
$backedUp = 0
foreach ($rel in $touched) {
  $src = Join-Path $SSL $rel
  if (Test-Path $src) {
    $dst    = Join-Path $backupDir $rel
    $dstDir = Split-Path $dst -Parent
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Copy-Item -Path $src -Destination $dst -Force
    $backedUp++
  }
}
Write-Host "   Backed up $backedUp existing files (new files like list-signatures.js are skipped)." -ForegroundColor DarkGray

# ---- 2. Copy the 11 feature files (byte-faithful, master ref) --------------
Write-Host "`n== [2/5] Exporting $($copyFiles.Count) files from template master..." -ForegroundColor Cyan
$tmpTar = Join-Path $env:TEMP ("ssl-modules-sync-{0}.tar" -f $PID)
# git writes the tar straight to disk; tar reads it straight from disk. No
# PowerShell pipe between them => no text re-encoding, LF + UTF-8 comments intact.
& git -C $TEMPLATE archive -o $tmpTar master -- $copyFiles
if ($LASTEXITCODE -ne 0) { throw "git archive failed (a path may be missing on master)." }
& tar -x -f $tmpTar -C $SSL
if ($LASTEXITCODE -ne 0) { Remove-Item $tmpTar -Force -ErrorAction SilentlyContinue; throw "tar extract failed." }
Remove-Item $tmpTar -Force
foreach ($f in $copyFiles) { Write-Host "   + $f" -ForegroundColor DarkGray }

# ---- 3. Surgical patch: _worker.js (add list-signatures route only) --------
# CRLF-tolerant: anchors match within a line ([^\r\n]*) and consume the line's
# own terminator (\r?\n), so it works whether the file is CRLF (Windows on-disk)
# or LF. Inserts with CRLF to match SSL's on-disk convention.
Write-Host "`n== [3/5] Patching _worker.js (list-signatures route)..." -ForegroundColor Cyan
$wpath = Join-Path $SSL '_worker.js'
$w = [System.IO.File]::ReadAllText($wpath, [System.Text.Encoding]::UTF8)
if ($w -match 'list-signatures') {
  Write-Host "   Already present - skipping (idempotent)." -ForegroundColor DarkGray
} else {
  $w = $w -replace "(?m)([^\r\n]*save-attorney-signature\.js';[^\r\n]*\r?\n)",
       "`$1import { onRequest as listSignatures }              from './functions/api/list-signatures.js';`r`n"
  $w = $w -replace "(?m)([^\r\n]*'/api/save-attorney-signature'[^\r\n]*\r?\n)",
       "`$1  '/api/list-signatures':                listSignatures,`r`n"
  if ($w -notmatch 'list-signatures') { throw "Could not find the save-attorney-signature anchors in SSL _worker.js - patch by hand." }
  [System.IO.File]::WriteAllText($wpath, $w, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "   + import listSignatures + '/api/list-signatures' route" -ForegroundColor DarkGray
}

# ---- 4. Surgical patch: js/menu.js (rename the signature nav label) --------
Write-Host "`n== [4/5] Patching js/menu.js ('Attorney Signature' -> 'My Signature')..." -ForegroundColor Cyan
$mpath = Join-Path $SSL 'js/menu.js'
$m = [System.IO.File]::ReadAllText($mpath, [System.Text.Encoding]::UTF8)
if ($m -match "route:\s*'settings/signature',\s*name:\s*'My Signature'") {
  Write-Host "   Already renamed - skipping (idempotent)." -ForegroundColor DarkGray
} elseif ($m -match "route:\s*'settings/signature',\s*name:\s*'Attorney Signature'") {
  $m = $m -replace "(route:\s*'settings/signature',\s*name:\s*)'Attorney Signature'", "`$1'My Signature'"
  [System.IO.File]::WriteAllText($mpath, $m, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "   + renamed nav label" -ForegroundColor DarkGray
} else {
  Write-Host "   settings/signature nav line not found as expected - leaving menu.js untouched. Verify by hand." -ForegroundColor Yellow
}

# ---- 5. Install deps + run the test gate -----------------------------------
Set-Location $SSL
Write-Host "`n== [5/5] npm install..." -ForegroundColor Cyan
npm install
Write-Host "`n== npm test..." -ForegroundColor Cyan
npm test
$testExit = $LASTEXITCODE

# ---- Result ----------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Green
if ($testExit -eq 0) {
  Write-Host " SYNC COMPLETE - tests GREEN. Safe to deploy after the steps below." -ForegroundColor Green
} else {
  Write-Host " SYNC DONE, but TESTS FAILED (exit $testExit). Do NOT deploy until green." -ForegroundColor Yellow
}
Write-Host "============================================================`n" -ForegroundColor Green

Write-Host "STEP A - DATABASE: nothing to run. None of the three features has a migration." -ForegroundColor Cyan
Write-Host "  Sanity only (already true on SSL): conflict_checks has additional_names (text[])," -ForegroundColor DarkGray
Write-Host "  outcome, notes, checked_by; the folder tree uses the existing matter_folders table." -ForegroundColor DarkGray

Write-Host "`nSTEP B - ENV: no new variables. (Signatures use the existing R2 binding.)" -ForegroundColor Cyan

Write-Host "`nSTEP C - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nHEADS-UP - detail.js also carries the trust READ-ONLY retainer balance." -ForegroundColor Cyan
Write-Host "  When trust_accounting is enabled it shows a live read-only 'Retainer balance (in trust)'" -ForegroundColor Gray
Write-Host "  and hides the editable field. SSL has trust live, so this activates. It reads the" -ForegroundColor Gray
Write-Host "  matter_trust_balances view + can_read('trust_accounting') RPC (present since the ledger" -ForegroundColor Gray
Write-Host "  works). A blank field just means the viewer lacks trust read permission - expected." -ForegroundColor Gray

Write-Host "`nPOST-DEPLOY DATA/CONFIG (in the portal UI, not code):" -ForegroundColor Cyan
Write-Host "  1. Per-user signatures: the old shared signature (R2 firm/attorney-signature.png) is now" -ForegroundColor Gray
Write-Host "     orphaned. Each attorney/staff re-uploads ONCE via Settings -> My Signature. Grant" -ForegroundColor Gray
Write-Host "     Paralegals the sig_stamp permission if they stamp on their own behalf." -ForegroundColor Gray
Write-Host "  2. File Manager tree: Whitney's custom 'Admin' folder collides with the built-in 'admin'" -ForegroundColor Gray
Write-Host "     folder - hide built-in folders in Settings -> Firm Profile and seed her folder template." -ForegroundColor Gray

Write-Host "`nVERIFY LIVE:" -ForegroundColor Cyan
Write-Host "  1. Conflict Checker: search a name that only appears in a past inquiry (never retained)" -ForegroundColor Gray
Write-Host "     -> a red 'Prior Inquiry' match card appears." -ForegroundColor Gray
Write-Host "  2. File Manager: matter -> Files -> custom folders show as a tree; a subfolder is its own" -ForegroundColor Gray
Write-Host "     clickable row (count + chevron); clicking opens it (own files only)." -ForegroundColor Gray
Write-Host "  3. Signatures: Settings -> My Signature -> upload saves for YOU; the Signature Stamp picker" -ForegroundColor Gray
Write-Host "     lists staff who have uploaded and applies the chosen person's signature." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  (then delete the new functions/api/list-signatures.js, which had no prior version)." -ForegroundColor DarkGray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
