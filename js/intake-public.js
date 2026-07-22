// js/intake-public.js
// Drives the public, pre-portal intake webform (intake.html, served at /intake?token=).
// No auth: the URL token is the only capability. Reads context from
// /api/intake-public-load, renders a curated (deliberately non-overwhelming)
// version of the family-law intake gated by case type, and submits everything in
// one shot to /api/intake-public-submit.
//
// Field names map 1:1 to the columns whitelisted server-side; keep them in sync.
(function () {
  'use strict';

  // ── Case-type → which sections apply (mirrors pages/client-portal/client-portal.js) ──
  var MARRIAGE_CASE_TYPES  = new Set(['divorce', 'prenuptial_agreement', 'postnuptial_agreement', 'other']);
  var CHILDREN_CASE_TYPES  = new Set(['divorce', 'custody', 'custody_modification', 'child_support', 'child_support_modification', 'paternity', 'sapcr_original', 'sapcr_modification', 'adoption', 'protective_order', 'enforcement', 'other']);
  var FINANCIAL_CASE_TYPES = new Set(['divorce', 'child_support', 'child_support_modification', 'prenuptial_agreement', 'postnuptial_agreement', 'enforcement', 'other']);

  // ── Curated field sets (safe text/date/number only — no enums/booleans) ──────
  var OPPOSING = [
    { name: 'first_name',  label: 'First name',      type: 'text' },
    { name: 'middle_name', label: 'Middle name',     type: 'text' },
    { name: 'last_name',   label: 'Last name',       type: 'text' },
    { name: 'dob',         label: 'Date of birth',   type: 'date' },
    { name: 'cell_phone',  label: 'Cell phone',      type: 'tel' },
    { name: 'email',       label: 'Email',           type: 'email' },
    { name: 'address_line1', label: 'Street address', type: 'text', full: true },
    { name: 'city',        label: 'City',            type: 'text' },
    { name: 'state',       label: 'State',           type: 'text' },
    { name: 'zip',         label: 'ZIP',             type: 'text' },
    { name: 'employer',    label: 'Employer',        type: 'text' },
    { name: 'gross_annual_income', label: 'Approx. annual income', type: 'number' },
  ];

  var MARRIAGE = [
    { name: 'place_of_marriage', label: 'Place of marriage (city, state)', type: 'text', full: true },
    { name: 'date_of_marriage',  label: 'Date of marriage', type: 'date' },
    { name: 'marital_difficulties', label: 'Briefly, what led to the difficulties? (optional)', type: 'textarea', full: true },
  ];

  var CHILD = [
    { name: 'first_name', label: 'First name', type: 'text' },
    { name: 'last_name',  label: 'Last name',  type: 'text' },
    { name: 'dob',        label: 'Date of birth', type: 'date' },
    { name: 'current_residence', label: 'Currently lives with', type: 'text' },
    { name: 'special_needs', label: 'Special needs / notes (optional)', type: 'text', full: true },
  ];

  var FINANCIAL = [
    { name: 'client_monthly_income',     label: 'Your gross monthly income', type: 'number' },
    { name: 'real_estate_gross_value',   label: 'Estimated real-estate value', type: 'number' },
    { name: 'liquid_assets_value',       label: 'Cash / bank / liquid assets', type: 'number' },
    { name: 'retirement_estimated_value', label: 'Estimated retirement value', type: 'number' },
    { name: 'total_liabilities',         label: 'Total debts / liabilities', type: 'number' },
    { name: 'vehicles_description',      label: 'Vehicles (year / make / model)', type: 'textarea', full: true },
    { name: 'other_assets_description',  label: 'Other significant assets (optional)', type: 'textarea', full: true },
  ];

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var token = new URLSearchParams(window.location.search).get('token') || '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function show(id) {
    ['state-loading', 'state-error', 'state-done', 'state-form'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  function fieldHtml(prefix, f) {
    var id = prefix + '-' + f.name;
    var input = f.type === 'textarea'
      ? '<textarea id="' + id + '" data-name="' + f.name + '"></textarea>'
      : '<input id="' + id + '" data-name="' + f.name + '" type="' + f.type + '"' +
        (f.type === 'number' ? ' inputmode="decimal"' : '') + '>';
    return '<div class="field' + (f.full ? ' full' : '') + '">' +
      '<label for="' + id + '">' + esc(f.label) + '</label>' + input + '</div>';
  }

  function sectionHtml(title, sub, prefix, fields) {
    return '<h2 class="section">' + esc(title) + '</h2>' +
      (sub ? '<p class="section-sub">' + esc(sub) + '</p>' : '') +
      '<div class="grid" data-section="' + prefix + '">' +
      fields.map(function (f) { return fieldHtml(prefix, f); }).join('') + '</div>';
  }

  var childCount = 0;
  function childBlockHtml(i) {
    return '<div class="child-block" data-child="' + i + '">' +
      '<div class="child-head"><strong>Child ' + (i + 1) + '</strong>' +
      '<button type="button" class="btn--link child-remove" data-child="' + i + '">Remove</button></div>' +
      '<div class="grid">' +
      CHILD.map(function (f) { return fieldHtml('child' + i, f); }).join('') + '</div></div>';
  }

  function renderForm(caseType) {
    var html = sectionHtml('The other party', 'The person on the other side of your case, if there is one.', 'op', OPPOSING);

    if (MARRIAGE_CASE_TYPES.has(caseType)) {
      html += sectionHtml('Marriage', 'If your case involves a marriage.', 'mar', MARRIAGE);
    }

    var childrenApply = CHILDREN_CASE_TYPES.has(caseType);
    if (childrenApply) {
      html += '<h2 class="section">Children</h2>' +
        '<p class="section-sub">Add any children involved in this case.</p>' +
        '<div id="children-list"></div>' +
        '<button type="button" id="add-child" class="btn btn--ghost">+ Add a child</button>';
    }

    if (FINANCIAL_CASE_TYPES.has(caseType)) {
      html += sectionHtml('Finances', 'Rough estimates are fine — you can refine these later.', 'fin', FINANCIAL);
    }

    $('intake-sections').innerHTML = html;

    if (childrenApply) {
      var list = $('children-list');
      var addOne = function () { list.insertAdjacentHTML('beforeend', childBlockHtml(childCount)); childCount++; };
      addOne(); // start with one
      $('add-child').addEventListener('click', addOne);
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('.child-remove');
        if (!btn) return;
        var block = list.querySelector('.child-block[data-child="' + btn.dataset.child + '"]');
        if (block) block.remove();
      });
    }
  }

  function collectGrid(prefix, fields) {
    var out = {};
    fields.forEach(function (f) {
      var el = $(prefix + '-' + f.name);
      if (el && el.value.trim()) out[f.name] = el.value.trim();
    });
    return out;
  }

  function collectChildren() {
    var kids = [];
    document.querySelectorAll('.child-block').forEach(function (block) {
      var obj = {};
      block.querySelectorAll('[data-name]').forEach(function (el) {
        if (el.value.trim()) obj[el.dataset.name] = el.value.trim();
      });
      if (Object.keys(obj).length) kids.push(obj);
    });
    return kids;
  }

  function submit(e) {
    e.preventDefault();
    var btn = $('submit-btn');
    var errEl = $('submit-error');
    errEl.classList.add('hidden');

    var turnstileToken;
    if (window.IurisTurnstile && window.IurisTurnstile.enabled()) {
      turnstileToken = window.IurisTurnstile.token('turnstile-intake');
      if (!turnstileToken) {
        errEl.textContent = 'Please complete the verification checkbox above.';
        errEl.classList.remove('hidden');
        return;
      }
    }

    var payload = {
      token: token,
      turnstile_token: turnstileToken,
      opposing_party: collectGrid('op', OPPOSING),
      marriage: $('mar-place_of_marriage') ? collectGrid('mar', MARRIAGE) : {},
      children: collectChildren(),
      financial: $('fin-client_monthly_income') ? collectGrid('fin', FINANCIAL) : {},
    };

    btn.disabled = true;
    btn.textContent = 'Submitting…';

    fetch('/api/intake-public-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (!r.ok) {
        errEl.textContent = (r.data && r.data.error) || 'Something went wrong. Please try again.';
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Submit intake';
        if (window.IurisTurnstile) window.IurisTurnstile.reset('turnstile-intake');
        return;
      }
      $('done-body').textContent = 'Your intake has been submitted to ' + ((r.data && r.data.firm_name) || 'the firm') + '.';
      show('state-done');
      window.scrollTo(0, 0);
    }).catch(function () {
      errEl.textContent = 'Network error. Please check your connection and try again.';
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Submit intake';
    });
  }

  function errorState(title, body) {
    $('error-title').textContent = title;
    $('error-body').textContent = body;
    show('state-error');
  }

  function init() {
    if (!token) { errorState('Missing link', 'This intake link is incomplete. Please use the link from your email.'); return; }

    fetch('/api/intake-public-load?token=' + encodeURIComponent(token))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var firm = data.firm_name || 'Client Intake';
        $('firm-name').textContent = firm;

        if (data.status === 'submitted') { $('done-body').textContent = 'This intake has already been submitted to ' + firm + '.'; show('state-done'); return; }
        if (data.status === 'expired')  { errorState('This link has expired', 'For your security, intake links expire after 14 days. Please contact ' + firm + ' for a new link.'); return; }
        if (data.status !== 'open')     { errorState("This link isn't valid", 'Please contact the firm for an up-to-date intake link.'); return; }

        var name = data.client_first_name ? data.client_first_name : '';
        $('form-greeting').textContent = (name ? 'Hello ' + name + ' — ' : '') + firm + ' has asked you to complete this short intake.';
        renderForm(data.case_type || '');
        $('state-form').addEventListener('submit', submit);
        show('state-form');
      })
      .catch(function () {
        errorState("Couldn't load the form", 'Please check your connection and try again in a moment.');
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
