# ============================================================================
#  scroggins-sync-fb-dedupe.ps1  -  Port the FB billed-time dedupe (1533)
#  into Scroggins & Savage (SSL). Written 2026-07-16, MID-BILLING-RUN.
#
#  RUN FROM ANY POWERSHELL WINDOW (self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-fb-dedupe.ps1
#
#  WHAT IT PORTS (merged to template master, e5c4dff):
#    FB-PULLED TIME CAN NO LONGER BE BILLED TWICE. FreshBooks never learns its
#    entries were invoiced here, so already-invoiced time kept re-appearing in
#    the unbilled list (that's how Gracie Everitt got two identical $80 drafts,
#    INV-0035/0040). Now:
#      1. Line items store the FB entry id (external_entry_id, migration 1533).
#      2. The unbilled list hides entries already on a draft/sent invoice.
#         VOIDING an invoice (or removing a line from a draft) frees its
#         entries again - void of FB time now genuinely works.
#      3. Creating/editing an invoice REJECTS entries that are already on a
#         live invoice (protects against stale browser tabs).
#      4. New Invoice shows a warning when the matter already has a draft/sent
#         invoice, so a same-period redo can't slip through unnoticed.
#
#  *** DATABASE: migration 1533 (invoice_line_items.external_entry_id) must be
#      applied to SSL Supabase BEFORE deploying - Claude applies it via MCP
#      and verifies; confirm that happened, or run
#      supabase/migrations/1533_line_item_external_entry.sql by hand. ***
#  *** NO NEW ENV / SECRETS / CRON. ***
#
#  BACKFILL NOTE: invoices sent BEFORE this deploy have no external_entry_id,
#  so their FB entries are still re-pullable. After the July run, staff should
#  bulk "mark as billed" the July time inside FreshBooks (FB UI supports this),
#  or just keep to one-invoice-per-client until August.
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

# This batch's fileset copied WHOLESALE from master. NEW files are created by
# tar; existing ones are overwritten after backup.
$copyFiles = @(
  # Dedupe core
  'functions/api/_external-entry.js',           # NEW - shared id check + consumed lookup
  'functions/api/create-invoice.js',
  'functions/api/update-draft-invoice.js',
  'functions/api/get-unbilled-time.js',
  # Billing UI (duplicate-invoice warning banner)
  'pages/billing/billing.js',
  'pages/billing/index.html',
  # Tests ride along so SSL's gate covers the new behavior
  'test/unit/external-entry-dedupe.test.js',    # NEW
  'test/unit/billing-review.test.js',
  'test/unit/create-invoice.test.js'
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
$tmpTar = Join-Path $env:TEMP ("ssl-fb-dedupe-sync-{0}.tar" -f $PID)
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

Write-Host "DATABASE - migration 1533 MUST be applied to SSL Supabase BEFORE deploy" -ForegroundColor Yellow
Write-Host "  (additive column; Claude applies via MCP and verifies - confirm it happened)." -ForegroundColor Yellow
Write-Host "ENV / SECRETS / CRON - nothing new." -ForegroundColor DarkGray

Write-Host "`nSTEP A - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray
Write-Host "  (This deploy also carries the retainer pill, SSL logos and help guide" -ForegroundColor Gray
Write-Host "   already synced into the clone on 7/15.)" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE (mid-billing-run checklist):" -ForegroundColor Cyan
Write-Host "  1. Hard-refresh (Ctrl+F5) - stale menu.js cache bit staff last time." -ForegroundColor Gray
Write-Host "  2. New Invoice -> pick a client who ALREADY has a draft (e.g. one of" -ForegroundColor Gray
Write-Host "     last night's INV-0043..0057): amber 'Existing invoice' banner shows," -ForegroundColor Gray
Write-Host "     and the unbilled list NO LONGER offers the time already on that draft." -ForegroundColor Gray
Write-Host "  3. Void a TEST invoice -> its FB entries reappear in the unbilled list." -ForegroundColor Gray
Write-Host "  4. Everitt cleanup: void INV-0035 or INV-0040 (identical $80 drafts)." -ForegroundColor Gray
Write-Host "  5. Check LIGHT and DARK on the New Invoice banner." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
