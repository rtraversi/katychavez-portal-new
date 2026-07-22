# ============================================================================
#  scroggins-sync-billing-increment.ps1  -  Port the billing-increment batch
#  into Scroggins & Savage (SSL). Written 2026-07-14.
#
#  RUN FROM ANY POWERSHELL WINDOW (self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-billing-increment.ps1
#
#  WHAT IT PORTS (merged to template master, 47ce60e):
#    - Billable time now rounds UP to the firm's billing increment when pulled
#      for invoicing. FreshBooks tracks to the minute; SSL bills in 6-minute
#      (0.1 hr) blocks - a 4-minute call bills as 0.1h, a 25-minute draft as 0.5h.
#    - Applies to BOTH FreshBooks-pulled time and manually-entered portal time.
#    - Transparency: rounded entries show the actual tracked time next to the
#      billed hours ("0.1h (4m tracked)") - the biller always sees the
#      adjustment before it reaches an invoice.
#    - Settings > Billing & Payments gains a "Billing increment" selector
#      (Owner-only save). SSL is ALREADY SET to 6 minutes (see below).
#
#  *** DATABASE: ALREADY APPLIED LIVE (2026-07-14 via MCP) - nothing to run. ***
#    - Migration 1530: firm_settings.billing_increment_minutes (default 1).
#    - SSL's firm_settings row set to 6 (verified). Old worker code ignores the
#      column, so the DB change is inert until this code deploys.
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

# This batch's fileset copied WHOLESALE from master. Two files are NEW on the
# clone (_billing-increment.js helper + its test) - tar creates them; the rest
# pre-exist and are safely overwritten.
$copyFiles = @(
  # Backend
  'functions/api/_adapters/billing/freshbooks.js',
  'functions/api/_billing-increment.js',
  'functions/api/get-unbilled-time.js',
  # Frontend
  'pages/billing/billing.js',
  'pages/settings/billing/billing.js',
  'pages/settings/billing/index.html',
  # Test coverage
  'test/unit/billing-increment.test.js',
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
$tmpTar = Join-Path $env:TEMP ("ssl-billing-increment-sync-{0}.tar" -f $PID)
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

Write-Host "DATABASE - nothing to run (migration 1530 + increment=6 already applied live 2026-07-14)." -ForegroundColor DarkGray
Write-Host "ENV / SECRETS / CRON - nothing new." -ForegroundColor DarkGray

Write-Host "`nSTEP A - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE:" -ForegroundColor Cyan
Write-Host "  1. Settings -> Billing & Payments: 'Billing increment' shows '6 minutes (0.1 hr)'." -ForegroundColor Gray
Write-Host "  2. Billing -> New Invoice, pick any matter with short entries: a 4m entry" -ForegroundColor Gray
Write-Host "     shows '0.1h (4m tracked)' and its amount = 0.1 x that person's rate." -ForegroundColor Gray
Write-Host "  3. Entries already on a tenth (12m, 30m, 1h) show plain hours - no '(tracked)' note." -ForegroundColor Gray
Write-Host "  4. Reassign a rounded entry to another person - amount recalcs from the ROUNDED hours." -ForegroundColor Gray
Write-Host "  5. Check dark mode on the Settings page section (token-driven, should just work)." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  DB rollback if ever needed (harmless to leave): UPDATE firm_settings SET billing_increment_minutes = 1;" -ForegroundColor Gray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
