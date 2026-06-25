(async function () {
  // Supabase dashboard recovery emails redirect to the site root with a
  // recovery token in the hash. Hand off to the dedicated reset page.
  if (window.location.hash.includes('type=recovery')) {
    window.location.replace('/reset-password' + window.location.hash);
    return;
  }

  // Already logged in → bounce to portal (or account if MFA enrollment needed)
  var session = await Auth.getSession();
  if (session) {
    var aal = await Auth.getMFALevel();
    if (aal && aal.currentLevel === 'aal1' && aal.nextLevel === 'aal1') {
      // Check if their role requires MFA enrollment
      var profile = await Auth.getProfile();
      if (profile && Auth.MFA_REQUIRED_ROLES.has(profile.role && profile.role.name)) {
        window.location.replace('/account?enroll=1');
        return;
      }
    }
    window.location.replace('/portal');
    return;
  }

  // Show session-expired message if redirected from portal
  var loginMsg = sessionStorage.getItem('login_message');
  if (loginMsg) {
    sessionStorage.removeItem('login_message');
    var msgEl = document.getElementById('login-error');
    msgEl.textContent = loginMsg;
    msgEl.hidden = false;
  }

  var form       = document.getElementById('login-form');
  var emailEl    = document.getElementById('email');
  var passwordEl = document.getElementById('password');
  var errorEl    = document.getElementById('login-error');
  var loginBtn   = document.getElementById('login-btn');

  // ── MFA challenge state ──────────────────────────────────────────────────────
  var _mfaFactorId    = null;
  var _mfaChallengeId = null;

  function setRememberedDevice(email) {
    try {
      localStorage.setItem('mfa_device_' + btoa(email), JSON.stringify({
        expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }));
    } catch (_) {}
  }

  var mfaPanel       = document.getElementById('mfa-panel');
  var mfaCodeEl      = document.getElementById('mfa-code');
  var mfaErrorEl     = document.getElementById('mfa-error');
  var mfaBtn         = document.getElementById('mfa-btn');
  var mfaRecovLink   = document.getElementById('mfa-recovery-link');

  var recoveryPanel   = document.getElementById('recovery-panel');
  var recoveryCodeEl  = document.getElementById('recovery-code');
  var recoveryErrorEl = document.getElementById('recovery-error');
  var recoveryMsgEl   = document.getElementById('recovery-message');
  var recoveryBtn     = document.getElementById('recovery-btn');
  var recoveryBackLink= document.getElementById('recovery-back-link');

  // ── Password login ───────────────────────────────────────────────────────────

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    try {
      await Auth.login(emailEl.value.trim(), passwordEl.value);

      // Check MFA assurance level after password auth
      var aal = await Auth.getMFALevel();
      if (aal && aal.nextLevel === 'aal2') {
        // Enrolled — need TOTP verification
        await startMFAChallenge();
      } else {
        // No TOTP factor enrolled — check if role requires enrollment
        var prof = await Auth.getProfile();
        if (prof && Auth.MFA_REQUIRED_ROLES.has(prof.role && prof.role.name)) {
          window.location.replace('/account?enroll=1');
        } else {
          window.location.replace('/portal');
        }
      }
    } catch (err) {
      errorEl.textContent = err.message === 'Invalid login credentials'
        ? 'Incorrect email or password.' : err.message;
      errorEl.hidden = false;
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign in';
    }
  });

  async function startMFAChallenge() {
    // Skip TOTP prompt if this device was remembered within the last 30 days
    if (Auth.isDeviceRemembered(emailEl.value.trim())) {
      window.location.replace('/portal');
      return;
    }

    var factors = await Auth.listMFAFactors();
    if (!factors.length) {
      window.location.replace('/portal');
      return;
    }
    _mfaFactorId = factors[0].id;
    var challenge = await Auth.challengeTOTP(_mfaFactorId);
    _mfaChallengeId = challenge.id;

    form.hidden = true;
    mfaPanel.hidden = false;
    mfaCodeEl.value = '';
    mfaCodeEl.focus();
  }

  // ── TOTP verification ────────────────────────────────────────────────────────

  mfaBtn.addEventListener('click', async function () {
    var code = mfaCodeEl.value.replace(/\s/g, '');
    if (code.length !== 6) {
      mfaErrorEl.textContent = 'Enter the 6-digit code from your authenticator app.';
      mfaErrorEl.hidden = false;
      return;
    }
    mfaErrorEl.hidden = true;
    mfaBtn.disabled = true;
    mfaBtn.textContent = 'Verifying…';

    try {
      await Auth.verifyTOTP(_mfaFactorId, _mfaChallengeId, code);
      var rememberEl = document.getElementById('mfa-remember');
      if (rememberEl && rememberEl.checked) {
        setRememberedDevice(emailEl.value.trim());
      }
      window.location.replace('/portal');
    } catch (err) {
      mfaErrorEl.textContent = 'Incorrect code — check your app and try again.';
      mfaErrorEl.hidden = false;
      // Re-challenge for a fresh window
      try {
        var ch = await Auth.challengeTOTP(_mfaFactorId);
        _mfaChallengeId = ch.id;
      } catch (_) {}
    } finally {
      mfaBtn.disabled = false;
      mfaBtn.textContent = 'Verify';
    }
  });

  // Allow submitting TOTP code with Enter
  mfaCodeEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); mfaBtn.click(); }
  });

  // ── Recovery code flow ───────────────────────────────────────────────────────

  mfaRecovLink.addEventListener('click', function (e) {
    e.preventDefault();
    mfaPanel.hidden = true;
    recoveryPanel.hidden = false;
    recoveryCodeEl.value = '';
    recoveryCodeEl.focus();
  });

  recoveryBackLink.addEventListener('click', function (e) {
    e.preventDefault();
    recoveryPanel.hidden = true;
    mfaPanel.hidden = false;
    mfaCodeEl.focus();
  });

  recoveryBtn.addEventListener('click', async function () {
    var code = recoveryCodeEl.value.trim();
    if (!code) {
      recoveryErrorEl.textContent = 'Enter your recovery code.';
      recoveryErrorEl.hidden = false;
      return;
    }
    recoveryErrorEl.hidden = true;
    recoveryMsgEl.hidden = true;
    recoveryBtn.disabled = true;
    recoveryBtn.textContent = 'Verifying…';

    try {
      var session = await Auth.getSession();
      var res = await fetch('/api/mfa-recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ code: code }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recovery failed.');

      recoveryMsgEl.textContent = 'Recovery code accepted. Your authenticator has been removed. You will now be redirected to set up a new authenticator.';
      recoveryMsgEl.hidden = false;
      recoveryBtn.hidden = true;
      recoveryCodeEl.disabled = true;
      setTimeout(function () { window.location.replace('/account?enroll=1'); }, 3000);
    } catch (err) {
      recoveryErrorEl.textContent = err.message;
      recoveryErrorEl.hidden = false;
      recoveryBtn.disabled = false;
      recoveryBtn.textContent = 'Use recovery code';
    }
  });

  recoveryCodeEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); recoveryBtn.click(); }
  });

})();
