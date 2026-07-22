# Discovery Manager — Module Spec Sheet

**Tier:** Premium — **separately priced** (not the standard add-on tier)
**Status:** Scoped + market-validated; Phase 0 in progress (sample #1 analyzed 2026-07-11)
**Branch (when built):** `module/discovery` off master · **Migration range:** TBD (avoid 200–299 AI Assistant)
**Last updated:** 2026-07-11

---

## Positioning

A financial-discovery analysis workspace for family-law matters, built **inside the portal** — no exporting client financials to a third-party tool. The module identity is **completeness**:

> *Know what you have, what you're missing, and what they didn't disclose.*

Competitors (CounselPro $100–1k/mo, DocuClipper, StrongSuit, Valid8 $42k/yr) analyze *what was produced*, as standalone silos. Nobody owns "is the production complete?" inside a case-management system. Deep transaction analysis is deliberately Phase 2 — the completeness layer runs on cheap AI (date math + one inexpensive classify pass per page), which fits IurisIQ's cost reality and undercuts the field.

**Working price range:** ~$149–299/firm/mo, included AI allotment + metered overage with a hard cap. Undercuts CounselPro because it's portal-bundled (zero CAC, shared infra) — not because it does less.

---

## Phase 0 — Validate on real discovery (IN PROGRESS, gates everything)

Nothing below is final until 2–3 real discovery sets are studied.

- ✅ **Sample #1 (2026-07-11):** Gary Lusk (SSL) — 217-file collaborative-divorce production imported via Dropbox. Confirmed: Texas-style I&A folder taxonomy, one-statement-per-file naming (rich filename metadata), **the Inventory & Appraisement spreadsheet ships inside the production** (versioned xlsx — the cross-check target), **real statement gaps in a real production**, trust/LLC/third-party entity ownership, small combined multi-month PDFs, non-PDF formats (xlsx/docx/png/msg), duplicate files, inconsistent account-number masking.
- ⬜ **Sample #2–3:** at least one **litigated/contested** matter — the adversarial "one giant unlabeled scanned PDF" worst case is still unvalidated.
- ⬜ Anita's answers: what her team does manually today, per-matter AI spend ceiling, staff roles/access, retention policy.

---

## Phase 1 — Discovery Workspace (the completeness engine) ← v1 build

### Ingest
- Pull from Dropbox via existing **Storage Sync "Import from Storage"** into the matter's Discovery folder tree; direct manual upload also supported.
- **Large-file path:** R2 multipart upload (browser-chunked) — removes the practical size cap for giant productions (sync path stays 25MB, manual 100MB).
- Graceful handling of provider-native files (Dropbox 409 `unsupported_file`) — surfaced in UI, never fails the job.

### Processing pipeline (durable, resumable, per-matter progress bar)
Per-document jobs via Cloudflare Workflows/Queues — never one giant Worker invocation:
1. **Detect** native-text vs scanned → extract text or OCR (reuses Proof Scan OCR); image OCR path for screenshots (e.g. Venmo PNGs).
2. **Classify** — two-pass: cheap **filename-metadata parse first** (Lusk showed `Owner_Institution_Type_#Acct_Kind_Date` conventions carry ~80% of the metadata), then content-based AI classify (cheap model tier) for sloppy names. Taxonomy from the real census: bank / brokerage / retirement / credit-card statements, year-long transaction exports, tax returns + forms (1040, state, 1099/1099-R/5498), credit reports, HSA, Social Security statements, savings bonds, titles/deeds/closing docs, property tax/mortgage/insurance, trust & entity documents, budgets/net-worth spreadsheets, P2P screenshots, email, other.
3. **Extract metadata** — institution, account last-4 (normalized across full/masked formats), statement period, **owner entity**.
4. **Index** into AutoRAG (matter-scoped) + write rows to Supabase.
- **Document bursting:** auto-split combined PDFs into constituent documents by page-range (boundary detection via per-page classify signals + text heuristics; split with pdf-lib). **Provenance preserved:** original untouched in R2, each child linked to parent + exact page range (chain of custody).
- **Dedup detection:** flag `(1).pdf` copies and identical docs filed in multiple folders.

### Analysis features (the completeness triangle)
- **Gap checker** — per account, walk statement periods and flag missing months ("12 months requested, Jul–Aug missing"). No heavy AI; validated on sample #1 (found real gaps immediately).
- **Account inventory** — every financial account referenced anywhere in the production: institution, type, last-4, **owner entity** (spouse A / spouse B / joint / trust / LLC / third party).
- **Disclosure cross-check** — inventory vs the sworn disclosure (I&A spreadsheet / financial affidavit): accounts in the documents that aren't on the disclosure, and vice versa. Handles versioned disclosure files.
- **RAG Q&A chat** — plain-English questions over the matter's discovery set with cited source documents. Air-gapped (AutoRAG folder-scoping, reuses AI Brain infra).
- **Full-text search** across the production.

### Cost & governance (first-class deliverables, not deferred)
- **AI usage monitor:** per-matter + per-firm usage/spend capture (`ai_usage` design), visible meter in the workspace, **hard spend cap** via AI Gateway spend limits; rolls up to the HQ admin/billing panel.
- Model routing: cheap tier (Kimi/Llama-class) for OCR-assist/classify; frontier only for Q&A synthesis.
- **Security:** staff-only (never client-visible), role-gated, access-logged, SSN redaction, air-gapped AI (no training on firm data). Retention/deletion policy per firm setting (pending Anita input).

### Data model (own migration range)
`discovery_sets` (per matter, per producing party) → `discovery_documents` (R2 pointer, type, **owner entity**, period, parent/page-range provenance, status) → `discovery_accounts` (institution, last-4, entity) → `discovery_gaps` → `discovery_findings`. (`discovery_transactions` reserved for Phase 2.) Entity table or enum covering spouses/joint/trusts/LLCs/third parties — required, per Lusk.

### Reuse (~60% existing infra)
Storage Sync · File Manager folder tree · Proof Scan OCR · AutoRAG/AI Brain scoping · AI Gateway + usage schema · pdf-lib (Signature Stamp) · R2 upload-proxy pattern.

---

## Phase 2 — Financial Intelligence (the data layer)

The differentiator and the expensive AI — deferred until Phase 1 revenue supports the COGS (this is where CounselPro burns money).

- Line-item **transaction extraction** from statements → `discovery_transactions`.
- **Income reconstruction** (deposits vs reported income), **balance timeline** per account, **spend categorization**.
- **Dissipation & anomaly flags** — large cash withdrawals, transfers to third parties, structuring patterns, lifestyle-vs-reported-income inconsistency.
- **Marital balance-sheet export** — court/mediation-ready summary, exportable.
- Cross-checks the Phase 1 account inventory (transactions referencing accounts not in the production → new gap type).

## Phase 3 — Communications

- Email/text ingestion (PST and mobile exports — rides the Phase 1 multipart large-file path).
- Timeline correlation with financial events; cross-party consistency checks.
- Overlaps budget-eDiscovery territory (GoldFynch/Digital WarRoom) — scope deliberately narrow: correlation with the financial record, not full eDiscovery review.

---

## Explicitly out of scope
- Client visibility of any discovery content (staff-only, all phases).
- Full eDiscovery review platform (productions of *our* documents, privilege logs, Bates stamping) — not this module.
- Drafting discovery requests/responses (EsquireTek/Briefpoint territory; possible future module).
- Verified-accuracy human review layer (Valid8's market; we present AI output with source citations, staff verifies).

## Open items
1. Litigated-sample validation (Phase 0) — may resize the bursting/ingest requirements.
2. Final pricing + AI allotment sizing (needs Anita's spend-ceiling answer + Phase 1 COGS measurement).
3. Retention/deletion policy default.
4. Migration range assignment.
5. Module registry entry + premium gating row (standard pattern) when build starts.

---

## Website blurb (draft)

> **Discovery Manager** — *financial discovery, read and understood.*
>
> Divorce cases run on financial documents — and the other side rarely hands over a tidy, complete set. Discovery Manager pulls the entire production into your firm's secure portal and reads every page, so you don't have to. It builds a running inventory of every account it finds, flags the months of statements that are missing, and compares what was produced against what was sworn in the disclosure — surfacing anything that doesn't add up. Ask questions in plain English ("which accounts received transfers over $10,000?") and get answers with the source document cited. Everything stays inside your firm's own walled-off workspace — nothing shared, nothing used to train outside AI — with built-in cost tracking so you always know what each matter spends. Discovery that used to take a paralegal weeks is organized before your second cup of coffee.
