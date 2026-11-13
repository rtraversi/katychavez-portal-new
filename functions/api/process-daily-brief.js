// /api/process-daily-brief
// Bea-Bot — Slice 1 of BEA-BOT-PLAN.md.
//
// Gathers the morning's context, asks Claude for a brief, and writes both to
// brief_log. It does NOT send anything: sent_at stays NULL, which is the whole
// point of this slice. Katy reads a week of generated briefs in the portal and
// says which were useful before Slice 2 is allowed to reach her phone.
//
// Called every hour by the scheduled handler, and gated on the firm's configured
// local hour -- see shouldRunNow() in _brief-context.js for why the hour is not
// in the cron expression.
//
// Config:
//   BRIEF_TIMEZONE         var.    IANA zone, e.g. America/Mexico_City.
//   BRIEF_SEND_HOUR_LOCAL  var.    0-23 in that zone. Default 9.
//   BRIEF_MODEL            var.    Optional model override.
//   ANTHROPIC_API_KEY      secret. Unset means the context is gathered and
//                                  stored, and no brief is generated. Dormant,
//                                  not broken -- the house pattern.
//
// monday.com is deliberately absent. The adapter exists unmerged on
// origin/module/monday-sync and needs a read token the firm has not issued yet,
// so Slice 1a runs on Telegram alone and 1b adds the board diff.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { DAILY_BRIEF_PROMPT } from './_prompts/daily-brief.js';
import {
  briefWindow, shouldRunNow, deadlineCutoff, summarizeInputs, buildContext,
} from './_brief-context.js';

const DEFAULT_TIMEZONE = 'America/Mexico_City';   // Querétaro: Central, no DST
const DEFAULT_SEND_HOUR = 9;
const DEFAULT_MODEL = 'claude-sonnet-5-5';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  // Manual trigger for testing. Owner-level only -- this reads the whole staff
  // chat and the firm's priority list.
  const auth = await verifyAuth(request, env, 'admin', 'dashboard');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const result = await run(env, { force: true });
  return json(200, result);
}

/**
 * Called directly by the scheduled handler -- no HTTP wrapper.
 * `force` skips the hour gate, for manual runs.
 */
export async function run(env, { force = false, nowMs = Date.now() } = {}) {
  const timeZone = env.BRIEF_TIMEZONE || DEFAULT_TIMEZONE;
  const sendHour = env.BRIEF_SEND_HOUR_LOCAL ?? DEFAULT_SEND_HOUR;

  if (!force && !shouldRunNow(nowMs, timeZone, sendHour)) {
    return { skipped: 'not_the_hour' };
  }

  const admin = makeAdminClient(env);
  const window = briefWindow(nowMs, timeZone);

  try {
    const { messages, openItems, dueSoon } = await gather(admin, window, nowMs, env);
    const inputSummary = summarizeInputs({ window, messages, openItems, dueSoon });

    let briefText = null;
    let model = null;
    let generated = false;
    let reason = null;

    if (!env.ANTHROPIC_API_KEY) {
      // Dormant. The context is still recorded, so the day is not a blank in
      // the log and the gathering half stays verifiable on its own.
      reason = 'no_api_key';
    } else if (messages.length === 0 && openItems.length === 0) {
      // Nothing happened and nothing is open. Section 2: a short brief is a
      // good brief, and this one does not need a model to write it.
      briefText = 'Nothing needs you today. Nothing new in the staff chat and the list is clear.';
      generated = true;
    } else {
      model = env.BRIEF_MODEL || DEFAULT_MODEL;
      briefText = await askClaude(env, model, buildContext({ window, messages, openItems, dueSoon }));
      generated = true;
    }

    // Upsert on brief_date so re-running a morning while the prompt is being
    // tuned replaces that day rather than piling up duplicates.
    const { error } = await admin.from('brief_log').upsert(
      {
        brief_date: window.localDate,
        brief_text: briefText ?? '(not generated — ANTHROPIC_API_KEY not configured)',
        input_summary: inputSummary,
        model,
        sent_at: null,          // Slice 1 never sends. Slice 2 sets this.
        error_text: null,
      },
      { onConflict: 'brief_date' },
    );
    if (error) throw error;

    return { ok: true, date: window.localDate, generated, reason, inputs: inputSummary };
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[bea][brief] failed for', window.localDate, message);

    // Section 4.4: never fail silently. The row records the bad morning; the
    // one-line notice to Katy is Slice 2's job, since Slice 1 sends nothing.
    await admin.from('brief_log').upsert(
      {
        brief_date: window.localDate,
        brief_text: '(failed)',
        error_text: message.slice(0, 2000),
        sent_at: null,
      },
      { onConflict: 'brief_date' },
    ).catch(() => {});

    return { ok: false, date: window.localDate, error: message };
  }
}

/** Everything the brief reads, in three queries. */
async function gather(admin, window, nowMs, env) {
  const staffChat = env.TELEGRAM_STAFF_CHAT_ID;

  let msgQuery = admin
    .from('tg_messages')
    .select('message_id,sent_at,edited_at,sender_name,text,reply_to_message_id,message_thread_id,media_paths')
    .gte('sent_at', window.sinceIso)
    .order('sent_at', { ascending: true });
  if (staffChat) msgQuery = msgQuery.eq('chat_id', staffChat);

  const [msgs, items, due] = await Promise.all([
    msgQuery,
    admin
      .from('priority_items')
      .select('id,title,case_ref,why_katy,deadline,priority,status,times_asked,last_mentioned_in_brief')
      .in('status', ['open', 'partial'])
      .order('priority', { ascending: true }),
    admin
      .from('priority_items')
      .select('id,title,deadline,priority')
      .in('status', ['open', 'partial'])
      .not('deadline', 'is', null)
      .lte('deadline', deadlineCutoff(nowMs))
      .order('deadline', { ascending: true }),
  ]);

  for (const r of [msgs, items, due]) if (r.error) throw r.error;
  return { messages: msgs.data || [], openItems: items.data || [], dueSoon: due.data || [] };
}

/**
 * Ask Claude for the brief text.
 *
 * NOT YET EXERCISED AGAINST THE LIVE API -- the firm's key lives in a Cloudflare
 * account this branch cannot reach, so the first real run needs watching. The
 * request shape follows the current API: structured output goes in
 * output_config.format, not the deprecated output_format, and tool_choice is
 * left alone because forcing 'any' or 'tool' returns a 400 on current models.
 */
export async function askClaude(env, model, context) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: [
        // Static across every run, so it is worth caching: the prompt file is
        // the same bytes each morning and only the context below it changes.
        { type: 'text', text: DAILY_BRIEF_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['brief'],
            properties: {
              brief: {
                type: 'string',
                description: 'The brief, exactly as Katy should read it.',
              },
            },
          },
        },
      },
      messages: [{
        role: 'user',
        content: `Today is ${context.today}. Here is the context.\n\n${JSON.stringify(context, null, 1)}`,
      }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json();

  // A refusal is an HTTP 200 with stop_reason 'refusal', so it has to be checked
  // before the content is read or it looks like an empty response.
  if (body.stop_reason === 'refusal') {
    throw new Error(`Claude declined: ${body.stop_details?.category || 'unknown'}`);
  }

  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text).brief;
  } catch {
    // Structured output should make this impossible; if the shape ever changes,
    // the raw text is more useful to Katy than an exception.
    return text;
  }
}
