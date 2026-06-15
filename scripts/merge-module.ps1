<#
.SYNOPSIS
  Safely merge a completed module branch into main.

.USAGE
  .\scripts\merge-module.ps1 -Name messaging
  .\scripts\merge-module.ps1 -Name messaging -Deploy   # also prod-deploy after merge

.CHECKS
  • Working tree must be clean
  • Must be on the module/<name> branch
  • Warns about pending migrations
  • Squash-merges with a clean commit message
  • Optionally triggers production deploy
#>

param(
  [Parameter(Mandatory)][string]$Name,
  [switch]$Deploy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$branchName = "module/$Name"
$currentBranch = git rev-parse --abbrev-ref HEAD

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if ($currentBranch -ne $branchName) {
  Write-Error "Expected to be on branch '$branchName' but you're on '$currentBranch'."
  Write-Host "Switch with: git checkout $branchName" -ForegroundColor Yellow
  exit 1
}

$dirty = git status --porcelain
if ($dirty) {
  Write-Error "Working tree has uncommitted changes. Commit them before merging."
  exit 1
}

# Check branch exists on remote (optional warning)
$remoteBranch = git ls-remote --heads origin $branchName 2>$null
if (-not $remoteBranch) {
  Write-Warning "Branch '$branchName' doesn't appear to have been pushed. Run: git push origin $branchName"
}

# Migration reminder
$migRange = @{ billing=100; ai_brain=200; messaging=300; uploads=400; esign=500; draft_forms=600; dashboard=700; word_embed=800 }
if ($migRange.ContainsKey($Name)) {
  $start = $migRange[$Name]
  $migrations = Get-ChildItem "supabase/migrations/${start}*.sql" -ErrorAction SilentlyContinue
  if ($migrations) {
    Write-Host "⚠ Module has $($migrations.Count) migration(s) in range ${start}-$($start+99):" -ForegroundColor Yellow
    $migrations | ForEach-Object { Write-Host "  - $($_.Name)" }
    Write-Host "  Make sure these have been applied to dev BEFORE merging." -ForegroundColor Yellow
    Write-Host "  Apply to prod AFTER merge + deploy: .\scripts\db-migrate.ps1 -Target prod" -ForegroundColor Yellow
    $confirm = Read-Host "Migrations applied to dev? (y/N)"
    if ($confirm -ne 'y') { Write-Host "Merge cancelled."; exit 0 }
  }
}

Write-Host ""
Write-Host "Merging '$branchName' into main..." -ForegroundColor Cyan

# ── Merge ─────────────────────────────────────────────────────────────────────

git checkout main
git pull origin main
git merge --no-ff $branchName -m "feat($Name): merge module/$Name into main

Squash-merge of the $Name module. See _planning/modules/${Name}-spec.md for details."

Write-Host "✓ Merged '$branchName' into main." -ForegroundColor Green

# ── Optional deploy ───────────────────────────────────────────────────────────

if ($Deploy) {
  Write-Host "Deploying to production..." -ForegroundColor Cyan
  .\scripts\deploy.ps1 -Prod
} else {
  Write-Host ""
  Write-Host "Module merged. Deploy when ready:" -ForegroundColor Yellow
  Write-Host "  .\scripts\deploy.ps1 -Prod"
  Write-Host "  .\scripts\db-migrate.ps1 -Target prod   (if this module has migrations)"
}
