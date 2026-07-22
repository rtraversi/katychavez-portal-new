# ============================================================================
#  scroggins-sync-retainer.ps1  -  Port the "Request Retainer" feature into
#  Scroggins & Savage (SSL).
#
#  RUN THIS FROM ANY POWERSHELL WINDOW:
#      C:\Sites\iurisiq-portal-template\scroggins-sync-retainer.ps1
#  It cd's to the SSL clone itself. It is fully self-contained.
#
#  WHAT IT PORTS:
#    1. Request Retainer (module/retainer-requests) - staff email a client a
#       Payload payment link that deposits DIRECTLY into the IOLTA trust account
#       with no invoice (a client pre-funding their retainer). On payment, the
#       GROSS amount is posted to the matter's trust ledger. Fees bill to the
#       separate Operating account Payload-side, so the portal records the gross
#       with no fee math.  (migration 1226)
#    2. Retainer Requested (module/retainer-requested) - a NEW informational
#       matter field for how much retainer staff/atty asked the client for.
#       Purely a reference figure - NOTHING to do with IOLTA/trust.  (migration 1227)
#
#  It copies ONLY the files that feature touched. It never touches SSL's
#  per-client files (wrangler.toml, js/config.js, branding, .env).
#  It does NOT apply the migration (Rob runs the SQL in STEP A).
#  It does NOT deploy (Rob runs `npx wrangler deploy` in STEP C, on green tests).
#
#  Targets:  Supabase xdzgkagyfiauyfxbbdxv | R2 savagelaw-portal-prod | Worker savagelaw
#
#  DEPENDENCY - shared files are CUMULATIVE:
#    detail.js, _worker.js, _notifications.js, detail/index.html also carry the
#    session-#8 "Send Intake" changes (they're the latest template versions).
#    If scroggins-sync.ps1 has NOT been run on SSL yet, ALSO apply migration
#    1225 (Send Intake) - see that script - or the Send Intake button will hit
#    columns that don't exist. Trust Accounting (migration 1200) must already
#    be live on SSL; it is (trust is CORE + SSL had the trust catch-up).
# ============================================================================

$ErrorActionPreference = 'Stop'
$TEMPLATE = 'C:\Sites\iurisiq-portal-template'
$SSL      = 'C:\Sites\scrogginssavage'

# ---- 0. Sanity: both trees must exist and look like the portal --------------
if (-not (Test-Path (Join-Path $TEMPLATE '_worker.js'))) { throw "Template not found at $TEMPLATE." }
if (-not (Test-Path $SSL))                                { throw "SSL clone not found at $SSL. Clone it first (Option B cutover)." }
if (-not (Test-Path (Join-Path $SSL '_worker.js')))      { throw "Not the SSL portal root ($SSL) - _worker.js missing." }
Set-Location $SSL
Write-Host "== Source: $TEMPLATE" -ForegroundColor Cyan
Write-Host "== Target: $SSL"      -ForegroundColor Cyan

# ---- The exact file set the retainer feature changed (tracked, non-per-client)
$files = @(
  # Backend
  '_worker.js',
  'functions/api/request-retainer.js',
  'functions/api/invoice-payment-webhook.js',
  'functions/api/_notifications.js',
  'supabase/migrations/1226_retainer_requests.sql',
  'supabase/migrations/1227_retainer_requested.sql',
  # UI (Financial > Trust Ledger sub-tab + Retainer Requested field)
  'pages/clients/detail/detail.js',
  'pages/clients/detail/index.html',
  # Tests
  'test/unit/retainer.test.js'
)

# ---- 1. Recoverable snapshot of SSL's current state --------------------------
Write-Host "`n== [1/4] Snapshotting SSL to branch 'pre-retainer-sync-snapshot'..." -ForegroundColor Cyan
if (git branch --list pre-retainer-sync-snapshot) {
  Write-Host "   Snapshot branch already exists - preserving the original pre-sync state." -ForegroundColor DarkGray
} else {
  git add -A
  if (git status --porcelain) { git commit -m "WIP snapshot before retainer feature sync (recoverable)" --no-verify | Out-Null }
  git branch pre-retainer-sync-snapshot HEAD
  Write-Host "   Snapshot saved. Roll back later with:  git checkout pre-retainer-sync-snapshot" -ForegroundColor DarkGray
}

# ---- 2. Copy the file set template -> SSL ------------------------------------
Write-Host "`n== [2/4] Copying $($files.Count) files..." -ForegroundColor Cyan
$missing = @()
foreach ($rel in $files) {
  $src = Join-Path $TEMPLATE $rel
  $dst = Join-Path $SSL      $rel
  if (-not (Test-Path $src)) { $missing += $rel; continue }
  $dstDir = Split-Path $dst -Parent
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
  Copy-Item -Path $src -Destination $dst -Force
  Write-Host "   + $rel" -ForegroundColor DarkGray
}
if ($missing.Count -gt 0) { throw "Source files missing in template: $($missing -join ', ')" }
Write-Host "   Copy complete." -ForegroundColor DarkGray

# ---- 3. Install deps + run the test gate -------------------------------------
Write-Host "`n== [3/4] npm install..." -ForegroundColor Cyan
npm install
Write-Host "`n== [4/4] npm test..." -ForegroundColor Cyan
npm test
$testExit = $LASTEXITCODE

# ---- Result ------------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Green
if ($testExit -eq 0) {
  Write-Host " SYNC COMPLETE - tests GREEN. Safe to deploy after Steps A-C." -ForegroundColor Green
} else {
  Write-Host " SYNC DONE, but TESTS FAILED (exit $testExit). Do NOT deploy until green." -ForegroundColor Yellow
}
Write-Host "============================================================`n" -ForegroundColor Green

Write-Host "STEP A - Apply BOTH migrations to SSL's Supabase (xdzgkagyfiauyfxbbdxv). Paste each into the SQL editor." -ForegroundColor Cyan
Write-Host "  1226_retainer_requests.sql  - NEW table retainer_requests + process_retainer_payment RPC." -ForegroundColor Gray
Write-Host "  1227_retainer_requested.sql - ADD COLUMN matters.retainer_requested (idempotent)." -ForegroundColor Gray
Write-Host "  Both create NEW objects, so the 1200-range offset does NOT matter. Apply 1226 ONCE; 1227 is re-runnable." -ForegroundColor Gray
Write-Host "  NOTE: without 1227 the new 'Retainer requested' field will fail to save (unknown column)." -ForegroundColor DarkYellow
Write-Host "  If Send Intake (session #8) was NOT yet ported to SSL, ALSO apply 1225 - see scroggins-sync.ps1." -ForegroundColor DarkYellow

Write-Host "`nSTEP B - Payload config on 'savagelaw' (REQUIRED - retainer link is the whole point):" -ForegroundColor Cyan
Write-Host "  Set as wrangler secrets / vars:" -ForegroundColor Gray
Write-Host "    PAYMENT_PROVIDER            = payload" -ForegroundColor DarkGray
Write-Host "    PAYLOAD_SECRET_KEY          = <Payload API secret key>" -ForegroundColor DarkGray
Write-Host "    PAYLOAD_OPERATING_ACCOUNT_ID= <processing_id for the Operating account>" -ForegroundColor DarkGray
Write-Host "    PAYLOAD_TRUST_ACCOUNT_ID    = <processing_id for the Trust/IOLTA account>  <-- required for retainers" -ForegroundColor DarkGray
Write-Host "    PAYLOAD_WEBHOOK_SECRET      = <sender_secret from the Payload webhook endpoint>" -ForegroundColor DarkGray
Write-Host "  Register the webhook endpoint in Payload -> pointing at:" -ForegroundColor Gray
Write-Host "    https://<savagelaw portal domain>/api/invoice-payment-webhook   (watch: processed)" -ForegroundColor DarkGray
Write-Host "  Also confirm RESEND_API_KEY / PORTAL_URL / PORTAL_FIRM_NAME are set (the link is emailed)." -ForegroundColor Gray

Write-Host "`n  *** REAL-MONEY GATE ***" -ForegroundColor Red
Write-Host "  Do NOT point this at Payload PRODUCTION keys until Payload has:" -ForegroundColor Yellow
Write-Host "    1. Activated BOTH the Trust and Operating processing accounts (underwriting), and" -ForegroundColor Yellow
Write-Host "    2. Captured the voided check / bank letter so convenience fees bill to Operating" -ForegroundColor Yellow
Write-Host "       (Meredith's Jul-6 email). Until then, use Payload SANDBOX keys so trust funds" -ForegroundColor Yellow
Write-Host "       aren't moved and fees can't hit the trust account." -ForegroundColor Yellow

Write-Host "`nSTEP C - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE (use Payload SANDBOX keys first):" -ForegroundColor Cyan
Write-Host "  1. Ensure a trust account exists (Trust Accounting module -> Add account) - required for the button." -ForegroundColor Gray
Write-Host "  2. Open a client w/ a matter -> Financial tab -> Trust Ledger sub-tab." -ForegroundColor Gray
Write-Host "  3. 'Request Retainer' button shows (Owner/Attorney) -> enter an amount -> Send Payment Link." -ForegroundColor Gray
Write-Host "  4. Client gets the email; a 'Retainer Requests' row shows 'Awaiting payment'." -ForegroundColor Gray
Write-Host "  5. Pay via the link (sandbox card) -> row flips to 'Paid' and a Deposit appears in the" -ForegroundColor Gray
Write-Host "     trust ledger for the GROSS amount; the matter's trust balance goes up." -ForegroundColor Gray

Write-Host "`nIf anything is wrong:  git checkout pre-retainer-sync-snapshot`n" -ForegroundColor Gray
