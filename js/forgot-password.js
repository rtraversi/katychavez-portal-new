(async function () {
  var resetBtn = document.getElementById('reset-btn');
  var resetEmail = document.getElementById('reset-email');
  var resetMsg   = document.getElementById('reset-message');
  var resetErr   = document.getElementById('reset-error');

  // Pre-fill email if passed via query string (e.g. ?email=user@example.com)
  var params = new URLSearchParams(window.location.search);
  if (params.get('email')) resetEmail.value = params.get('email');

  resetEmail.focus();

  resetBtn.addEventListener('click', async function () {
    resetMsg.hidden = true;
    resetErr.hidden = true;

    var email = resetEmail.value.trim();
    if (!email) {
      resetErr.textContent = 'Enter your email address.';
      resetErr.hidden = false;
      return;
    }

    resetBtn.disabled = true;
    resetBtn.textContent = 'Sending…';

    try {
      await Auth.sendPasswordReset(email);
      resetMsg.textContent = 'Reset link sent — check your inbox.';
      resetMsg.hidden = false;
      resetBtn.hidden = true;
      resetEmail.disabled = true;
    } catch (err) {
      resetErr.textContent = err.message;
      resetErr.hidden = false;
    } finally {
      resetBtn.disabled = false;
      resetBtn.textContent = 'Send reset link';
    }
  });

  resetEmail.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); resetBtn.click(); }
  });
})();
