// _proof-scan-run.js — the proof scan itself, run off the request path.
//
// This is where the rules, the Claude call, and the stored verdict live. It is a
// module rather than an endpoint because two different things start a scan and
// both need the identical run:
//
//   /api/proof-scan-process   fired by the browser right after the scan is
//                             queued, so it starts immediately
//   runProofScanSweep()       the daily/5-minute cron, which picks up anything
//                             the fast path never claimed or left stuck
//
// The second one is why the tab can be closed. A queued scan is a row, not a
// live request, so nothing is lost when the browser goes away — the sweeper
// finds it and the completion email is the signal.
//
// The Anthropic call streams. A 107-page package used to be one blocking,
// non-streaming request that the edge killed with a 524; streaming keeps bytes
// flowing for the whole generation, and it is also what makes a large
// max_tokens safe (PROOF-SCAN-HANDOFF.md §6, mitigation 2).

import { modelFor }               from './_models.js';
import { notifyProofScanComplete } from './_notifications.js';
import { readSseStream }          from '../utils/anthropic-stream.js';
import { makeAdminClient }        from './_helpers.js';
import { tmpKey, MAX_PDF_BYTES, tooLargeMessage } from './proof-scan-upload.js';
import { segmentPackage, spansFrom, checkSpans, bytesToBase64, contentBlockFor } from './_segment-package.js';

const FALLBACK_EDITIONS = 'G-1145|1p|09/26/14, G-1450|1p|06/03/25, G-1650|1p|06/03/25, G-28|4p|09/17/18, I-90|7p|01/20/25, I-130|12p|04/01/24, I-130A|6p|04/01/24, I-131|14p|01/20/25, I-485|24p|01/20/25, I-751|11p|04/01/24, I-765|7p|08/21/25, I-765WS|1p|08/21/25, I-821D|7p|01/20/25, I-864|12p|10/17/24, N-400|14p|01/20/25';

const SYSTEM_PROMPT_BASE = `You are a USCIS document proof checker for an immigration law firm. Review the uploaded PDF and check for the issues listed below. Your response must be valid HTML only — no Markdown.

PETITIONER vs. BENEFICIARY AWARENESS:
Before checking name consistency, identify the case type and the roles of each party:
- BENEFICIARY (applicant): the foreign national whose immigration benefit is being sought. Their name must match across all USCIS forms and their own supporting documents.
- PETITIONER / SPONSOR: a separate person filing on behalf of the beneficiary (e.g., a US citizen spouse on I-130, a US lawful permanent resident sponsor on I-864, a US military service member on an I-131 PIP case). Supporting documents belonging to the PETITIONER (birth certificates, military IDs, military orders, naturalization certificates, passports, etc.) will be in the PETITIONER'S name — this is correct and must NOT be flagged as a name mismatch.

MILITARY PAROLE IN PLACE (PIP) — I-131 filed under 8 CFR 212.5(b) or INA 212(d)(5) for parents/spouses/children of active duty US military:
- The US Service Member is the PETITIONER. Their documents (birth certificate, military ID, deployment orders, DD-214, etc.) will be in the service member's name, not the beneficiary's name. Do NOT flag this as a name inconsistency.
- The beneficiary's name must still be consistent across all USCIS forms in the package.
- G-28 attorney of record should cover the beneficiary.

CHECK FOR:
1. Form edition dates — check the edition date printed in the footer of EVERY page of EVERY form. Flag:
   a. Any page whose footer edition date does not match the current USCIS published edition for that form (note the page number)
   b. Any form where pages have inconsistent edition dates among themselves — this indicates a signature page or other page from an older edition was inserted into a current-edition package. Call out which page(s) carry the old date.
   This per-page check is critical: it is common for applicants to submit a signature page from a previous edition mixed with current-edition pages. Each USCIS form page prints the edition date in its footer — read every one.
2. Page counts — flag missing or extra pages for each form identified
3. Blank or duplicate pages. Note: multiple G-1450 and/or G-1650 forms in a single package are normal and expected (one per filing fee) — do not flag them as duplicates.
4. Required signatures — applicant and attorney/preparer on all applicable forms. Exception: the I-765WS does not require a signature — do not flag it.
5. Signature dates — attorney must not sign before applicant
6. Name consistency — BENEFICIARY name must match across all USCIS forms and beneficiary supporting documents. PETITIONER/SPONSOR documents in a different name are expected and should not be flagged.
7. A-Number consistency — must match across all forms where present. A-Numbers may appear as A-XXXXXXXXX or XXX-XXX-XXX — treat these as equivalent formats and only flag if the underlying digits actually differ.
8. Address consistency — mailing address must match across forms
9. Bank routing number validation on any G-1650 forms found. G-1650 is for ACH bank drafts and carries a routing number. G-1450 is the credit card equivalent — it has no routing number and requires no bank validation.

USCIS FORM REFERENCE (current editions — updated daily from USCIS.gov):
{{FORM_EDITIONS}}

BANK ROUTING REFERENCE (for G-1650 validation):
021000021 JPMorgan Chase, 021000089 Citibank, 026009593 Bank of America, 021001208 Bank of America, 026012881 Bank of America, 021200339 Wells Fargo, 053000219 Wells Fargo, 021202337 JPMorgan Chase, 044000037 JPMorgan Chase, 071000013 JPMorgan Chase, 322271627 JPMorgan Chase, 083000108 PNC Bank, 041000124 PNC Bank, 054000030 PNC Bank, 031000053 PNC Bank, 021052053 Capital One, 056073502 Capital One, 051405515 Capital One, 065000090 Capital One, 031100649 TD Bank, 011103093 TD Bank, 267084131 TD Bank, 021300077 HSBC, 022000020 KeyBank, 041001039 KeyBank, 121122676 US Bank, 091000022 US Bank, 071904779 US Bank, 081000210 US Bank, 314972853 Navy Federal, 256074974 Navy Federal, 311079674 USAA, 114994196 USAA, 261271694 Truist, 053101121 Truist, 055002707 Truist, 042101706 Huntington, 044201847 Huntington, 011401533 Citizens Bank, 241070417 Citizens Bank

NOTES:
- G-1450 and G-1650 do NOT require a date next to the signature — do not flag this.
- G-1450 is the credit card payment form; G-1650 is the ACH bank draft form. Multiple G-1450/G-1650 in one package are normal (separate fees per filing). Do not flag them as duplicates. Only G-1650 has a routing number to validate.
- For DACA (I-821D) packages: the I-765WS is never listed on the G-28 attorney of record — do not flag its absence from the G-28.
- I-765WS does not require a signature — do not flag it as unsigned.
- I-821D Items 6, 7, and 8 (education guideline, school name, graduation date) apply only to initial DACA submissions. The government is currently only accepting DACA renewals, not initial filings — do not flag these items as missing or incomplete.
- When a supporting document (birth certificate, passport, military ID, etc.) is in a name different from the beneficiary, first determine whether it logically belongs to the petitioner or a third party before flagging it as an error.

Format your response as:
- A summary section (overall status: PASS / NEEDS CORRECTION), including the identified case type and the names of the beneficiary and petitioner/sponsor if determinable
- An HTML table: Status | Form/Document | Issue | Detail
- A cross-check section (beneficiary name consistency across USCIS forms, A-Number, address, signature date order)
- If a G-1650 is found: a Bank Validation section showing routing number, bank name on form, expected bank, and match status. (G-1450 is credit card — no routing validation needed.)`;

// Generation cap. Below the page's 10-minute poll ceiling, so a hung stream
// still resolves to a stored 'error' the poller and the email can report,
// rather than a row that sits in 'processing' forever.
const CLAUDE_TIMEOUT_MS = 9 * 60_000;

// A job that has been 'processing' longer than this was abandoned — the tab
// closed mid-run, or the Worker handling it died. Comfortably above the
// generation cap so a slow-but-alive scan is never stolen from itself.
const STUCK_AFTER_MS = 12 * 60_000;

// How long a 'queued' scan may sit before the sweeper assumes the browser's
// fast-path request never arrived and starts it. Long enough that the sweeper
// and the fast path do not race on a scan that is about to be claimed anyway.
const QUEUED_GRACE_MS = 90_000;

// Attempts allowed before a repeatedly-failing scan is left as an error rather
// than swept again. Two, because the common cause of a lost run (a closed tab)
// succeeds on the retry, and a third pass has never been the difference.
const MAX_ATTEMPTS = 2;

// ── Prompt assembly ───────────────────────────────────────────────────────────
// The base rules, plus the editions table, plus whatever this firm added in the
// UI. Both DB reads fail open: a scan against a stale editions list is worth
// more than no scan at all.

async function loadEditions(admin) {
  try {
    const { data: rows } = await admin
      .from('form_editions')
      .select('form_number, pages, edition_date')
      .order('form_number', { ascending: true });
    return rows?.length ? rows : null;
  } catch { return null; }
}

async function buildPrompt(admin, editionRows) {
  const formEditions = editionRows
    ? editionRows.map(r => `${r.form_number}|${r.pages}p|${r.edition_date}`).join(', ')
    : FALLBACK_EDITIONS;

  let customInstructions = '';
  try {
    const { data: rows } = await admin
      .from('proof_scan_config')
      .select('custom_instructions')
      .limit(1);
    customInstructions = rows?.[0]?.custom_instructions?.trim() || '';
  } catch { /* fail-open */ }

  const base = SYSTEM_PROMPT_BASE.replace('{{FORM_EDITIONS}}', formEditions);
  return customInstructions
    ? `${base}

ADDITIONAL FIRM-SPECIFIC INSTRUCTIONS (take these into account alongside the base rules above):
${customInstructions}`
    : base;
}

// ── The page map ──────────────────────────────────────────────────────────────
// Segment the filing into (form, page-range) spans and check those spans against
// the page counts we already know. This is step 5 of the rebuild: the scan stops
// being one prompt that has to hold 107 pages in its head and notice that a page
// is missing, and starts having a map it can be checked against
// (PROOF-SCAN-HANDOFF.md §6).
//
// Deliberately additive and fail-open. It does not touch the scan prompt or the
// report the model writes — those are the rules track's to change (§2), and a
// segmenter outage must never be the reason a package goes unscanned. What it
// adds is a section of findings that involved no model judgment at all.
async function pageMapSection(env, fileBase64, editionRows) {
  if (!editionRows?.length) return '';
  try {
    const candidates = editionRows.map(r => ({
      form_key:     String(r.form_number).toLowerCase(),
      edition_date: r.edition_date,
    }));
    const expectedPages = {};
    for (const r of editionRows) {
      const n = Number(r.pages);
      if (Number.isInteger(n)) expectedPages[String(r.form_number).toLowerCase()] = n;
    }

    const { pages } = await segmentPackage(env, {
      documents:  [{ label: 'package', contentBlock: contentBlockFor('application/pdf', fileBase64) }],
      candidates,
      // Reading a footer is not reasoning. Run it cheap — the map is checked in
      // code, so a stronger model buys nothing here.
      role: 'extract',
    });

    const { spans, unrouted } = spansFrom(pages);
    const findings = checkSpans(spans, expectedPages);
    return renderPageMap(spans, unrouted, findings);
  } catch (err) {
    console.warn('[proof-scan] page map unavailable:', err.message);
    return '';
  }
}

export function renderPageMap(spans, unrouted, findings) {
  if (!spans.length && !unrouted.length) return '';

  const rows = spans.map(s => `<tr><td>${s.form_key.toUpperCase()}</td><td>pages ${s.start + 1}–${s.end + 1}</td><td>${s.seen.length} page${s.seen.length === 1 ? '' : 's'} identified</td></tr>`).join('');
  const evidence = unrouted.length
    ? `<p>${unrouted.length} page${unrouted.length === 1 ? '' : 's'} did not match any USCIS form — supporting evidence, or unreadable scans.</p>`
    : '';
  const issues = findings.length
    ? `<ul>${findings.map(f => `<li><strong>${f.form_key.toUpperCase()}</strong> — ${f.detail}</li>`).join('')}</ul>`
    : '<p>Every form found has all of its pages.</p>';

  return `<h3>Page Map</h3>
<p style="font-size:.9em">Read from the footers and checked against the current editions — no judgment involved.</p>
<table><thead><tr><th>Form</th><th>Where</th><th>Pages</th></tr></thead><tbody>${rows}</tbody></table>
${evidence}
<h4>Page count check</h4>
${issues}`;
}

// Sending the result email must never be able to fail a scan that already
// produced one — including the failure email itself.
async function notify(env, admin, fields) {
  try {
    const { data: rows } = await admin
      .from('proof_scan_config')
      .select('notify_email')
      .limit(1);
    const toEmail = rows?.[0]?.notify_email?.trim();
    if (!toEmail) return;
    await notifyProofScanComplete(env, { toEmail, ...fields });
  } catch (err) {
    console.error('[proof-scan] notify error:', err.message);
  }
}

// ── Turning a generation into a stored verdict ────────────────────────────────
// Pure, and exported for tests, because both halves have bitten before: the
// status is a substring match over model prose, and a report cut off at
// max_tokens used to be stored as a clean PASS because stop_reason was never
// read. A truncated report is never a pass — it is a report nobody has seen the
// end of, and the banner has to say so on the report itself.
export function reportFrom(text, stopReason) {
  const truncated = stopReason === 'max_tokens';
  const html = truncated
    ? `<div class="proof-result"><strong>⚠ This report was cut off before it finished.</strong> It is incomplete — re-run the scan or split the package.</div>${text}`
    : text;
  const status = (truncated || html.includes('NEEDS CORRECTION')) ? 'needs_correction' : 'pass';
  return { html, status, truncated };
}

// ── What to do with a scan stuck in 'processing' ──────────────────────────────
// Pure, and exported for tests: this is the rule that decides between a retry
// and giving up, and getting it wrong in either direction is expensive — one
// way a package is never scanned, the other way it is scanned (and billed)
// forever on a five-minute loop.
export function sweepVerdict(row, nowMs) {
  const started = Date.parse(row.started_at ?? '');
  // No usable started_at means the claim never recorded one; treat it as stuck
  // rather than leaving the row untouchable.
  if (Number.isFinite(started) && nowMs - started < STUCK_AFTER_MS) return 'wait';
  return (row.attempts ?? 0) >= MAX_ATTEMPTS ? 'abandon' : 'requeue';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Claiming ──────────────────────────────────────────────────────────────────
// queued → processing as a conditional UPDATE, so two starters racing on the
// same scan produce one winner and one empty result. The loser does nothing —
// it does not need to know who won.

export async function claimScan(admin, scanId) {
  const { data: rows } = await admin
    .from('proof_scans')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', scanId).eq('status', 'queued')
    .select('id, filename, upload_id, attempts');
  return rows?.[0] || null;
}

// ── Running one scan ──────────────────────────────────────────────────────────
// Never throws. Every exit writes a terminal status to the row, because the row
// is the only thing the poller, the email and the sweeper can see — a scan that
// fails silently is a scan that sits in 'processing' until it is swept.

export async function runProofScan(env, admin, scan) {
  const filename = scan.filename || 'document.pdf';

  const finish = async (fields) => {
    await admin.from('proof_scans')
      .update({ ...fields, completed_at: new Date().toISOString() })
      .eq('id', scan.id);
  };
  const fail = async (detail) => {
    console.error(`[proof-scan] ${scan.id} failed:`, detail);
    await finish({ status: 'error', error_detail: detail });
    // Whoever closed the tab is waiting on the email, so a failure has to send
    // one too — silence would read as "still running".
    await notify(env, admin, {
      filename, status: 'error',
      resultHtml: `<p>The scan did not complete.</p><p>${escapeHtml(detail)}</p>`,
    });
    return { status: 'error', error: detail };
  };

  // ── The package ─────────────────────────────────────────────────────────
  let fileBase64;
  try {
    if (!env.R2) return await fail('Storage is not configured on this portal.');
    const obj = await env.R2.get(tmpKey(scan.upload_id));
    if (!obj) {
      return await fail('The uploaded package was no longer in storage when the scan started. Upload it again.');
    }
    if (obj.size > MAX_PDF_BYTES) {
      await env.R2.delete(tmpKey(scan.upload_id)).catch(() => {});
      return await fail(tooLargeMessage(obj.size));
    }
    fileBase64 = bytesToBase64(new Uint8Array(await obj.arrayBuffer()));
  } catch (err) {
    return await fail(`The uploaded package could not be read: ${err.message}`);
  }

  const editionRows  = await loadEditions(admin);
  const systemPrompt = await buildPrompt(admin, editionRows);

  // Segment first, in parallel with nothing — it is one cheap call and the
  // scan below is the long pole. Its output is appended to the report, never
  // fed to the scan prompt: the rules track owns what the model is told (§2).
  const mapSection = await pageMapSection(env, fileBase64, editionRows);

  // ── The scan ────────────────────────────────────────────────────────────
  let acc;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLAUDE_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      signal:  abort.signal,
      headers: {
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model: modelFor('judge', env),
        // Streaming, not because anyone watches the report arrive — nobody
        // does — but because one non-streaming request over 107 pages is what
        // produced the 524. It is also what makes a large max_tokens safe.
        stream:     true,
        max_tokens: 32000,
        // A miss here is a USCIS rejection and a false positive burns paralegal
        // time, so the model is told to think. 'high' is the API default; it is
        // written out because this is the knob to raise ('xhigh', 'max') if the
        // rules revamp needs more depth than prompt wording can buy.
        //
        // Both parameters require a 4.6-or-later model. A portal that pins
        // MODEL_JUDGE to something older will get a 400 from this call.
        thinking:      { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'document',
              source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 },
            },
            {
              type: 'text',
              text: 'Please run the proof check on this document. Respond in valid HTML only.',
            },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return await fail(`Claude API ${res.status}: ${errText.slice(0, 500)}`);
    }
    acc = await readSseStream(res);
  } catch (err) {
    return await fail(err.name === 'AbortError'
      ? `The scan was still running after ${Math.round(CLAUDE_TIMEOUT_MS / 60000)} minutes and was stopped. Try splitting the forms from the evidence and scanning each separately.`
      : `Claude API error: ${err.message}`);
  } finally {
    clearTimeout(timer);
    // The staged package is single-use — encoding it above was the only thing
    // that needed it. The daily cron mops up anything that never got here.
    if (scan.upload_id) await env.R2?.delete(tmpKey(scan.upload_id)).catch(() => {});
  }

  if (acc.error()) return await fail(`Claude stream error: ${acc.error()}`);
  const text = acc.text();
  if (!text) return await fail('Claude returned an empty report.');

  const { html: scanHtml, status, truncated } = reportFrom(text, acc.stopReason());
  const html = mapSection ? `${scanHtml}${mapSection}` : scanHtml;
  if (truncated) console.warn(`[proof-scan] ${scan.id} hit max_tokens — report truncated`);

  await finish({
    status,
    result_html: html,
    upload_id:   null,
    // A streamed call has no response body to read usage off — it arrives on
    // the message_delta events — so this comes from the accumulator.
    tokens_used: acc.usage().output_tokens ?? 0,
  });

  // The email is the completion signal for anyone who closed the tab — which is
  // the whole point of the scan being a job rather than a request.
  await notify(env, admin, { filename, status, resultHtml: html });

  return { status, html };
}

// ── The sweeper ───────────────────────────────────────────────────────────────
// Runs on the 5-minute cron. Its whole job is the scans the fast path lost: a
// tab closed before /api/proof-scan-process fired, or closed mid-run and took
// the Worker with it. One scan started per invocation — a cron tick has its own
// wall-clock budget, so a backlog drains at one every five minutes rather than
// risking a tick that dies partway through several.

export async function runProofScanSweep(env) {
  const admin = makeAdminClient(env);
  const now   = Date.now();

  // Requeue anything stuck in 'processing' past the point where its runner must
  // be gone. Out of attempts, it stops here as an error rather than cycling.
  const { data: stuck } = await admin
    .from('proof_scans')
    .select('id, attempts, started_at')
    .eq('status', 'processing')
    .lt('started_at', new Date(now - STUCK_AFTER_MS).toISOString())
    .limit(5);

  for (const row of stuck || []) {
    const verdict = sweepVerdict(row, now);
    if (verdict === 'wait') continue;
    if (verdict === 'abandon') {
      console.warn(`[proof-scan] ${row.id} abandoned after ${row.attempts} attempts`);
      await admin.from('proof_scans').update({
        status:       'error',
        error_detail: 'The scan stopped partway through more than once. Re-upload the package and try again.',
        completed_at: new Date().toISOString(),
      }).eq('id', row.id).eq('status', 'processing');
    } else {
      console.warn(`[proof-scan] ${row.id} stuck in processing — requeueing`);
      await admin.from('proof_scans')
        .update({ status: 'queued', started_at: null })
        .eq('id', row.id).eq('status', 'processing');
    }
  }

  // Then start the oldest scan that has waited longer than the fast path would
  // have taken to claim it.
  const { data: waiting } = await admin
    .from('proof_scans')
    .select('id, filename, upload_id, attempts')
    .eq('status', 'queued')
    .lt('created_at', new Date(now - QUEUED_GRACE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(1);

  const next = waiting?.[0];
  if (!next) return;

  const claimed = await claimScan(admin, next.id);
  if (!claimed) return;   // the fast path got there first

  await admin.from('proof_scans')
    .update({ attempts: (claimed.attempts ?? 0) + 1 })
    .eq('id', claimed.id);

  console.log(`[proof-scan] sweeper running ${claimed.id}`);
  await runProofScan(env, admin, claimed);
}
