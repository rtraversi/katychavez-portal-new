# Uploads the normalized, barcoded USCIS form templates to this portal's R2 bucket.
# Run from this repo's root with wrangler logged in to THIS portal's Cloudflare account.
#
# Source PDFs live in the template repo (normalized by
# iurisiq-portal-template/scripts/normalize-form-template.js — read-only fields
# stripped, real PDF417 barcodes stamped). Keys must match form_templates.r2_key
# as set by the 1600-* migrations.

$src    = "C:\Sites\iurisiq-portal-template\normalized"
$bucket = "katychavez-portal"
$forms  = @("g-28", "g-1145", "i-821d", "i-765", "i-765ws", "g-1450")

foreach ($f in $forms) {
    Write-Host "Uploading $f.pdf ..." -ForegroundColor Cyan
    npx wrangler r2 object put "$bucket/form-templates/$f.pdf" --file "$src\$f.pdf" --content-type "application/pdf" --remote
    if ($LASTEXITCODE -ne 0) { Write-Error "Upload failed for $f"; exit 1 }
}
Write-Host "All 6 templates uploaded to $bucket/form-templates/." -ForegroundColor Green
