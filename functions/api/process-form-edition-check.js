// Form-edition staleness check — the Tier 1 automated guard.
//
// Runs weekly (see _worker.js scheduled()). For every row in form_editions it
// fetches the form's page on uscis.gov, reads the current edition date, and
// compares it to the edition we have stored. The result lands in
// form_editions.check_status, which the USCIS Forms UI badge and the digest
// email both read.
//
// Design guarantee: a form is only ever marked 'current' when we POSITIVELY
// parsed an edition off the page AND it matches ours. Anything else — the page
// didn't load, or loaded but no edition could be found (USCIS restyled and the
// scrape broke) — is 'error', an alert state, never a silent pass. A scraper
// that quietly stops working is worse than no scraper, so it fails loud.
//
// The email is a single weekly digest, sent only when a form's status WORSENS
// (current/unknown -> stale/error) that run, so a steady-state stale form does
// not re-spam the team every week.
//
// Proof Scan v2.0.2:
//   D-122  a page that cannot be read keeps the last good edition (and its
//          notices) instead of wiping it, so the checker never falls back to
//          an old reference date because of one bad fetch
//   D-127  each page's notice text is read too: which editions USCIS accepts,
//          and until when (_uscis-editions.js); a notice that mentions an
//          edition in a way that is not understood is flagged for a person
//   D-128  staff can run the check on demand (proof-scan-v2-editions.js); the
//          weekly run stays

import { createClient } from '@supabase/supabase-js';
import { notifyFormEditionStale } from './_notifications.js';
import { parseEditionNotices, acceptedEditions } from './_uscis-editions.js';

const FETCH_TIMEOUT_MS = 15000;

// USCIS form landing page. Most forms live at uscis.gov/<lowercased-number>
// (i-130, g-1145, n-400); form_editions.source_url overrides this for any that
// don't. form_number is stored uppercase ('I-130').
function pageUrlFor(row) {
  if (row.source_url) return row.source_url;
  return `https://www.uscis.gov/${row.form_number.toLowerCase()}`;
}

// USCIS prints editions as MM/DD/YY. Normalize to MMDDYY so "04/01/24" and
// "04/01/2024" compare equal. Mirrors parseEdition() in package-builder-analyze.js.
function normalizeEdition(s) {
  const m = String(s || '').match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!m) return null;
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  const yy = (Number(m[3]) % 100).toString().padStart(2, '0');
  return `${mm}${dd}${yy}`;
}

// Pull the current edition date out of a USCIS form page. Their pages label the
// value "Edition Date" followed by the date — but the same phrase also appears
// in boilerplate prose ("you can find the edition date at the bottom of the
// page…") with no date near it. So scan EVERY "Edition Date" label in document
// order and return the date from the first label that actually has one within a
// short window; the prose mentions fall through because no date follows them.
// Scoping to a label's window (not the whole page) keeps a "related forms" date
// elsewhere from being mistaken for the edition. Returns e.g. "04/01/24" or null.
export function extractEdition(html) {
  if (!html) return null;
  // Strip tags so a date split across markup ("<span>04/01/24</span>") still
  // reads as contiguous text near its label.
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const label = /edition\s*date/ig;
  let m;
  while ((m = label.exec(text)) !== null) {
    // Look only just past the label, so we grab its value and not a later,
    // unrelated date. USCIS renders "Edition Date <date>" tightly together.
    const window = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const date = window.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (date) return date[1];
  }
  return null;
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // A plain default UA can get a bot-block page with no edition on it,
        // which would (correctly) read as 'error'. A browser-like UA avoids a
        // false alert; the request is read-only and low-volume (weekly).
        'User-Agent': 'Mozilla/5.0 (compatible; IurisIQ-EditionCheck/1.0)',
        'Accept': 'text/html',
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { html: await res.text() };
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'timed out' : (err.message || 'fetch failed') };
  } finally {
    clearTimeout(timer);
  }
}

// Decide the new status for one form from a fetch result. Pure, so it's unit
// testable without the network.
//
// D-122: on an error the result carries no upstream_edition and no
// edition_notices at all, so run() leaves the last good ones in place.
export function evaluate(row, fetchResult) {
  if (fetchResult.error) {
    return { check_status: 'error', check_error: `Could not reach ${row.form_number} page: ${fetchResult.error}` };
  }
  const rawUpstream = extractEdition(fetchResult.html);
  if (!rawUpstream) {
    return { check_status: 'error', check_error: 'Page loaded but no edition date could be found (the USCIS page may have changed — verify manually).' };
  }
  const edition_notices = parseEditionNotices(fetchResult.html, row.form_number);
  const up  = normalizeEdition(rawUpstream);
  const ours = normalizeEdition(row.edition_date);
  if (up && ours && up === ours) {
    return { check_status: 'current', upstream_edition: rawUpstream, check_error: null, edition_notices };
  }
  return { check_status: 'stale', upstream_edition: rawUpstream, check_error: null, edition_notices };
}

// Whether a form's stored notice needs a person today (D-127).
export function noticeUnclear(row, on = new Date().toISOString().slice(0, 10)) {
  const n = row?.edition_notices;
  if (!n || !row.upstream_edition) return false;
  return acceptedEditions({ published: row.upstream_edition, statements: n.statements || [], unreadable: n.unreadable || [] }, on).unclear;
}

const CONCURRENCY = 4;

export async function run(env, adminOverride) {
  const admin = adminOverride || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error } = await admin
    .from('form_editions')
    .select('id, form_number, edition_date, source_url, check_status, upstream_edition, edition_notices')
    .order('form_number');

  if (error) {
    console.error('[edition-check] load failed:', error.message);
    return { checked: 0, stale: 0, errored: 0 };
  }

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const worsened = [];   // forms that transitioned INTO stale/error this run
  const changed = [];    // forms whose published edition differs from the last good check
  const unclear = [];    // forms whose USCIS notice needs a person (D-127)
  let stale = 0, errored = 0;

  async function checkOne(row) {
    const url    = pageUrlFor(row);
    const result = await fetchPage(url);
    const next   = evaluate(row, result);

    const wasClean = row.check_status === 'current' || row.check_status === 'unknown';
    const nowBad   = next.check_status === 'stale' || next.check_status === 'error';
    if (nowBad) (next.check_status === 'stale' ? stale++ : errored++);
    const kept = next.upstream_edition === undefined; // D-122: the last good read stays
    const upstream = kept ? row.upstream_edition : next.upstream_edition;
    if (!kept && row.upstream_edition && normalizeEdition(row.upstream_edition) !== normalizeEdition(next.upstream_edition)) {
      changed.push(row.form_number);
    }
    const wasUnclear = noticeUnclear(row, today);
    const isUnclear = noticeUnclear({ upstream_edition: upstream, edition_notices: kept ? row.edition_notices : next.edition_notices }, today);
    if (isUnclear) unclear.push(row.form_number);
    if ((wasClean && nowBad) || (isUnclear && !wasUnclear)) {
      worsened.push({
        form_number: row.form_number, ours: row.edition_date, upstream, status: next.check_status,
        detail: next.check_error || (isUnclear ? 'USCIS has a notice about accepted editions that could not be read for certain. Check it on uscis.gov.' : null),
      });
    }

    const patch = { check_status: next.check_status, check_error: next.check_error, last_checked_at: nowIso };
    if (!kept) { patch.upstream_edition = next.upstream_edition; patch.edition_notices = next.edition_notices; }
    const { error: updErr } = await admin.from('form_editions').update(patch).eq('id', row.id);
    if (updErr) console.error(`[edition-check] update ${row.form_number} failed:`, updErr.message);
  }

  // A few at a time: on demand (D-128) a person is waiting for the answer.
  const queue = [...(rows || [])];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await checkOne(queue.shift());
  }));

  console.log(`[edition-check] checked ${rows?.length || 0} — ${stale} stale, ${errored} errored, ${worsened.length} newly flagged, ${unclear.length} unclear notices`);

  // Digest only when something newly went bad — no steady-state spam.
  if (worsened.length) {
    try {
      const { data: staff } = await admin.from('users').select('email, roles(name)').eq('active', true);
      const team = (staff || []).filter(u => u.email && u.roles?.name !== 'Client');
      await Promise.all(team.map(u =>
        notifyFormEditionStale(env, { toEmail: u.email, forms: worsened })
          .catch(err => console.error(`[edition-check] digest to ${u.email} failed:`, err.message))
      ));
    } catch (err) {
      console.error('[edition-check] digest notification failed (non-fatal):', err.message);
    }
  }

  return { checked: rows?.length || 0, stale, errored, worsened: worsened.length, changed, unclear };
}
