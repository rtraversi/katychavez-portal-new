// proof-scan.js — USCIS document proof checker (CF Worker port from Katy's Netlify function)
// POST only. Body: { file_base64: string, filename: string }

import { verifyAuth, json, makeAdminClient } from './_helpers.js';

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

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'proof_scan');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { file_base64, filename } = body;
  if (!file_base64) return json(400, { error: 'No file provided' });

  const admin = makeAdminClient(env);

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

  // Fetch custom instructions; fail-open
  let customInstructions = '';
  try {
    const { data: rows } = await admin
      .from('proof_scan_config')
      .select('custom_instructions')
      .limit(1);
    customInstructions = rows?.[0]?.custom_instructions?.trim() || '';
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
        'anthropic-beta':   'pdfs-2024-09-25',
        'content-type':     'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 4096,
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
  } catch (err) {
    console.error('[proof-scan] Claude API error:', err.message);
    return json(500, { error: err.message });
  }

  const html       = claudeData.content[0].text;
  const tokensUsed = claudeData.usage?.output_tokens ?? 0;
  const status     = html.includes('NEEDS CORRECTION') ? 'needs_correction' : 'pass';

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

  return json(200, {
    html,
    scan_id:  scanId,
    filename: filename || 'document.pdf',
    status:   'success',
  });
}
