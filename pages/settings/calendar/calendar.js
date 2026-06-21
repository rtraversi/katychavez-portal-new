'use strict';

(async function CalendarSettingsPage() {

  // ── Check for OAuth redirect result ──────────────────────────────────────────

  const params    = new URLSearchParams(window.location.search);
  const calResult = params.get('cal_result');
  const banner    = document.getElementById('cal-banner');

  if (calResult) {
    if (calResult === 'connected' || calResult === 'outlook_connected') {
      const label = calResult === 'outlook_connected' ? 'Outlook' : 'Google';
      banner.style.background = 'var(--color-success-bg, #f0fdf4)';
      banner.style.color      = 'var(--color-success, #15803d)';
      banner.style.border     = '1px solid var(--color-success-border, #bbf7d0)';
      banner.textContent = `${label} Calendar connected successfully.`;
      banner.classList.remove('hidden');
    } else if (calResult.startsWith('error:')) {
      const code = calResult.replace('error:', '');
      const messages = {
        access_denied:  'You declined access. Click Connect to try again.',
        invalid_state:  'The authorization link expired. Please try again.',
        state_expired:  'The authorization link expired. Please try again.',
        token_exchange: 'Could not complete authorization. Please try again.',
        save_failed:    'Authorization succeeded but tokens could not be saved. Please try again.',
      };
      banner.style.background = 'var(--color-danger-bg, #fef2f2)';
      banner.style.color      = 'var(--color-danger, #dc2626)';
      banner.style.border     = '1px solid var(--color-danger-border, #fecaca)';
      banner.textContent = messages[code] || `Connection failed (${code}). Please try again.`;
      banner.classList.remove('hidden');
    }
    // Clean up query param without triggering a reload
    const clean = new URL(window.location.href);
    clean.searchParams.delete('cal_result');
    history.replaceState(null, '', clean);
  }

  // ── iCal feed elements ───────────────────────────────────────────────────────────

  const icalLoading  = document.getElementById('ical-loading');
  const icalReady    = document.getElementById('ical-ready');
  const icalUrlInput = document.getElementById('ical-url');
  const btnIcalCopy  = document.getElementById('btn-ical-copy');
  const btnIcalOpen  = document.getElementById('btn-ical-open');
  const btnIcalRegen = document.getElementById('btn-ical-regen');

  function setIcalUrl(token) {
    const feedUrl   = `${window.location.origin}/api/calendar/ical-feed?token=${token}`;
    const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://');
    icalUrlInput.value   = feedUrl;
    btnIcalOpen.href     = webcalUrl;
    icalLoading.classList.add('hidden');
    icalReady.classList.remove('hidden');
  }

  // Load token on page load
  (async () => {
    try {
      const session = await Auth.getSession();
      const res  = await fetch('/api/calendar/ical-token', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setIcalUrl(data.token);
      } else {
        icalLoading.textContent = 'Could not load feed URL.';
      }
    } catch {
      icalLoading.textContent = 'Could not load feed URL.';
    }
  })();

  btnIcalCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(icalUrlInput.value).then(() => {
      btnIcalCopy.textContent = 'Copied!';
      setTimeout(() => { btnIcalCopy.textContent = 'Copy URL'; }, 2000);
    });
  });

  btnIcalRegen.addEventListener('click', async () => {
    if (!await Utils.confirm(
      'Regenerate the iCal feed URL? Your current calendar subscription will stop working and you\'ll need to re-subscribe with the new URL.',
      { confirmLabel: 'Regenerate', danger: true }
    )) return;
    btnIcalRegen.disabled    = true;
    btnIcalRegen.textContent = 'Regenerating…';
    try {
      const session = await Auth.getSession();
      const res  = await fetch('/api/calendar/ical-token', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setIcalUrl(data.token);
        Utils.toast('Feed URL regenerated. Re-subscribe with the new URL.', 'success');
      } else {
        Utils.toast('Failed to regenerate URL.', 'error');
      }
    } catch {
      Utils.toast('Failed to regenerate URL.', 'error');
    }
    btnIcalRegen.disabled    = false;
    btnIcalRegen.textContent = 'Regenerate URL';
  });

  // ── Google elements ───────────────────────────────────────────────────────────

  const googleStatusText = document.getElementById('google-status-text');
  const btnGoogleConnect    = document.getElementById('btn-google-connect');
  const btnGoogleDisconnect = document.getElementById('btn-google-disconnect');
  const googleConnectedInfo = document.getElementById('google-connected-info');
  const googleAccountEmail  = document.getElementById('google-account-email');
  const googleSetupGuide    = document.getElementById('google-setup-guide');

  // ── Outlook elements ──────────────────────────────────────────────────────────

  const outlookStatusText    = document.getElementById('outlook-status-text');
  const btnOutlookConnect    = document.getElementById('btn-outlook-connect');
  const btnOutlookDisconnect = document.getElementById('btn-outlook-disconnect');
  const outlookConnectedInfo = document.getElementById('outlook-connected-info');
  const outlookAccountEmail  = document.getElementById('outlook-account-email');
  const outlookSetupGuide    = document.getElementById('outlook-setup-guide');

  // ── Load status (both providers) ──────────────────────────────────────────────

  async function loadStatus() {
    googleStatusText.textContent  = 'Checking…';
    outlookStatusText.textContent = 'Checking…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/calendar/status', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Google
      const google = data.providers?.google;
      if (google) {
        googleStatusText.textContent   = 'Connected';
        googleStatusText.style.color   = 'var(--color-success, #22c55e)';
        googleAccountEmail.textContent = google.email || 'Unknown account';
        googleConnectedInfo.classList.remove('hidden');
        btnGoogleConnect.classList.add('hidden');
        btnGoogleDisconnect.classList.remove('hidden');
        googleSetupGuide.classList.add('hidden');
      } else {
        googleStatusText.textContent = 'Not connected';
        googleStatusText.style.color = '';
        googleConnectedInfo.classList.add('hidden');
        btnGoogleConnect.classList.remove('hidden');
        btnGoogleDisconnect.classList.add('hidden');
        googleSetupGuide.classList.remove('hidden');
      }

      // Outlook
      const outlook = data.providers?.outlook;
      if (outlook) {
        outlookStatusText.textContent   = 'Connected';
        outlookStatusText.style.color   = 'var(--color-success, #22c55e)';
        outlookAccountEmail.textContent = outlook.email || 'Unknown account';
        outlookConnectedInfo.classList.remove('hidden');
        btnOutlookConnect.classList.add('hidden');
        btnOutlookDisconnect.classList.remove('hidden');
        outlookSetupGuide.classList.add('hidden');
      } else {
        outlookStatusText.textContent = 'Not connected';
        outlookStatusText.style.color = '';
        outlookConnectedInfo.classList.add('hidden');
        btnOutlookConnect.classList.remove('hidden');
        btnOutlookDisconnect.classList.add('hidden');
        outlookSetupGuide.classList.remove('hidden');
      }

    } catch (err) {
      googleStatusText.textContent  = 'Failed to load status';
      outlookStatusText.textContent = 'Failed to load status';
      console.error('[cal-settings] status:', err);
    }
  }

  await loadStatus();

  // ── Google — Connect ──────────────────────────────────────────────────────────

  btnGoogleConnect.addEventListener('click', async () => {
    btnGoogleConnect.disabled    = true;
    btnGoogleConnect.textContent = 'Connecting…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/calendar/oauth-url', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      Utils.toast(err.message || 'Failed to start Google authorization.', 'error');
      btnGoogleConnect.disabled    = false;
      btnGoogleConnect.textContent = 'Connect Google Calendar';
    }
  });

  // ── Google — Disconnect ───────────────────────────────────────────────────────

  btnGoogleDisconnect.addEventListener('click', async () => {
    if (!await Utils.confirm('Disconnect Google Calendar? The portal will no longer have access to your events.', { confirmLabel: 'Disconnect', danger: true })) return;
    btnGoogleDisconnect.disabled    = true;
    btnGoogleDisconnect.textContent = 'Disconnecting…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/calendar/disconnect', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ provider: 'google' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Utils.toast('Google Calendar disconnected.', 'success');
      await loadStatus();
    } catch (err) {
      Utils.toast(err.message || 'Failed to disconnect.', 'error');
      btnGoogleDisconnect.disabled    = false;
      btnGoogleDisconnect.textContent = 'Disconnect';
    }
  });

  // ── Outlook — Connect ─────────────────────────────────────────────────────────

  btnOutlookConnect.addEventListener('click', async () => {
    btnOutlookConnect.disabled    = true;
    btnOutlookConnect.textContent = 'Connecting…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/calendar/outlook-oauth-url', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      Utils.toast(err.message || 'Failed to start Outlook authorization.', 'error');
      btnOutlookConnect.disabled    = false;
      btnOutlookConnect.textContent = 'Connect Outlook Calendar';
    }
  });

  // ── Outlook — Disconnect ──────────────────────────────────────────────────────

  btnOutlookDisconnect.addEventListener('click', async () => {
    if (!await Utils.confirm('Disconnect Outlook Calendar? The portal will no longer have access to your events.', { confirmLabel: 'Disconnect', danger: true })) return;
    btnOutlookDisconnect.disabled    = true;
    btnOutlookDisconnect.textContent = 'Disconnecting…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/calendar/disconnect', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ provider: 'outlook' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Utils.toast('Outlook Calendar disconnected.', 'success');
      await loadStatus();
    } catch (err) {
      Utils.toast(err.message || 'Failed to disconnect.', 'error');
      btnOutlookDisconnect.disabled    = false;
      btnOutlookDisconnect.textContent = 'Disconnect';
    }
  });

})();
