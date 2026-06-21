(async function () {
  var loadingEl  = document.getElementById('loading-state');
  var resetForm  = document.getElementById('reset-form');
  var errorState = document.getElementById('error-state');
  var resetErr   = document.getElementById('reset-error');
  var resetOk    = document.getElementById('reset-success');
  var resetBtn   = document.getElementById('reset-btn');
  var newPwEl    = document.getElementById('new-password');
  var confirmEl  = document.getElementById('confirm-password');

  // Capture hash params before Supabase clears them.
  var hashParams = new URLSearchParams(window.location.hash.slice(1));
  var isInvite   = hashParams.get('type') === 'invite';

  if (isInvite) {
    document.title = 'Welcome — Set Your Password';
    document.querySelector('.reset-intro').textContent =
      'Welcome! Please set a password to access your portal.';
    resetBtn.textContent = 'Set password & continue';
  }

  var recoveryActive = false;

  // PASSWORD_RECOVERY = password reset link; SIGNED_IN = invite link.
  // Also check SIGNED_IN for PKCE recovery flow (code= param in URL, no type in hash).
  var urlParams   = new URLSearchParams(window.location.search);
  var hasPkceCode = !!urlParams.get('code');

  db.auth.onAuthStateChange(function (event, session) {
    var isRecovery = event === 'PASSWORD_RECOVERY' ||
      (event === 'SIGNED_IN' && isInvite) ||
      (event === 'SIGNED_IN' && hasPkceCode && session && session.user);
    if (isRecovery) {
      recoveryActive = true;
      loadingEl.hidden = true;
      errorState.hidden = true;
      resetForm.hidden = false;
      newPwEl.focus();
    }
  });

  // Trigger token exchange (processes hash fragment or ?code= param).
  await db.auth.getSession();

  // Fallback: show error state if no recovery event arrives within 10s.
  // PKCE token exchange can take longer than implicit flow.
  setTimeout(function () {
    if (!recoveryActive) {
      loadingEl.hidden = true;
      errorState.hidden = false;
    }
  }, 10000);

  resetForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    resetErr.hidden = true;
    resetOk.hidden  = true;

    var pw      = newPwEl.value;
    var confirm = confirmEl.value;

    if (pw.length < 8)             { resetErr.textContent = 'Password must be at least 8 characters.';                           resetErr.hidden = false; return; }
    if (!/[A-Z]/.test(pw))         { resetErr.textContent = 'Password must include at least one uppercase letter.';              resetErr.hidden = false; return; }
    if (!/[a-z]/.test(pw))         { resetErr.textContent = 'Password must include at least one lowercase letter.';              resetErr.hidden = false; return; }
    if (!/[0-9]/.test(pw))         { resetErr.textContent = 'Password must include at least one number.';                        resetErr.hidden = false; return; }
    if (!/[^A-Za-z0-9]/.test(pw))  { resetErr.textContent = 'Password must include at least one special character (e.g. !@#$%).'; resetErr.hidden = false; return; }
    if (pw !== confirm)            { resetErr.textContent = 'Passwords do not match.';                                           resetErr.hidden = false; return; }

    resetBtn.disabled = true;
    resetBtn.textContent = 'Updating…';

    try {
      var result = await db.auth.updateUser({ password: pw });
      if (result.error) throw result.error;

      resetOk.textContent = 'Password updated! Redirecting to portal…';
      resetOk.hidden = false;
      resetForm.hidden = true;

      setTimeout(function () { window.location.replace('/portal'); }, 1500);
    } catch (err) {
      resetErr.textContent = err.message;
      resetErr.hidden = false;
      resetBtn.disabled = false;
      resetBtn.textContent = 'Update password';
    }
  });
})();
