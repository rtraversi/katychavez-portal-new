// js/book.js
// Drives the public consultation-booking page (book.html, served at /book).
// Attorney-first flow: pick attorney → pick consult type → pick a slot from
// that attorney's real availability → details + Turnstile → confirm.
// No auth — talks only to the /api/booking/* public endpoints.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var cfg = window.APP_CONFIG || {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Wizard state ─────────────────────────────────────────────────────────────
  var state = {
    attorneys: [],
    caseTypes: [],
    attorney: null,      // selected { slug, display_name, photo_url, blurb }
    consultType: null,   // selected { id, name, duration_min, fee_type, price_cents }
    timezone: 'America/Chicago',
    slotsByDay: {},      // 'YYYY-MM-DD' -> [{ start, end }]
    dayOrder: [],
    selectedDay: null,
    slot: null,          // selected { start, end }
    singleAttorney: false,
    offer: null,         // private booking-offer token (/book?offer=...)
  };

  var STEPS = ['state-loading', 'state-closed', 'step-attorney', 'step-type', 'step-time', 'step-details', 'state-done'];
  function show(id) {
    STEPS.forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    window.scrollTo(0, 0);
  }

  function api(path) {
    return fetch(path).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
    });
  }

  // ── Formatting (always in the FIRM's timezone, not the visitor's) ────────────
  function dayKey(iso) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: state.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
  }
  function dayLabel(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: state.timezone, weekday: 'short', month: 'short', day: 'numeric',
    }).format(new Date(iso));
  }
  function timeLabel(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: state.timezone, hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  }
  function whenLabel(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: state.timezone, weekday: 'long', month: 'long', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(iso));
  }
  function feeLabel(ct) {
    if (ct.price_cents > 0) {
      var amt = '$' + (ct.price_cents / 100).toFixed(ct.price_cents % 100 === 0 ? 0 : 2);
      return ct.fee_type === 'reduced' ? amt + ' (special rate)' : amt;
    }
    return ct.fee_type === 'free' ? 'Free' : '';
  }

  // ── Step 1: attorneys ────────────────────────────────────────────────────────
  // The photo is the attorney's account avatar (users.avatar_url), resolved
  // server-side; a pasted photo_url is the fallback, initials the last resort.
  function initial(name) { return esc((name || '?').trim().charAt(0).toUpperCase()); }

  function attorneyAvatar(a) {
    var box = '<span class="dk-avatar" style="width:46px;height:46px;font-size:17px;background:var(--daily)">';
    return a.photo_url
      ? box + '<img class="book-av-img" src="' + esc(a.photo_url) + '" alt=""></span>'
      : box + initial(a.display_name) + '</span>';
  }

  function renderAttorneys() {
    var html = state.attorneys.map(function (a, i) {
      return '<button type="button" class="book-opt" data-i="' + i + '">' + attorneyAvatar(a) +
        '<span class="book-opt-body"><span class="book-opt-name">Book with ' + esc(a.display_name) + '</span>' +
        (a.blurb ? '<span class="book-opt-sub">' + esc(a.blurb) + '</span>' : '') +
        '</span><span class="book-opt-go">&#8594;</span></button>';
    }).join('');
    $('attorney-list').innerHTML = html;
    Array.prototype.forEach.call($('attorney-list').querySelectorAll('.book-opt'), function (btn) {
      btn.addEventListener('click', function () {
        pickAttorney(state.attorneys[+btn.getAttribute('data-i')]);
      });
    });
    show('step-attorney');
  }

  function pickAttorney(a) {
    state.attorney = a;
    $('type-title').textContent = 'Book with ' + a.display_name;
    $('type-list').innerHTML = '<div class="book-note">Loading…</div>';
    show('step-type');
    api('/api/booking/consult-types?attorney=' + encodeURIComponent(a.slug)).then(function (r) {
      if (!r.ok) { $('type-list').innerHTML = '<div class="book-note">' + esc(r.body.error || 'Something went wrong.') + '</div>'; return; }
      renderTypes(r.body.consult_types || []);
    }).catch(function () {
      $('type-list').innerHTML = '<div class="book-note">Something went wrong. Please try again.</div>';
    });
  }

  // ── Step 2: consult types ────────────────────────────────────────────────────
  function renderTypes(types) {
    if (!types.length) {
      $('type-list').innerHTML = '<div class="book-note">No consultation types are available right now. Please contact our office.</div>';
      return;
    }
    $('type-list').innerHTML = types.map(function (ct, i) {
      var fee = feeLabel(ct);
      var sub = ct.duration_min + ' minutes' + (fee ? ' · ' + fee : '');
      return '<button type="button" class="book-opt book-opt--rec" data-i="' + i + '">' +
        '<span class="book-opt-body"><span class="book-opt-name">' + esc(ct.name) + '</span>' +
        '<span class="book-opt-sub">' + esc(sub) + (ct.description ? ' — ' + esc(ct.description) : '') + '</span>' +
        '</span><span class="book-opt-go">&#8594;</span></button>';
    }).join('');
    Array.prototype.forEach.call($('type-list').querySelectorAll('.book-opt'), function (btn) {
      btn.addEventListener('click', function () {
        state.consultType = types[+btn.getAttribute('data-i')];
        loadAvailability();
      });
    });
  }

  // ── Step 3: availability ─────────────────────────────────────────────────────
  function loadAvailability() {
    show('step-time');
    $('time-loading').classList.remove('hidden');
    $('time-empty').classList.add('hidden');
    $('time-picker').classList.add('hidden');
    $('time-tz-note').textContent = '';

    var q = '/api/booking/availability?attorney=' + encodeURIComponent(state.attorney.slug) +
            '&consult_type_id=' + encodeURIComponent(state.consultType.id) +
            (state.offer ? '&offer=' + encodeURIComponent(state.offer) : '');
    api(q).then(function (r) {
      $('time-loading').classList.add('hidden');
      if (!r.ok) { $('time-empty').textContent = r.body.error || 'Could not load availability.'; $('time-empty').classList.remove('hidden'); return; }

      state.timezone = r.body.timezone || state.timezone;
      var slots = r.body.slots || [];
      if (!slots.length) { $('time-empty').classList.remove('hidden'); return; }

      $('time-tz-note').textContent = 'All times are shown in ' +
        (whenLabel(slots[0].start).match(/[A-Z]{2,4}$/) || ['local time'])[0] + '.';

      state.slotsByDay = {};
      state.dayOrder = [];
      slots.forEach(function (s) {
        var k = dayKey(s.start);
        if (!state.slotsByDay[k]) { state.slotsByDay[k] = []; state.dayOrder.push(k); }
        state.slotsByDay[k].push(s);
      });
      state.selectedDay = state.dayOrder[0];
      renderDays();
      $('time-picker').classList.remove('hidden');
    }).catch(function () {
      $('time-loading').classList.add('hidden');
      $('time-empty').textContent = 'Could not load availability. Please try again.';
      $('time-empty').classList.remove('hidden');
    });
  }

  function renderDays() {
    $('day-chips').innerHTML = state.dayOrder.map(function (k) {
      var first = state.slotsByDay[k][0].start;
      return '<button type="button" class="book-chip" data-day="' + k + '" aria-pressed="' +
        (k === state.selectedDay) + '">' + esc(dayLabel(first)) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('day-chips').querySelectorAll('.book-chip'), function (btn) {
      btn.addEventListener('click', function () {
        state.selectedDay = btn.getAttribute('data-day');
        renderDays();
      });
    });
    renderTimes();
  }

  function renderTimes() {
    var slots = state.slotsByDay[state.selectedDay] || [];
    $('time-chips').innerHTML = slots.map(function (s, i) {
      return '<button type="button" class="book-chip" data-i="' + i + '">' + esc(timeLabel(s.start)) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('time-chips').querySelectorAll('.book-chip'), function (btn) {
      btn.addEventListener('click', function () {
        state.slot = slots[+btn.getAttribute('data-i')];
        renderDetails();
      });
    });
  }

  // ── Step 4: details + submit ─────────────────────────────────────────────────
  function renderDetails() {
    $('details-summary').innerHTML =
      '<strong>' + esc(state.consultType.name) + ' with ' + esc(state.attorney.display_name) + '</strong>' +
      esc(whenLabel(state.slot.start)) + ' · ' + state.consultType.duration_min + ' minutes' +
      (feeLabel(state.consultType) ? ' · ' + esc(feeLabel(state.consultType)) : '');
    $('book-error').classList.add('hidden');
    show('step-details');
    if (window.onTurnstileLoad) window.onTurnstileLoad(); // render the widget if it wasn't visible yet
  }

  function bookError(msg) {
    var el = $('book-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (window.IurisTurnstile) window.IurisTurnstile.reset('turnstile-book');
  }

  $('step-details').addEventListener('submit', function (e) {
    e.preventDefault();
    var name  = $('f-name').value.trim();
    var email = $('f-email').value.trim();
    if (!name)  return bookError('Please enter your name.');
    if (!email || email.indexOf('@') < 1) return bookError('Please enter a valid email address.');

    var payload = {
      attorney:        state.attorney.slug,
      consult_type_id: state.consultType.id,
      start:           state.slot.start,
      prospect_name:   name,
      prospect_email:  email,
      prospect_phone:  $('f-phone').value.trim() || null,
      case_type_id:    $('f-case-type').value || null,
      notes:           $('f-notes').value.trim() || null,
      turnstile_token: window.IurisTurnstile ? window.IurisTurnstile.token('turnstile-book') : undefined,
      offer:           state.offer || undefined,
    };

    var btn = $('book-btn');
    btn.disabled = true;
    btn.textContent = 'Booking…';
    $('book-error').classList.add('hidden');

    fetch('/api/booking/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
    }).then(function (r) {
      btn.disabled = false;
      btn.textContent = 'Confirm booking';
      if (r.ok) {
        var a = r.body.appointment || {};
        $('done-summary').innerHTML =
          '<strong>' + esc(a.consult_type || state.consultType.name) + '</strong> with ' +
          esc(a.attorney || state.attorney.display_name) + '<br>' +
          esc(whenLabel(a.starts_at || state.slot.start));
        show('state-done');
        return;
      }
      if (r.status === 409) {
        bookError((r.body.error || 'That time is no longer available.') + ' Returning you to the calendar…');
        setTimeout(loadAvailability, 1800);
        return;
      }
      bookError(r.body.error || 'Something went wrong. Please try again.');
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = 'Confirm booking';
      bookError('Something went wrong. Please check your connection and try again.');
    });
  });

  // ── Back links ───────────────────────────────────────────────────────────────
  $('back-to-attorney').addEventListener('click', function () { show('step-attorney'); });
  $('back-to-type').addEventListener('click', function () { pickAttorney(state.attorney); });
  $('back-to-time').addEventListener('click', function () { loadAvailability(); });

  // ── Boot ─────────────────────────────────────────────────────────────────────
  if (cfg.firmName) {
    document.title = 'Book a Consultation — ' + cfg.firmName;
    $('firm-name').textContent = 'Schedule a consultation with ' + cfg.firmName + ' — it only takes a minute.';
    $('foot-firm').textContent = cfg.firmName + ' · Online consultation booking';
  }

  // Firm branding — the brand color drives the Docket accent hue (--h-daily),
  // so lines, buttons, chips and avatars all theme to the firm. The masthead
  // logo prefers the firm's uploaded logo, then falls back to a same-origin
  // asset (CSP blocks external image hosts, so an external logo_url that fails
  // to load also drops to the fallback).
  var LOGO_FALLBACK = 'assets/iurisiq-logo.png';

  function showLogo(url) {
    var logo = $('firm-logo');
    logo.onerror = function () {
      if (logo.src.indexOf(LOGO_FALLBACK) === -1) { logo.src = LOGO_FALLBACK; }
      else { logo.hidden = true; } // even the fallback is missing — hide it
    };
    logo.onload = function () { logo.hidden = false; };
    logo.src = url || LOGO_FALLBACK;
  }

  function applyBranding(b) {
    b = b || {};
    if (b.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(b.brand_color)) {
      document.documentElement.style.setProperty('--h-daily', b.brand_color);
    }
    showLogo(b.logo_url);
  }

  function fillCaseTypes(caseTypesRes) {
    state.caseTypes = (caseTypesRes.ok && caseTypesRes.body.case_types) || [];
    if (state.caseTypes.length) {
      var sel = $('f-case-type');
      var byPa = {};
      state.caseTypes.forEach(function (ct) { (byPa[ct.practice_area] = byPa[ct.practice_area] || []).push(ct); });
      var paNames = Object.keys(byPa);
      paNames.forEach(function (pa) {
        var parent = sel;
        if (paNames.length > 1) {
          parent = document.createElement('optgroup');
          parent.label = pa;
          sel.appendChild(parent);
        }
        byPa[pa].forEach(function (ct) {
          var opt = document.createElement('option');
          opt.value = ct.id;
          opt.textContent = ct.name;
          parent.appendChild(opt);
        });
      });
    } else {
      $('f-case-type-wrap').classList.add('hidden');
    }
  }

  var offerToken = new URLSearchParams(window.location.search).get('offer');

  if (offerToken) {
    // Private booking link: the firm chose the attorney + consult type — skip
    // straight to the time picker. Invalid/used/expired token = generic close.
    Promise.all([
      api('/api/booking/offer?token=' + encodeURIComponent(offerToken)),
      api('/api/booking/case-types'),
    ]).then(function (rs) {
      var offerRes = rs[0];
      if (!offerRes.ok) {
        $('state-closed').querySelector('h2').textContent = 'This booking link is no longer valid';
        $('state-closed').querySelector('p').textContent =
          'It may have expired or already been used. Please contact our office to schedule.';
        show('state-closed');
        return;
      }
      applyBranding(offerRes.body.branding);
      fillCaseTypes(rs[1]);
      state.offer = offerToken;
      state.attorney = offerRes.body.attorney;
      state.consultType = offerRes.body.consult_type;
      $('back-to-type').classList.add('hidden');
      var fee = feeLabel(state.consultType);
      $('offer-note').innerHTML =
        '<strong>' + esc(state.consultType.name) + ' with ' + esc(state.attorney.display_name) + '</strong>' +
        state.consultType.duration_min + ' minutes' + (fee ? ' · ' + esc(fee) : '') +
        (state.consultType.description ? ' — ' + esc(state.consultType.description) : '');
      $('offer-note').classList.remove('hidden');
      loadAvailability();
    }).catch(function () {
      show('state-closed');
    });
  } else {
    Promise.all([api('/api/booking/attorneys'), api('/api/booking/case-types')]).then(function (rs) {
      var attorneysRes = rs[0];
      if (!attorneysRes.ok || !(attorneysRes.body.attorneys || []).length) { show('state-closed'); return; }
      applyBranding(attorneysRes.body.branding);
      state.attorneys = attorneysRes.body.attorneys;
      fillCaseTypes(rs[1]);

      if (state.attorneys.length === 1) {
        state.singleAttorney = true;
        $('back-to-attorney').classList.add('hidden');
        pickAttorney(state.attorneys[0]);
      } else {
        renderAttorneys();
      }
    }).catch(function () {
      show('state-closed');
    });
  }
})();
