# ============================================================================
#  scroggins-sync-billing-fixes.ps1  -  Port the "billing fixes" batch
#  (Anita/Whitney list) into Scroggins & Savage (SSL). Written 2026-07-13.
#
#  RUN FROM ANY POWERSHELL WINDOW (self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-billing-fixes.ps1
#
#  WHAT IT PORTS (merged to template master):
#    - Retainer-balance field reads the live ledger balance.
#    - Invoice line-item detail (billing fallback + client-card trust view).
#    - "Admin Fee" expense category.
#    - FreshBooks: unbillable "No charge", first+last NAME fallback client match,
#      pagination (no longer stops at the first ~15 entries).
#    - Admin-fee auto-billing OFF by default.
#    - Open-amount retainer links (client enters the amount at checkout).
#    - "Other People" (guarantors) + retainer recipient picker.
#    - Recent Payments home widget.
#    - Refreshed billing/trust help guide.
#
#  *** THIS BATCH HAS A DATABASE STEP. ***  Apply BEFORE deploying (see
#  BILLING-FIXES-DEPLOY-SSL.md, Step 1):
#      1527_expense_admin_fee_category.sql
#      1528_recurring_charge_optin.sql
#      1529_open_amount_retainers.sql     (replaces process_retainer_payment)
#      1902_client_contacts.sql
#    + Step 1b remediation:
#      UPDATE public.recurring_charges SET active = false WHERE charge_type = 'admin_fee';
#    The .sql files are copied to the clone for history only - apply them to
#    Supabase xdzgkagyfiauyfxbbdxv via MCP / SQL editor, do NOT expect the clone
#    to run them.
#
#  *** NO NEW ENV / SECRETS / CRON. ***  The Payload webhook stays as-is.
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
# clone (this batch adds no brand-new served files), so overwriting is safe.
$copyFiles = @(
  # Backend
  'functions/api/_adapters/billing/freshbooks.js',
  'functions/api/_adapters/payment/payload.js',
  'functions/api/_notifications.js',
  'functions/api/create-invoice.js',
  'functions/api/get-unbilled-time.js',
  'functions/api/invoice-payment-webhook.js',
  'functions/api/request-retainer.js',
  # Frontend
  'pages/billing/billing.js',
  'pages/billing/index.html',
  'pages/clients/detail/detail.js',
  'pages/clients/detail/index.html',
  'pages/home/home.js',
  'pages/home/index.html',
  # Help guide
  'help/guides/billing-trust.html',
  # Migrations (apply via MCP; copied for history only)
  'supabase/migrations/1527_expense_admin_fee_category.sql',
  'supabase/migrations/1528_recurring_charge_optin.sql',
  'supabase/migrations/1529_open_amount_retainers.sql',
  'supabase/migrations/1902_client_contacts.sql',
  # Test coverage
  'test/unit/freshbooks.test.js',
  'test/unit/retainer.test.js'
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
$tmpTar = Join-Path $env:TEMP ("ssl-billing-fixes-sync-{0}.tar" -f $PID)
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

Write-Host "DATABASE - REQUIRED before deploy (Supabase xdzgkagyfiauyfxbbdxv):" -ForegroundColor Yellow
Write-Host "  Apply 1527, 1528, 1529, 1902 via MCP / SQL editor, then run:" -ForegroundColor Gray
Write-Host "    UPDATE public.recurring_charges SET active = false WHERE charge_type = 'admin_fee';" -ForegroundColor Gray
Write-Host "  Full detail + verification: BILLING-FIXES-DEPLOY-SSL.md" -ForegroundColor Gray

Write-Host "`nENV / SECRETS / CRON - nothing new. Payload webhook stays as-is." -ForegroundColor DarkGray

Write-Host "`nSTEP A - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE - see Step 4 in BILLING-FIXES-DEPLOY-SSL.md (9 checks)." -ForegroundColor Cyan

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
