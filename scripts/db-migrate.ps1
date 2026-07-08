<#
.SYNOPSIS
  Apply Supabase migrations to dev or prod.
  Migrations are the ONLY way the database schema changes. Never hand-edit the live DB.

.USAGE
  .\scripts\db-migrate.ps1 -Target dev           # apply all pending to dev/staging
  .\scripts\db-migrate.ps1 -Target prod          # apply all pending to production
  .\scripts\db-migrate.ps1 -Target dev -DryRun   # show what would run without applying
  .\scripts\db-migrate.ps1 -Target dev -File 002_rbac.sql   # apply a specific file only

.PREREQUISITES
  psql installed (via PostgreSQL or Supabase CLI).
  .env must have SUPABASE_DB_URL_DEV and SUPABASE_DB_URL_PROD set to the Postgres connection string.

.MIGRATION TRACKING
  This script checks supabase/migrations/applied-<target>.txt to track applied migrations.
  DO NOT hand-edit that file -- it is the source of truth for what has been applied.
#>

param(
  [Parameter(Mandatory)][ValidateSet('dev','prod')][string]$Target,
  [switch]$DryRun,
  [string]$File
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# -- Load .env ----------------------------------------------------------------

if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line -match '=') {
      $parts = $line -split '=', 2
      [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
  }
}

$dbUrlVar = if ($Target -eq 'dev') { 'SUPABASE_DB_URL_DEV' } else { 'SUPABASE_DB_URL_PROD' }
$dbUrl    = [System.Environment]::GetEnvironmentVariable($dbUrlVar)

if (-not $dbUrl) {
  Write-Error "$dbUrlVar is not set. Add it to .env:`n  $dbUrlVar=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres"
  exit 1
}

# A non-URI value (e.g. a leftover placeholder) makes psql treat it as a local
# database NAME and silently try localhost:5432 -- fail loudly instead.
if ($dbUrl -notmatch '^postgres(ql)?://') {
  Write-Error "$dbUrlVar does not look like a connection string (got: $dbUrl).`nGet it from Supabase dashboard -> Connect -> Session pooler URI, then set it in .env."
  exit 1
}

# -- Safety check for prod ----------------------------------------------------

if ($Target -eq 'prod' -and -not $DryRun) {
  Write-Host ""
  Write-Host "=================================================" -ForegroundColor Red
  Write-Host "  PRODUCTION DATABASE MIGRATION                 " -ForegroundColor Red
  Write-Host "  This will alter the WLS production database.  " -ForegroundColor Red
  Write-Host "  Make sure dev was tested first.               " -ForegroundColor Red
  Write-Host "=================================================" -ForegroundColor Red
  $confirm = Read-Host "Type 'migrate-prod' to confirm"
  if ($confirm -ne 'migrate-prod') { Write-Host "Cancelled."; exit 0 }
}

# -- Find migrations ----------------------------------------------------------

$appliedFile = "supabase/migrations/applied-${Target}.txt"
$applied     = if (Test-Path $appliedFile) { Get-Content $appliedFile } else { @() }

$allMigrations = Get-ChildItem "supabase/migrations/*.sql" | Sort-Object Name

if ($File) {
  $allMigrations = $allMigrations | Where-Object { $_.Name -eq $File }
  if (-not $allMigrations) {
    Write-Error "Migration file '$File' not found in supabase/migrations/"
    exit 1
  }
}

$pending = $allMigrations | Where-Object { $_.Name -notin $applied }

if (-not $pending) {
  Write-Host "OK - No pending migrations for $Target." -ForegroundColor Green
  exit 0
}

$pendingCount = @($pending).Count
Write-Host "Pending migrations for $Target ($pendingCount file(s)):" -ForegroundColor Cyan
$pending | ForEach-Object { Write-Host "  - $($_.Name)" }
Write-Host ""

if ($DryRun) {
  Write-Host "(Dry run -- no changes applied)" -ForegroundColor Yellow
  exit 0
}

# -- Apply migrations ---------------------------------------------------------
# psql only. (The old Supabase CLI fallback called `supabase db execute`, a
# subcommand that no longer exists in the modern CLI.)

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Error "psql not found on PATH. Install it first, e.g.:  scoop install postgresql"
  exit 1
}

$failed = @()
foreach ($mig in $pending) {
  Write-Host "Applying $($mig.Name)..." -ForegroundColor Cyan

  $success = $false

  # EAP=Continue for the native call: psql writes NOTICEs to stderr, which
  # under Stop + 2>&1 in PS 5.1 become fatal NativeCommandError exceptions.
  # ON_ERROR_STOP makes psql exit non-zero on SQL errors (otherwise it keeps
  # going and exits 0, and a broken migration would be recorded as applied).
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $result = & psql $dbUrl -v ON_ERROR_STOP=1 -f $mig.FullName 2>&1
  $ErrorActionPreference = $eap

  if ($LASTEXITCODE -eq 0) {
    $success = $true
  } else {
    Write-Warning "psql exited with code $LASTEXITCODE"
  }

  if ($success) {
    Write-Host "  OK - Applied $($mig.Name)" -ForegroundColor Green
    Add-Content -Path $appliedFile -Value $mig.Name
  } else {
    Write-Host "  FAILED: $($mig.Name)" -ForegroundColor Red
    Write-Host $result
    $failed += $mig.Name
    Write-Host "Stopping -- fix the error above before applying more migrations." -ForegroundColor Red
    break
  }
}

if ($failed) {
  Write-Host ""
  Write-Error "Migration failed: $($failed -join ', '). Fix and re-run."
  exit 1
}

Write-Host ""
Write-Host "OK - All pending migrations applied to $Target." -ForegroundColor Green
Write-Host "  Applied log: $appliedFile"
