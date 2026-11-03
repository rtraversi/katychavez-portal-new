# Ask Claude — Authoritative Sources Plan

**Status:** 📋 Scoped, not started. Proposed branch `module/ai-chat-sources` (cut from `module/ai-chat`,
the KCL deploy branch). Proposed migration `2201_ai_chat_sources.sql` (ai_chat owns 2200–2299).
**Trigger:** staff asked whether the chat could look beyond Claude for answers. A second model
(ChatGPT, Gemini) was ruled out for now on cost, and because extra models add opinions, not evidence.
This plan adds **primary legal sources** that Claude searches and cites directly.

---

## Why

Today the chat has one research tool, Anthropic's web search. It works, but:

- It searches the whole web, so a law-firm blog post and the USCIS Policy Manual get equal weight.
  The 11/3 I-485 test answer cited 4 uscis.gov pages and 2 law-firm pages.
- Its results come back as encrypted page content, so the API's `citations` stayed empty and the
  Sources list never filled. The current workaround is a prompt asking Claude to type Markdown links
  inline.
- Every search costs $0.01, plus the page text it pulls in.
- We can't check what a web page said, because we never see its text. That rules out automated
  verification (Phase 3).

Searching the sources ourselves fixes all four. We pick the corpus, the results come back as
`search_result` blocks with real citations, and we hold the text Claude cited.

---

## The sources

| Source | What it covers | Access | Phase |
|---|---|---|---|
| **eCFR** | 8 CFR (DHS/DOJ), 22 CFR 40–42 (consular) | Public JSON search API + full-section XML, no key | 1 |
| **Federal Register** | Rules, interim rules, notices from USCIS, DHS, DOS, EOIR | Public JSON API, no key, agency filter | 1 |
| **CourtListener** | SCOTUS + circuit opinions (check BIA coverage) | REST v4 search, free account token | 1 |
| **USCIS Policy Manual** | The adjudication rules staff cite most | **No API.** Crawl and index ourselves | 2 |
| **INA (8 U.S.C.)** | The statute | uscode.house.gov USLM XML download, index ourselves | 2 |
| **9 FAM** | Consular visa adjudication | fam.state.gov HTML, index ourselves | 2b |
| **BIA / AG precedent decisions** | Agency precedent | justice.gov/eoir PDFs by volume; extract text with a local script, not in the Worker | 2b |
| Web search (existing) | Fees, processing times, announcements, anything not above | Anthropic server tool | stays |

**Ruled out for now:**
- **LegiScan.** It covers state legislation, and immigration is federal. Revisit only for
  state laws that affect immigrants (driver's licenses, in-state tuition).
- **AILA (InfoNet).** Members-only, no API. Putting it in a tool is a licensing and terms-of-service
  question for Katy/AILA before any code. Park it until that's answered in writing.
- **Second LLMs.** Cost, a second vendor seeing client facts, and correlated errors.

---

## How it fits the current chat

### Tools (custom client tools, executed by the Worker)

Two tools, not one per source. Fewer tools are easier for Claude to choose between, and the
Worker fans one call out to several sources in parallel.

- `search_authorities({ query, sources?: ['cfr','federal_register','case_law','policy_manual','ina','fam','bia'], limit? })`
  returns `search_result` blocks (`source` = canonical URL, `title` = citation + heading,
  `content` = passage text, `citations: { enabled: true }`).
- `read_authority({ id })` returns the full section or chapter when a snippet isn't enough.

`strict: true` and `eager_input_streaming: true` on both. The tool descriptions repeat the
no-identifiers rule: queries to eCFR, Federal Register and CourtListener leave the firm, the same as
web search. Queries against our own index (Policy Manual, INA, FAM, BIA) stay in Supabase.

**Why client tools and not the MCP connector:** the MCP connector (`mcp-client-2025-11-20`) would
avoid changing the Worker loop, but it's beta, it needs a public authenticated MCP endpoint, and
it's not confirmed that it carries `search_result` citations. Client tools are GA and give us the text.

### Worker loop (`functions/api/ai-chat-send.js`)

Today the loop only resumes `pause_turn`. It gains a `tool_use` branch:

1. On `stop_reason: "tool_use"`, run every `tool_use` block in parallel, then send **all**
   `tool_result`s back in **one** user message (`is_error: true` on failure, never dropped).
2. Keep `pause_turn` handling for the web search server loop. The two can alternate within one turn.
3. Cap total rounds per turn (`MAX_TOOL_ROUNDS`, start at 6) on top of `MAX_CONTINUATIONS`.
4. Stream a new event `{type:'lookup', source, query}` so the page shows "Searched 8 CFR: …" the way
   it shows web searches now.
5. Validate parsed tool input against the schema before running it (eager streaming turns off
   API-side validation).

Wall time grows. CPU time doesn't: the tools are I/O waits, well under `cpu_ms = 60000`.

### Storage (`2201`)

A turn becomes several API messages (assistant → user tool_results → assistant…). Today one
assistant row stores one `content` array, and `toApiMessages` replays it as-is.

- Add `ai_chat_messages.rounds jsonb null`. For tool turns it holds the exact interleaved
  `[{role, content}, …]`. `toApiMessages` expands it. Old rows (null) replay exactly as before.
- History must stay **append-only and byte-identical**, because Opus 5.5 thinking blocks are bound to
  the conversation (preserved thinking). Never trim or rewrite stored tool results.
- `transcript.js` renders from `rounds` when present: text joined, lookups listed, and **Sources
  built from real citations** (the empty-Sources problem goes away for authority answers).

### Toggles (decided 2026-11-03)

The chat is a general-purpose tool as well as a research tool: Katy wants staff to drop in a paycheck
and say "calculate yearly income." So web search stays, and case law is opt-in.

| Switch | Default | Covers |
|---|---|---|
| **Web search** (existing) | On (remembered per browser, as today) | Web search + eCFR + Federal Register + our own index (Policy Manual, INA, FAM, BIA) |
| **Case law** (new) | **Off**, resets with each new chat | CourtListener only |

Claude only uses lookups when a question needs them, so a paycheck question runs none. eCFR and the
Federal Register sit with web search because they have no key and no tight rate limit.
CourtListener gets its own switch because of its shared 125/day limit and the open
commercial-terms question.

**How "off" works without breaking the cache.** Every tool stays declared on every request. Taking
a tool out of `tools` would change the start of the cached prefix and invalidate the whole chat's
cache. It could also leave earlier `tool_use` blocks pointing at a tool that's no longer defined.
Instead:

1. The page sends `case_law: true|false` with each message.
2. The Worker appends a short note to that user message's text, e.g. `[Case law search: off for this
   message]`. That's append-only history, so cache-safe. The system prompt says what the note means and
   to suggest "turn on Case law" when a court decision would really help.
3. **Enforced in code, not just the prompt:** if Claude calls a CourtListener search while it's off,
   the Worker returns an `is_error` tool_result ("Case law search is turned off") without
   calling CourtListener.
4. With **Web search** off, `tool_choice: "none"` still turns off everything, as today.

---

## Phase 2: our own index

**Tables** (in `2201`, or `2202` if Phase 1 ships first):

- `authority_documents`: one row per section or chapter: `source`, `citation` (e.g.
  `8 CFR 214.2(h)`, `PM 7.B.2`), `title`, `url`, `content_hash`, `fetched_at`, `r2_key` (the raw
  HTML/XML snapshot lives in R2, per the files rule).
- `authority_passages`: chunks of about 300–600 words split on headings: `document_id`,
  `heading_path`, `text`, `tsv tsvector` (GIN index).
- Search is Postgres full-text (`websearch_to_tsquery`) plus an exact-citation match after normalizing
  `212(a)(9)(B)` / `INA 212` / `8 USC 1182`. Legal questions are keyword- and cite-heavy, so FTS is the
  right start. Add pgvector hybrid search (Workers AI embeddings) only if testing shows FTS
  misses.
- **Grants:** these are new `public` tables, so the migration GRANTs explicitly. `service_role`
  only (the Worker reads them, browsers never do), with RLS on and no anon/authenticated policies.

**Ingest:** a daily cron (the existing scheduled handler) that re-fetches only what changed:
the Policy Manual "updates" page, the eCFR/USLM amendment dates, and new FAM and BIA volume
listings. Pages fan out through a Cloudflare Queue so no single invocation hits subrequest or CPU
limits. Hash comparison skips unchanged pages. Crawl politely (low concurrency, an identifying
User-Agent without personal email). BIA PDF text extraction runs as a local Node script, then gets
uploaded, because pdf parsing in the Worker is a known CPU cost.

---

## Phase 3: verification with Jev (TypeSafe)

`search_result` citations give us, for free, pairs of (sentence in the answer, passage it cited).
For each pair, one Jev **Noul** judgment: *"Does this passage support this statement?"* That covers
every authority citation. Web-search citations can't be checked, because we never see their text.

- Runs after the answer finishes, as an async job: questions batched in one request, in
  parallel.
- The page shows a small mark per citation: supported, or "check this: the cited source may not say this."
- Thresholds come from testing, not defaults: build about 30 real Q&As (no client data), hand-label
  them, then pick the cutoff.
- Before committing: TypeSafe pricing per judgment, data terms (the passages are public law, but the
  answer text can carry client facts), and latency.

---

## Phasing and size

| Phase | Delivers | Size |
|---|---|---|
| **1** | Tool loop + `rounds` storage + eCFR, Federal Register, CourtListener + citations in Sources + toggle rename | M |
| **2** | Policy Manual + INA index, ingest cron | M–L |
| **2b** | 9 FAM + BIA/AG precedents | M |
| **3** | Jev citation verification | S–M plus eval time |

Each phase ships alone. Phase 1 is useful without the index, because 8 CFR and the Federal Register
alone cover most "what does the reg say" questions.

**Cost:** authority results are input tokens, about 6k for three searches × five passages, or ≈ $0.02
at Opus 5.5 input rates, then cache-read at $0.20/M on follow-ups. That's comparable to or cheaper than
web search's $0.01/search plus page text. The Owner usage panel needs a "lookups" count next to web
searches.

---

## Tests (`npm test`)

- Each source adapter has mocked `fetch` fixtures (eCFR, FR, CourtListener JSON) and is tested for
  `search_result` mapping, empty results, and upstream 4xx/5xx becoming an `is_error` result.
- Loop: tool_use → tool_result → end_turn; tool_use and pause_turn alternating; round cap; parallel
  results in one message; invalid tool input.
- `toApiMessages` round-trip: a `rounds` row replays byte-identical. Old rows are unchanged.
- Transcript: Sources built from citations, lookups listed.

---

## Decisions needed

1. **KCL-only or template?** The chat itself was built in KCL as an exception. The authority index is
   public law and useful to every firm, so it argues for building Phase 2 in the sandbox template.
2. ~~Toggle~~ **Decided 11/3:** keep Web search (default on). Add a separate Case law switch,
   default off (see Toggles).
3. **CourtListener account:** Rob's token is in `.env` as `COURTLISTENER_API_TOKEN` (the same token
   attytraining uses). Reviewed the terms on 2026-11-03 (ToS dated 2026-08-05). Using one account for
   several of your own projects is allowed, but they share one rate limit (default 5/min, 50/hr,
   125/day). The open question is the use itself: the terms say "If you need access for a product or a
   team, talk to us about a commercial agreement," and they forbid sharing or pooling tokens. A
   firm's staff using Rob's token through the portal is a team/product use, so confirm with Free Law
   Project (courtlistener.com/contact, issue type API) before go-live. Testing is fine meanwhile.
   Deploy it as a Worker secret (`wrangler secret put`), never in `wrangler.toml`.
4. **AILA:** Katy confirms whether there's any licensed path. Until then it's out.
