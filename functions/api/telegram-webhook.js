// /api/telegram-webhook
// Bea-Bot (Bea, the Legal Beagle) — Slice 0 of BEA-BOT-PLAN.md.
//
// Receives every message in the staff Telegram group and records it. This slice
// deliberately does nothing else: it never calls Claude, never reads monday.com,
// and never sends a message to anybody. It only listens.
//
// Why this endpoint is unlike every other one in functions/api/: the caller is
// Telegram, not a signed-in user, so there is no session to verifyAuth() on.
// Authentication is the shared secret Telegram echoes in a header, which is set
// when the webhook is registered. Beyond that, the chat id is an allow-list of
// exactly two conversations.
//
// Config (wrangler.toml / wrangler secret put):
//   TELEGRAM_BOT_TOKEN       secret. From @BotFather.
//   TELEGRAM_WEBHOOK_SECRET  secret. Any long random string; also passed as
//                            `secret_token` to setWebhook.
//   TELEGRAM_STAFF_CHAT_ID   var. The staff group (a negative number).
//   TELEGRAM_KATY_CHAT_ID    var. Katy's private chat with Bea. Optional in
//                            this slice — she is only DM'd from Slice 2 on.
//
// Unconfigured means dormant, per the house pattern: with no bot token and no
// webhook secret this endpoint refuses everything and touches nothing.

import { makeAdminClient, json } from './_helpers.js';

const TG_API = 'https://api.telegram.org';

// getFile will not serve anything larger than this to a bot, so there is no
// point downloading past it. Oversized media is recorded as a miss, not lost
// silently — the message row still lands.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// Documents worth keeping: the screenshots and scans staff attach to questions.
// Everything else on a message (video, voice, stickers) is ignored in Slice 0.
const KEEP_DOC_TYPES = /^(image\/|application\/pdf$)/;

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !env.TELEGRAM_BOT_TOKEN) {
    console.error('[bea] not configured — TELEGRAM_WEBHOOK_SECRET / TELEGRAM_BOT_TOKEN missing');
    return json(503, { error: 'not configured' });
  }
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    // Someone who is not Telegram. Say nothing useful.
    return json(401, { error: 'unauthorized' });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    // Malformed body is not worth a retry.
    return json(200, { ok: true, ignored: 'unparseable' });
  }

  const isEdit = Boolean(update.edited_message);
  const msg = update.message || update.edited_message;

  // Updates we do not handle in Slice 0 (my_chat_member, callback_query,
  // channel_post and so on). 200 so Telegram stops redelivering them.
  if (!msg) return json(200, { ok: true, ignored: 'no_message' });

  const chatId = msg.chat?.id;
  const allowed = new Set(
    [env.TELEGRAM_STAFF_CHAT_ID, env.TELEGRAM_KATY_CHAT_ID]
      .filter(Boolean)
      .map(String),
  );
  if (!allowed.has(String(chatId))) {
    // Bea was added somewhere she does not belong, or someone found her
    // username. Record nothing.
    return json(200, { ok: true, ignored: 'chat_not_allowed' });
  }

  const admin = makeAdminClient(env);
  const text = msg.text ?? msg.caption ?? null;

  try {
    if (isEdit) {
      // Spec 4.1: update the stored text and keep the edit time. The original
      // sent_at and any media already fetched are left alone — an edit in
      // Telegram cannot change a message's attachments.
      const { error } = await admin
        .from('tg_messages')
        .update({
          text,
          edited_at: msg.edit_date
            ? new Date(msg.edit_date * 1000).toISOString()
            : new Date().toISOString(),
        })
        .eq('chat_id', chatId)
        .eq('message_id', msg.message_id);

      if (error) throw error;
      return json(200, { ok: true, action: 'edited' });
    }

    const mediaPaths = await collectMedia(env, msg);

    // Upsert, not insert: Telegram redelivers any update it did not get a 2xx
    // for, so the same message_id can arrive twice through no fault of ours.
    const { error } = await admin.from('tg_messages').upsert(
      {
        chat_id: chatId,
        message_id: msg.message_id,
        sender_name: senderName(msg.from),
        sender_id: msg.from?.id != null ? String(msg.from.id) : null,
        sent_at: new Date(msg.date * 1000).toISOString(),
        text,
        reply_to_message_id: msg.reply_to_message?.message_id ?? null,
        media_paths: mediaPaths,
        raw: update,
      },
      { onConflict: 'chat_id,message_id' },
    );

    if (error) throw error;
    return json(200, { ok: true, action: 'logged', media: mediaPaths.length });
  } catch (err) {
    // A 5xx makes Telegram retry, which is what we want: a message dropped here
    // is a message that can never be recovered from the API.
    console.error('[bea] failed to log message', msg.message_id, err?.message || err);
    return json(500, { error: 'write failed' });
  }
}

function senderName(from) {
  if (!from) return null;
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || null;
}

// Pull the photos and image/PDF documents off a message into R2, returning
// their object keys. A download that fails is logged and skipped — the message
// row is worth more than the attachment, and losing the row loses both.
async function collectMedia(env, msg) {
  const wanted = [];

  // photo[] is the same image at several sizes, smallest first. The spec asks
  // for the largest, since these are usually screenshots of forms.
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1];
    wanted.push({ fileId: largest.file_id, size: largest.file_size });
  }

  if (msg.document?.file_id && KEEP_DOC_TYPES.test(msg.document.mime_type || '')) {
    wanted.push({
      fileId: msg.document.file_id,
      size: msg.document.file_size,
      name: msg.document.file_name,
    });
  }

  const keys = [];
  for (const item of wanted) {
    if (item.size && item.size > MAX_FILE_BYTES) {
      console.warn('[bea] attachment over 20MB, skipped', msg.message_id);
      continue;
    }
    const key = await downloadToR2(env, item, msg);
    if (key) keys.push(key);
  }
  return keys;
}

async function downloadToR2(env, item, msg) {
  const token = env.TELEGRAM_BOT_TOKEN;
  try {
    const metaRes = await fetch(
      `${TG_API}/bot${token}/getFile?file_id=${encodeURIComponent(item.fileId)}`,
    );
    const meta = await metaRes.json();
    if (!meta.ok || !meta.result?.file_path) {
      console.warn('[bea] getFile refused', msg.message_id, meta.description);
      return null;
    }
    if ((meta.result.file_size || 0) > MAX_FILE_BYTES) return null;

    const binRes = await fetch(`${TG_API}/file/bot${token}/${meta.result.file_path}`);
    if (!binRes.ok) {
      console.warn('[bea] file download failed', msg.message_id, binRes.status);
      return null;
    }
    const bytes = await binRes.arrayBuffer();

    // Namespaced by chat and message so an object is traceable back to the
    // conversation it came from without consulting the DB.
    const base = meta.result.file_path.split('/').pop();
    const key = `bea-bot/${msg.chat.id}/${msg.message_id}/${base}`;

    await env.R2.put(key, bytes, {
      httpMetadata: {
        contentType: msg.document?.mime_type || guessType(base),
      },
    });
    return key;
  } catch (err) {
    console.warn('[bea] attachment error', msg.message_id, err?.message || err);
    return null;
  }
}

function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      pdf: 'application/pdf',
    }[ext] || 'application/octet-stream'
  );
}
