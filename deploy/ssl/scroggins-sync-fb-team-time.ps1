# ============================================================================
#  scroggins-sync-fb-team-time.ps1  -  Port the FreshBooks team-time batch
#  into Scroggins & Savage (SSL). Written 2026-07-14.
#
#  RUN FROM ANY POWERSHELL WINDOW (self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-fb-team-time.ps1
#
#  WHAT IT PORTS (merged to template master, 04e3717):
#    - FreshBooks unbilled-time pull sends team=true: WITHOUT it FreshBooks
#      returns only the OAuth owner's (Anita's) entries, silently hiding all of
#      Whitney/Madison/Naomie's time. Root cause of "no time for Whitney's clients".
#    - Each pulled entry now shows WHO the time is attributed to (identity ->
#      portal user via billing_identity_map).
#    - New Invoice: per-entry dropdown to REASSIGN a pulled entry to a different
#      person; rebills at that person's per-client rate (no-charge stays $0).
#    - Portal-email-less clients (e.g. Philip Hiatt Haigh) now match their
#      FreshBooks record by exact first+last name instead of erroring out.
#
#  *** DATABASE: ALREADY APPLIED LIVE (2026-07-14 via MCP) - nothing to run. ***
#    - billing_rates seeded for Whitney's 11 clients from the signed fee
#      agreements (Anita 500 / Whitney 295-400 / Naomie+Madison 125).
#    - 24 portal client emails backfilled from FreshBooks (blank-only fill).
#    No migrations in this batch.
#
#  *** NO NEW ENV / SECRETS / CRON. ***
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

# This batch's fileset copied WHOLESALE from master. All files pre-exist on the
# clone (no brand-new served files), so overwriting is safe.
$copyFiles = @(
  # Backend
  'functions/api/_adapters/billing/freshbooks.js',
  'functions/api/get-unbilled-time.js',
  # Frontend
  'pages/billing/billing.js',
  # Test coverage
  'test/unit/freshbooks.test.js'
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
$tmpTar = Join-Path $env:TEMP ("ssl-fb-team-time-sync-{0}.tar" -f $PID)
& git -C $TEMPLATE archive -o $tmpTar master -- $copyFiles
if ($LASTEXITCODE -ne 0) { throw "git archive failed (a path may be missing on master)." }
& tar -x -f $tmpTar -C $SSL
if ($LASTEXITCODE -ne 0) { Remove-Item $tmpTar -Force -ErrorAction SilentlyContinue; throw "tar extract failed." }
Remove-Item $tmpTar -Force
foreach ($f in $copyFiles) { Write-Host "   + $f" -ForegroundColor DarkGray }

# ---- 3. Install deps + run the test gate -----------------------------------
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

Write-Host "DATABASE - nothing to run (rates + emails already applied live 2026-07-14)." -ForegroundColor DarkGray
Write-Host "ENV / SECRETS / CRON - nothing new." -ForegroundColor DarkGray

Write-Host "`nSTEP A - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE (Billing -> New Invoice):" -ForegroundColor Cyan
Write-Host "  1. Pick a Whitney matter (e.g. Kelly Benavidez) - unbilled entries appear (14 for Kelly)." -ForegroundColor Gray
Write-Host "  2. Each entry shows the person dropdown (Whitney/Madison on her entries) with real rates (350/125)." -ForegroundColor Gray
Write-Host "  3. Reassign one entry to a different person - amount recalculates; put it back." -ForegroundColor Gray
Write-Host "  4. Pick an Anita matter (e.g. Randy Robbins) - her entries still appear as before." -ForegroundColor Gray
Write-Host "  5. Philip Hiatt Haigh's matter loads entries (or a clean 'no entries') instead of an email error." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
