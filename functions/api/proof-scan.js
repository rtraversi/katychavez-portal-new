// proof-scan.js — USCIS document proof checker (CF Worker port from Katy's Netlify function)
// POST only. Body: { file_base64: string, filename: string }
//
// Size limits, and what they are actually protecting against:
//
// Anthropic accepts a 32 MiB request. Base64 inflates a file by 4/3, so a PDF
// above 24 MiB cannot physically fit, prompt included — that ceiling is hard and
// this endpoint refuses it with a reason instead of letting the API reject it.
//
// The softer, nearer wall is TIME. A 107-page AOS package (19.4 MiB) returns
// HTTP 524: Cloudflare's edge stops waiting before one blocking, non-streaming
// call over that many pages finishes. Nothing here can raise that ceiling — the
// fix is to move the scan off the request path (PROOF-SCAN-HANDOFF.md §6). Until
// then this at least fails in words rather than as a mystery gateway error.

import { verifyAuth, json, makeAdminClient } from './_helpers.js';
import { modelFor, textFrom } from './_models.js';
import { notifyProofScanComplete } from './_notifications.js';

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

// 23 MiB, not 24: base64 of 24 MiB is exactly Anthropic's 32 MiB request limit,
// leaving nothing for the system prompt or the JSON around it.
const MAX_PDF_BYTES = 23 * 1024 * 1024;

const mib = bytes => (bytes / 1024 / 1024).toFixed(1);

// Original byte count of a base64 string, without decoding 20 MiB to find out.
// Exported for tests: the padding term is the part that is easy to get wrong,
// and getting it wrong shifts the size limit by a couple of bytes in silence.
export function base64Bytes(b64) {
  if (typeof b64 !== 'string' || !b64.length) return 0;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export async function onRequest({ request, env, ctx }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'proof_scan');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { file_base64, filename } = body;
  if (!file_base64) return json(400, { error: 'No file provided' });

  const fileBytes = base64Bytes(file_base64);
  if (fileBytes > MAX_PDF_BYTES) {
    return json(413, {
      error: `This package is ${mib(fileBytes)} MB, over the ${mib(MAX_PDF_BYTES)} MB limit a single scan can accept. Split it — scanning the forms and the evidence separately works — and run each part.`,
    });
  }

  const admin = makeAdminClient(env);

  // DEMO_MODE: skip Claude, return pre-seeded scan result
  if (env.DEMO_MODE === 'true') {
    const { data: rows } = await admin.from('proof_scans')
      .select('id, result_html, status')
      .order('created_at', { ascending: false })
      .limit(1);
    const seed = rows?.[0];
    return json(200, {
      html:     seed?.result_html || '<div class="proof-result pass"><h3>✓ Form Verified — No Issues Found</h3><p>All fields complete. Package is ready to file.</p></div>',
      scan_id:  seed?.id || null,
      filename: filename || 'document.pdf',
      status:   'success',
    });
  }

  // Fetch form editions from DB; fall back to hardcoded string
  let formEditions = FALLBACK_EDITIONS;
  try {
    const { data: rows } = await admin
      .from('form_editions')
      .select('form_number, pages, edition_date')
      .order('form_number', { ascending: true });
    if (rows?.length) {
      formEditions = rows.map(r => `${r.form_number}|${r.pages}p|${r.edition_date}`).join(', ');
    }
  } catch { /* use fallback */ }

  // Fetch custom instructions + notify email; fail-open
  let customInstructions = '';
  let notifyEmail = '';
  try {
    const { data: rows } = await admin
      .from('proof_scan_config')
      .select('custom_instructions, notify_email')
      .limit(1);
    customInstructions = rows?.[0]?.custom_instructions?.trim() || '';
    notifyEmail        = rows?.[0]?.notify_email?.trim()        || '';
  } catch { /* fail-open */ }

  const basePrompt = SYSTEM_PROMPT_BASE.replace('{{FORM_EDITIONS}}', formEditions);
  const fullSystemPrompt = customInstructions
    ? `${basePrompt}\n\nADDITIONAL FIRM-SPECIFIC INSTRUCTIONS (take these into account alongside the base rules above):\n${customInstructions}`
    : basePrompt;

  // Call Anthropic API
  let claudeData;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':        env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':     'application/json',
      },
      body: JSON.stringify({
        model:      modelFor('judge', env),
        // A miss here is a USCIS rejection and a false positive burns paralegal
        // time, so this runs on the judge tier with thinking left on (adaptive
        // by default on Opus 5). It is slower than the old Sonnet 4.6 call —
        // acceptable only because 4096 could truncate a full AOS report mid-table
        // and the scan is moving off the request path (PROOF-SCAN-HANDOFF.md §6).
        max_tokens: 16000,
        system:     fullSystemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type:   'document',
              source: { type: 'base64', media_type: 'application/pdf', data: file_base64 },
            },
            {
              type: 'text',
              text: 'Please run the proof check on this document. Respond in valid HTML only.',
            },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API ${claudeRes.status}: ${errText}`);
    }
    claudeData = await claudeRes.json();
    if (!textFrom(claudeData)) {
      throw new Error('Unexpected response from Claude API (no content)');
    }
  } catch (err) {
    console.error('[proof-scan] Claude API error:', err.message);
    return json(500, { error: err.message });
  }

  const truncated  = claudeData.stop_reason === 'max_tokens';
  const tokensUsed = claudeData.usage?.output_tokens ?? 0;

  // A report cut off mid-table used to be stored as a clean pass, because
  // stop_reason was never read and the status is a substring match. Say so on
  // the report and never let a truncated scan read as passing.
  const html = truncated
    ? `<div class="proof-result"><strong>⚠ This report was cut off before it finished.</strong> It is incomplete — re-run the scan or split the package.</div>${textFrom(claudeData)}`
    : textFrom(claudeData);
  const status = (truncated || html.includes('NEEDS CORRECTION')) ? 'needs_correction' : 'pass';
  if (truncated) console.warn('[proof-scan] output hit max_tokens — report truncated');

  // Save to proof_scans table
  let scanId;
  try {
    const { data: rows } = await admin
      .from('proof_scans')
      .insert({
        filename:    filename || 'document.pdf',
        result_html: html,
        status,
        tokens_used: tokensUsed,
        scanned_by:  auth.profile.id,
      })
      .select('id');
    scanId = rows?.[0]?.id;
  } catch (err) {
    console.error('[proof-scan] DB save error:', err.message);
    // Don't block response if DB save fails
  }

  // Send email notification — use ctx.waitUntil so the Worker stays alive after returning the response
  if (notifyEmail) {
    ctx.waitUntil(
      notifyProofScanComplete(env, {
        toEmail:    notifyEmail,
        filename:   filename || 'document.pdf',
        status,
        resultHtml: html,
      }).catch(err => console.error('[proof-scan] notify error:', err.message))
    );
  }

  return json(200, {
    html,
    scan_id:  scanId,
    filename: filename || 'document.pdf',
    status:   'success',
  });
}
