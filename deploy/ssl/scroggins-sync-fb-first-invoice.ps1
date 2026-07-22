# ============================================================================
#  scroggins-sync-fb-first-invoice.ps1  -  Port the FreshBooks-first invoice
#  flow into Scroggins & Savage (SSL). Written 2026-07-17.
#
#  RUN FROM ANY POWERSHELL WINDOW (self-contained, cd's to SSL):
#      C:\Sites\iurisiq-portal-template\scroggins-sync-fb-first-invoice.ps1
#
#  WHAT IT PORTS (merged to template master, 624e220):
#    THE NEW BILLING WORKFLOW - Anita composes invoices in FreshBooks and
#    leaves them as DRAFTS; the portal does the rest:
#    - Billing > "From FreshBooks": lists FB drafts + unpaid invoices (drafts
#      get a Draft badge). Pick a matter, click "Attach pay link & send" ->
#      portal mirrors the invoice, creates the Payload TRUST pay-link, writes
#      the link into FB notes, has FRESHBOOKS email the client (PDF attached),
#      and best-effort stores the FB PDF in the matter's Files.
#    - IMPORTANT PROCESS CHANGE: staff must NOT use FreshBooks' own Send
#      button - it would email the client with NO pay link. Compose -> leave
#      as draft -> send from the portal.
#    - Retainer paid -> EVERY active staff user gets an individual email
#      (client/matter/amount) from the payment webhook. While the new
#      "Retainer prepayments" toggle is OFF (default), that email also
#      reminds staff to record the retainer in FB as a PREPAYMENT CREDIT
#      (Credits > New Credit > Prepayment) - NOT as an invoice.
#    - Settings > Billing & Payments gains a "Retainer prepayments" section:
#      auto-record retainers in FB as Prepayment credits. LEAVE OFF until the
#      FB credit mechanism is verified live (it is untested against real FB).
#
#  *** DATABASE: TWO MIGRATIONS MUST BE APPLIED to SSL Supabase (see STEP A
#      printed at the end - the template-side MCP no longer has SSL access,
#      so run them from the SSL-rooted window or the Supabase SQL editor).
#      Both are additive + idempotent; inert until this code deploys. ***
#
#  *** NO NEW ENV / SECRETS / CRON. *** (Uses existing FreshBooks OAuth,
#      Payload, and Resend config already live on SSL.)
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

# This batch's fileset copied WHOLESALE from master. New on the clone:
# fb-unpaid-invoices.js, mirror-fb-invoice.js, the two migrations, and three
# test files - tar creates them; the rest pre-exist and are safely overwritten.
$copyFiles = @(
  # Route table - registers /api/fb-unpaid-invoices + /api/mirror-fb-invoice
  # (these were missing on both master and SSL; without this the FB panel 404s)
  '_worker.js',
  # Backend
  'functions/api/_adapters/billing/freshbooks.js',
  'functions/api/_notifications.js',
  'functions/api/invoice-payment-webhook.js',
  'functions/api/fb-unpaid-invoices.js',
  'functions/api/mirror-fb-invoice.js',
  # Frontend
  'pages/billing/billing.js',
  'pages/billing/index.html',
  'pages/settings/billing/billing.js',
  'pages/settings/billing/index.html',
  # Help guide (Billing/Trust guide rewritten around the FB-first flow)
  'help/guides/billing-trust.html',
  'js/help-guides.js',
  # Migrations (files for the record; APPLY them per STEP A below)
  'supabase/migrations/1534_fb_first_invoice.sql',
  'supabase/migrations/1535_fb_prepayment_toggle.sql',
  # Test coverage
  'test/unit/fb-unpaid-invoices.test.js',
  'test/unit/freshbooks-invoices.test.js',
  'test/unit/mirror-fb-invoice.test.js'
)

# Guard: SSL's migrations dir must not already have DIFFERENT 1534/1535 files
# (SSL numbering historically diverged in the 1200 range; the fresh clone
# tracks template numbering, but verify rather than assume).
foreach ($m in @('supabase\migrations\1534_*.sql', 'supabase\migrations\1535_*.sql')) {
  $hit = Get-ChildItem (Join-Path $SSL $m) -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -notin @('1534_fb_first_invoice.sql', '1535_fb_prepayment_toggle.sql') }
  if ($hit) { throw "SSL already has a different migration numbered like $($hit.Name) - resolve numbering before syncing." }
}

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
$tmpTar = Join-Path $env:TEMP ("ssl-fb-first-sync-{0}.tar" -f $PID)
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

Write-Host "STEP A - DATABASE (do BEFORE deploying; additive + idempotent, inert" -ForegroundColor Cyan
Write-Host "until the new worker code ships). Template MCP has no SSL access, so run" -ForegroundColor Cyan
Write-Host "these from the SSL window's Supabase MCP or the SQL editor (xdzgkagyfiauyfxbbdxv):" -ForegroundColor Cyan
Write-Host "  1. supabase\migrations\1534_fb_first_invoice.sql    (documents/document_versions" -ForegroundColor Gray
Write-Host "     source CHECK gains 'freshbooks'; invoices.pdf_document_id added)" -ForegroundColor Gray
Write-Host "  2. supabase\migrations\1535_fb_prepayment_toggle.sql (firm_settings.fb_auto_prepayment," -ForegroundColor Gray
Write-Host "     default false = auto-record OFF)" -ForegroundColor Gray
Write-Host "  Verify both:" -ForegroundColor Gray
Write-Host "    SELECT column_name FROM information_schema.columns" -ForegroundColor Gray
Write-Host "     WHERE (table_name='invoices' AND column_name='pdf_document_id')" -ForegroundColor Gray
Write-Host "        OR (table_name='firm_settings' AND column_name='fb_auto_prepayment');  -- expect 2 rows" -ForegroundColor Gray

Write-Host "`nSTEP B - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy            (uses SSL's wrangler.toml -> savagelaw-v2)" -ForegroundColor Gray

Write-Host "`nSTEP C - LIVE TEST WITH NAOMIE (safe order; use a TEST client whose email" -ForegroundColor Cyan
Write-Host "in BOTH the portal and FreshBooks is a firm-controlled inbox - the send" -ForegroundColor Cyan
Write-Host "step emails the invoice to whatever address FB/portal has on file):" -ForegroundColor Cyan
Write-Host "  1. Settings > Billing & Payments: FreshBooks 'Connected'; new 'Retainer" -ForegroundColor Gray
Write-Host "     prepayments' section shows OFF. Leave it off." -ForegroundColor Gray
Write-Host "  2. In FreshBooks: create a small invoice (e.g. `$1) for the test client." -ForegroundColor Gray
Write-Host "     LEAVE IT AS A DRAFT - do not send or mark as sent." -ForegroundColor Gray
Write-Host "  3. Portal > Billing > From FreshBooks: the draft appears with a Draft badge." -ForegroundColor Gray
Write-Host "     Pick the matter, click 'Attach pay link & send'. Read any warning toasts" -ForegroundColor Gray
Write-Host "     out loud - they name exactly which best-effort step (PDF, FB send) failed." -ForegroundColor Gray
Write-Host "  4. Verify: FB invoice is now SENT with 'Pay online: <link>' in notes; the" -ForegroundColor Gray
Write-Host "     firm-controlled inbox got FB's invoice email with PDF + pay link; the" -ForegroundColor Gray
Write-Host "     portal invoice shows source freshbooks / status sent; and check whether" -ForegroundColor Gray
Write-Host "     the invoice PDF appears in the matter's Files. THE PDF IS THE ONE" -ForegroundColor Gray
Write-Host "     UNVERIFIED MECHANISM - if it's missing (warning toast in step 3), the" -ForegroundColor Gray
Write-Host "     rest of the flow is unaffected; report back so the share-link fetch can" -ForegroundColor Gray
Write-Host "     be adjusted to FB's real response." -ForegroundColor Gray
Write-Host "  5. Pay the `$1 via the Payload link -> confirm the portal invoice flips PAID" -ForegroundColor Gray
Write-Host "     and the `$1 trust DEPOSIT appears on the matter's trust ledger. (Real" -ForegroundColor Gray
Write-Host "     money into IOLTA - void/refund per firm procedure afterward, or skip" -ForegroundColor Gray
Write-Host "     this step and let the first real client payment be the verification.)" -ForegroundColor Gray
Write-Host "  6. Retainer email test: Billing > Request Retainer, `$1 to the test client" -ForegroundColor Gray
Write-Host "     -> pay it -> ALL FIVE staff should each get the 'Retainer paid' email" -ForegroundColor Gray
Write-Host "     with the amber 'record as Prepayment credit in FreshBooks' reminder." -ForegroundColor Gray
Write-Host "  7. Dark mode glance at the two new UI pieces (Settings section + FB panel)." -ForegroundColor Gray
Write-Host "  8. Open the Help drawer > Billing, Invoicing & Trust Accounting - Section 4" -ForegroundColor Gray
Write-Host "     now teaches the FreshBooks-first loop (golden rule: never send from FB)." -ForegroundColor Gray

Write-Host "`nROLLBACK (SSL is not a git repo):" -ForegroundColor Cyan
Write-Host "  Copy-Item -Path '$backupDir\*' -Destination '$SSL' -Recurse -Force" -ForegroundColor Gray
Write-Host "  Then redeploy. DB rollback is unnecessary - both migrations are additive" -ForegroundColor Gray
Write-Host "  and inert with old code (harmless to leave in place).`n" -ForegroundColor DarkGray
