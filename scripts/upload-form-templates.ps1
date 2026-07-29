# Uploads the normalized, barcoded USCIS form templates to this portal's R2 bucket.
# Run from this repo's root with wrangler logged in to THIS portal's Cloudflare account.
#
# Source PDFs live in the template repo (normalized by
# iurisiq-portal-template/scripts/normalize-form-template.js — read-only fields
# stripped, real PDF417 barcodes stamped). Keys must match form_templates.r2_key
# as set by the 1600-* migrations.

#
# Pass -Only to upload a subset, e.g.  .\scripts\upload-form-templates.ps1 -Only i-130,i-485
# Re-uploading an unchanged form is harmless (same bytes, same key).

param([string[]]$Only)

$src    = "C:\Sites\iurisiq-portal-template\normalized"
$bucket = "katychavez-portal"

# The full set registered by this repo's 1600-* migrations. Keys must match
# form_templates.r2_key exactly (verified against the migrations).
$forms  = @(
  # Originally provisioned on this portal.
  "g-28", "g-1145", "g-1450", "i-765", "i-765ws", "i-821d", "n-400",
  # Family + adjustment-of-status core, ported from the sandbox.
  "i-130", "i-130a", "i-485", "i-751", "i-864",
  # USCIS forms library, ported from module/uscis-forms-library.
  "ar-11", "g-325a", "i-90", "i-129f", "i-131", "i-134", "i-192", "i-360",
  "i-539", "i-539a", "i-601", "i-601a", "i-821", "i-912",
  "i-914", "i-914supa", "i-918", "i-918supa", "i-918supb", "n-600"
)

if ($Only) { $forms = $forms | Where-Object { $Only -contains $_ } }

foreach ($f in $forms) {
    Write-Host "Uploading $f.pdf ..." -ForegroundColor Cyan
    npx wrangler r2 object put "$bucket/form-templates/$f.pdf" --file "$src\$f.pdf" --content-type "application/pdf" --remote
    if ($LASTEXITCODE -ne 0) { Write-Error "Upload failed for $f"; exit 1 }
}
Write-Host "$($forms.Count) template(s) uploaded to $bucket/form-templates/." -ForegroundColor Green
