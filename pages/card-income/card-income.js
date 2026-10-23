'use strict';

// Card Income page bootstrap. menu.js loads this as a classic script after
// injecting index.html; the page itself is ES modules (app.js, model.js,
// charts.js), stamped with the deploy version like Proof Scan v2.

(async function CardIncomePage() {
  const root = document.getElementById('ci-root');
  if (!root) return;
  const v = window.APP_CONFIG?.deployVersion || '';
  try {
    const { mountCardIncome } = await import(`/pages/card-income/app.js?v=${v}`);
    await mountCardIncome({ db: window.db, auth: window.Auth });
  } catch (err) {
    console.error('[card-income] page failed to load', err);
    const gate = document.getElementById('ci-gate');
    if (gate) {
      gate.textContent = '';
      const p = document.createElement('p');
      p.className = 'dk-empty';
      p.style.color = 'var(--color-danger)';
      p.textContent = 'Card Income could not load. Reload the page to try again.';
      gate.appendChild(p);
    }
  }
})();
