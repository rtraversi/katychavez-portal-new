# ============================================================================
#  scroggins-sync-retainer-readonly.ps1  -  Port the "live read-only retainer
#  balance" change into Scroggins & Savage (SSL).
#
#  RUN THIS FROM ANY POWERSHELL WINDOW:
#      C:\Sites\iurisiq-portal-template\scroggins-sync-retainer-readonly.ps1
#  It cd's to the SSL clone itself. It is fully self-contained.
#
#  WHAT IT PORTS (branch module/trust-retainer-readonly):
#    When the trust_accounting module is enabled, the immutable trust LEDGER is
#    the authoritative retainer balance (matters.retainer_balance goes stale as
#    funds are disbursed). The client/matter detail card now shows a live,
#    read-only "Retainer balance (in trust)" pulled from matter_trust_balances,
#    and the editable input is removed from the Case + Financial edit forms.
#    "Retainer requested" stays editable. Firms WITHOUT trust accounting keep the
#    old editable static field unchanged. Display is gated on
#    can_read('trust_accounting') so viewers without trust access see the field
#    hidden rather than a misleading $0.
#
#  It copies ONE file (pages/clients/detail/detail.js). detail.js is CUMULATIVE:
#    the template copy also carries every earlier detail.js change (Send Intake,
#    Retainer Requested, Request Retainer). SSL is already current on those from
#    scroggins-sync-retainer.ps1, so this is a clean forward step - the only new
#    delta is the read-only retainer balance.
#
#  *** NO MIGRATION. NO NEW ENV/SECRETS. NO PAYLOAD. ***
#  Prereqs already satisfied on SSL:
#    - Trust Accounting (migration 1200) is live (trust is CORE; SSL had the
#      trust catch-up).
#    - The trust ledger is SEEDED (16 opening deposits, $30,718.70 = Frost IOLTA).
#    - matters.retainer_requested (migration 1227) is applied.
#  If, and only if, scroggins-sync-retainer.ps1 was NOT run on SSL yet, run that
#  FIRST (it carries the retainer_requested field + migration 1227). This script
#  assumes SSL's detail.js is already at the retainer-requested version.
#
#  It never touches SSL's per-client files (wrangler.toml, js/config.js,
#  branding, .env). It does NOT deploy (Rob runs `npx wrangler deploy` on green).
#
#  Targets:  Supabase xdzgkagyfiauyfxbbdxv | R2 savagelaw-portal-prod | Worker savagelaw
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

# ---- The exact file set this change touched (tracked, non-per-client) --------
$files = @(
  'pages/clients/detail/detail.js'
)

# ---- Guard: SSL's detail.js must already carry Retainer Requested ------------
# (proves the retainer sync ran; this change stacks on top of it)
$sslDetail = Join-Path $SSL 'pages/clients/detail/detail.js'
if (Test-Path $sslDetail) {
  if (-not (Select-String -Path $sslDetail -Pattern 'retainer_requested' -Quiet)) {
    throw "SSL detail.js has no 'retainer_requested' - run scroggins-sync-retainer.ps1 FIRST, then re-run this."
  }
} else {
  throw "SSL detail.js missing at $sslDetail."
}

# ---- 1. Recoverable snapshot of SSL's current state --------------------------
Write-Host "`n== [1/4] Snapshotting SSL to branch 'pre-retainer-readonly-sync-snapshot'..." -ForegroundColor Cyan
if (git branch --list pre-retainer-readonly-sync-snapshot) {
  Write-Host "   Snapshot branch already exists - preserving the original pre-sync state." -ForegroundColor DarkGray
} else {
  git add -A
  if (git status --porcelain) { git commit -m "WIP snapshot before retainer-readonly sync (recoverable)" --no-verify | Out-Null }
  git branch pre-retainer-readonly-sync-snapshot HEAD
  Write-Host "   Snapshot saved. Roll back later with:  git checkout pre-retainer-readonly-sync-snapshot" -ForegroundColor DarkGray
}

# ---- 2. Copy the file set template -> SSL ------------------------------------
Write-Host "`n== [2/4] Copying $($files.Count) file..." -ForegroundColor Cyan
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
  Write-Host " SYNC COMPLETE - tests GREEN. Safe to deploy (Step A)." -ForegroundColor Green
} else {
  Write-Host " SYNC DONE, but TESTS FAILED (exit $testExit). Do NOT deploy until green." -ForegroundColor Yellow
}
Write-Host "============================================================`n" -ForegroundColor Green

Write-Host "STEP A - Regenerate config + deploy (SSL's normal deploy). NO migration, NO env changes:" -ForegroundColor Cyan
Write-Host "  node scripts/build-config.js   (with SSL's Supabase URL/anon key + FIRM_NAME env)" -ForegroundColor Gray
Write-Host "  npx wrangler deploy" -ForegroundColor Gray

Write-Host "`nVERIFY LIVE (SSL already has trust on + the ledger seeded):" -ForegroundColor Cyan
Write-Host "  1. Open a client with trust funds (e.g. Laura Cargile) -> Case tab." -ForegroundColor Gray
Write-Host "     'Retainer balance (in trust)' shows the LIVE ledger figure, read-only." -ForegroundColor Gray
Write-Host "  2. Financial tab shows the same live figure." -ForegroundColor Gray
Write-Host "  3. Click Edit on Case or Financial: there is NO 'Retainer balance' input -" -ForegroundColor Gray
Write-Host "     only 'Retainer requested', plus a note that the balance is tracked in" -ForegroundColor Gray
Write-Host "     Trust Accounting. Saving must NOT wipe the balance." -ForegroundColor Gray
Write-Host "  4. Record a disbursement in Trust Accounting for that matter, then reload" -ForegroundColor Gray
Write-Host "     the client card - the 'in trust' figure drops by that amount." -ForegroundColor Gray
Write-Host "  5. (Optional) A Paralegal without trust read should NOT see the balance field." -ForegroundColor Gray

Write-Host "`nIf anything is wrong:  git checkout pre-retainer-readonly-sync-snapshot`n" -ForegroundColor Gray
