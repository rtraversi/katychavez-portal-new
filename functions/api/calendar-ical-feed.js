// GET /api/calendar/ical-feed?token=<uuid>
// Public endpoint (no bearer auth) — authenticated by the per-user ical_token.
// Returns an RFC 5545 .ics feed of all active-matter key dates (excluding marriage/separation).
// Attorneys subscribe to this URL in Apple Calendar (webcal://) or any other calendar app.

import { makeAdminClient } from './_helpers.js';

const DATE_TYPE_LABELS = {
  divorce_final: 'Divorce Final',
  filing:        'Filing',
  hearing:       'Hearing',
  mediation:     'Mediation',
  deposition:    'Deposition',
  trial:         'Trial',
  deadline:      'Deadline',
  dwop:          'DWOP',
  custom:        'Date',
};

// RFC 5545 line folding — fold at 75 octets
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const result = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 75) {
      result.push(current);
      current = ' ' + ch;
      bytes = 1 + n;
    } else {
      current += ch;
      bytes += n;
    }
  }
  if (current) result.push(current);
  return result.join('\r\n');
}

function escapeText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

// YYYY-MM-DD -> YYYYMMDD
function toIcalDate(dateStr) {
  return String(dateStr).replace(/-/g, '');
}

// Return the calendar date one day after dateStr (exclusive end for all-day events)
function nextDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

export async function onRequest({ request, env }) {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token') || '';

  // Basic UUID shape validation before hitting the DB
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return new Response('Not found', { status: 404 });
  }

  const supabase = makeAdminClient(env);

  // Resolve token -> user
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('ical_token', token)
    .eq('active', true)
    .maybeSingle();

  if (!user) {
    return new Response('Not found', { status: 404 });
  }

  // Fetch key dates from active matters (exclude historical relationship dates)
  const { data: rows } = await supabase
    .from('key_dates')
    .select(`
      id,
      date_type,
      date_value,
      description,
      matters!inner(
        case_number,
        status,
        clients(first_name, last_name)
      )
    `)
    .not('date_type', 'in', '(marriage,separation)')
    .order('date_value', { ascending: true });

  const dtstamp   = nowStamp();
  const firmName  = env.PORTAL_FIRM_NAME || 'Law Firm';
  const vevents   = [];

  for (const kd of rows || []) {
    if (kd.matters?.status === 'closed') continue;

    const client = kd.matters?.clients;
    const name   = client ? `${client.first_name} ${client.last_name}` : 'Unknown';
    const label  = DATE_TYPE_LABELS[kd.date_type] || kd.date_type;
    const summary = `${label} — ${name}`;

    const lines = [
      'BEGIN:VEVENT',
      `UID:${kd.id}@iurisiq.portal`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${toIcalDate(kd.date_value)}`,
      `DTEND;VALUE=DATE:${nextDay(kd.date_value)}`,
      foldLine(`SUMMARY:${escapeText(summary)}`),
    ];
    if (kd.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeText(kd.description)}`));
    }
    lines.push('END:VEVENT');
    vevents.push(lines.join('\r\n'));
  }

  const cal = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IurisIQ//Portal//EN',
    `X-WR-CALNAME:${escapeText(firmName)} — Matters`,
    'X-WR-TIMEZONE:America/Chicago',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(cal, {
    headers: {
      'Content-Type':        'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="portal-matters.ics"',
      'Cache-Control':       'no-cache, no-store, must-revalidate',
    },
  });
}
