(async function () {
  // Supabase dashboard recovery emails redirect to the site root with a
  // recovery token in the hash. Hand off to the dedicated reset page.
  if (window.location.hash.includes('type=recovery')) {
    window.location.replace('/reset-password' + window.location.hash);
    return;
  }

  // Already logged in → bounce to portal
  var session = await Auth.getSession();
  if (session) { window.location.replace('/portal'); return; }

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

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    try {
      await Auth.login(emailEl.value.trim(), passwordEl.value);
      window.location.replace('/portal');
    } catch (err) {
      errorEl.textContent = err.message === 'Invalid login credentials'
        ? 'Incorrect email or password.' : err.message;
      errorEl.hidden = false;
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign in';
    }
  });

  var forgotLink = document.getElementById('forgot-link');
  var resetPanel = document.getElementById('reset-panel');
  var backLink   = document.getElementById('back-link');
  var resetBtn   = document.getElementById('reset-btn');
  var resetEmail = document.getElementById('reset-email');
  var resetMsg   = document.getElementById('reset-message');
  var resetErr   = document.getElementById('reset-error');

  forgotLink.addEventListener('click', function (e) {
    e.preventDefault();
    form.hidden = true;
    resetPanel.hidden = false;
    resetEmail.value = emailEl.value;
    resetEmail.focus();
  });

  backLink.addEventListener('click', function (e) {
    e.preventDefault();
    resetPanel.hidden = true;
    form.hidden = false;
  });

  resetBtn.addEventListener('click', async function () {
    resetMsg.hidden = true;
    resetErr.hidden = true;
    var email = resetEmail.value.trim();
    if (!email) { resetErr.textContent = 'Enter your email.'; resetErr.hidden = false; return; }

    resetBtn.disabled = true;
    resetBtn.textContent = 'Sending…';
    try {
      await Auth.sendPasswordReset(email);
      resetMsg.textContent = 'Reset link sent — check your email.';
      resetMsg.hidden = false;
    } catch (err) {
      resetErr.textContent = err.message;
      resetErr.hidden = false;
    } finally {
      resetBtn.disabled = false;
      resetBtn.textContent = 'Send reset link';
    }
  });
})();
