# ============================================================================
#  scroggins-sync-retainer-pill.ps1  -  Port the retainer-requested pill +
#  updated Billing/Trust help guide into Scroggins & Savage (SSL).
#  Written 2026-07-14.
#
#  RUN FROM ANY POWERSHELL WINDOW (self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-retainer-pill.ps1
#
#  WHAT IT PORTS (merged to template master, 5b9fc63 + 85d1909):
#    1. RETAINER-REQUESTED PILL - the Clients list shows an amber
#       "(hourglass) $X requested" tag when a client has a pending retainer
#       request (link sent, not paid). Clears automatically when the Payload
#       webhook posts the payment. SSL has 10 pending requests today, so the
#       pill shows immediately.
#    2. HELP GUIDE REFRESH - "Billing, Invoicing & Trust Accounting" guide
#       updated for the pre-billing review batch: rates on the client card,
#       Pending review staging + draft editing, manual Add Time Entry,
#       FreshBooks emails w/ PDF, client-portal Invoices card, retainer pill.
#
#  *** DATABASE: migration 1903 (client_contacts RLS -> 'core') was ALREADY
#      APPLIED to SSL Supabase via MCP on 2026-07-14 and verified. That fix is
#      LIVE regardless of this sync ("Add person" already works). NOTHING TO
#      RUN. ***
#  *** NO NEW ENV / SECRETS / CRON. NO TEST CHANGES. ***
#
#  ROLLBACK: SSL is NOT a git repo, so this takes a FILESYSTEM backup of every
#  file it touches into  _pre-sync-backup-<timestamp>\  BEFORE overwriting. The
#  restore command is printed at the end. The LIVE worker is untouched until you
#  deploy, so the deployed site is always the ultimate fallback.
#
#  HOW IT SOURCES FILES: byte-faithful from the template's *master* ref via
#  `git archive` -> tar (NOT the working tree) - LF + UTF-8 intact.
#
#  It copies ONLY this batch's files. It NEVER touches SSL's per-client files
#  (wrangler.toml, js/config.js, branding assets, .env). It does NOT deploy.
#
#  Targets:  Supabase xdzgkagyfiauyfxbbdxv | R2 savagelaw-portal-prod | Worker savagelaw-v2
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

# This batch's fileset copied WHOLESALE from master.
$copyFiles = @(
  'pages/clients/clients.js',          # retainer-requested pill
  'help/guides/billing-trust.html'     # updated help guide
)

# ---- 1. Filesystem backup of every file we will touch ----------------------
$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $SSL "_pre-sync-backup-$stamp"
Write-Host "`n== [1/4] Backing up files to $backupDir ..." -ForegroundColor Cyan
$backedUp = 0
foreach ($rel in $copyFiles) {
  $src = Join-Path $SSL $rel
  if (Test-Path $src) {
    $dst    = Join-Path $backupDir $rel
    $dstDir = Split-Path $dst -Parent
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Copy-Item -Path $src -Destination $dst -Force
    $backedUp++
  }
}
Write-Host "   Backed up $backedUp existing files." -ForegroundColor DarkGray

# ---- 2. Copy the fileset (byte-faithful, master ref) -----------------------
Write-Host "`n== [2/4] Exporting $($copyFiles.Count) files from template master..." -ForegroundColor Cyan
$tmpTar = Join-Path $env:TEMP ("ssl-retainer-pill-sync-{0}.tar" -f $PID)
& git -C $TEMPLATE archive -o $tmpTar master -- $copyFiles
if ($LASTEXITCODE -ne 0) { throw "git archive failed (a path may be missing on master)." }
& tar -x -f $tmpTar -C $SSL
if ($LASTEXITCODE -ne 0) { Remove-Item $tmpTar -Force -ErrorAction SilentlyContinue; throw "tar extract failed." }
Remove-Item $tmpTar -Force
foreach ($f in $copyFiles) { Write-Host "   + $f" -ForegroundColor DarkGray }

# ---- 3. Run the test gate (frontend-only change, but the gate stays) -------
Set-Location $SSL
Write-Host "`n== [3/4] npm install..." -ForegroundColor Cyan
npm install
Write-Host "`n== [4/4] npm test..." -ForegroundColor Cyan
npm test
$testExit = $LASTEXITCODE

# ---- Result ----------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Green
if ($testExit -eq 0) {
  Write-Host " SYNC COMPLETE - tests GREEN." -ForegroundColor Green
} else {
  Write-Host " SYNC DONE, but TESTS FAILED (exit $testExit). Do NOT deploy until green." -ForegroundColor Yellow
}
Write-Host "============================================================`n" -ForegroundColor Green

Write-Host "DATABASE - nothing to run (migration 1903 already applied via MCP + verified)." -ForegroundColor DarkGray
Write-Host "ENV / SECRETS / CRON - nothing new." -ForegroundColor DarkGray

Write-Host "`nSTEP A - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE (hard refresh Ctrl+Shift+R first):" -ForegroundColor Cyan
Write-Host "  1. Clients list: amber 'requested' pills appear - SSL has 10 pending" -ForegroundColor Gray
Write-Host "     retainer requests today, so several rows should show one immediately." -ForegroundColor Gray
Write-Host "  2. A client WITH trust funds still shows the green 'on hand' tag; the two" -ForegroundColor Gray
Write-Host "     tags can coexist on one row." -ForegroundColor Gray
Write-Host "  3. Clients -> any client -> Client tab -> Other People -> Add person now" -ForegroundColor Gray
Write-Host "     saves (RLS fix was DB-side; this just confirms it)." -ForegroundColor Gray
Write-Host "  4. Help drawer -> Billing, Invoicing & Trust Accounting: guide shows the" -ForegroundColor Gray
Write-Host "     new sections (Step 2.5 Pending review, rates on client card, FB email)." -ForegroundColor Gray
Write-Host "  5. Light AND dark on the clients list." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
