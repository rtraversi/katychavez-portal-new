# Package Builder

**Status:** BUILT 2026-08-27, ported from the IurisIQ sandbox (`iurisiq-portal-template`), where the
same feature shipped 2026-07-23 under the name **Smart Intake**. Renamed here because "Smart Intake"
already means something else in this portal — the AI document-field extraction on the Document Intake
page (`pages/uploads/`) — and because what this does is assemble the signed filing package.

Migration `1626_package_builder.sql` (tables + `generated_forms.signed_r2_key`).
Routes `POST /api/package-builder/analyze` + `POST /api/package-builder/apply`; signed copies served
via `/api/form-filler/download?id=…&signed=1`. UI: the **Package Builder** panel at the bottom of a
matter's **Documents → USCIS Forms** tab (`pages/clients/detail/detail.js`).
Part of the `draft_forms` premium module — no new module row.

**Depends on:** forms generated per matter (`generated_forms`), the malware-scanned upload trio,
`pdf-lib` (already bundled), and the Claude-over-PDF pattern from `proof-scan.js`.

---

## The problem, stated precisely

A firm generates a USCIS form package for a matter, finalizes it (flattened PDF per form at
`generated_forms.finalized_r2_key`), and sends it to the client to sign. The client prints the
signature pages, signs and dates them, scans them, and sends them back — **sometimes as one
combined PDF, sometimes one page at a time.**

Merging those signed pages back into the filing package by hand means figuring out which scan is
which form's which page, checking it's the right edition and actually signed, and splicing it into
the PDF. Across a multi-form package that is slow and error-prone.

**Package Builder automates the routing, validation, and splice — behind a human confirm.**

---

## The one architectural fact that shapes everything

**There is no per-page storage anywhere.** A USCIS form is a *single multi-page PDF*: the blank
template at `form-templates/<form-key>.pdf`, the matter's copy at `generated_forms.r2_key` /
`finalized_r2_key`. "Pages" exist only *inside* those PDFs — the code never splits them into files.

So **"replace the existing page" is a PDF page splice, not a file swap**: load the form PDF, remove
page *k*, insert the client's scanned page at index *k*, save a new PDF. `pdf-lib` (already bundled,
used by `form-filler-generate.js` / `-finalize.js`) does this via `copyPages` / `insertPage` /
`removePage`. No new dependency.

The footer Package Builder validates — **edition date + PDF417 barcode + "Page X of Y"** — is *also
the routing key*. The AI reads that one footer to know both which form and which page slot the scan
belongs in. Validation and routing are the same read.

---

## Decisions locked

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Automation level | **Review & confirm first** | Filing documents; the model never edits a filing silently. AI pre-selects routed pages, staff clicks Apply. |
| 2 | Output of splice | **Keep clean + add signed version** | `r2_key` / `finalized_r2_key` are never mutated; the splice writes a new signed copy (`signed_r2_key`). Reversible, full history. |
| 3 | Unmatched uploads | **Hold as normal documents** | Anything not confidently routed to a package form stays as a malware-scanned doc in Document Intake. Covers EAD cards, certs, translations for free. |
| 4 | The three checks | **Flag, don't hold** | A page is Apply-able whenever it routes to a form that has a *generated* version (draft OR finalized — no need to finalize first). The checks are advisory badges; the human decides. |

---

## What it reuses — do not rebuild

| Piece | Where |
|---|---|
| Upload trio (malware-scanned) | `/api/get-upload-url` → `/api/upload-proxy` → `/api/confirm-upload` |
| Claude over multi-page PDF, per-page footer/edition/signature reasoning | `functions/api/proof-scan.js` (Sonnet-class + `anthropic-beta: pdfs-2024-09-25`) |
| PDF page manipulation | `pdf-lib` |
| The matter's package form set (routing candidates) | `loadPackageTemplates()` in `_fill-context.js` |
| Expected edition per form | `form_editions` (authoritative), falling back to `form_templates.edition_date` |
| Server-side Claude, key as Worker secret | `env.ANTHROPIC_API_KEY` (CSP omits api.anthropic.com) |

---

## The two halves

**Analyze — read-only.** `POST /api/package-builder/analyze` takes the uploaded `document_ids`,
fetches their bytes from R2, and sends them to `claude-sonnet-4-6` (pdfs beta) **constrained to this
matter's package forms** — we don't ask "what USCIS form is this?" open-world, we ask "which of
THESE, which page?". It records one `package_builder_pages` row per detected page with the three
checks and the routed target. It modifies no filing. Caps: 20 documents, ~25MB total.

**Apply — the splice.** `POST /api/package-builder/apply` groups the selected pages by target form,
loads that form's latest PDF once (existing `signed_r2_key` if present, so applies accumulate; else
finalized; else the fillable draft), does `removePage` + `insertPage` at the footer's page number,
and saves `signed-forms/<matter>/<batch>/<form>_signed.pdf`. PDF sources contribute their page;
JPG/PNG sources embed scaled to the replaced page's dimensions. Page count is preserved so indices
stay stable across applies. Per-page and per-form error isolation — one bad page never blocks the rest.

Splitting analyze from apply keeps analyze independently useful and de-risks the splice.

## The three checks (advisory)

1. **Edition correct** — footer edition == the expected edition. Fail → *client signed an outdated
   edition; consider re-sending the current one.*
2. **Signed AND dated** — both a signature and a date present.
3. **Footer intact** — edition + barcode + page # all visible (catches cut-off / bad scans).

None of these block Apply (decision 4); they render as ✓ / ✗ / ? badges on the page row, and the
reason line spells out what to look at.

---

## Not ported from the sandbox

- **Attorney signature + date stamp** (the per-form **Sign** action, `form_stamp_overlays`,
  migration 1624, `/api/form-filler/stamp`) — a separate feature the sandbox built alongside this
  one. Package Builder does not depend on it; port it separately if the firm wants it.

## Deferred / designed for, not built

- **Package assembly** — appending supporting exhibits *after* the last USCIS form (EAD card
  front/back, marriage/birth certificates, translated copies). That is assembly, a different
  operation from page *replacement*, with its own ordering rules. v1 holds these as normal
  documents (decision 3).

---

## Risks / edge cases

- **Auto-modifying legal filings** — mitigated by decision 1 (human confirm) + decision 2 (never
  overwrite the clean copy).
- **Page-position drift** — if the generated pagination differs from the blank template, footer
  "Page X of Y" is the anchor; a target page beyond the form's page count errors that page rather
  than splicing blind.
- **Scan size / cost** — a high-DPI combined packet is a large Claude payload; hence the 25MB /
  20-document cap (same concern `proof-scan.js` carries).
- **Signer identity is out of scope** — the AI confirms a signature *exists*; it cannot confirm the
  correct human signed. Be explicit with the firm.
