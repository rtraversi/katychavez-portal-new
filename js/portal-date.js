(function () {
  var el = document.getElementById('topbar-date');
  if (!el) return;
  function setDate() {
    el.textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }
  setDate();
  var now = new Date();
  var msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  setTimeout(function () { setDate(); setInterval(setDate, 86400000); }, msUntilMidnight);
})();
