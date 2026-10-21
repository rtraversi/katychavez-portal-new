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
    det.open = true;
    var sum = document.createElement('summary');
    // Max 2026-10-16: click, don't drag.
    sum.textContent = 'Examples: click an AOS case to open it, or click a sample file to add it to the stage you have open';
    det.appendChild(sum);
    var note = document.createElement('div');
    note.className = 'preview-sample-note';
    note.setAttribute('role', 'status');
    det.appendChild(note);
    var grid = document.createElement('div');
    grid.className = 'preview-samples';
    det.appendChild(grid);
    banner.appendChild(det);
    main.insertBefore(banner, main.firstChild);

    function say(text) { note.textContent = text; }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function byText(sel, text) {
      return Array.prototype.find.call(document.querySelectorAll(sel), function (b) { return b.textContent.trim() === text; });
    }

    // Open a case by its folder name, then one of its stages. The AOS cases
    // were run through the real engine when the preview started.
    async function openCase(label, stage) {
      var back = byText('.ps2 button', 'All cases');
      if (back) { back.click(); await wait(500); }
      var rows = document.querySelectorAll('.ps2 .v2-case-row');
      var row = Array.prototype.find.call(rows, function (r) { return r.textContent.indexOf(label) !== -1; });
      if (!row) { say('Could not find ' + label + '. Restart the preview to bring the examples back.'); return; }
      row.click();
      await wait(900);
      var card = document.querySelector('.ps2 .v2-stage-card[data-stage="' + stage + '"]');
      var step = card || Array.prototype.find.call(document.querySelectorAll('.ps2 .v2-step'), function (x) { return x.textContent.indexOf('Physical Scan') !== -1; });
      if (step) (step.querySelector('button') || step).click();
      say('Opened ' + label + '.');
    }

    // Add a sample file to the drop zone on screen, as if dropped.
    async function addSample(name) {
      var inputs = document.querySelectorAll('.ps2 input[type=file]');
      var input = inputs[0];
      if (!input) { say('Open a case and a stage first (Evidence Zero, Draft Review, Pre-flight or Physical Scan), then click a file.'); return; }
      var blob = await fetch('/__samples/' + name).then(function (r) { return r.blob(); });
      var dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: 'application/pdf' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      say('Added ' + name + '. Now press the stage\'s Run button (or Read for Evidence Zero).');
    }

    var aos = document.createElement('h4');
    aos.textContent = 'AOS cases (run through the real checker at start-up)';
    grid.appendChild(aos);
    [
      ['SANTOS & VEGA', 'physical_scan', 'Spousal: every stage, Evidence Zero documents and a suggestion'],
      ['REYES, Miguel & Carmen', 'physical_scan', 'Child to parent: clean, one possible issue'],
      ['NGUYEN & TRAN', 'physical_scan', 'Parent to child, under 14: interpreter boxes'],
      ['OKAFOR & BELLO', 'physical_scan', 'Spousal, turning 79: G-1650, terrorism Yes, divorce certificate'],
    ].forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preview-sample-btn';
      b.textContent = c[0] + ' · ' + c[2];
      b.addEventListener('click', function () { openCase(c[0], c[1]); });
      grid.appendChild(b);
    });

    fetch('/__samples.json').then(function (r) { return r.json(); }).then(function (groups) {
      Object.keys(groups).forEach(function (g) {
        var h = document.createElement('h4');
        h.textContent = g + ' (click to add)';
        grid.appendChild(h);
        groups[g].forEach(function (name) {
          var a = document.createElement('a');
          a.href = '/__samples/' + name;
          a.textContent = name;
          a.title = 'Click to add to the open stage. Alt-click to download.';
          a.addEventListener('click', function (e) {
            if (e.altKey) return;
            e.preventDefault();
            addSample(name);
          });
          grid.appendChild(a);
        });
      });
    });
    var s = document.createElement('script');
    s.src = '/pages/proof-scan-v2/proof-scan-v2.js?v=preview';
    document.body.appendChild(s);
  });
})();
