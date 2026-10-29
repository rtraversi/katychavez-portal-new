// app.js: the Ask Claude page. Reads the user's own chats straight from the
// database (RLS: own rows only); every write and every question goes through
// the Worker (/api/ai-chat-*), which holds the API key.

import { renderMarkdown, escapeHtml } from './markdown.js';
import { assistantView, plainAnswer, userView, fmtBytes, createNdjsonReader } from './transcript.js';

const $ = (id) => document.getElementById(id);
const esc = escapeHtml;
const toast = (msg, type = 'error') => (window.Utils ? window.Utils.toast(msg, type) : console.warn(msg));

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const WEB_PREF_KEY = 'ac-web-search';

const EXAMPLES = [
  'My client entered without inspection in 1994, attempted to re-enter in 1996 and again in 1999. He is filing an I-212. What evidence should he submit?',
  'Explain how the 212(a)(9)(B) and 212(a)(9)(C) bars differ, with the statutory citations and the Policy Manual sections.',
  'Summarize the attached RFE: what USCIS is asking for, the deadline, and a checklist of documents to respond with.',
];

const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

export async function mountAskClaude({ db, auth }) {
  const [canRead, isAdmin] = await Promise.all([
    auth.getAccessibleModules('read').then((s) => s.has('ai_chat')),
    auth.getAccessibleModules('admin').then((s) => s.has('ai_chat')),
  ]);
  if (!canRead) {
    $('ac-gate').innerHTML = '<div class="dk-register"><div class="dk-empty">Ask Claude is not turned on for your role.</div></div>';
    return;
  }
  $('ac-gate').innerHTML = '';
  $('ac-body').hidden = false;

  const state = {
    chats: [],
    activeId: null,
    messages: [],
    files: new Map(),     // attachment id → { id, file_name, content_type, size_bytes }
    pending: [],          // { key, file_name, size_bytes, id?, busy, bad }
    sending: false,
    filter: '',
  };

  const input = $('ac-input');
  const log = $('ac-log');
  const web = $('ac-web');
  try { web.checked = localStorage.getItem(WEB_PREF_KEY) !== 'off'; } catch { web.checked = true; }

  // ── Wiring ────────────────────────────────────────────────────────────────
  $('ac-composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', grow);
  web.addEventListener('change', () => {
    try { localStorage.setItem(WEB_PREF_KEY, web.checked ? 'on' : 'off'); } catch { /* private window */ }
  });
  $('ac-attach').addEventListener('click', () => $('ac-file').click());
  $('ac-file').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  $('ac-new').addEventListener('click', () => { if (!state.sending) openChat(null); });
  $('ac-filter').addEventListener('input', (e) => { state.filter = e.target.value.trim().toLowerCase(); renderChats(); });
  $('ac-rename').addEventListener('click', renameChat);
  $('ac-delete').addEventListener('click', deleteChat);

  const composer = $('ac-composer');
  composer.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); composer.classList.add('is-drop'); } });
  composer.addEventListener('dragleave', () => composer.classList.remove('is-drop'));
  composer.addEventListener('drop', (e) => {
    composer.classList.remove('is-drop');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  });

  log.addEventListener('click', (e) => {
    const fileBtn = e.target.closest('[data-file]');
    if (fileBtn) { openFile(fileBtn.dataset.file); return; }
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) { copyAnswer(copyBtn.dataset.copy, copyBtn); return; }
    const ex = e.target.closest('[data-example]');
    if (ex) { input.value = EXAMPLES[Number(ex.dataset.example)]; grow(); input.focus(); }
  });
  $('ac-chats').addEventListener('click', (e) => {
    const row = e.target.closest('[data-chat]');
    if (row && !state.sending) openChat(row.dataset.chat);
  });

  await loadChats();
  openChat(null);
  if (isAdmin) loadUsage();

  // ── Chats ─────────────────────────────────────────────────────────────────
  async function loadChats() {
    const { data, error } = await db.from('ai_chat_conversations')
      .select('id, title, message_count, updated_at').order('updated_at', { ascending: false });
    if (error) {
      console.error('[ai-chat] chats failed', error);
      $('ac-chats').innerHTML = '<div class="dk-empty" style="color:var(--color-danger)">Your chats could not be loaded.</div>';
      return;
    }
    state.chats = data || [];
    renderChats();
  }

  function renderChats() {
    const list = state.filter ? state.chats.filter((c) => c.title.toLowerCase().includes(state.filter)) : state.chats;
    if (!list.length) {
      $('ac-chats').innerHTML = `<div class="dk-empty">${state.chats.length ? 'No chat matches.' : 'No chats yet. Your conversations will be listed here.'}</div>`;
      return;
    }
    $('ac-chats').innerHTML = list.map((c) => `
      <button type="button" class="ac-chat${c.id === state.activeId ? ' is-active' : ''}" data-chat="${esc(c.id)}"${c.id === state.activeId ? ' aria-current="true"' : ''}>
        <b>${esc(c.title)}</b>
        <small>${esc(whenLabel(c.updated_at))}</small>
      </button>`).join('');
  }

  async function openChat(id) {
    state.activeId = id;
    state.messages = [];
    state.files = new Map();
    renderChats();
    renderHead();
    if (!id) { renderLog(); input.focus(); return; }

    log.innerHTML = '<div class="ac-turn"><div class="dk-empty" style="background:none">Loading…</div></div>';
    const [mRes, fRes] = await Promise.all([
      db.from('ai_chat_messages').select('id, role, content, model, stop_reason, created_at')
        .eq('conversation_id', id).order('created_at', { ascending: true }),
      db.from('ai_chat_attachments').select('id, file_name, content_type, size_bytes').eq('conversation_id', id),
    ]);
    if (state.activeId !== id) return;   // the user moved on while this loaded
    if (mRes.error || fRes.error) {
      console.error('[ai-chat] chat failed', mRes.error || fRes.error);
      log.innerHTML = '<div class="ac-turn"><div class="dk-empty" style="color:var(--color-danger);background:none">This chat could not be loaded.</div></div>';
      return;
    }
    state.messages = mRes.data || [];
    for (const f of fRes.data || []) state.files.set(f.id, f);
    renderLog();
    log.scrollTop = log.scrollHeight;
  }

  function renderHead() {
    const chat = state.chats.find((c) => c.id === state.activeId);
    const title = $('ac-title');
    title.textContent = chat ? chat.title : 'New chat';
    title.classList.toggle('is-new', !chat);
    $('ac-rename').hidden = !chat;
    $('ac-delete').hidden = !chat;
  }

  async function renameChat() {
    const chat = state.chats.find((c) => c.id === state.activeId);
    if (!chat) return;
    const title = await window.Utils.prompt('Rename this chat', { defaultValue: chat.title, confirmLabel: 'Save' });
    if (!title || title === chat.title) return;
    const res = await api('/api/ai-chat-conversation', { action: 'rename', id: chat.id, title });
    if (!res.ok) { toast(res.error); return; }
    chat.title = res.data.title;
    renderChats();
    renderHead();
  }

  async function deleteChat() {
    const chat = state.chats.find((c) => c.id === state.activeId);
    if (!chat) return;
    const ok = await window.Utils.confirm(`Delete "${chat.title}"? The conversation and its attached files are removed for good.`, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const res = await api('/api/ai-chat-conversation', { action: 'delete', id: chat.id });
    if (!res.ok) { toast(res.error); return; }
    state.chats = state.chats.filter((c) => c.id !== chat.id);
    openChat(null);
    toast('Chat deleted.', 'success');
    if (isAdmin) loadUsage();
  }

  // ── Transcript ────────────────────────────────────────────────────────────
  function renderLog() {
    if (!state.messages.length) {
      log.innerHTML = `
        <div class="ac-blank">
          <h2>What are you <em>working on?</em></h2>
          <p>Ask with the real names, dates and history. Attach a notice, an RFE or a prior decision and Claude will read it.</p>
          <div class="ac-examples">
            ${EXAMPLES.map((ex, i) => `<button type="button" class="ac-example" data-example="${i}">${esc(ex)}</button>`).join('')}
          </div>
        </div>`;
      return;
    }
    log.innerHTML = state.messages.map(turnHtml).join('');
  }

  function turnHtml(m) {
    return m.role === 'user' ? userTurnHtml(m) : assistantTurnHtml(m);
  }

  function userTurnHtml(m) {
    const v = userView(m.content);
    const files = v.attachmentIds.map((id) => fileChipHtml(state.files.get(id), id)).join('');
    return `
      <article class="ac-turn user">
        <div class="ac-who">You${m.created_at ? ` · ${esc(timeLabel(m.created_at))}` : ''}</div>
        ${files ? `<div class="ac-files">${files}</div>` : ''}
        <div class="ac-q">${esc(v.text)}</div>
      </article>`;
  }

  function fileChipHtml(f, id) {
    if (!f) return `<span class="ac-file" title="File no longer available">${FILE_ICON}<span>Attached file</span></span>`;
    return `<button type="button" class="ac-file" data-file="${esc(id)}" title="Open ${esc(f.file_name)}">${FILE_ICON}<span>${esc(f.file_name)}</span><small>${esc(fmtBytes(f.size_bytes))}</small></button>`;
  }

  function assistantTurnHtml(m) {
    const v = assistantView(m.content);
    const notes = [];
    if (m.stop_reason === 'max_tokens') notes.push('This answer hit the length limit and stops early. Ask Claude to continue.');
    return `
      <article class="ac-turn claude" data-msg="${esc(m.id)}">
        <div class="ac-who">Claude${m.created_at ? ` · ${esc(timeLabel(m.created_at))}` : ''}</div>
        ${reasoningHtml(v.thinking, false)}
        ${searchesHtml(v.searches)}
        <div class="ac-md">${renderMarkdown(v.text, { cite: (n) => citeHtml(v.sources, n) })}</div>
        ${sourcesHtml(v.sources)}
        <div class="ac-foot">
          <button type="button" class="dk-linkbtn" data-copy="${esc(m.id)}">Copy</button>
          ${notes.map((n) => `<span class="ac-note">${esc(n)}</span>`).join('')}
        </div>
      </article>`;
  }

  function reasoningHtml(text, live) {
    if (!text && !live) return '';
    return `<details class="ac-think"${live ? ' data-live-think' : ''}>
      <summary>${live ? '<span class="ac-live-dot"></span> Thinking…' : 'How Claude approached this'}</summary>
      <div class="ac-think-body">${esc(text || '')}</div>
    </details>`;
  }

  function searchesHtml(queries) {
    if (!queries.length) return '';
    return `<div class="ac-searches">${queries.map((q) => `<div><b>Searched</b><span>${esc(q)}</span></div>`).join('')}</div>`;
  }

  function citeHtml(sources, n) {
    const s = sources.find((x) => x.n === n);
    if (!s) return '';
    return `<sup class="ac-cite"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">[${n}]</a></sup>`;
  }

  function sourcesHtml(sources) {
    if (!sources.length) return '';
    return `<div class="ac-sources"><div class="ac-sources-cap">Sources</div><ol>${
      sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('')
    }</ol></div>`;
  }

  // ── Sending ───────────────────────────────────────────────────────────────
  async function send() {
    if (state.sending) return;
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (state.pending.some((p) => p.busy)) { toast('Wait for the files to finish uploading.', 'info'); return; }
    if (state.pending.some((p) => p.bad)) { toast('Remove the files that failed to upload first.', 'info'); return; }

    const pending = state.pending.slice();
    const attachmentIds = pending.map((p) => p.id);
    for (const p of pending) state.files.set(p.id, { id: p.id, file_name: p.file_name, content_type: p.content_type, size_bytes: p.size_bytes });

    setSending(true);
    const wasBlank = !state.messages.length;
    const userMsg = { id: null, role: 'user', content: [...attachmentIds.map((id) => ({ type: 'attachment', attachment_id: id })), { type: 'text', text }], created_at: new Date().toISOString() };
    state.messages.push(userMsg);
    if (wasBlank) log.innerHTML = '';
    log.insertAdjacentHTML('beforeend', userTurnHtml(userMsg));
    input.value = '';
    grow();
    state.pending = [];
    renderPending();

    // The live answer: rebuilt from the stream, replaced by the saved row at the end.
    log.insertAdjacentHTML('beforeend', `
      <article class="ac-turn claude" id="ac-live">
        <div class="ac-who">Claude</div>
        ${reasoningHtml('', true)}
        <div class="ac-searches" id="ac-live-searches"></div>
        <div class="ac-md" id="ac-live-md"><p class="ac-hint"><span class="ac-live-dot"></span> Working on it…</p></div>
      </article>`);
    stick(true);
    announce('Claude is answering.');

    let answer = '';
    let thinking = '';
    let finished = false;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const md = $('ac-live-md');
      if (md && answer) md.innerHTML = renderMarkdown(answer);
      const think = document.querySelector('[data-live-think] .ac-think-body');
      if (think) think.textContent = thinking;
      stick();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };

    const fail = (message) => {
      finished = true;
      $('ac-live')?.remove();
      if (log.lastElementChild?.classList.contains('user')) log.lastElementChild.remove();
      state.messages = state.messages.filter((m) => m !== userMsg);
      if (!state.messages.length) renderLog();
      // Put the question and its files back so a retry is one click.
      input.value = text;
      grow();
      state.pending = pending;
      renderPending();
      toast(message);
      announce('The answer failed.');
    };

    const onEvent = (evt) => {
      if (evt.type === 'start') {
        if (!state.activeId) {
          state.activeId = evt.conversation_id;
          state.chats.unshift({ id: evt.conversation_id, title: evt.title, message_count: 0, updated_at: new Date().toISOString() });
          renderChats();
          renderHead();
        }
      } else if (evt.type === 'thinking') {
        thinking += evt.text;
        schedule();
      } else if (evt.type === 'search') {
        const box = $('ac-live-searches');
        if (box) box.insertAdjacentHTML('beforeend', `<div><b>Searching</b><span>${esc(evt.query)}</span></div>`);
        stick();
      } else if (evt.type === 'text') {
        if (!answer) {
          const think = document.querySelector('[data-live-think] summary');
          if (think) think.innerHTML = 'How Claude approached this';
        }
        answer += evt.text;
        schedule();
      } else if (evt.type === 'done') {
        finished = true;
        if (frame) cancelAnimationFrame(frame);
        state.messages.push(evt.message);
        const live = $('ac-live');
        if (live) live.outerHTML = assistantTurnHtml(evt.message);
        const chat = state.chats.find((c) => c.id === state.activeId);
        if (chat) {
          chat.updated_at = evt.message.created_at || new Date().toISOString();
          state.chats = [chat, ...state.chats.filter((c) => c !== chat)];
          renderChats();
        }
        stick();
        announce('Answer ready.');
      } else if (evt.type === 'error') {
        fail(evt.error || 'Something went wrong. Try again.');
      }
    };

    try {
      const session = await auth.getSession();
      const res = await fetch('/api/ai-chat-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ conversation_id: state.activeId, text, attachment_ids: attachmentIds, web_search: web.checked }),
      });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('ndjson')) {
        const body = await res.json().catch(() => ({}));
        fail(body.error || `Ask Claude failed (${res.status}).`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const nd = createNdjsonReader(onEvent);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        nd.push(decoder.decode(value, { stream: true }));
      }
      nd.push(decoder.decode());
      nd.end();
      if (!finished) {
        // The stream closed without a verdict (network drop). The Worker keeps
        // going and saves the reply, so reload the chat rather than guess.
        $('ac-live')?.remove();
        toast('The connection dropped. Reloading the chat…', 'info');
        if (state.activeId) await openChat(state.activeId);
      }
    } catch (err) {
      console.error('[ai-chat] send failed', err);
      if (!finished) fail('Could not reach the portal. Check your connection and try again.');
    } finally {
      setSending(false);
      input.focus();
      if (isAdmin) loadUsage();
    }
  }

  function setSending(on) {
    state.sending = on;
    $('ac-send').disabled = on;
    $('ac-send').textContent = on ? 'Answering…' : 'Send';
    $('ac-new').disabled = on;
    log.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  function addFiles(files) {
    for (const file of files) {
      if (state.pending.length >= 5) { toast('Attach at most 5 files to one message.', 'info'); break; }
      if (!FILE_TYPES.includes(file.type)) { toast(`${file.name}: attach a PDF or an image.`, 'info'); continue; }
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name} is over 10 MB.`, 'info'); continue; }
      const item = { key: crypto.randomUUID(), file_name: file.name, content_type: file.type, size_bytes: file.size, busy: true, bad: false };
      state.pending.push(item);
      upload(item, file);
    }
    renderPending();
  }

  async function upload(item, file) {
    try {
      const session = await auth.getSession();
      const res = await fetch('/api/ai-chat-upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-File-Name': encodeURIComponent(file.name),
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
      item.id = body.attachment.id;
      item.busy = false;
    } catch (err) {
      item.busy = false;
      item.bad = true;
      toast(`${file.name}: ${err.message}`);
    }
    renderPending();
  }

  function renderPending() {
    $('ac-pending').innerHTML = state.pending.map((p) => `
      <span class="ac-chip${p.busy ? ' is-busy' : ''}${p.bad ? ' is-bad' : ''}" title="${esc(p.file_name)}">
        <span>${esc(p.file_name)}${p.busy ? ' · uploading…' : p.bad ? ' · failed' : ` · ${esc(fmtBytes(p.size_bytes))}`}</span>
        <button type="button" data-remove="${esc(p.key)}" aria-label="Remove ${esc(p.file_name)}">×</button>
      </span>`).join('');
    $('ac-pending').querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      state.pending = state.pending.filter((p) => p.key !== b.dataset.remove);
      renderPending();
    }));
  }

  async function openFile(id) {
    // Open the tab now, inside the click, so a popup blocker allows it.
    const tab = window.open('', '_blank');
    try {
      const session = await auth.getSession();
      const res = await fetch(`/api/ai-chat-attachment?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'File not found');
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      toast(err.message);
    }
  }

  async function copyAnswer(id, btn) {
    const m = state.messages.find((x) => x.id === id);
    if (!m) return;
    try {
      await navigator.clipboard.writeText(plainAnswer(m.content));
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch {
      toast('Copy failed. Select the text and copy it instead.', 'info');
    }
  }

  // ── Usage (admin) ─────────────────────────────────────────────────────────
  async function loadUsage() {
    const res = await api('/api/ai-chat-stats', null, 'GET');
    if (!res.ok) return;
    const s = res.data;
    const thisMonth = s.months[0] && s.months[0].month === new Date().toISOString().slice(0, 7) ? s.months[0] : null;
    const money = (n) => `$${Number(n || 0).toFixed(2)}`;
    const rows = [
      ['This month (estimate)', money(thisMonth?.estimated_cost), 'is-head'],
      ['Answers this month', (thisMonth?.replies || 0).toLocaleString()],
      ['Web searches this month', (thisMonth?.web_searches || 0).toLocaleString()],
      ...s.months.slice(thisMonth ? 1 : 0, (thisMonth ? 1 : 0) + 2).map((m) => [`${monthLabel(m.month)} (estimate)`, money(m.estimated_cost)]),
      ['Chats · staff using it', `${s.conversations.toLocaleString()} · ${s.users}`],
      ['Chat data in the database', fmtBytes(s.table_bytes)],
      ['Attached files (R2)', `${fmtBytes(s.attachment_bytes)} · ${s.attachments}`],
      ['Whole database', fmtBytes(s.database_bytes)],
    ];
    $('ac-usage-body').innerHTML = rows.map(([k, v, cls]) => `<div class="ac-kv${cls ? ` ${cls}` : ''}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    $('ac-usage').hidden = false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  async function api(path, body, method = 'POST') {
    try {
      const session = await auth.getSession();
      const res = await fetch(path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${session?.access_token || ''}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, data } : { ok: false, error: data.error || `Request failed (${res.status})` };
    } catch {
      return { ok: false, error: 'Could not reach the portal.' };
    }
  }

  function grow() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 2}px`;
  }

  // Follow the answer down while the reader is at the bottom; leave them be
  // once they scroll up to reread something.
  function stick(force = false) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
    if (force || nearBottom) log.scrollTop = log.scrollHeight;
  }

  function announce(msg) { $('ac-status').textContent = msg; }
}

function timeLabel(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function whenLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (d.toDateString() === new Date().toDateString()) return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}
