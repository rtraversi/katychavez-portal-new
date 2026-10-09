// Preview shell for Proof Scan v2. NOT PRODUCTION CODE.
//
// Loads the real page exactly the way js/menu.js does in the portal: fetch
// pages/proof-scan-v2/index.html into #page-content, then append
// pages/proof-scan-v2/proof-scan-v2.js as a script. Sign-in is a stub; the
// preview server answers every API call.
(function () {
  window.APP_CONFIG = { deployVersion: 'preview' };
  window.Auth = { getSession: async function () { return { access_token: 'preview' }; } };

  var mode = new URLSearchParams(location.search).get('mode');
  if (mode && window.PortalTheme && window.PortalTheme.mode !== mode) window.PortalTheme.toggleMode();
  var btn = document.getElementById('topbar-mode-btn');
  function sync() {
    var dark = window.PortalTheme && window.PortalTheme.mode === 'dark';
    document.getElementById('topbar-mode-sun').style.display = dark ? '' : 'none';
    document.getElementById('topbar-mode-moon').style.display = dark ? 'none' : '';
  }
  btn.addEventListener('click', function () { window.PortalTheme && window.PortalTheme.toggleMode(); });
  document.addEventListener('portalmodechange', sync);
  sync();

  var main = document.getElementById('page-content');
  fetch('/pages/proof-scan-v2/index.html?v=preview').then(function (r) { return r.text(); }).then(function (html) {
    // Same as menu.js: the page's own fixed markup.
    main.innerHTML = html;
    var banner = document.createElement('div');
    banner.className = 'preview-banner';
    var strong = document.createElement('strong');
    strong.textContent = 'Local preview: synthetic data, real page, real server checks, canned AI answers. Nothing is sent anywhere. Restart the preview to reset.';
    banner.appendChild(strong);
    var det = document.createElement('details');
    var sum = document.createElement('summary');
    sum.textContent = 'Sample files to drag in (any PDF works; these names pick a scenario)';
    det.appendChild(sum);
    var grid = document.createElement('div');
    grid.className = 'preview-samples';
    det.appendChild(grid);
    banner.appendChild(det);
    main.insertBefore(banner, main.firstChild);
    fetch('/__samples.json').then(function (r) { return r.json(); }).then(function (groups) {
      Object.keys(groups).forEach(function (g) {
        var h = document.createElement('h4');
        h.textContent = g;
        grid.appendChild(h);
        groups[g].forEach(function (name) {
          var a = document.createElement('a');
          a.href = '/__samples/' + name;
          a.textContent = name;
          a.setAttribute('download', name);
          grid.appendChild(a);
        });
      });
    });
    var s = document.createElement('script');
    s.src = '/pages/proof-scan-v2/proof-scan-v2.js?v=preview';
    document.body.appendChild(s);
  });
})();
