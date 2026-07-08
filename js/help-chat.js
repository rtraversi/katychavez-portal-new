// Portal help chat widget — floating button + slide-up panel.
// Depends on: Auth (auth.js), loaded after portal-init.js.

(function () {
  'use strict';

  var messages = [];
  var sending  = false;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  var toggleBtn, panel, closeBtn, msgList, input, sendBtn;

  function init() {
    toggleBtn = document.getElementById('help-chat-toggle');
    panel     = document.getElementById('help-chat-panel');
    closeBtn  = document.getElementById('help-chat-close');
    msgList   = document.getElementById('help-chat-messages');
    input     = document.getElementById('help-chat-input');
    sendBtn   = document.getElementById('help-chat-send');

    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', openPanel);
    closeBtn.addEventListener('click',  closePanel);
    sendBtn.addEventListener('click',   submit);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });

    // auto-resize textarea
    input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    appendGreeting();
  }

  function openPanel() {
    panel.style.display = 'flex';
    toggleBtn.setAttribute('aria-expanded', 'true');
    input.focus();
  }

  function closePanel() {
    panel.style.display = 'none';
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  function appendGreeting() {
    var greeting = {
      role: 'assistant',
      content: 'Hi! I\'m Clause, your portal help assistant. Ask me anything about how to use the portal — uploading documents, sending messages, e-signatures, billing, and more.'
    };
    renderMessage(greeting);
  }

  function renderMessage(msg) {
    var div = document.createElement('div');
    div.className = 'help-msg help-msg-' + msg.role;

    var bubble = document.createElement('div');
    bubble.className = 'help-msg-bubble';
    bubble.textContent = msg.content;

    div.appendChild(bubble);
    msgList.appendChild(div);
    scrollToBottom();
    return div;
  }

  function renderTyping() {
    var div = document.createElement('div');
    div.className = 'help-msg help-msg-assistant';
    div.id = 'help-typing-indicator';

    var bubble = document.createElement('div');
    bubble.className = 'help-msg-bubble help-msg-typing';
    bubble.innerHTML = '<span></span><span></span><span></span>';

    div.appendChild(bubble);
    msgList.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() {
    msgList.scrollTop = msgList.scrollHeight;
  }

  async function submit() {
    var text = input.value.trim();
    if (!text || sending) return;

    sending = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    var userMsg = { role: 'user', content: text };
    messages.push(userMsg);
    renderMessage(userMsg);

    var typingEl = renderTyping();

    try {
      var session = await Auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      var res = await fetch('/api/help-chat', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ messages: messages }),
      });

      typingEl.remove();

      if (!res.ok) {
        var errData = await res.json().catch(function () { return {}; });
        throw new Error(errData.error || 'Request failed');
      }

      var data = await res.json();
      var assistantMsg = { role: 'assistant', content: data.reply };
      messages.push(assistantMsg);
      renderMessage(assistantMsg);

    } catch (err) {
      typingEl.remove();
      var errMsg = { role: 'assistant', content: 'Sorry, I couldn\'t get a response right now. Please try again in a moment.' };
      renderMessage(errMsg);
      // remove the failed user message so retry doesn't double it
      messages.pop();
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
