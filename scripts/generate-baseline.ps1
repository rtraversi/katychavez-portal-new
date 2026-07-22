<#
.SYNOPSIS
  Regenerate the schema baseline used to stand up a NEW client database.

.DESCRIPTION
  Writes two files:

    supabase/baseline/000_baseline.sql   schema-only dump of the sandbox
    supabase/baseline/MANIFEST.txt       the migration filenames baked into it

  Why a baseline at all: supabase/migrations/ is 119 files and grows by ~1 per
  USCIS form (the 1600-* family will pass 125). Replaying all of them for every
  new client is slow and fragile. The baseline collapses "everything up to now"
  into one file; a new client applies it, then only the migrations added since.

  Why a MANIFEST of FILENAMES and not a number cutoff: the 1600-* USCIS form
  migrations deliberately share one number prefix (one file per form, so 125+
  forms don't burn 125 numbers). "Everything after 1536" is therefore not a
  well-defined set. The tail is computed by set difference against this list.

  Why a script instead of a checked-in one-off: the analysis (CONSOLIDATION-
  ANALYSIS.md ?3) calls for regenerating the baseline at each checkpoint. This
  also keeps the dump exact - it goes straight from Postgres to disk via
  pg_dump rather than being reconstructed from catalog queries by hand.

  EXISTING deployments never touch the baseline. They are already at current
  schema and must never replay it - db-migrate.ps1 keeps tracking them by
  filename in applied-<target>.txt exactly as before.

.PARAMETER Target
  Which applied-*.txt ledger the manifest is taken from. Default: dev (sandbox).

.PARAMETER DbUrl
  Optional direct Postgres connection string. Use this when the Supabase CLI
  isn't logged in. Format:
    postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres

.EXAMPLE
  # Using the Supabase CLI (run `npx supabase login` once first)
  ./scripts/generate-baseline.ps1

.EXAMPLE
  # Using a direct connection string instead
  ./scripts/generate-baseline.ps1 -DbUrl "postgresql://postgres:PASS@db.lqyihtfwfwvgfjccclgm.supabase.co:5432/postgres"
#>
param(
  [string]$Target = 'dev',
  [string]$ProjectRef = 'lqyihtfwfwvgfjccclgm',
  [string]$DbUrl
)

$ErrorActionPreference = 'Stop'

$repoRoot    = Split-Path -Parent $PSScriptRoot
$baselineDir = Join-Path $repoRoot 'supabase/baseline'
$outSql      = Join-Path $baselineDir '000_baseline.sql'
$outManifest = Join-Path $baselineDir 'MANIFEST.txt'
$ledger      = Join-Path $repoRoot "supabase/migrations/applied-$Target.txt"

if (-not (Test-Path $ledger)) {
  throw "Ledger not found: $ledger. Expected applied-$Target.txt to exist."
}

if (-not (Test-Path $baselineDir)) {
  New-Item -ItemType Directory -Path $baselineDir | Out-Null
}

# -- 1. Dump the schema --------------------------------------------------------
# --schema-only  : no data. Seed rows live in the migrations, not here.
# --no-owner     : a new project has different role names; never pin ownership.
# --no-privileges: same reason - GRANTs are environment-specific.
# public only    : auth/storage/graphql schemas are Supabase-managed and are
#                  created by the platform, not by us. RLS policies that call
#                  auth.uid() still dump fine as expressions.
Write-Host "Dumping schema from $ProjectRef ..." -ForegroundColor Cyan

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "iurisiq-baseline-$([guid]::NewGuid()).sql"

# NB `supabase db dump` has no --project-ref flag (verified against CLI 2.103):
# it targets either the LINKED project or an explicit --db-url. So the two
# supported paths are "link once, then run this" or "pass a connection string".
if ($DbUrl) {
  & npx supabase db dump --db-url $DbUrl --schema public -f $tmp
  if ($LASTEXITCODE -ne 0) { throw "supabase db dump --db-url failed with exit code $LASTEXITCODE." }
} else {
  & npx supabase db dump --linked --schema public -f $tmp
  if ($LASTEXITCODE -ne 0) {
    throw @"
supabase db dump --linked failed with exit code $LASTEXITCODE.

The CLI needs to be logged in AND linked to the project. One-time setup:
  npx supabase login
  npx supabase link --project-ref $ProjectRef

Or skip both and pass a connection string (Supabase dashboard ->
Project Settings -> Database -> Connection string; password must be
percent-encoded if it contains special characters):
  ./scripts/generate-baseline.ps1 -DbUrl "postgresql://postgres:<password>@db.$ProjectRef.supabase.co:5432/postgres"
"@
  }
}

if (-not (Test-Path $tmp)) { throw "Dump produced no file at $tmp." }
$dump = Get-Content $tmp -Raw
Remove-Item $tmp -Force
if ([string]::IsNullOrWhiteSpace($dump)) { throw "Dump was empty - refusing to write a blank baseline." }

# -- 2. Manifest: which migrations this baseline already contains --------------
$applied = Get-Content $ledger |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -ne '' -and -not $_.StartsWith('#') -and -not $_.StartsWith([char]0xFEFF + '#') }

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')

$header = @"
-- IurisIQ portal - schema BASELINE
--
-- Generated $stamp by scripts/generate-baseline.ps1 from $ProjectRef (applied-$Target.txt).
-- Contains $($applied.Count) migrations. DO NOT HAND-EDIT - regenerate instead.
--
-- NEW client:      apply this file, then only the migrations listed as pending
--                  by db-migrate.ps1 (those NOT in baseline/MANIFEST.txt).
-- EXISTING client: never apply this file. Those databases are already at
--                  current schema and must not replay it.
--
-- Note: seed/backfill data is NOT in here (--schema-only). Migrations carrying
-- one-time backfills (1104, 1105, 1202, 1508) are no-ops on a fresh database,
-- but the module and practice-area seed INSERTs still need to run - they are
-- part of those migration files, so a fresh setup that applies the baseline
-- must still run the seed steps in new-client-setup.md.

"@

Set-Content -Path $outSql -Value ($header + $dump) -Encoding utf8

$manifestHeader = @(
  "# Migrations already contained in 000_baseline.sql",
  "# Generated $stamp from applied-$Target.txt ($ProjectRef).",
  "#",
  "# The tail to apply for a new client = supabase/migrations/*.sql MINUS this list.",
  "# Matched by FILENAME, not by number - the 1600-* USCIS form migrations all",
  "# share a prefix, so a numeric cutoff would be ambiguous."
)
Set-Content -Path $outManifest -Value ($manifestHeader + $applied) -Encoding utf8

# -- 3. Report -----------------------------------------------------------------
$sqlLines     = (Get-Content $outSql | Measure-Object -Line).Lines
$migrationDir = Join-Path $repoRoot 'supabase/migrations'
$allFiles     = Get-ChildItem -Path $migrationDir -Filter '*.sql' | Select-Object -ExpandProperty Name
$tail         = $allFiles | Where-Object { $applied -notcontains $_ }

Write-Host ""
Write-Host "Baseline written:" -ForegroundColor Green
Write-Host "  $outSql  ($sqlLines lines)"
Write-Host "  $outManifest  ($($applied.Count) migrations)"
Write-Host ""

if ($tail.Count -gt 0) {
  Write-Host "Migrations NOT in the baseline (a new client applies these after it):" -ForegroundColor Yellow
  $tail | ForEach-Object { Write-Host "  $_" }
  Write-Host ""
  Write-Host "If any of these are already applied to the sandbox, the ledger is stale -" -ForegroundColor Yellow
  Write-Host "reconcile applied-$Target.txt before trusting this baseline." -ForegroundColor Yellow
} else {
  Write-Host "Baseline is current with every migration file in the repo." -ForegroundColor Green
}

Write-Host ""
Write-Host "VERIFY before using for a real client:" -ForegroundColor Cyan
Write-Host "  Create a scratch Supabase project, apply 000_baseline.sql + the tail above,"
Write-Host "  then diff its schema against the sandbox. A baseline that is subtly wrong is"
Write-Host "  worse than none - the divergence surfaces later as unexplained portal bugs."
