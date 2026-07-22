# ============================================================================
#  scroggins-sync.ps1  -  Port session #8 features into Scroggins & Savage (SSL).
#
#  RUN THIS FROM ANY POWERSHELL WINDOW:
#      C:\Sites\iurisiq-portal-template\scroggins-sync.ps1
#  It cd's to the SSL clone itself. It is fully self-contained.
#
#  WHAT IT PORTS (this session's pushed template work, commits 4723f27..23a2a44):
#    1. Client Document Checklist  (renamed/reframed doc-templates, empty-start)
#    2. Send Intake                (tokenized 14-day public intake webform + migration 1225)
#    3. send-doc-reminder 500 fix  (bad Resend key -> clean 502 instead of opaque 500)
#    4. proof-scan dark-mode fix   (readable results in dark theme)
#
#  It copies ONLY the exact files those commits touched. It never touches SSL's
#  per-client files (wrangler.toml, js/config.js, branding assets, .env).
#  It does NOT apply the migration (Rob runs the SQL below against Supabase).
#  It does NOT deploy (Rob runs `npx wrangler deploy` at the end, on green tests).
#
#  Targets:  Supabase xdzgkagyfiauyfxbbdxv | R2 savagelaw-portal-prod | Worker savagelaw
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

# ---- The exact file set this session changed (tracked, non-per-client) -------
# Deliberately EXCLUDES SCROGGINS-DEPLOY-send-intake.md + SEND-INTAKE-PLAN.md
# (template-only planning docs) and every per-client / gitignored file.
$files = @(
  # 1. Client Document Checklist (4723f27)
  'modules/registry.js',
  'pages/settings/doc-templates/doc-templates.js',
  'pages/settings/doc-templates/index.html',
  # 2. Send Intake (cc455e2)
  '_worker.js',
  'functions/api/_notifications.js',
  'functions/api/send-intake.js',
  'functions/api/intake-public-load.js',
  'functions/api/intake-public-submit.js',
  'intake.html',
  'js/intake-public.js',
  'pages/clients/detail/detail.js',
  'pages/clients/detail/index.html',
  'supabase/migrations/1225_send_intake.sql',
  'test/integration/worker.test.js',
  'wrangler.toml.example',
  # 3. send-doc-reminder 500 fix (23a2a44)
  'functions/api/send-doc-reminder.js',
  # 4. proof-scan dark-mode fix (4f197ac)
  'css/portal.css',
  'pages/proof-scan/proof-scan.js'
)

# ---- 1. Recoverable snapshot of SSL's current state --------------------------
Write-Host "`n== [1/4] Snapshotting SSL to branch 'pre-scroggins-sync-snapshot'..." -ForegroundColor Cyan
# Idempotent: create the snapshot only ONCE, so a re-run never overwrites the
# original pre-sync state with the already-synced tree.
if (git branch --list pre-scroggins-sync-snapshot) {
  Write-Host "   Snapshot branch already exists - preserving the original pre-sync state." -ForegroundColor DarkGray
} else {
  git add -A
  if (git status --porcelain) { git commit -m "WIP snapshot before scroggins feature sync (recoverable)" --no-verify | Out-Null }
  git branch pre-scroggins-sync-snapshot HEAD
  Write-Host "   Snapshot saved. Roll back later with:  git checkout pre-scroggins-sync-snapshot" -ForegroundColor DarkGray
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

Write-Host "STEP A - Apply migration 1225 to SSL's Supabase (xdzgkagyfiauyfxbbdxv)." -ForegroundColor Cyan
Write-Host "  Idempotent (ADD COLUMN IF NOT EXISTS) - the 1200-range offset does NOT matter." -ForegroundColor Gray
Write-Host @'
    ALTER TABLE public.matters
      ADD COLUMN IF NOT EXISTS intake_token       uuid        DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS intake_sent_at     timestamptz DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS intake_expires_at  timestamptz DEFAULT NULL;

    CREATE INDEX IF NOT EXISTS matters_intake_token_idx
      ON public.matters (intake_token) WHERE intake_token IS NOT NULL;
'@ -ForegroundColor DarkGray

Write-Host "`nSTEP B - Confirm worker env on 'savagelaw' (Send Intake sends a real email):" -ForegroundColor Cyan
Write-Host "  - RESEND_API_KEY     set (or the email silently no-ops; token still created)" -ForegroundColor Gray
Write-Host "  - PORTAL_URL         SSL's real portal domain (emailed link = PORTAL_URL/intake?token=...)" -ForegroundColor Gray
Write-Host "  - PORTAL_FIRM_NAME   'Scroggins & Savage PLLC'" -ForegroundColor Gray
Write-Host "  - TURNSTILE_SECRET_KEY   optional; set as secret to enable the public-form CAPTCHA" -ForegroundColor Gray
Write-Host "                           (only meaningful if TURNSTILE_SITE_KEY is also in js/config.js)" -ForegroundColor Gray

Write-Host "`nSTEP C - Regenerate config + deploy (SSL's normal deploy):" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE:" -ForegroundColor Cyan
Write-Host "  1. Client w/ a matter -> Send Intake -> email arrives." -ForegroundColor Gray
Write-Host "  2. Open link incognito (no login) -> branded form loads for the case type." -ForegroundColor Gray
Write-Host "  3. Submit -> 'submitted to Scroggins & Savage PLLC' thank-you." -ForegroundColor Gray
Write-Host "  4. Staff view: card shows the data + button flips to 'Intake completed'; attorney notified." -ForegroundColor Gray
Write-Host "  5. Client Document Checklist page renders under its new name; '+ Add document' works." -ForegroundColor Gray
Write-Host "  (Optional) empty-start checklist:  delete from document_checklists;" -ForegroundColor DarkGray

Write-Host "`nIf anything is wrong:  git checkout pre-scroggins-sync-snapshot`n" -ForegroundColor Gray
