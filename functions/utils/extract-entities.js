// functions/utils/extract-entities.js — ESM port from Katy's Netlify util.
// Calls Claude Haiku to extract named individuals from translated or scanned content.
// Fails open (returns empty array) so it never blocks a main translation/scan.
//
// docType: 'translation' | 'proof_scan'

const TRANSLATION_PROMPT = `You are analyzing an English translation of a Spanish civil document.

First determine the document type, then extract ONLY the key parties listed below. Never include witnesses, notaries, judges, priests, clerks, parents, attorneys, or preparers.

Rules by document type:
- MARRIAGE CERTIFICATE → extract the TWO people getting married (bride and groom) only. Maximum 2 people.
- BIRTH CERTIFICATE → extract the CHILD being registered only. Maximum 1 person.
- ANY OTHER CIVIL DOCUMENT → extract only the primary subject(s) of the document.

Additional rules:
- Keep compound/hyphenated last names as written (e.g. "Garcia-Lopez" stays as one last name)
- If A-Numbers (format A-XXXXXXXXX) are present, include them
- Each person appears once even if named multiple times

Respond with valid JSON only — no other text:
{
  "people": [
    {
      "full_name": "...",
      "first_name": "...",
      "last_name": "...",
      "email": null,
      "phone": null,
      "a_number": null,
      "role": "spouse|subject|applicant"
    }
  ]
}`;

const PROOF_SCAN_PROMPT = `You are analyzing an immigration form or petition.

Extract ONLY the following roles:
- Petitioner (the person filing / sponsoring)
- Beneficiary (the person seeking the immigration benefit)
- Joint sponsor (if one is explicitly present — do NOT fabricate)

Rules:
- Do NOT include attorneys, preparers, USCIS officers, interpreters, or witnesses
- Maximum 3 people total
- Keep compound/hyphenated last names as written
- If A-Numbers (format A-XXXXXXXXX) are present, include them

Respond with valid JSON only — no other text:
{
  "people": [
    {
      "full_name": "...",
      "first_name": "...",
      "last_name": "...",
      "email": null,
      "phone": null,
      "a_number": null,
      "role": "petitioner|beneficiary|joint_sponsor"
    }
  ]
}`;

export async function extractEntities(content, apiKey, docType = 'translation') {
  const prompt = docType === 'proof_scan' ? PROOF_SCAN_PROMPT : TRANSLATION_PROMPT;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role:    'user',
          content: `${prompt}\n\nDocument content (first 6000 characters):\n${String(content).substring(0, 6000)}`,
        }],
      }),
    });

    if (!res.ok) return { people: [] };
    const claude = await res.json();
    const text   = claude.content[0].text.trim()
      .replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(text);
    return { people: Array.isArray(parsed.people) ? parsed.people : [] };
  } catch {
    return { people: [] };
  }
}
