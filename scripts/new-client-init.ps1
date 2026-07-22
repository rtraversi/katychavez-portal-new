# IurisIQ Portal - New client initialization script
# Usage: .\scripts\new-client-init.ps1 -Slug smithlaw -Dest C:\Sites\smithlaw-portal-new
# Run from the template directory: C:\Sites\iurisiq-portal-template
#
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads a .ps1 with no BOM as ANSI,
# so non-ASCII (em-dashes, smart quotes) corrupts parsing. The .env below is built
# as an array of lines rather than a here-string for the same PS 5.1 robustness.

param(
  [Parameter(Mandatory)][string]$Slug,
  [Parameter(Mandatory)][string]$Dest
)

$ErrorActionPreference = 'Stop'
$Template = $PSScriptRoot | Split-Path -Parent

if (!(Test-Path $Template\wrangler.toml.example)) {
  Write-Error "Run this script from inside the template directory (C:\Sites\iurisiq-portal-template)."
  exit 1
}

if (Test-Path $Dest) {
  Write-Error "Destination already exists: $Dest - remove it first or choose a different path."
  exit 1
}

Write-Host "Initializing $Slug portal at $Dest ..." -ForegroundColor Cyan

# Copy template, excluding secrets and generated files.
# NOTE: /XF must use FULL SOURCE PATHS for root-only files. A bare "wrangler.toml"
# would also exclude test/wrangler.toml (the Vitest dummy config), which breaks
# `npm test` in the clone. Same for .env / js\config.js.
robocopy $Template $Dest /E `
  /XD node_modules .git .wrangler .claude `
  /XF "$Template\wrangler.toml" "$Template\.env" "$Template\js\config.js" "*.ps1.bak" `
  /NFL /NDL /NJH /NJS | Out-Null

# Write a clean .env with placeholders (array of lines - no here-string, PS 5.1 safe)
$envLines = @(
  "# $Slug Portal - fill in all values before deploying. Never commit this file."
  "SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co"
  "SUPABASE_ANON_KEY=YOUR-SUPABASE-ANON-KEY"
  "SUPABASE_SERVICE_KEY=YOUR-SUPABASE-SERVICE-KEY"
  "R2_ACCOUNT_ID=YOUR-CF-ACCOUNT-ID"
  "R2_ACCESS_KEY_ID=YOUR-R2-ACCESS-KEY-ID"
  "R2_SECRET_ACCESS_KEY=YOUR-R2-SECRET-ACCESS-KEY"
  "R2_BUCKET_NAME=$Slug-portal-prod"
  "R2_PUBLIC_URL="
  "FIRM_NAME=Client Firm Name"
  "B2_KEY_ID=YOUR-B2-KEY-ID"
  "B2_APPLICATION_KEY=YOUR-B2-APPLICATION-KEY"
  "B2_BUCKET_NAME=$Slug-portal-backup"
  "B2_ENDPOINT=s3.us-east-005.backblazeb2.com"
  "RESEND_API_KEY=YOUR-RESEND-API-KEY"
  "ATTACHMENTAV_API_KEY=YOUR-ATTACHMENTAV-API-KEY"
  "ANTHROPIC_API_KEY=YOUR-ANTHROPIC-API-KEY"
  "SSN_ENCRYPTION_KEY=YOUR-32-CHAR-RANDOM-HEX"
)
$envLines | Set-Content "$Dest\.env" -Encoding ascii

# Update package.json with client-specific name
$pkgPath = "$Dest\package.json"
$pkg = Get-Content $pkgPath -Raw
$pkg = $pkg -replace '"name":\s*"[^"]+"', "`"name`": `"$Slug-portal`""
$pkg = $pkg -replace '"description":\s*"[^"]+"', "`"description`": `"IurisIQ portal - $Slug`""
Set-Content $pkgPath $pkg -Encoding utf8
Write-Host "npm install ..." -ForegroundColor Cyan
Push-Location $Dest
npm install --silent
Pop-Location

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Green
Write-Host "  1. Fill in $Dest\.env with real credentials"
Write-Host "  2. Copy wrangler.toml.example -> wrangler.toml and fill in"
Write-Host "  3. Run migrations in Supabase (see new-client-setup.md Step 3)"
Write-Host "  4. Create R2 bucket: $Slug-portal-prod"
Write-Host "  5. node scripts\build-config.js"
Write-Host "  6. .\scripts\set-prod-secrets.ps1"
Write-Host "  7. npx wrangler deploy"
