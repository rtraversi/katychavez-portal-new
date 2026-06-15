'use strict';

// Messaging module — staff inbox + thread view
// Auth token obtained via Auth.getSession() (js/auth.js loaded globally in portal.html)

(function () {
  let currentConvoId    = null;
  let currentClientId   = null;
  let pollInterval      = null;
  let allConversations  = [];

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function apiFetch(path, opts = {}) {
    const session = await Auth.getSession();
    const token   = session?.access_token || '';
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });
    return res.json();
  }

  function initials(name) {
    return (name || '?').split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
  }

  function relativeTime(iso) {
    const d    = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Load conversation list ────────────────────────────────────────────────

  async function loadConversations() {
    const data = await apiFetch('/api/get-conversations');
    allConversations = data.conversations || [];
    renderConvoList(allConversations);
  }

  function renderConvoList(conversations) {
    const list = document.getElementById('msg-convo-list');
    if (!list) return;

    if (!conversations.length) {
      list.innerHTML = '<div class="msg-empty-list">No conversations found.</div>';
      return;
    }

    const totalUnread = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);
    const badge = document.getElementById('msg-total-unread');
    if (badge) {
      badge.textContent = totalUnread || '';
      badge.classList.toggle('hidden', !totalUnread);
    }
    window.Menu?.setNavBadge('messaging', totalUnread);

    list.innerHTML = conversations.map(c => `
      <div class="msg-convo-item ${c.id === currentConvoId ? 'active' : ''} ${c.unread_count ? 'unread' : ''}"
           data-id="${esc(c.id)}"
           data-client="${esc(c.client_id)}"
           data-name="${esc(c.client_name)}">
        <div class="msg-convo-avatar">${esc(initials(c.client_name))}</div>
        <div class="msg-convo-body">
          <div class="msg-convo-row">
            <span class="msg-convo-name">${esc(c.client_name)}</span>
            <span class="msg-convo-time">${c.last_message ? relativeTime(c.last_message.created_at) : ''}</span>
          </div>
          <div class="msg-convo-preview">
            ${c.last_message
              ? `${c.last_message.direction === 'outbound' ? '<span class="msg-you">You: </span>' : ''}${esc(c.last_message.body)}`
              : '<em>No messages yet</em>'}
          </div>
        </div>
        ${c.unread_count ? `<span class="msg-unread-badge">${c.unread_count}</span>` : ''}
      </div>
    `).join('');

    list.querySelectorAll('.msg-convo-item').forEach(el => {
      el.addEventListener('click', () =>
        selectConversation(el.dataset.id, el.dataset.client, el.dataset.name)
      );
    });
  }

  // ── Select + load thread ─────────────────────────────────────────────────

  async function selectConversation(convoId, clientId, clientName) {
    currentConvoId  = convoId;
    currentClientId = clientId;

    document.querySelectorAll('.msg-convo-item').forEach(el =>
      el.classList.toggle('active', el.dataset.id === convoId)
    );

    const emptyEl  = document.getElementById('msg-empty');
    const headerEl = document.getElementById('msg-thread-header');
    const replyEl  = document.getElementById('msg-reply');
    const avatarEl = document.getElementById('msg-thread-avatar');
    const nameEl   = document.getElementById('msg-thread-name');
    const bubblesEl = document.getElementById('msg-bubbles');

    emptyEl?.classList.add('hidden');
    headerEl?.classList.remove('hidden');
    replyEl?.classList.remove('hidden');

    if (avatarEl) avatarEl.textContent = initials(clientName);
    if (nameEl)   nameEl.textContent   = clientName;
    if (bubblesEl) bubblesEl.innerHTML  = '<div class="msg-loading">Loading…</div>';

    await loadMessages(convoId);
    loadConversations();  // refresh list to clear unread badge

    clearInterval(pollInterval);
    pollInterval = setInterval(() => loadMessages(convoId), 15000);
  }

  async function loadMessages(convoId) {
    const data     = await apiFetch(`/api/get-messages?conversation_id=${convoId}`);
    const bubblesEl = document.getElementById('msg-bubbles');
    if (!bubblesEl) return;

    if (!data.messages?.length) {
      bubblesEl.innerHTML = '<div class="msg-empty-thread">No messages yet — send the first one below.</div>';
      return;
    }

    const msgs = data.messages;
    const lastReadIdx = msgs.reduce((acc, m, i) =>
      m.direction === 'outbound' && m.client_read_at ? i : acc, -1);

    bubblesEl.innerHTML = msgs.map((m, i) => {
      const isRead    = m.direction === 'outbound' && m.client_read_at;
      const extraClass = isRead ? ' client-read' : '';
      return `
      <div class="msg-bubble ${esc(m.direction)}${extraClass}">
        <div class="msg-bubble-body">${esc(m.body).replace(/\n/g, '<br>')}</div>
        <div class="msg-bubble-meta">
          ${m.direction === 'outbound' && m.sender_name ? esc(m.sender_name) + ' · ' : ''}${relativeTime(m.created_at)}
          ${m.direction === 'outbound' ? `<span class="msg-channel-tag">${esc(m.channel)}</span>` : ''}
        </div>
        ${i === lastReadIdx ? '<div class="msg-read-receipt">Read</div>' : ''}
      </div>`;
    }).join('');
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // ── Send message ─────────────────────────────────────────────────────────

  async function sendMessage() {
    if (!currentClientId) return;

    const inputEl = document.getElementById('msg-reply-input');
    const btnEl   = document.getElementById('msg-send-btn');
    const body    = inputEl?.value.trim();
    if (!body) return;

    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Sending…'; }

    const data = await apiFetch('/api/send-message', {
      method: 'POST',
      body:   JSON.stringify({ client_id: currentClientId, body }),
    });

    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Send'; }

    if (data.message) {
      if (inputEl) inputEl.value = '';
      const charsEl = document.getElementById('msg-reply-chars');
      if (charsEl) charsEl.textContent = '0 / 2000';
      await loadMessages(currentConvoId);
      loadConversations();
    } else {
      Utils.toast(data.error || 'Failed to send message.', 'error');
    }
  }

  // ── Event binding (called after HTML is injected into DOM) ────────────────

  function bindEvents() {
    document.getElementById('msg-send-btn')?.addEventListener('click', sendMessage);

    document.getElementById('msg-reply-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMessage();
    });

    document.getElementById('msg-reply-input')?.addEventListener('input', function () {
      const charsEl = document.getElementById('msg-reply-chars');
      if (charsEl) charsEl.textContent = `${this.value.length} / 2000`;
    });

    document.getElementById('msg-search')?.addEventListener('input', function () {
      const q = this.value.toLowerCase().trim();
      renderConvoList(q
        ? allConversations.filter(c => c.client_name.toLowerCase().includes(q))
        : allConversations
      );
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function cleanup() {
    clearInterval(pollInterval);
    pollInterval    = null;
    currentConvoId  = null;
    currentClientId = null;
  }

  // menu.js re-runs this script on navigation — clean up previous state first
  cleanup();
  bindEvents();
  loadConversations();

  // Clean up poll timer when navigating away
  window.addEventListener('hashchange', cleanup, { once: true });
})();
