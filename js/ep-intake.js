// js/ep-intake.js — the public estate-planning questionnaire (estate-intake.html).
//
// No login: the ?t= token in the link is the only capability. The questionnaire
// definition comes from the server (/api/ep-intake/public-load), so this file knows
// nothing about wills — it renders sections, fields and repeatable groups, one
// section per step, in English or Spanish, saving progress as the client goes.
//
// isVisible() below mirrors functions/api/_ep-validate.js. Keep them in step: the
// server is the authority (hidden answers are dropped there on submit), this copy
// only decides what to show.
(function () {
  'use strict';

  var UI = {
    en: {
      loading: 'Loading…', step: 'Step', of: 'of', review: 'Review & submit',
      next: 'Continue', back: 'Back', submit: 'Submit questionnaire', submitting: 'Submitting…',
      saved: 'Saved', saving: 'Saving…', saveFailed: 'Not saved — check your connection',
      add: 'Add', remove: 'Remove', first: 'First choice', backup: 'Backup',
      edit: 'Edit', nothing: 'Nothing entered', yes: 'Yes', no: 'No',
      reviewLead: 'Please look over your answers. You can go back to any section to change something.',
      confirm: 'By submitting, you confirm the information is accurate to the best of your knowledge. The firm will review it with you.',
      missing: 'A few required answers are missing:', goTo: 'Go to section',
      verify: 'Please complete the verification box above.',
      network: 'Network problem — your answers are still here. Please try again.',
      doneTitle: 'Thank you', doneBody: 'Your questionnaire has been sent to {firm}. We will be in touch.',
      submittedTitle: 'Already submitted', submittedBody: 'This questionnaire was already sent to {firm}. If something needs to change, please contact the firm.',
      expiredTitle: 'This link has expired', expiredBody: 'For your security, questionnaire links expire. Please contact {firm} for a new link.',
      revokedTitle: 'A newer link was sent', revokedBody: 'This link has been replaced. Please use the most recent email from {firm} — your saved answers carried over.',
      invalidTitle: "This link isn't valid", invalidBody: 'Please use the link from your email, or contact the firm.',
      errorTitle: "Couldn't load the questionnaire", errorBody: 'Please check your connection and try again.',
      hello: 'Hello {name}.', foot: 'Secure questionnaire · Please do not share this link.',
      preview: 'Preview — this is what the client sees. Nothing is saved and it cannot be submitted.',
      theFirm: 'the firm', titleA: 'Estate Planning', titleB: 'Questionnaire',
    },
    es: {
      loading: 'Cargando…', step: 'Paso', of: 'de', review: 'Revisar y enviar',
      next: 'Continuar', back: 'Atrás', submit: 'Enviar cuestionario', submitting: 'Enviando…',
      saved: 'Guardado', saving: 'Guardando…', saveFailed: 'No se guardó — revise su conexión',
      add: 'Agregar', remove: 'Quitar', first: 'Primera opción', backup: 'Suplente',
      edit: 'Editar', nothing: 'Nada ingresado', yes: 'Sí', no: 'No',
      reviewLead: 'Revise sus respuestas. Puede regresar a cualquier sección para cambiar algo.',
      confirm: 'Al enviar, usted confirma que la información es correcta según su mejor conocimiento. El despacho la revisará con usted.',
      missing: 'Faltan algunas respuestas obligatorias:', goTo: 'Ir a la sección',
      verify: 'Por favor complete la casilla de verificación de arriba.',
      network: 'Problema de conexión — sus respuestas siguen aquí. Intente de nuevo.',
      doneTitle: 'Gracias', doneBody: 'Su cuestionario fue enviado a {firm}. Nos pondremos en contacto con usted.',
      submittedTitle: 'Ya fue enviado', submittedBody: 'Este cuestionario ya fue enviado a {firm}. Si algo debe cambiar, comuníquese con el despacho.',
      expiredTitle: 'Este enlace venció', expiredBody: 'Por su seguridad, los enlaces vencen. Comuníquese con {firm} para recibir uno nuevo.',
      revokedTitle: 'Se envió un enlace más reciente', revokedBody: 'Este enlace fue reemplazado. Use el correo más reciente de {firm} — sus respuestas guardadas se conservaron.',
      invalidTitle: 'Este enlace no es válido', invalidBody: 'Use el enlace de su correo electrónico o comuníquese con el despacho.',
      errorTitle: 'No se pudo cargar el cuestionario', errorBody: 'Revise su conexión e intente de nuevo.',
      hello: 'Hola {name}.', foot: 'Cuestionario seguro · Por favor no comparta este enlace.',
      preview: 'Vista previa — así lo ve el cliente. No se guarda nada y no se puede enviar.',
      theFirm: 'el despacho', titleA: 'Cuestionario de', titleB: 'Planificación Patrimonial',
    },
  };

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var token = params.get('t') || '';
  var preview = !token && params.get('preview') === '1';

  var def = null, answers = {}, lang = 'en', firm = '', firstName = '';
  var stepKey = null;           // current section key, or '__review'
  var dirty = false, saveTimer = null, saving = false;
  var condRegistry = [];        // [{ el, cond, rowCtx }]

  function ui(k) { return (UI[lang] && UI[lang][k]) || UI.en[k] || k; }
  function L(o) { if (!o) return ''; return typeof o === 'string' ? o : (o[lang] || o.en || ''); }
  function fill(s) { return s.replace('{firm}', firm || ui('theFirm')).replace('{name}', firstName); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // ── Visibility (mirror of _ep-validate.js isVisible) ─────────────────────────
  function getPath(path) {
    var p = String(path).split('.');
    var s = answers[p[0]];
    return s && typeof s === 'object' && !Array.isArray(s) ? s[p[1]] : undefined;
  }
  function test(v, c) {
    if ('eq' in c) return v === c.eq;
    if ('ne' in c) return v !== c.ne;
    if ('in' in c) return Array.isArray(c.in) && c.in.indexOf(v) !== -1;
    return true;
  }
  function isVisible(cond, row) {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every(function (c) { return isVisible(c, row); });
    if (cond.row) return test(row ? row[cond.row] : undefined, cond);
    if (cond.f) return test(getPath(cond.f), cond);
    return true;
  }

  function sec(key) {
    if (!answers[key] || typeof answers[key] !== 'object' || Array.isArray(answers[key])) answers[key] = {};
    return answers[key];
  }
  function visibleSections() { return def.sections.filter(function (s) { return isVisible(s.showIf); }); }
  function steps() { return visibleSections().map(function (s) { return s.key; }).concat(['__review']); }

  // ── Rendering ───────────────────────────────────────────────────────────────
  function renderChrome() {
    document.documentElement.lang = lang;
    document.querySelectorAll('.ep-lang button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.lang === lang); });
    $('firm-name').textContent = firm;
    $('page-title').innerHTML = '';
    $('page-title').appendChild(document.createTextNode(ui('titleA') + ' '));
    $('page-title').appendChild(el('em', { text: ui('titleB') }));
    $('greeting').textContent = def ? ((firstName ? fill(ui('hello')) + ' ' : '') + L(def.intro)) : '';
    $('foot').textContent = ui('foot');
    $('back-btn').textContent = ui('back');
    if (preview) { $('preview-note').textContent = ui('preview'); $('preview-note').classList.remove('hidden'); }
  }

  function renderStep() {
    var list = steps();
    if (list.indexOf(stepKey) === -1) stepKey = list[0];
    var idx = list.indexOf(stepKey);
    var isReview = stepKey === '__review';

    $('prog-label').textContent = ui('step') + ' ' + (idx + 1) + ' ' + ui('of') + ' ' + list.length;
    $('prog-fill').style.width = Math.round(((idx + 1) / list.length) * 100) + '%';
    $('back-btn').classList.toggle('hidden', idx === 0);
    $('next-btn').textContent = isReview ? ui('submit') : ui('next');
    $('next-btn').disabled = isReview && preview;
    $('turnstile-ep').classList.toggle('hidden', !isReview || preview);
    $('form-error').classList.add('hidden');

    var body = $('step-body');
    body.innerHTML = '';
    condRegistry = [];

    if (isReview) {
      $('prog-name').textContent = '';
      $('step-title').textContent = ui('review');
      $('step-lead').textContent = ui('reviewLead');
      body.appendChild(renderReview());
      body.appendChild(el('p', { class: 'ep-help', style: 'margin-top:16px', text: ui('confirm') }));
      return;
    }

    var s = def.sections.filter(function (x) { return x.key === stepKey; })[0];
    $('prog-name').textContent = L(s.title);
    $('step-title').textContent = L(s.title);
    $('step-lead').textContent = L(s.lead);
    $('step-lead').classList.toggle('hidden', !s.lead);

    var grid = el('div', { class: 'ep-grid' });
    s.fields.forEach(function (f) { grid.appendChild(f.type === 'group' ? renderGroup(s, f) : renderField(s, f, sec(s.key), null)); });
    body.appendChild(grid);
    applyVisibility();
  }

  function inputId(secKey, f, rowCtx) {
    return 'f-' + secKey + '-' + (rowCtx ? rowCtx.group + '-' + rowCtx.index + '-' : '') + f.key;
  }

  function renderField(s, f, store, rowCtx) {
    var id = inputId(s.key, f, rowCtx);
    var wrap = el('div', { class: 'field' + (f.full || f.type === 'textarea' || f.type === 'choice' || f.type === 'multi' ? ' full' : '') });
    var labelText = L(f.label);
    var lab = (f.type === 'choice' || f.type === 'multi')
      ? el('span', { class: 'ep-label', id: id + '-lab' }, [document.createTextNode(labelText)])
      : el('label', { class: 'ep-label', for: id }, [document.createTextNode(labelText)]);
    if (f.required) lab.appendChild(el('span', { class: 'req', text: '*', 'aria-hidden': 'true' }));
    wrap.appendChild(lab);

    var v = store[f.key];
    var data = { 'data-sec': s.key, 'data-key': f.key };
    if (rowCtx) { data['data-group'] = rowCtx.group; data['data-row'] = String(rowCtx.index); }

    var input;
    if (f.type === 'textarea') {
      input = el('textarea', Object.assign({ id: id, rows: 3 }, data));
      input.value = v || '';
    } else if (f.type === 'select') {
      input = el('select', Object.assign({ id: id }, data), [el('option', { value: '', text: '—' })]);
      (f.options || []).forEach(function (o) {
        var opt = el('option', { value: o.value, text: L(o.label) });
        if (o.value === v) opt.selected = true;
        input.appendChild(opt);
      });
    } else if (f.type === 'choice' || f.type === 'multi') {
      input = el('div', { class: 'ep-choices', role: f.type === 'choice' ? 'radiogroup' : 'group', 'aria-labelledby': id + '-lab' });
      var name = id;
      (f.options || []).forEach(function (o) {
        var on = f.type === 'multi' ? (Array.isArray(v) && v.indexOf(o.value) !== -1) : v === o.value;
        var box = el('input', Object.assign({ type: f.type === 'multi' ? 'checkbox' : 'radio', name: name, value: o.value }, data));
        box.checked = on;
        input.appendChild(el('label', { class: 'ep-choice' + (on ? ' is-on' : '') }, [box, el('span', { text: L(o.label) })]));
      });
    } else {
      var type = { email: 'email', tel: 'tel', date: 'date' }[f.type] || 'text';
      input = el('input', Object.assign({ id: id, type: type, autocomplete: 'off' }, data));
      if (f.type === 'money') input.setAttribute('inputmode', 'text');
      input.value = v || '';
    }
    wrap.appendChild(input);
    if (f.hint) wrap.appendChild(el('div', { class: 'ep-help', text: L(f.hint) }));
    if (f.showIf) condRegistry.push({ el: wrap, cond: f.showIf, rowCtx: rowCtx });
    return wrap;
  }

  function renderGroup(s, g) {
    var store = sec(s.key);
    if (!Array.isArray(store[g.key])) store[g.key] = [];
    var rows = store[g.key];
    // Fiduciary-style lists open with one empty row so the client sees the shape;
    // blank rows are dropped server-side, so this never stores anything.
    if (!rows.length && !/^(specific_gifts|real_estate|accounts|hipaa_people)$/.test(g.key)) rows.push({});

    var wrap = el('div', { class: 'ep-group field full' });
    wrap.appendChild(el('span', { class: 'ep-label', text: L(g.label) }));
    var list = el('div', { class: 'ep-rows' });
    var ordered = /^(list|agents|successor_trustees)$/.test(g.key) && s.key !== 'children';

    rows.forEach(function (row, i) {
      var head = el('div', { class: 'ep-row-head' });
      var title = el('b', { text: L(g.itemLabel) + ' ' + (i + 1) });
      if (ordered) title.appendChild(el('span', { class: 'ep-order', text: i === 0 ? ui('first') : ui('backup') }));
      head.appendChild(title);
      head.appendChild(el('button', { type: 'button', class: 'dk-linkbtn d', 'data-remove': s.key + '|' + g.key + '|' + i, text: ui('remove') }));
      var grid = el('div', { class: 'ep-grid' });
      g.fields.forEach(function (f) { grid.appendChild(renderField(s, f, row, { group: g.key, index: i })); });
      list.appendChild(el('div', { class: 'ep-row' }, [head, grid]));
    });
    wrap.appendChild(list);
    if (rows.length < (g.max || 10)) {
      wrap.appendChild(el('button', { type: 'button', class: 'btn btn--secondary btn--sm ep-add', 'data-add': s.key + '|' + g.key, text: '+ ' + L(g.addLabel || ui('add')) }));
    }
    if (g.showIf) condRegistry.push({ el: wrap, cond: g.showIf, rowCtx: null });
    return wrap;
  }

  function rowFor(ctx) {
    if (!ctx) return null;
    var s = answers[stepKey];
    return s && Array.isArray(s[ctx.group]) ? s[ctx.group][ctx.index] : null;
  }
  function applyVisibility() {
    condRegistry.forEach(function (c) { c.el.classList.toggle('hidden', !isVisible(c.cond, rowFor(c.rowCtx))); });
  }

  // ── Review ──────────────────────────────────────────────────────────────────
  function display(f, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
    if (f.type === 'select' || f.type === 'choice') {
      var o = (f.options || []).filter(function (x) { return x.value === v; })[0];
      return o ? L(o.label) : v;
    }
    if (f.type === 'multi') {
      return v.map(function (x) { var o = (f.options || []).filter(function (y) { return y.value === x; })[0]; return o ? L(o.label) : x; }).join(', ');
    }
    return String(v);
  }

  function renderReview() {
    var box = el('div', { class: 'ep-review' });
    visibleSections().forEach(function (s) {
      var store = answers[s.key] || {};
      var dl = el('dl');
      var any = false;
      s.fields.forEach(function (f) {
        if (!isVisible(f.showIf)) return;
        if (f.type === 'group') {
          (store[f.key] || []).forEach(function (row, i) {
            var items = f.fields.filter(function (rf) { return isVisible(rf.showIf, row) && display(rf, row[rf.key]); });
            if (!items.length) return;
            any = true;
            dl.appendChild(el('div', { class: 'ep-review-row', text: L(f.itemLabel) + ' ' + (i + 1) }));
            items.forEach(function (rf) {
              dl.appendChild(el('dt', { text: L(rf.label) }));
              dl.appendChild(el('dd', { text: display(rf, row[rf.key]) }));
            });
          });
          return;
        }
        var d = display(f, store[f.key]);
        if (!d) return;
        any = true;
        dl.appendChild(el('dt', { text: L(f.label) }));
        dl.appendChild(el('dd', { text: d }));
      });
      var head = el('div', { class: 'ep-review-head' }, [
        el('h3', { text: L(s.title) }),
        el('button', { type: 'button', class: 'dk-linkbtn', 'data-goto': s.key, text: ui('edit') }),
      ]);
      box.appendChild(el('div', { class: 'ep-review-sec' }, [head, any ? dl : el('p', { class: 'empty', text: ui('nothing') })]));
    });
    return box;
  }

  // ── Input → answers ─────────────────────────────────────────────────────────
  function storeFor(t) {
    var s = sec(t.dataset.sec);
    if (t.dataset.group != null) {
      var rows = s[t.dataset.group] || (s[t.dataset.group] = []);
      var i = Number(t.dataset.row);
      return rows[i] || (rows[i] = {});
    }
    return s;
  }

  function onInput(e) {
    var t = e.target;
    if (!t.dataset || !t.dataset.key) return;
    var store = storeFor(t);
    if (t.type === 'checkbox') {
      var cur = Array.isArray(store[t.dataset.key]) ? store[t.dataset.key].slice() : [];
      var at = cur.indexOf(t.value);
      if (t.checked && at === -1) cur.push(t.value);
      if (!t.checked && at !== -1) cur.splice(at, 1);
      store[t.dataset.key] = cur;
      t.closest('.ep-choice').classList.toggle('is-on', t.checked);
    } else if (t.type === 'radio') {
      store[t.dataset.key] = t.value;
      t.closest('.ep-choices').querySelectorAll('.ep-choice').forEach(function (c) {
        c.classList.toggle('is-on', c.querySelector('input').checked);
      });
    } else {
      store[t.dataset.key] = t.value;
    }
    if (e.type === 'change') applyVisibility();
    markDirty();
  }

  function onClick(e) {
    var add = e.target.closest('[data-add]');
    var rem = e.target.closest('[data-remove]');
    var go = e.target.closest('[data-goto]');
    if (add) {
      var a = add.dataset.add.split('|');
      sec(a[0])[a[1]].push({});
      markDirty(); rerenderKeepScroll();
    } else if (rem) {
      var r = rem.dataset.remove.split('|');
      sec(r[0])[r[1]].splice(Number(r[2]), 1);
      markDirty(); rerenderKeepScroll();
    } else if (go) {
      goTo(go.dataset.goto);
    }
  }

  function rerenderKeepScroll() { var y = window.scrollY; renderStep(); window.scrollTo(0, y); }

  // ── Saving ──────────────────────────────────────────────────────────────────
  function markDirty() {
    if (preview || !def || lastMessage) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 15000);
  }

  function save(opts) {
    if (preview || !dirty || saving) return Promise.resolve();
    saving = true; dirty = false;
    clearTimeout(saveTimer);
    $('saved-note').textContent = ui('saving');
    return fetch('/api/ep-intake/public-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, answers: answers, lang: lang }),
      keepalive: !!(opts && opts.keepalive),
    }).then(function (res) {
      saving = false;
      if (!res.ok) { dirty = true; $('saved-note').textContent = ui('saveFailed'); return; }
      var d = new Date();
      $('saved-note').textContent = ui('saved') + ' ' + d.toLocaleTimeString(lang === 'es' ? 'es' : 'en-US', { hour: 'numeric', minute: '2-digit' });
    }).catch(function () { saving = false; dirty = true; $('saved-note').textContent = ui('saveFailed'); });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────
  function goTo(key) {
    save();
    stepKey = key;
    renderStep();
    window.scrollTo(0, 0);
    var first = $('step-body').querySelector('input, select, textarea');
    if (first && window.innerWidth > 700) first.focus({ preventScroll: true });
  }

  function onSubmit(e) {
    e.preventDefault();
    var list = steps();
    var idx = list.indexOf(stepKey);
    if (stepKey !== '__review') { goTo(list[idx + 1]); return; }
    if (preview) return;
    submit();
  }

  function showError(html) {
    var box = $('form-error');
    box.innerHTML = '';
    box.appendChild(html);
    box.classList.remove('hidden');
  }

  function submit() {
    var tsToken;
    if (window.IurisTurnstile && window.IurisTurnstile.enabled()) {
      tsToken = window.IurisTurnstile.token('turnstile-ep');
      if (!tsToken) { showError(el('span', { text: ui('verify') })); return; }
    }
    var btn = $('next-btn');
    btn.disabled = true; btn.textContent = ui('submitting');
    fetch('/api/ep-intake/public-submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, answers: answers, lang: lang, turnstile_token: tsToken }),
    }).then(function (res) {
      return res.json().then(function (d) { return { status: res.status, ok: res.ok, data: d || {} }; });
    }).then(function (r) {
      if (r.ok) { dirty = false; message('doneTitle', 'doneBody'); return; }
      btn.disabled = false; btn.textContent = ui('submit');
      if (window.IurisTurnstile) window.IurisTurnstile.reset('turnstile-ep');
      if (r.status === 422 && Array.isArray(r.data.errors)) {
        var wrap = el('div', null, [el('span', { text: ui('missing') })]);
        var ul = el('ul');
        r.data.errors.forEach(function (er) {
          ul.appendChild(el('li', null, [
            document.createTextNode(er.message + ' — '),
            el('a', { href: '#', 'data-goto': er.section, text: ui('goTo') }),
          ]));
        });
        wrap.appendChild(ul);
        showError(wrap);
        return;
      }
      if (r.data.status === 'submitted') { message('submittedTitle', 'submittedBody'); return; }
      if (r.data.status === 'expired') { message('expiredTitle', 'expiredBody'); return; }
      if (r.data.status === 'revoked') { message('revokedTitle', 'revokedBody'); return; }
      showError(el('span', { text: r.data.error || ui('network') }));
    }).catch(function () {
      btn.disabled = false; btn.textContent = ui('submit');
      showError(el('span', { text: ui('network') }));
    });
  }

  // ── States ──────────────────────────────────────────────────────────────────
  var lastMessage = null;
  function message(titleKey, bodyKey) {
    lastMessage = [titleKey, bodyKey];
    $('state-loading').classList.add('hidden');
    $('state-form').classList.add('hidden');
    $('msg-title').textContent = ui(titleKey);
    $('msg-body').textContent = fill(ui(bodyKey));
    $('state-message').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function setLang(l) {
    lang = l === 'es' ? 'es' : 'en';
    renderChrome();
    if (lastMessage) message(lastMessage[0], lastMessage[1]);
    else if (def) renderStep();
    markDirty();
  }

  function init() {
    var initialLang = params.get('lang');
    if (initialLang) lang = initialLang === 'es' ? 'es' : 'en';
    document.querySelectorAll('.ep-lang button').forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.dataset.lang); });
    });
    $('state-loading').querySelector('p').textContent = ui('loading');

    if (!token && !preview) { renderChrome(); message('invalidTitle', 'invalidBody'); return; }

    var url = preview
      ? '/api/ep-intake/public-load?preview=1&lang=' + lang + (params.get('q') ? '&q=' + encodeURIComponent(params.get('q')) : '')
      : '/api/ep-intake/public-load?t=' + encodeURIComponent(token);

    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      firm = d.firm_name || '';
      if (!initialLang && d.language) lang = d.language;
      if (d.status !== 'open' && d.status !== 'preview') {
        renderChrome();
        var map = { submitted: ['submittedTitle', 'submittedBody'], expired: ['expiredTitle', 'expiredBody'],
                    revoked: ['revokedTitle', 'revokedBody'] };
        var m = map[d.status] || ['invalidTitle', 'invalidBody'];
        message(m[0], m[1]);
        return;
      }
      def = d.definition;
      answers = d.answers && typeof d.answers === 'object' ? d.answers : {};
      firstName = d.first_name || '';
      renderChrome();
      stepKey = steps()[0];
      var form = $('state-form');
      form.addEventListener('submit', onSubmit);
      form.addEventListener('input', onInput);
      form.addEventListener('change', onInput);
      form.addEventListener('click', onClick);
      $('back-btn').addEventListener('click', function () {
        var list = steps(); var i = list.indexOf(stepKey);
        if (i > 0) goTo(list[i - 1]);
      });
      $('form-error').addEventListener('click', function (e) {
        var go = e.target.closest('[data-goto]');
        if (go) { e.preventDefault(); goTo(go.dataset.goto); }
      });
      window.addEventListener('pagehide', function () { if (dirty) save({ keepalive: true }); });
      $('state-loading').classList.add('hidden');
      form.classList.remove('hidden');
      renderStep();
    }).catch(function () { renderChrome(); message('errorTitle', 'errorBody'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
