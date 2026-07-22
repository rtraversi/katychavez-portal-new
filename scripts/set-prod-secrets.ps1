# One-time setup: sets CF Workers secrets from .env (prod values).
# Run once from C:\Sites\wilsonlakesavage — secrets persist across future deploys.
# Usage: .\scripts\set-prod-secrets.ps1

$ErrorActionPreference = 'Stop'

# Parse .env — last value for each key wins (prod values are at bottom of file)
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
    'RESEND_API_KEY'
)

foreach ($name in $secrets) {
    $val = $envVars[$name]
    if (-not $val -or $val.StartsWith('[YOUR')) {
        Write-Host "SKIP $name — not in .env, set manually: npx wrangler secret put $name" -ForegroundColor Yellow
        continue
    }
    Write-Host "Setting: $name" -ForegroundColor Cyan
    $val | npx wrangler secret put $name
}

Write-Host ""
Write-Host "Done. Run: npx wrangler deploy" -ForegroundColor Green
