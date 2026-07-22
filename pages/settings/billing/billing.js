'use strict';

(async function BillingSettingsPage() {

  // ── Handle OAuth redirect result ──────────────────────────────────────────────
  const params   = new URLSearchParams(window.location.search);
  const fbResult = params.get('fb_result');
  const banner   = document.getElementById('fb-banner');

  if (fbResult && banner) {
    if (fbResult === 'connected') {
      banner.style.background = 'var(--color-success-bg, #f0fdf4)';
      banner.style.color      = 'var(--color-success, #15803d)';
      banner.style.border     = '1px solid var(--color-success-border, #bbf7d0)';
      banner.textContent = 'FreshBooks connected successfully.';
      banner.classList.remove('hidden');
    } else if (fbResult.startsWith('error:')) {
      const code = fbResult.replace('error:', '');
      const messages = {
        access_denied:  'You declined access. Click Connect to try again.',
        missing_params: 'FreshBooks did not return an authorization code. Please try again.',
        invalid_state:  'The authorization link expired. Please try again.',
        state_expired:  'The authorization link expired. Please try again.',
        token_exchange: 'Could not complete authorization. Please try again.',
        no_business:    'Connected, but no FreshBooks business was found on that account. Sign in with the account that owns the FreshBooks business.',
        save_failed:    'Authorization succeeded but the connection could not be saved. Please try again.',
      };
      banner.style.background = 'var(--color-danger-bg, #fef2f2)';
      banner.style.color      = 'var(--color-danger, #dc2626)';
      banner.style.border     = '1px solid var(--color-danger-border, #fecaca)';
      banner.textContent = messages[code] || `Connection failed (${code}). Please try again.`;
      banner.classList.remove('hidden');
    }
    const clean = new URL(window.location.href);
    clean.searchParams.delete('fb_result');
    history.replaceState(null, '', clean);
  }

  // ── Elements ──────────────────────────────────────────────────────────────────
  const statusText    = document.getElementById('fb-status-text');
  const btnConnect    = document.getElementById('btn-fb-connect');
  const btnDisconnect = document.getElementById('btn-fb-disconnect');
  const connectedInfo = document.getElementById('fb-connected-info');
  const accountEmail  = document.getElementById('fb-account-email');
  const businessIdEl  = document.getElementById('fb-business-id');
  const setupGuide    = document.getElementById('fb-setup-guide');
  const notConfigured = document.getElementById('fb-not-configured');

  // ── Load status ───────────────────────────────────────────────────────────────
  async function loadStatus() {
    statusText.textContent = 'Checking…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/freshbooks/status', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (!data.configured) {
        statusText.textContent = 'Not configured';
        statusText.style.color = '';
        connectedInfo.classList.add('hidden');
        setupGuide.classList.add('hidden');
        btnConnect.classList.add('hidden');
        btnDisconnect.classList.add('hidden');
        notConfigured.classList.remove('hidden');
        return;
      }
      notConfigured.classList.add('hidden');

      if (data.connected) {
        statusText.textContent      = 'Connected';
        statusText.style.color      = 'var(--color-success, #22c55e)';
        accountEmail.textContent    = data.email || 'Unknown account';
        businessIdEl.textContent    = data.businessId || '—';
        connectedInfo.classList.remove('hidden');
        setupGuide.classList.add('hidden');
        btnConnect.classList.add('hidden');
        btnDisconnect.classList.remove('hidden');
      } else {
        statusText.textContent = 'Not connected';
        statusText.style.color = '';
        connectedInfo.classList.add('hidden');
        setupGuide.classList.remove('hidden');
        btnConnect.classList.remove('hidden');
        btnDisconnect.classList.add('hidden');
      }
    } catch (err) {
      statusText.textContent = 'Failed to load status';
      console.error('[billing-settings] status:', err);
    }
  }

  await loadStatus();

  // ── Connect ─────────────────────────────────────────────────────────────────--
  btnConnect.addEventListener('click', async () => {
    btnConnect.disabled    = true;
    btnConnect.textContent = 'Connecting…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/freshbooks/oauth-url', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      Utils.toast(err.message || 'Failed to start FreshBooks authorization.', 'error');
      btnConnect.disabled    = false;
      btnConnect.textContent = 'Connect FreshBooks';
    }
  });

  // ── Billing workflow ──────────────────────────────────────────────────────────
  // firm_settings.billing_mode + trust_first (migration 1536). Same singleton-row
  // pattern as the increment below. billing_mode decides which invoice-authoring
  // entry point the Billing page shows; trust_first decides which account payment
  // links route to when an invoice doesn't specify one.
  const modeSel       = document.getElementById('billing-mode');
  const modeBtn       = document.getElementById('btn-save-billing-mode');
  const trustSel      = document.getElementById('trust-first');
  const trustBtn      = document.getElementById('btn-save-trust-first');

  // ── Billing increment ─────────────────────────────────────────────────────────
  // firm_settings singleton, edited directly via supabase-js like Settings > Firm
  // (RLS: authenticated read, Owner-only write; column added in migration 1530).
  const incrementSel  = document.getElementById('billing-increment');
  const incrementBtn  = document.getElementById('btn-save-increment');
  const incrementNote = document.getElementById('increment-example');
  let settingsRowId = null;

  function showIncrementExample() {
    const inc = Number(incrementSel.value) || 1;
    incrementNote.textContent = inc <= 1
      ? 'Example: a 4-minute call bills as 0.07 hr — exactly the time tracked.'
      : `Example: a 4-minute call bills as ${(Math.ceil(4 / inc) * inc / 60).toFixed(2).replace(/0$/, '')} hr (rounded up from 4 minutes).`;
  }

  async function loadIncrement() {
    const { data, error } = await db.from('firm_settings')
      .select('id, billing_increment_minutes').limit(1).maybeSingle();
    if (error) { console.error('[billing-settings] increment:', error); return; }
    settingsRowId = data?.id || null;
    const val = String(data?.billing_increment_minutes || 1);
    if ([...incrementSel.options].some(o => o.value === val)) incrementSel.value = val;
    showIncrementExample();
  }

  incrementSel.addEventListener('change', showIncrementExample);

  incrementBtn.addEventListener('click', async () => {
    incrementBtn.disabled = true;
    try {
      const profile = await Auth.getProfile();
      const update  = {
        billing_increment_minutes: Number(incrementSel.value) || 1,
        updated_by: profile?.id || null,
      };
      const { error } = settingsRowId
        ? await db.from('firm_settings').update(update).eq('id', settingsRowId)
        : await db.from('firm_settings').insert(update);
      if (error) throw error;
      Utils.toast('Billing increment saved. It applies the next time unbilled time is pulled.', 'success');
      if (!settingsRowId) await loadIncrement();
    } catch (err) {
      Utils.toast(err.message || 'Save failed.', 'error');
    } finally {
      incrementBtn.disabled = false;
    }
  });

  await loadIncrement();

  // ── Billing workflow: load + save ─────────────────────────────────────────────
  async function loadBillingWorkflow() {
    const { data, error } = await db.from('firm_settings')
      .select('id, billing_mode, trust_first').limit(1).maybeSingle();
    if (error) { console.error('[billing-settings] workflow:', error); return; }
    settingsRowId = settingsRowId || data?.id || null;
    // Unset/unrecognised billing_mode shows 'portal' (the template default) but
    // is only persisted once the Owner actually saves — until then the Billing
    // page keeps showing both workflows.
    modeSel.value  = data?.billing_mode === 'freshbooks_first' ? 'freshbooks_first' : 'portal';
    trustSel.value = data?.trust_first === false ? 'off' : 'on';
  }

  async function saveSetting(btn, update, message, reload) {
    btn.disabled = true;
    try {
      const profile = await Auth.getProfile();
      const { error } = settingsRowId
        ? await db.from('firm_settings').update({ ...update, updated_by: profile?.id || null }).eq('id', settingsRowId)
        : await db.from('firm_settings').insert({ ...update, updated_by: profile?.id || null });
      if (error) throw error;
      Utils.toast(message, 'success');
      if (!settingsRowId) await reload();
    } catch (err) {
      Utils.toast(err.message || 'Save failed.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  modeBtn.addEventListener('click', () => saveSetting(
    modeBtn,
    { billing_mode: modeSel.value },
    modeSel.value === 'freshbooks_first'
      ? 'Invoices are drafted in FreshBooks. The Billing page now shows "From FreshBooks" instead of "+ New Invoice".'
      : 'Invoices are built in the portal from unbilled time. The Billing page now shows "+ New Invoice".',
    loadBillingWorkflow,
  ));

  trustBtn.addEventListener('click', () => saveSetting(
    trustBtn,
    { trust_first: trustSel.value === 'on' },
    trustSel.value === 'on'
      ? 'Invoice and retainer payment links will collect into the trust account.'
      : 'Invoice and retainer payment links will collect into the operating account. Confirm this is permitted for unearned client funds.',
    loadBillingWorkflow,
  ));

  await loadBillingWorkflow();

  // ── Retainer prepayments in FreshBooks ────────────────────────────────────────
  // firm_settings.fb_auto_prepayment (migration 1535) — same singleton-row
  // pattern as the billing increment above. Default OFF: the FreshBooks
  // prepayment-credit mechanism is unverified against a live FB account.
  const fbPrepaySel = document.getElementById('fb-prepay-auto');
  const fbPrepayBtn = document.getElementById('btn-save-fb-prepay');

  async function loadFbPrepay() {
    const { data, error } = await db.from('firm_settings')
      .select('id, fb_auto_prepayment').limit(1).maybeSingle();
    if (error) { console.error('[billing-settings] fb_auto_prepayment:', error); return; }
    settingsRowId = settingsRowId || data?.id || null;
    fbPrepaySel.value = data?.fb_auto_prepayment === true ? 'on' : 'off';
  }

  fbPrepayBtn.addEventListener('click', async () => {
    fbPrepayBtn.disabled = true;
    try {
      const profile = await Auth.getProfile();
      const update  = {
        fb_auto_prepayment: fbPrepaySel.value === 'on',
        updated_by: profile?.id || null,
      };
      const { error } = settingsRowId
        ? await db.from('firm_settings').update(update).eq('id', settingsRowId)
        : await db.from('firm_settings').insert(update);
      if (error) throw error;
      Utils.toast(
        fbPrepaySel.value === 'on'
          ? 'Retainers will now be auto-recorded in FreshBooks as Prepayment credits.'
          : 'Auto-recording is off — the retainer-paid email will remind the team to record prepayments in FreshBooks manually.',
        'success'
      );
      if (!settingsRowId) await loadFbPrepay();
    } catch (err) {
      Utils.toast(err.message || 'Save failed.', 'error');
    } finally {
      fbPrepayBtn.disabled = false;
    }
  });

  await loadFbPrepay();

  // ── Disconnect ────────────────────────────────────────────────────────────────
  btnDisconnect.addEventListener('click', async () => {
    if (!await Utils.confirm('Disconnect FreshBooks? The portal will stop syncing invoices and time entries.', { confirmLabel: 'Disconnect', danger: true })) return;
    btnDisconnect.disabled    = true;
    btnDisconnect.textContent = 'Disconnecting…';
    try {
      const session = await Auth.getSession();
      const res     = await fetch('/api/freshbooks/disconnect', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Utils.toast('FreshBooks disconnected.', 'success');
      await loadStatus();
    } catch (err) {
      Utils.toast(err.message || 'Failed to disconnect.', 'error');
      btnDisconnect.disabled    = false;
      btnDisconnect.textContent = 'Disconnect';
    }
  });

})();
