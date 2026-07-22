# ============================================================================
#  scroggins-sync-billing.ps1  -  Port the FULL billing stack into Scroggins &
#  Savage (SSL). Written 2026-07-13.
#
#  RUN FROM ANY POWERSHELL WINDOW (fully self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-billing.ps1
#
#  WHAT IT PORTS (merged to template master @ 6633303):
#    The complete billing surface in ONE pass, bringing the clone fully current:
#      1. FreshBooks OAuth 2.0 connect + reworked adapter (now resolves each
#         time entry's rate by identity_id -> per-client rate).
#      2. Per-client per-person RATE ENGINE (_billing-rates.js resolver +
#         billing-rates API + Settings -> Billing Rates UI).
#      3. Monthly admin-fee CRON (process-recurring-charges.js -> ONE draft
#         invoice/client/month) + the recurring_charges / expenses primitives.
#      4. Grouped left-sidebar settings sub-nav (css/portal.css + js/menu.js).
#
#  WHY RE-PORT THE FRESHBOOKS FILES: an earlier freshbooks-sync.ps1 run put a
#  PARTIAL version on the clone. This re-copies the CURRENT versions, which carry
#  the client-scoping fix (a38f7e7) and the freshbooks-debug strip. Overwriting
#  with byte-faithful master copies is idempotent and safe.
#
#  *** NO DATABASE STEP. *** Migrations 1523/1524/1525 are ALREADY APPLIED to
#  SSL's Supabase (via MCP), and the rates + admin fees are ALREADY SEEDED
#  (21 clients / 78 rate rows + 20 admin fees, 2026-07-13). The .sql files are
#  copied only to keep the clone's migration history complete - DO NOT re-run.
#
#  *** NO NEW ENV / SECRETS. *** The rate engine + cron add none; FreshBooks's
#  vars/secret are already live on the worker (FreshBooks is connected).
#
#  ROLLBACK: SSL is NOT a git repo, so this script takes a FILESYSTEM backup of
#  every file it touches into  _pre-sync-backup-<timestamp>\  BEFORE overwriting.
#  The exact restore command is printed at the end. The LIVE worker is untouched
#  until you deploy, so the deployed site is always the ultimate fallback.
#
#  HOW IT SOURCES FILES: byte-faithful from the template's *master* ref via
#  `git archive` -> tar (NOT the working tree) - LF + UTF-8 intact, immune to
#  whatever branch the template happens to be on.
#
#  It copies ONLY billing files. It NEVER touches SSL's per-client files
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

# The complete billing fileset copied WHOLESALE from master. _worker.js and
# js/menu.js are full-file copies (template-tracked - no per-client edits).
$copyFiles = @(
  # Route + nav wiring (full-file; carries the debug-route removal)
  '_worker.js',
  'js/menu.js',
  # Grouped settings sub-nav styles
  'css/portal.css',
  # Adapters
  'functions/api/_adapters/billing/freshbooks.js',
  'functions/api/_adapters/payment/payload.js',
  # Rate engine
  'functions/api/_billing-rates.js',
  'functions/api/billing-rates.js',
  'functions/api/get-unbilled-time.js',
  # Recurring-charge cron
  'functions/api/process-recurring-charges.js',
  # FreshBooks OAuth routes
  'functions/api/freshbooks-oauth-url.js',
  'functions/api/freshbooks-oauth-callback.js',
  'functions/api/freshbooks-status.js',
  'functions/api/freshbooks-disconnect.js',
  # Settings UI
  'pages/settings/billing/index.html',
  'pages/settings/billing/billing.js',
  'pages/settings/rates/index.html',
  'pages/settings/rates/rates.js',
  # Migrations (already applied to Supabase; copied for history only)
  'supabase/migrations/1523_freshbooks_oauth.sql',
  'supabase/migrations/1524_billing_rates.sql',
  'supabase/migrations/1525_recurring_charges_expenses.sql',
  # Test coverage + env docs
  'test/integration/worker.test.js',
  'test/unit/retainer.test.js',
  'test/unit/billing-rates.test.js',
  'test/unit/freshbooks.test.js',
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
$tmpTar = Join-Path $env:TEMP ("ssl-billing-sync-{0}.tar" -f $PID)
# git writes the tar straight to disk; tar reads it straight from disk. No
# PowerShell pipe between them => no text re-encoding, LF + UTF-8 intact.
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
  Write-Host " SYNC COMPLETE - tests GREEN. Do STEP A, then deploy." -ForegroundColor Green
} else {
  Write-Host " SYNC DONE, but TESTS FAILED (exit $testExit). Do NOT deploy until green." -ForegroundColor Yellow
}
Write-Host "============================================================`n" -ForegroundColor Green

Write-Host "DATABASE - nothing to run. Migrations 1523/1524/1525 are already applied to" -ForegroundColor DarkGray
Write-Host "  Supabase xdzgkagyfiauyfxbbdxv, and rates + admin fees are already seeded." -ForegroundColor DarkGray

Write-Host "`nENV - no new variables or secrets. FreshBooks's vars/secret are already live." -ForegroundColor DarkGray

Write-Host "`nCRON - the admin-fee job piggybacks on the EXISTING daily cron via _worker.js" -ForegroundColor Cyan
Write-Host "  scheduled(). Confirm SSL's wrangler.toml has a daily [triggers] crons entry" -ForegroundColor Gray
Write-Host "  (e.g. `"0 14 * * *`"); if it fires other crons already, nothing to add." -ForegroundColor Gray

Write-Host "`nSTEP A - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE (as Anita / Owner):" -ForegroundColor Cyan
Write-Host "  1. Settings -> Billing Rates loads; pick a client (e.g. Lusk) -> seeded rates pre-fill;" -ForegroundColor Gray
Write-Host "     the admin-fee box shows checked / `$100." -ForegroundColor Gray
Write-Host "  2. Open a matter whose client has FreshBooks time -> unbilled time shows NON-ZERO" -ForegroundColor Gray
Write-Host "     amounts (hours x the seeded rate), not `$0." -ForegroundColor Gray
Write-Host "  3. (Optional) Trigger the daily cron -> each fee client gets ONE draft admin-fee" -ForegroundColor Gray
Write-Host "     invoice; re-running the same month creates NO duplicate." -ForegroundColor Gray
Write-Host "  4. Anita's UI test: she adds Tomer Alpert + splits the O'Connors into two clients" -ForegroundColor Gray
Write-Host "     and sets their rates via Settings -> Billing Rates." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  (brand-new files - _billing-rates.js, billing-rates.js, process-recurring-charges.js," -ForegroundColor DarkGray
Write-Host "   pages/settings/rates/* - had no prior version; delete them to fully revert.)" -ForegroundColor DarkGray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
