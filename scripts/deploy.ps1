<#
.SYNOPSIS
  Controlled deploy script for the WLS Portal.
  Run from repo root: .\scripts\deploy.ps1 -Local | -Preview | -Prod

.USAGE
  .\scripts\deploy.ps1 -Preview   # push branch -> Netlify preview URL
  .\scripts\deploy.ps1 -Prod      # deploy main to production
  .\scripts\deploy.ps1 -Local     # generate js/config.js for local dev only
#>

param(
  [switch]$Preview,
  [switch]$Prod,
  [switch]$Local
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Ensure we run from repo root regardless of where the script was invoked
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

$branch = git rev-parse --abbrev-ref HEAD

# ── Local dev only ─────────────────────────────────────────────────────────────
if ($Local) {
  Write-Host "Building config for local dev..." -ForegroundColor Cyan
  node scripts/build-config.js
  Write-Host "Done - js/config.js written. Open index.html in your browser." -ForegroundColor Green
  exit 0
}

# ── Safety checks ──────────────────────────────────────────────────────────────

$dirty = git status --porcelain
if ($dirty) {
  Write-Warning "Uncommitted changes detected:"
  git status --short
  $confirm = Read-Host "Deploy with uncommitted changes? (y/N)"
  if ($confirm -ne 'y') { Write-Host "Deploy cancelled."; exit 0 }
}

$migrations = Get-ChildItem supabase/migrations/*.sql | Sort-Object Name
Write-Host "Found $($migrations.Count) migration file(s) - ensure they are applied to the target env." -ForegroundColor Yellow
Write-Host "  Run: .\scripts\db-migrate.ps1 -Target dev   (or -Target prod)"

# ── Preview deploy ─────────────────────────────────────────────────────────────
if ($Preview) {
  Write-Host "Deploying branch '$branch' to Netlify preview..." -ForegroundColor Cyan
  node scripts/build-config.js
  git push origin $branch
  Write-Host ""
  Write-Host "Pushed '$branch'. Netlify will build a preview URL shortly." -ForegroundColor Green
  Write-Host "Check Netlify dashboard for the preview link."
  exit 0
}

# ── Production deploy ──────────────────────────────────────────────────────────
if ($Prod) {
  if ($branch -like 'module/*') {
    Write-Error "Cannot prod-deploy from a module branch ('$branch'). Merge to main first: .\scripts\merge-module.ps1 -Name <name>"
    exit 1
  }

  if ($branch -ne 'main') {
    Write-Warning "You are on '$branch', not 'main'."
    $confirm = Read-Host "Deploy '$branch' to production? (y/N)"
    if ($confirm -ne 'y') { Write-Host "Deploy cancelled."; exit 0 }
  }

  Write-Host ""
  Write-Host "=== PRODUCTION DEPLOY ===" -ForegroundColor Yellow
  Write-Host "Branch : $branch" -ForegroundColor Yellow
  Write-Host "This will go live immediately on WLS production." -ForegroundColor Yellow
  Write-Host "=========================" -ForegroundColor Yellow
  $confirm = Read-Host "Confirm production deploy? (yes/N)"
  if ($confirm -ne 'yes') { Write-Host "Deploy cancelled."; exit 0 }

  git push origin main
  Write-Host ""
  Write-Host "Pushed to main. Netlify is building production deploy." -ForegroundColor Green
  Write-Host "Monitor at: https://app.netlify.com"
  exit 0
}

Write-Host "Usage: .\scripts\deploy.ps1 -Preview | -Prod | -Local"
