# ============================================================================
#  scroggins-sync-billing-review.ps1  -  Port the pre-billing review batch
#  into Scroggins & Savage (SSL). Written 2026-07-14. THEY BILL TOMORROW.
#
#  RUN FROM ANY POWERSHELL WINDOW (self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-billing-review.ps1
#
#  WHAT IT PORTS (merged to template master, 88f8379):
#    1. REVIEW PENDING INVOICES - Billing's Draft tab is now "Pending review"
#       with a count. Draft invoices are editable: change description/due date,
#       remove lines (the time/expense goes back to unbilled), add lines from
#       unbilled time/expenses, or log a quick manual entry right there.
#    2. ADD TIME ENTRY - "+ Add time entry" on New Invoice: description, who,
#       MINUTES, date, optional no-charge. Prices from the per-client rates,
#       rounds up to the 6-min increment, shows in the unbilled list.
#    3. BILLING RATES ON THE CLIENT CARD - Clients > client > Financial now has
#       the full rates + admin-fee editor. Settings > Billing Rates removed
#       from the nav (the old URL still works).
#    4. FRESHBOOKS EMAILS FOR REAL - sending an invoice now triggers a real
#       FreshBooks email to the client with the invoice PDF ATTACHED and the
#       Payload link in the notes. (Before, the invoice was only marked "sent"
#       in FB - FreshBooks never emailed anyone unless someone did it by hand.)
#    5. CLIENT PORTAL INVOICES - clients see their sent/paid invoices on the
#       Overview tab: Pay now (Payload link) + PDF (print-styled invoice,
#       browser Save-as-PDF).
#
#  *** DATABASE: migration 1532 (invoice_line_items.expense_id) was ALREADY
#      APPLIED to SSL Supabase via MCP on 2026-07-14 and verified.
#      NOTHING TO RUN. ***
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

# This batch's fileset copied WHOLESALE from master. NEW files are created by
# tar; existing ones are overwritten after backup.
$copyFiles = @(
  # Worker routes + endpoints
  '_worker.js',
  'functions/api/add-time-entry.js',            # NEW
  'functions/api/update-draft-invoice.js',      # NEW
  'functions/api/client-invoices.js',           # NEW
  'functions/api/get-unbilled-time.js',
  'functions/api/create-invoice.js',
  'functions/api/send-invoice.js',
  'functions/api/resend-invoice.js',
  'functions/api/void-invoice.js',              # 2026-07-15 hotfix: void releases expenses
  'functions/api/_adapters/billing/freshbooks.js', # 2026-07-15 hotfixes: create_date + qty
  'test/unit/void-invoice.test.js',             # NEW (rides with the void hotfix)
  # Billing UI (review + add time + no-charge render)
  'pages/billing/billing.js',
  'pages/billing/index.html',
  # Rates on the client card
  'pages/clients/detail/detail.js',
  'pages/clients/detail/index.html',
  'js/menu.js',
  # Client portal invoices
  'pages/client-portal/client-portal.js',
  'pages/client-portal/index.html',
  # Tests ride along so SSL's gate covers the new endpoints
  'test/unit/billing-review.test.js',           # NEW
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
$tmpTar = Join-Path $env:TEMP ("ssl-billing-review-sync-{0}.tar" -f $PID)
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

Write-Host "DATABASE - nothing to run (migration 1532 already applied via MCP + verified)." -ForegroundColor DarkGray
Write-Host "ENV / SECRETS / CRON - nothing new." -ForegroundColor DarkGray

Write-Host "`nSTEP A - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE (the billing-tomorrow checklist):" -ForegroundColor Cyan
Write-Host "  1. Billing: tab now reads 'Pending review (N)'. Open a draft ->" -ForegroundColor Gray
Write-Host "     Edit Details strip, X on each line, '+ Add items' all present." -ForegroundColor Gray
Write-Host "  2. New Invoice -> pick a matter -> '+ Add time entry': add a 7-min entry" -ForegroundColor Gray
Write-Host "     -> appears as 0.2h (7m tracked) at that person's client rate, pre-checked." -ForegroundColor Gray
Write-Host "  3. Clients -> any client -> Financial: 'Billing Rates & Admin Fee' section" -ForegroundColor Gray
Write-Host "     shows the seeded rates; save works; hero chips refresh." -ForegroundColor Gray
Write-Host "     Settings no longer lists Billing Rates." -ForegroundColor Gray
Write-Host "  4. EMAIL SMOKE TEST (IMPORTANT - first real FB email): send a small real" -ForegroundColor Gray
Write-Host "     invoice to a firm-controlled email (or Anita) BEFORE tomorrow's run." -ForegroundColor Gray
Write-Host "     Expect a FreshBooks email with PDF attached + 'Pay online:' Payload link" -ForegroundColor Gray
Write-Host "     in the notes. Void/refund after if it was a test." -ForegroundColor Gray
Write-Host "  5. Log in as a test CLIENT: Overview shows the Invoices card with Pay now" -ForegroundColor Gray
Write-Host "     + PDF (print dialog -> Save as PDF)." -ForegroundColor Gray
Write-Host "  6. Check LIGHT and DARK on the new billing surfaces." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  Or simply do not deploy - the live worker still runs the pre-sync code.`n" -ForegroundColor DarkGray
