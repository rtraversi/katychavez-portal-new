// Account page — TOTP MFA enrollment and management.
// Standalone page: no portal SPA dependency, only auth.js + supabase-client.js.
(async function () {
  'use strict';

  // ── Auth check ───────────────────────────────────────────────────────────────
  var session = await Auth.getSession();
  if (!session) {
    window.location.replace('/');
    return;
  }

  var isEnrollFlow = new URLSearchParams(window.location.search).has('enroll');

  document.getElementById('account-loading').hidden = true;
  document.getElementById('account-main').hidden = false;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function showModal(id) {
    document.getElementById(id).classList.remove('hidden');
    document.getElementById(id).classList.add('active');
  }
  function hideModal(id) {
    document.getElementById(id).classList.add('hidden');
    document.getElementById(id).classList.remove('active');
  }

  // Generate 8 secure random recovery codes (format: xxxx-xxxx-xxxx, hex)
  function generateRecoveryCodes() {
    var codes = [];
    for (var i = 0; i < 8; i++) {
      var bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      var hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      codes.push(hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12));
    }
    return codes;
  }

  function renderCodeGrid(containerId, codes) {
    var grid = document.getElementById(containerId);
    grid.innerHTML = codes.map(c =>
      '<div class="recovery-code-item">' + c + '</div>'
    ).join('');
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).catch(function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  }

  function downloadCodes(codes) {
    var blob = new Blob([
      'IurisIQ Recovery Codes\n',
      'Save these in a secure location. Each code can only be used once.\n\n',
      codes.join('\n'),
    ], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'iurisiq-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function storeRecoveryCodes(codes) {
    var s = await Auth.getSession();
    var res = await fetch('/api/mfa-store-recovery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.access_token,
      },
      body: JSON.stringify({ codes: codes }),
    });
    if (!res.ok) {
      var d = await res.json();
      throw new Error(d.error || 'Failed to save recovery codes.');
    }
  }

  // ── Load current MFA state ───────────────────────────────────────────────────

  var _factors = [];

  async function loadMFAState() {
    var profile = await Auth.getProfile();
    var roleName = profile && profile.role && profile.role.name;
    var requiresMFA = Auth.MFA_REQUIRED_ROLES.has(roleName);

    _factors = await Auth.listMFAFactors();
    var enrolled = _factors.length > 0;

    var statusArea = document.getElementById('mfa-status-area');
    if (enrolled) {
      statusArea.innerHTML = '<div class="mfa-status-badge mfa-status-badge--enrolled">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><polyline points="20 6 9 17 4 12"/></svg>' +
        'Authenticator app connected</div>';
    } else if (requiresMFA) {
      statusArea.innerHTML = '<div class="mfa-status-badge mfa-status-badge--required">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        'Required for your role — please set up before continuing</div>';
    } else {
      statusArea.innerHTML = '<div class="mfa-status-badge mfa-status-badge--not-enrolled">Not enabled</div>';
    }

    document.getElementById('mfa-not-enrolled').hidden = enrolled;
    document.getElementById('mfa-enrolled').hidden = !enrolled;

    // Auto-open enrollment if redirected from login
    if (isEnrollFlow && !enrolled) {
      isEnrollFlow = false;
      startEnrollment();
    }
  }

  await loadMFAState();

  // ── Enrollment flow ──────────────────────────────────────────────────────────

  var _enrollFactorId    = null;
  var _enrollChallengeId = null;

  async function startEnrollment() {
    // Clean up any unverified pending factors first (Supabase rejects re-enrollment if one exists)
    var existing = await Auth.listAllMFAFactors();
    for (var f of existing) {
      if (f.status === 'unverified') {
        try { await Auth.unenrollTOTP(f.id); } catch (_) {}
      }
    }

    var enrollData = await Auth.enrollTOTP();
    _enrollFactorId = enrollData.id;

    // Show QR code (Supabase returns the QR as an SVG string in totp.qr_code)
    document.getElementById('enroll-step-qr').hidden = false;
    document.getElementById('enroll-step-codes').hidden = true;

    // qr_code is a data URI (svg+xml or png) — set it as an img src
    document.getElementById('qr-img').src = enrollData.totp.qr_code || '';

    document.getElementById('totp-secret').textContent = enrollData.totp.secret;
    document.getElementById('enroll-code').value = '';
    document.getElementById('enroll-error').hidden = true;

    // Start challenge so the verify step has a fresh challenge ID
    var ch = await Auth.challengeTOTP(_enrollFactorId);
    _enrollChallengeId = ch.id;

    showModal('enroll-modal');
    setTimeout(function () { document.getElementById('enroll-code').focus(); }, 100);
  }

  document.getElementById('btn-start-enroll').addEventListener('click', function () {
    startEnrollment().catch(function (err) {
      alert('Could not start enrollment: ' + err.message);
    });
  });

  document.getElementById('enroll-modal-close').addEventListener('click', function () {
    hideModal('enroll-modal');
    // Unenroll any unverified factor we just created
    if (_enrollFactorId) {
      Auth.listMFAFactors().then(function (facs) {
        var f = facs.find(function (x) { return x.id === _enrollFactorId && x.status === 'unverified'; });
        if (f) Auth.unenrollTOTP(f.id).catch(function () {});
      }).catch(function () {});
      _enrollFactorId = null;
    }
  });

  var enrollVerifyBtn = document.getElementById('btn-enroll-verify');
  document.getElementById('enroll-code').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); enrollVerifyBtn.click(); }
  });

  enrollVerifyBtn.addEventListener('click', async function () {
    var code = document.getElementById('enroll-code').value.replace(/\s/g, '');
    var errEl = document.getElementById('enroll-error');
    errEl.hidden = true;
    if (code.length !== 6) {
      errEl.textContent = 'Enter the 6-digit code from your app.';
      errEl.hidden = false;
      return;
    }
    enrollVerifyBtn.disabled = true;
    enrollVerifyBtn.textContent = 'Verifying…';

    try {
      // Re-challenge if the challenge expired
      var ch = await Auth.challengeTOTP(_enrollFactorId);
      _enrollChallengeId = ch.id;
      await Auth.verifyTOTP(_enrollFactorId, _enrollChallengeId, code);

      // Enrollment confirmed — generate and store recovery codes
      var codes = generateRecoveryCodes();
      await storeRecoveryCodes(codes);

      // Show codes
      document.getElementById('enroll-step-qr').hidden = true;
      document.getElementById('enroll-step-codes').hidden = false;
      renderCodeGrid('recovery-codes-display', codes);

      // Wire up copy/download for this set of codes
      document.getElementById('btn-copy-codes').onclick = function () {
        copyText(codes.join('\n'));
      };
      document.getElementById('btn-download-codes').onclick = function () {
        downloadCodes(codes);
      };

    } catch (err) {
      errEl.textContent = 'Incorrect code — check your app and try again.';
      errEl.hidden = false;
      // Refresh challenge
      try {
        var ch2 = await Auth.challengeTOTP(_enrollFactorId);
        _enrollChallengeId = ch2.id;
      } catch (_) {}
    } finally {
      enrollVerifyBtn.disabled = false;
      enrollVerifyBtn.textContent = 'Confirm & activate';
    }
  });

  document.getElementById('btn-done-enroll').addEventListener('click', function () {
    hideModal('enroll-modal');
    window.location.replace('/portal');
  });

  // ── Remove TOTP ──────────────────────────────────────────────────────────────

  document.getElementById('btn-remove-totp').addEventListener('click', function () {
    document.getElementById('remove-code').value = '';
    document.getElementById('remove-error').hidden = true;
    showModal('remove-modal');
    setTimeout(function () { document.getElementById('remove-code').focus(); }, 100);
  });

  document.getElementById('remove-modal-close').addEventListener('click', function () { hideModal('remove-modal'); });
  document.getElementById('remove-cancel-btn').addEventListener('click', function () { hideModal('remove-modal'); });

  document.getElementById('remove-code').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('remove-confirm-btn').click(); }
  });

  document.getElementById('remove-confirm-btn').addEventListener('click', async function () {
    var code = document.getElementById('remove-code').value.replace(/\s/g, '');
    var errEl = document.getElementById('remove-error');
    errEl.hidden = true;
    if (code.length !== 6) {
      errEl.textContent = 'Enter the 6-digit code from your authenticator app.';
      errEl.hidden = false;
      return;
    }

    var btn = document.getElementById('remove-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Verifying…';

    try {
      if (!_factors.length) throw new Error('No authenticator to remove.');
      var factorId = _factors[0].id;
      // Verify TOTP before unenrolling (prevents unauthorized removal)
      var ch = await Auth.challengeTOTP(factorId);
      await Auth.verifyTOTP(factorId, ch.id, code);
      await Auth.unenrollTOTP(factorId);

      hideModal('remove-modal');
      await loadMFAState();
    } catch (err) {
      errEl.textContent = 'Incorrect code or removal failed. Try again.';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Remove authenticator';
    }
  });

  // ── Regenerate recovery codes ─────────────────────────────────────────────────

  document.getElementById('btn-regen-codes').addEventListener('click', async function () {
    try {
      var codes = generateRecoveryCodes();
      await storeRecoveryCodes(codes);
      renderCodeGrid('regen-codes-display', codes);

      document.getElementById('btn-copy-regen-codes').onclick = function () {
        copyText(codes.join('\n'));
      };
      document.getElementById('btn-download-regen-codes').onclick = function () {
        downloadCodes(codes);
      };

      showModal('regen-modal');
    } catch (err) {
      alert('Could not generate codes: ' + err.message);
    }
  });

  document.getElementById('regen-modal-close').addEventListener('click', function () { hideModal('regen-modal'); });
  document.getElementById('btn-close-regen').addEventListener('click', function () { hideModal('regen-modal'); });

})();
