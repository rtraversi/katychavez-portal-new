# ============================================================================
#  freshbooks-sync.ps1  -  Port the FreshBooks billing integration into
#                          Scroggins & Savage (SSL).
#
#  RUN THIS FROM ANY POWERSHELL WINDOW:
#      C:\Sites\iurisiq-portal-template\freshbooks-sync.ps1
#  It cd's to the SSL clone itself. It is fully self-contained.
#
#  WHAT IT PORTS (template branch module/freshbooks-billing):
#    FreshBooks OAuth 2.0 connect flow + reworked billing adapter, plus the
#    Settings -> Billing & Payments UI. Firm-level connection; client match by
#    email; rotating-refresh-token persistence with a single-flight guard.
#
#  It copies ONLY the module's files. It never touches SSL's per-client files
#  (wrangler.toml, js/config.js, branding assets, .env).
#
#  MIGRATION 1523 IS ALREADY APPLIED to SSL's Supabase (done via MCP) - there is
#  NO SQL step here. The .sql file is copied only to keep the clone's migration
#  history complete.
#
#  It does NOT set worker config and does NOT deploy - see STEP A / STEP B below.
#
#  Targets:  Supabase xdzgkagyfiauyfxbbdxv | R2 savagelaw-portal-prod | Worker savagelaw-v2
# ============================================================================

$ErrorActionPreference = 'Stop'
$TEMPLATE = 'C:\Sites\iurisiq-portal-template'
$SSL      = 'C:\Sites\scrogginssavage'

# ---- 0. Sanity: both trees must exist and look like the portal --------------
if (-not (Test-Path (Join-Path $TEMPLATE '_worker.js'))) { throw "Template not found at $TEMPLATE." }
if (-not (Test-Path $SSL))                                { throw "SSL clone not found at $SSL." }
if (-not (Test-Path (Join-Path $SSL '_worker.js')))      { throw "Not the SSL portal root ($SSL) - _worker.js missing." }
Set-Location $SSL
Write-Host "== Source: $TEMPLATE" -ForegroundColor Cyan
Write-Host "== Target: $SSL"      -ForegroundColor Cyan

# ---- The exact file set the FreshBooks module adds/changes -------------------
# _worker.js and js/menu.js are full-file copies: verify the clone had no local
# per-client edits to those two (it shouldn't - they are template-tracked).
$files = @(
  # New API routes
  'functions/api/freshbooks-oauth-url.js',
  'functions/api/freshbooks-oauth-callback.js',
  'functions/api/freshbooks-status.js',
  'functions/api/freshbooks-disconnect.js',
  # Reworked adapter (static token -> OAuth)
  'functions/api/_adapters/billing/freshbooks.js',
  # Settings -> Billing & Payments UI
  'pages/settings/billing/index.html',
  'pages/settings/billing/billing.js',
  # Migration (already applied to Supabase; copied for history only)
  'supabase/migrations/1523_freshbooks_oauth.sql',
  # Route + nav registration
  '_worker.js',
  'js/menu.js',
  # Test coverage + env docs
  'test/integration/worker.test.js',
  'wrangler.toml.example'
)

# ---- 1. Recoverable snapshot of SSL's current state --------------------------
Write-Host "`n== [1/4] Snapshotting SSL to branch 'pre-freshbooks-sync-snapshot'..." -ForegroundColor Cyan
# Idempotent: create the snapshot only ONCE. (No-op if the clone is not a git repo.)
if (git branch --list pre-freshbooks-sync-snapshot) {
  Write-Host "   Snapshot branch already exists - preserving the original pre-sync state." -ForegroundColor DarkGray
} else {
  git add -A
  if (git status --porcelain) { git commit -m "WIP snapshot before freshbooks sync (recoverable)" --no-verify | Out-Null }
  git branch pre-freshbooks-sync-snapshot HEAD
  Write-Host "   Snapshot saved (if git repo). Roll back with: git checkout pre-freshbooks-sync-snapshot" -ForegroundColor DarkGray
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
  Write-Host " SYNC COMPLETE - tests GREEN. Do STEP A + STEP B, then deploy." -ForegroundColor Green
} else {
  Write-Host " SYNC DONE, but TESTS FAILED (exit $testExit). Do NOT deploy until green." -ForegroundColor Yellow
}
Write-Host "============================================================`n" -ForegroundColor Green

Write-Host "MIGRATION 1523 - already applied to Supabase xdzgkagyfiauyfxbbdxv (nothing to run)." -ForegroundColor DarkGray

Write-Host "`nSTEP A - Set worker config on 'savagelaw-v2' (this is the FreshBooks connect config):" -ForegroundColor Cyan
Write-Host "  [vars] in wrangler.toml:" -ForegroundColor Gray
Write-Host "    BILLING_PROVIDER        = `"freshbooks`"" -ForegroundColor DarkGray
Write-Host "    FRESHBOOKS_CLIENT_ID    = `"<client id from the FreshBooks app>`"" -ForegroundColor DarkGray
Write-Host "    FRESHBOOKS_REDIRECT_URI = `"https://portal.divorcedifferently.com/api/freshbooks/oauth-callback`"" -ForegroundColor DarkGray
Write-Host "      ^ SLASH form, must EXACTLY match the Redirect URI in the FreshBooks app" -ForegroundColor DarkGray
Write-Host "  Secret:" -ForegroundColor Gray
Write-Host "    npx wrangler secret put FRESHBOOKS_CLIENT_SECRET" -ForegroundColor DarkGray
Write-Host "  Confirm PORTAL_URL is already https://portal.divorcedifferently.com (callback redirects there)." -ForegroundColor Gray

Write-Host "`nSTEP B - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE (as Anita / Owner):" -ForegroundColor Cyan
Write-Host "  1. Settings -> Billing & Payments -> shows 'Not connected' (not 'Not configured')." -ForegroundColor Gray
Write-Host "     'Not configured' = the vars/secret above are not live yet." -ForegroundColor DarkGray
Write-Host "  2. Connect FreshBooks -> FreshBooks sign-in -> Allow -> back to 'connected', shows account + Business ID." -ForegroundColor Gray
Write-Host "  3. Open a matter whose client's email MATCHES their FreshBooks client email -> unbilled time pulls from FB." -ForegroundColor Gray
Write-Host "  4. Send a draft invoice -> it appears in FreshBooks for that client." -ForegroundColor Gray
Write-Host "  If a call 403s on scope: widen the FreshBooks app scopes (clients:read, invoices:read+write, time_entries:read), reconnect." -ForegroundColor DarkGray

Write-Host "`nIf anything is wrong:  git checkout pre-freshbooks-sync-snapshot (if the clone is a git repo)`n" -ForegroundColor Gray
