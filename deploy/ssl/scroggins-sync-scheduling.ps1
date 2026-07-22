# ============================================================================
#  scroggins-sync-scheduling.ps1  -  Port the Scheduling module into Scroggins
#  & Savage (SSL). Written 2026-07-13.
#
#  RUN FROM ANY POWERSHELL WINDOW (fully self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-scheduling.ps1
#
#  WHAT IT PORTS (merged to template master @ 9efb39f):
#    The native consult-booking module:
#      - Public /book wizard (attorney-first, Turnstile + rate-limited, race-guarded)
#      - Availability engine + free/busy against connected calendars
#      - Staff Settings -> Scheduling + the Appointments page + row actions
#      - Consult reminder emails (piggyback the existing */5 cron)
#      - /book branding (logo/color), public_bookable flag, private booking links
#      - The Appointments DASHBOARD TILE (upcoming-count) on the home page
#
#  Several files (_worker.js, js/menu.js, modules/registry.js, the client-detail
#  pages, and shared helpers) carry BOTH billing and scheduling now - this copies
#  the current reconciled master versions, so it's safe over the earlier billing
#  sync (idempotent, byte-faithful).
#
#  *** NO DATABASE STEP. *** Migrations 1010-1013 are ALREADY APPLIED to SSL's
#  Supabase (via MCP), the scheduling module is ALREADY ENABLED (enabled_modules),
#  and the 3 consult types are seeded. The .sql files are copied for history only
#  - DO NOT re-run them.
#
#  *** NO NEW ENV / SECRETS / CRON. *** Turnstile, calendar OAuth, and email are
#  already configured; the reminder job rides the existing "*/5 * * * *" cron that
#  SSL's wrangler.toml already fires. Scheduling adds no build-config keys, so no
#  config rebuild is needed either.
#
#  ROLLBACK: SSL is NOT a git repo, so this takes a FILESYSTEM backup of every
#  file it touches into  _pre-sync-backup-<timestamp>\  BEFORE overwriting. The
#  restore command is printed at the end. The LIVE worker is untouched until you
#  deploy, so the deployed site is always the ultimate fallback.
#
#  HOW IT SOURCES FILES: byte-faithful from the template's *master* ref via
#  `git archive` -> tar (NOT the working tree). It copies ONLY module files and
#  NEVER touches SSL's per-client files (wrangler.toml, js/config.js, branding,
#  .env). It does NOT deploy.
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

# The scheduling module fileset, copied WHOLESALE from master.
$copyFiles = @(
  # Route + nav + registry (full-file; carry billing + scheduling together)
  '_worker.js',
  'js/menu.js',
  'modules/registry.js',
  # Public booking page + client script
  'book.html',
  'js/book.js',
  # Booking APIs + shared helpers
  'functions/api/booking-public.js',
  'functions/api/booking-staff.js',
  'functions/api/intake-public-submit.js',
  'functions/api/_booking-helpers.js',
  'functions/api/_booking-reminders.js',
  'functions/api/_calendar-helpers.js',
  'functions/api/_notifications.js',
  'functions/api/_helpers.js',
  'functions/api/_schemas.js',
  # Staff Appointments page + Settings -> Scheduling
  'pages/scheduling/index.html',
  'pages/scheduling/scheduling.js',
  'pages/settings/scheduling/index.html',
  'pages/settings/scheduling/scheduling.js',
  # Home tile + client-detail (Appointments tile lives in registry; these updated too)
  'pages/home/home.js',
  'pages/clients/detail/detail.js',
  'pages/clients/detail/index.html',
  # Migrations (already applied to Supabase; copied for history only)
  'supabase/migrations/1010_scheduling_module.sql',
  'supabase/migrations/1011_scheduling_race_guard.sql',
  'supabase/migrations/1012_scheduling_public_bookable_branding.sql',
  'supabase/migrations/1013_scheduling_booking_offers.sql',
  # Test coverage + env docs
  'test/unit/booking.test.js',
  'test/unit/schemas.test.js',
  'wrangler.toml.example'
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
Write-Host "   Backed up $backedUp existing files (brand-new files are skipped)." -ForegroundColor DarkGray

# ---- 2. Copy the fileset (byte-faithful, master ref) -----------------------
Write-Host "`n== [2/4] Exporting $($copyFiles.Count) files from template master..." -ForegroundColor Cyan
$tmpTar = Join-Path $env:TEMP ("ssl-scheduling-sync-{0}.tar" -f $PID)
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
  Write-Host " SYNC COMPLETE - tests GREEN. Deploy with the step below." -ForegroundColor Green
} else {
  Write-Host " SYNC DONE, but TESTS FAILED (exit $testExit). Do NOT deploy until green." -ForegroundColor Yellow
}
Write-Host "============================================================`n" -ForegroundColor Green

Write-Host "DATABASE - nothing to run. Migrations 1010-1013 applied, module ENABLED," -ForegroundColor DarkGray
Write-Host "  and the 3 consult types are seeded on Supabase xdzgkagyfiauyfxbbdxv." -ForegroundColor DarkGray
Write-Host "ENV / CRON - no new vars/secrets; reminders ride the existing */5 cron." -ForegroundColor DarkGray

Write-Host "`nDEPLOY (SSL's normal deploy - no build-config needed, no new config keys):" -ForegroundColor Cyan
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nCONFIGURE (in the portal UI, as Anita/Owner) - REQUIRED before /book works:" -ForegroundColor Cyan
Write-Host "  Settings -> Scheduling:" -ForegroundColor Gray
Write-Host "   1. Make Anita (and any bookable attorney) a booking provider - sets her" -ForegroundColor Gray
Write-Host "      public display name + slug + 'is bookable'." -ForegroundColor Gray
Write-Host "   2. Set her availability (working hours) - without it, /book shows no slots." -ForegroundColor Gray
Write-Host "   3. Attach consult types to her (which of Free / Initial / Special-Rate she offers)." -ForegroundColor Gray
Write-Host "   4. Confirm her calendar is connected (Settings -> Calendar Sync) so free/busy" -ForegroundColor Gray
Write-Host "      is honored and booked events land on her calendar." -ForegroundColor Gray

Write-Host "`nVERIFY LIVE:" -ForegroundColor Cyan
Write-Host "  1. Dashboard shows the APPOINTMENTS tile (upcoming count / 'APPOINTMENTS ->')." -ForegroundColor Gray
Write-Host "  2. Settings -> Scheduling loads; Appointments page loads." -ForegroundColor Gray
Write-Host "  3. Public /book -> pick Anita -> Initial Consultation -> a real slot -> book." -ForegroundColor Gray
Write-Host "     Confirm: appointment appears on the Appointments page + on her calendar," -ForegroundColor Gray
Write-Host "     and the confirmation email sends (SSL has real email; sandbox never did)." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  (brand-new booking files had no prior version; delete them to fully revert.)" -ForegroundColor DarkGray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
