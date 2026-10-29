'use strict';

// Ask Claude page bootstrap. menu.js loads this as a classic script after
// injecting index.html; the page itself is ES modules (app.js, markdown.js),
// stamped with the deploy version like Card Income.

(async function AskClaudePage() {
  const root = document.getElementById('ac-root');
  if (!root) return;
  const v = window.APP_CONFIG?.deployVersion || '';
  try {
    const { mountAskClaude } = await import(`/pages/ai-chat/app.js?v=${v}`);
    await mountAskClaude({ db: window.db, auth: window.Auth });
  } catch (err) {
    console.error('[ai-chat] page failed to load', err);
    const gate = document.getElementById('ac-gate');
    if (gate) {
      gate.textContent = '';
      const p = document.createElement('p');
      p.className = 'dk-empty';
      p.style.color = 'var(--color-danger)';
      p.textContent = 'Ask Claude could not load. Reload the page to try again.';
      gate.appendChild(p);
    }
  }
})();
