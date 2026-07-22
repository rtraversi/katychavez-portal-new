# trust-portal-site.ps1
# Adds the client portal URL to the Windows Trusted Sites zone.
# Run once per user machine during onboarding (or push via GPO/MDM).
#
# Word and Internet Explorer/Edge both respect this zone. Adding the portal URL
# here prevents Office from opening WebDAV documents in Protected View, which
# causes a second read-only Word window to appear alongside the editing window.
#
# Usage:
#   .\scripts\trust-portal-site.ps1 -PortalUrl "https://smithlaw.shy-union-b269.workers.dev"
#   .\scripts\trust-portal-site.ps1 -PortalUrl "https://portal.smithlawfirm.com"
#
# Zone values: 1=Intranet, 2=Trusted, 3=Internet, 4=Restricted

param(
    [Parameter(Mandatory=$true)]
    [string]$PortalUrl
)

# Parse the URL
try {
    $uri = [System.Uri]$PortalUrl
} catch {
    Write-Error "Invalid URL: $PortalUrl"
    exit 1
}

$scheme = $uri.Scheme          # "https"
$host   = $uri.Host            # e.g. "iurisiq-sandbox.shy-union-b269.workers.dev"
$parts  = $host.Split(".")

if ($parts.Length -lt 2) {
    Write-Error "Cannot parse domain from: $host"
    exit 1
}

# Build registry path.
# ZoneMap\Domains structure: \<registered-domain>\<subdomain>
# For "iurisiq-sandbox.shy-union-b269.workers.dev":
#   registered domain key = "workers.dev"
#   subkey                = "iurisiq-sandbox.shy-union-b269"
$regDomain = "$($parts[-2]).$($parts[-1])"
$subDomain = if ($parts.Length -gt 2) { $parts[0..($parts.Length - 3)] -join "." } else { $null }

$base    = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Domains"
$regPath = if ($subDomain) { "$base\$regDomain\$subDomain" } else { "$base\$regDomain" }

# Create key and set zone = 2 (Trusted Sites)
try {
    New-Item -Path $regPath -Force | Out-Null
    Set-ItemProperty -Path $regPath -Name $scheme -Value 2 -Type DWord
    Write-Host "Added to Trusted Sites: $($scheme)://$($host)" -ForegroundColor Green
    Write-Host "Registry path: $regPath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Word will no longer open this portal's documents in Protected View." -ForegroundColor Cyan
    Write-Host "If Word is currently open, restart it for the change to take effect." -ForegroundColor Yellow
} catch {
    Write-Error "Failed to write registry: $_"
    exit 1
}
