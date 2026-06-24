# Sets CF Workers secrets from .env — run once per deployment.
# Usage: .\scripts\set-prod-secrets.ps1

$ErrorActionPreference = 'Stop'

$envVars = @{}
Get-Content .env | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#')) {
        $idx = $line.IndexOf('=')
        if ($idx -gt 0) {
            $key = $line.Substring(0, $idx).Trim()
            $val = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
            $envVars[$key] = $val
        }
    }
}

$secrets = @(
    'SUPABASE_SERVICE_KEY',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'SSN_ENCRYPTION_KEY',
    'B2_KEY_ID',
    'B2_APPLICATION_KEY',
    'RESEND_API_KEY',
    'ATTACHMENTAV_API_KEY',
    'ANTHROPIC_API_KEY'
)

foreach ($name in $secrets) {
    $val = $envVars[$name]
    if (-not $val -or $val.StartsWith('[YOUR')) {
        Write-Host "SKIP $name - not in .env" -ForegroundColor Yellow
        continue
    }
    Write-Host "Setting: $name" -ForegroundColor Cyan
    $val | npx wrangler secret put $name
}

Write-Host ""
Write-Host "Done. Secrets pushed to CF Workers." -ForegroundColor Green
