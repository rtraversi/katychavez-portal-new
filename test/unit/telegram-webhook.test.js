// Bea-Bot webhook (functions/api/telegram-webhook.js), Slice 0.
//
// This endpoint is the one place in functions/api/ with no verifyAuth(), because
// the caller is Telegram rather than a signed-in user. That makes its guard rails
// — the shared-secret header and the two-chat allow-list — the only thing between
// the staff group's contents and anyone who finds the URL. They are what these
// tests are mostly about.
//
// The Supabase admin client is stubbed; no network and no database.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upserts = [];
const updates = [];

vi.mock('../../functions/api/_helpers.js', async (importOriginal) => {
  const actual = await importOriginal();
  // A thenable that absorbs .eq() chaining, the way the Supabase builder does.
  const thenable = (sink, payload) => {
    const o = {
      eq: () => o,
      then: (resolve) => {
        sink.push(payload);
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return o;
  };
  return {
    ...actual,
    makeAdminClient: () => ({
      from: () => ({
        upsert: (row) => {
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
        update: (patch) => thenable(updates, patch),
      }),
    }),
  };
});

const { onRequest } = await import('../../functions/api/telegram-webhook.js');

const SECRET = 'a-long-random-webhook-secret';
const STAFF_CHAT = -1004480289705;

// Derive the epoch seconds from the ISO strings rather than hand-computing them,
// so the fixture and the assertion cannot disagree with each other.
const SENT_ISO = '2026-11-12T22:40:00.000Z';
const EDIT_ISO = '2026-11-12T22:50:00.000Z';
const SENT_EPOCH = Date.parse(SENT_ISO) / 1000;
const EDIT_EPOCH = Date.parse(EDIT_ISO) / 1000;

const ENV = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_STAFF_CHAT_ID: String(STAFF_CHAT),
};

function post(body, { secret = SECRET, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return new Request('https://portal.example.com/api/telegram-webhook', {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

const groupMessage = (over = {}) => ({
  update_id: 1,
  message: {
    message_id: 42,
    date: SENT_EPOCH,
    chat: { id: STAFF_CHAT, type: 'supergroup' },
    from: { id: 777, first_name: 'Ana', last_name: 'Paralegal' },
    text: 'Does the I-130 need the new edition?',
    ...over,
  },
});

beforeEach(() => {
  upserts.length = 0;
  updates.length = 0;
});

describe('guard rails', () => {
  it('rejects anything but POST', async () => {
    const res = await onRequest({ request: post(groupMessage(), { method: 'GET' }), env: ENV });
    expect(res.status).toBe(405);
    expect(upserts).toHaveLength(0);
  });

  it('refuses when the webhook secret is not configured', async () => {
    const res = await onRequest({
      request: post(groupMessage()),
      env: { ...ENV, TELEGRAM_WEBHOOK_SECRET: undefined },
    });
    expect(res.status).toBe(503);
    expect(upserts).toHaveLength(0);
  });

  it('rejects a wrong secret header', async () => {
    const res = await onRequest({ request: post(groupMessage(), { secret: 'wrong' }), env: ENV });
    expect(res.status).toBe(401);
    expect(upserts).toHaveLength(0);
  });

  it('rejects a missing secret header', async () => {
    const res = await onRequest({ request: post(groupMessage(), { secret: null }), env: ENV });
    expect(res.status).toBe(401);
    expect(upserts).toHaveLength(0);
  });

  it('ignores a chat that is not on the allow-list, and writes nothing', async () => {
    const other = groupMessage();
    other.message.chat.id = -1009999999999;
    const res = await onRequest({ request: post(other), env: ENV });
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe('chat_not_allowed');
    expect(upserts).toHaveLength(0);
  });

  it('ignores updates that carry no message', async () => {
    const res = await onRequest({
      request: post({ update_id: 2, my_chat_member: { chat: { id: STAFF_CHAT } } }),
      env: ENV,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe('no_message');
    expect(upserts).toHaveLength(0);
  });
});

describe('logging a staff message', () => {
  it('records the fields the daily job will need', async () => {
    const res = await onRequest({ request: post(groupMessage()), env: ENV });
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);

    const row = upserts[0];
    expect(row.chat_id).toBe(STAFF_CHAT);
    expect(row.message_id).toBe(42);
    expect(row.sender_name).toBe('Ana Paralegal');
    expect(row.sender_id).toBe('777');          // text, not number — ids are large
    expect(row.text).toBe('Does the I-130 need the new edition?');
    expect(row.sent_at).toBe(SENT_ISO);
    expect(row.edited_at).toBeUndefined();
    expect(row.media_paths).toEqual([]);
    expect(row.raw).toBeTruthy();               // kept verbatim for Phase 2
  });

  it('threads a reply so a question can be tied to Katy\'s answer', async () => {
    const m = groupMessage({ reply_to_message: { message_id: 40 } });
    await onRequest({ request: post(m), env: ENV });
    expect(upserts[0].reply_to_message_id).toBe(40);
  });

  it('uses the caption when a photo carries no text', async () => {
    const m = groupMessage({ text: undefined, caption: 'see the date on page 3' });
    // No photo array, so no download is attempted and no fetch is needed.
    await onRequest({ request: post(m), env: ENV });
    expect(upserts[0].text).toBe('see the date on page 3');
  });

  it('logs a message with no text at all rather than dropping it', async () => {
    const m = groupMessage({ text: undefined });
    await onRequest({ request: post(m), env: ENV });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].text).toBeNull();
  });

  // The two shapes below came out of the real queue, not from imagination --
  // the first synthetic fixtures for this file missed both.
  it('keeps message_thread_id, which Telegram sets on threaded messages', async () => {
    const m = groupMessage({ message_thread_id: 118 });
    await onRequest({ request: post(m), env: ENV });
    expect(upserts[0].message_thread_id).toBe(118);
  });

  it('logs a voice note with null text and no media, not as an error', async () => {
    // Slice 0 does not transcribe or store audio; the row still has to exist or
    // the conversation has a hole in it.
    const m = groupMessage({
      text: undefined,
      voice: { duration: 7, mime_type: 'audio/ogg', file_id: 'x', file_size: 11_000 },
    });
    const res = await onRequest({ request: post(m), env: ENV });
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].text).toBeNull();
    expect(upserts[0].media_paths).toEqual([]);
  });
});

describe('edits', () => {
  it('updates the text and stamps the edit time without inserting a new row', async () => {
    const edited = {
      update_id: 3,
      edited_message: {
        message_id: 42,
        date: SENT_EPOCH,
        edit_date: EDIT_EPOCH,
        chat: { id: STAFF_CHAT, type: 'supergroup' },
        from: { id: 777, first_name: 'Ana' },
        text: 'Does the I-130 need the 2026 edition?',
      },
    };
    const res = await onRequest({ request: post(edited), env: ENV });
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe('edited');

    expect(upserts).toHaveLength(0);            // no duplicate row
    expect(updates).toHaveLength(1);
    expect(updates[0].text).toBe('Does the I-130 need the 2026 edition?');
    expect(updates[0].edited_at).toBe(EDIT_ISO);
    expect(updates[0].sent_at).toBeUndefined(); // original send time preserved
  });
});
