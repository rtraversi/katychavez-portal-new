'use strict';

// Proof Scan v2 page bootstrap. menu.js loads this as a classic script after
// injecting index.html, the same way it loads pages/proof-scan/proof-scan.js.
// The page itself is a set of ES modules, imported once and stamped with the
// deploy version so a release never pairs new screens with cached ones.

(async function ProofScanV2Page() {
  const root = document.getElementById('ps2-root');
  if (!root) return;
  const v = window.APP_CONFIG?.deployVersion || '';
  try {
    const { mountProofScanV2, createApi } = await import(`/pages/proof-scan-v2/app.js?v=${v}`);
    const api = createApi({
      getToken: async () => (await Auth.getSession())?.access_token || null,
    });
    mountProofScanV2({ root, api });
  } catch (err) {
    console.error('[proof-scan-v2] page failed to load');
    root.textContent = '';
    const p = document.createElement('p');
    p.className = 'dk-empty';
    p.style.color = 'var(--color-danger)';
    p.textContent = 'Proof Scan v2 could not load. Reload the page to try again.';
    root.appendChild(p);
  }
})();
