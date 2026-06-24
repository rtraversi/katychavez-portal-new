<#
.SYNOPSIS
  Deploy script for IurisIQ Portal (Cloudflare Workers).
  Run from repo root: .\scripts\deploy.ps1 -Local | -Prod

.USAGE
  .\scripts\deploy.ps1 -Local   # regenerate js/config.js for local dev only
  .\scripts\deploy.ps1 -Prod    # build config + npx wrangler deploy
#>

param(
  [switch]$Prod,
  [switch]$Local
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

# ── Local dev only ─────────────────────────────────────────────────────────────
if ($Local) {
  Write-Host "Building config for local dev..." -ForegroundColor Cyan
  node scripts/build-config.js
  Write-Host "Done — js/config.js written." -ForegroundColor Green
  exit 0
}

# ── Production deploy ──────────────────────────────────────────────────────────
if ($Prod) {
  if (!(Test-Path "wrangler.toml")) {
    Write-Error "wrangler.toml not found. Copy wrangler.toml.example, fill it in, then retry."
    exit 1
  }

  $dirty = git status --porcelain
  if ($dirty) {
    Write-Warning "Uncommitted changes detected:"
    git status --short
    $confirm = Read-Host "Deploy with uncommitted changes? (y/N)"
    if ($confirm -ne 'y') { Write-Host "Deploy cancelled."; exit 0 }
  }

  $migrations = Get-ChildItem supabase/migrations/*.sql | Sort-Object Name
  Write-Host "Found $($migrations.Count) migration file(s) — confirm all are applied to prod Supabase." -ForegroundColor Yellow

  Write-Host ""
  Write-Host "=== PRODUCTION DEPLOY ===" -ForegroundColor Yellow
  $workerName = (Select-String -Path wrangler.toml -Pattern '^name\s*=\s*"(.+)"').Matches[0].Groups[1].Value
  Write-Host "Worker : $workerName" -ForegroundColor Yellow
  Write-Host "=========================" -ForegroundColor Yellow
  $confirm = Read-Host "Confirm production deploy? (yes/N)"
  if ($confirm -ne 'yes') { Write-Host "Deploy cancelled."; exit 0 }

  Write-Host "Building config..." -ForegroundColor Cyan
  node scripts/build-config.js

  Write-Host "Deploying to Cloudflare Workers..." -ForegroundColor Cyan
  npx wrangler deploy

  Write-Host ""
  Write-Host "Deploy complete. Worker URL: https://$workerName.workers.dev" -ForegroundColor Green
  exit 0
}

Write-Host "Usage: .\scripts\deploy.ps1 -Prod | -Local"
