// pages/clients/detail/estate-planning.js — the client card's Estate Planning tab.
//
// Loaded on first open by detail.js (initEstateTab), which passes the card's
// matter/client and its callFunction (POST with the session bearer). Everything
// estate-specific on the card lives here, so the shared detail.js only carries
// the hook.
//
//   Questionnaire  send / resend / revoke the client link, see where it stands —
//                  or fill it in yourself (phone or office meeting, no link)
//   Answers        read, edit (validated server-side), print, compare to original
//   Draft          fill estate templates (Word) from the answers, for the client
//                  or — for a couple — the spouse
(function () {
  'use strict';

  const esc = (s) => Utils.esc(s == null ? '' : String(s));
  const L = (o) => (!o ? '' : typeof o === 'string' ? o : (o.en || ''));
  const fmt = (iso) => (iso ? Utils.formatDateTime(iso) : '—');

  // Mirror of _ep-validate.js isVisible (same as js/ep-intake.js).
  function getPath(answers, path) {
    const [s, f] = String(path).split('.');
    const sec = answers?.[s];
    return sec && typeof sec === 'object' && !Array.isArray(sec) ? sec[f] : undefined;
  }
  function test(v, c) {
    if ('eq' in c) return v === c.eq;
    if ('ne' in c) return v !== c.ne;
    if ('in' in c) return Array.isArray(c.in) && c.in.includes(v);
    return true;
  }
  function isVisible(cond, answers, row) {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every(c => isVisible(c, answers, row));
    if (cond.row) return test(row ? row[cond.row] : undefined, cond);
    if (cond.f) return test(getPath(answers, cond.f), cond);
    return true;
  }

  const STATUS = {
    open:      { label: 'Link open',   kind: 'acc' },
    submitted: { label: 'Submitted',   kind: 'ok' },
    expired:   { label: 'Expired',     kind: 'warn' },
    revoked:   { label: 'Replaced',    kind: 'mut' },
  };

  function display(f, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
    if (f.type === 'select' || f.type === 'choice') {
      const o = (f.options || []).find(x => x.value === v);
      return o ? L(o.label) : v;
    }
    if (f.type === 'multi') return v.map(x => L((f.options || []).find(o => o.value === x)?.label) || x).join(', ');
    if (f.type === 'date') return Utils.formatDate(v);
    return String(v);
  }

  // Read-only answers, grouped by section, in the definition's own labels.
  function answersHtml(def, answers) {
    const parts = [];
    for (const s of def.sections) {
      if (!isVisible(s.showIf, answers)) continue;
      const store = answers[s.key] || {};
      const rows = [];
      for (const f of s.fields) {
        if (!isVisible(f.showIf, answers)) continue;
        if (f.type === 'group') {
          (store[f.key] || []).forEach((row, i) => {
            const items = f.fields.filter(rf => isVisible(rf.showIf, answers, row) && display(rf, row[rf.key]));
            if (!items.length) return;
            rows.push(`<div class="ep-a-row">${esc(L(f.itemLabel))} ${i + 1}</div>`);
            items.forEach(rf => rows.push(`<dt>${esc(L(rf.label))}</dt><dd>${esc(display(rf, row[rf.key]))}</dd>`));
          });
          continue;
        }
        const d = display(f, store[f.key]);
        rows.push(`<dt>${esc(L(f.label))}</dt><dd>${d ? esc(d) : '<span class="ep-a-none">—</span>'}</dd>`);
      }
      parts.push(`<section class="ep-a-sec"><h3>${esc(L(s.title))}</h3><dl>${rows.join('')}</dl></section>`);
    }
    return `<div class="ep-answers">${parts.join('')}</div>`;
  }

  // ── Editor (all visible sections on one page; same field types as the client form)
  function fieldInput(f, v, path) {
    const data = `data-path="${esc(path)}" data-type="${esc(f.type)}"`;
    if (f.type === 'textarea') return `<textarea class="form-control" rows="3" ${data}>${esc(v || '')}</textarea>`;
    if (f.type === 'select' || f.type === 'choice') {
      return `<select class="form-control" ${data}><option value="">—</option>${(f.options || []).map(o =>
        `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(L(o.label))}</option>`).join('')}</select>`;
    }
    if (f.type === 'multi') {
      return `<div class="ep-e-multi">${(f.options || []).map(o =>
        `<label><input type="checkbox" value="${esc(o.value)}" ${Array.isArray(v) && v.includes(o.value) ? 'checked' : ''} ${data}> ${esc(L(o.label))}</label>`).join('')}</div>`;
    }
    const type = { email: 'email', tel: 'tel', date: 'date' }[f.type] || 'text';
    return `<input class="form-control" type="${type}" value="${esc(v || '')}" ${data}>`;
  }

  function editorHtml(def, answers) {
    return def.sections.map(s => {
      const store = answers[s.key] || {};
      const body = s.fields.map(f => {
        const hidden = !isVisible(f.showIf, answers) ? ' hidden' : '';
        if (f.type === 'group') {
          const rows = Array.isArray(store[f.key]) ? store[f.key] : [];
          const rowHtml = rows.map((row, i) => `
            <div class="ep-e-grouprow">
              <div class="ep-e-grouphead"><b>${esc(L(f.itemLabel))} ${i + 1}</b>
                <button type="button" class="dk-linkbtn d" data-ep-remove="${esc(s.key)}|${esc(f.key)}|${i}">Remove</button></div>
              <div class="ep-e-grid">${f.fields.map(rf => `
                <label class="ep-e-field"><span>${esc(L(rf.label))}</span>${fieldInput(rf, row[rf.key], `${s.key}.${f.key}.${i}.${rf.key}`)}</label>`).join('')}</div>
            </div>`).join('');
          return `<div class="ep-e-group${hidden}"><div class="ep-e-glabel">${esc(L(f.label))}</div>${rowHtml}
            ${rows.length < (f.max || 10) ? `<button type="button" class="btn btn--secondary btn--sm" data-ep-add="${esc(s.key)}|${esc(f.key)}">+ ${esc(L(f.addLabel) || 'Add')}</button>` : ''}</div>`;
        }
        return `<label class="ep-e-field${f.type === 'textarea' || f.full ? ' full' : ''}${hidden}"><span>${esc(L(f.label))}</span>${fieldInput(f, store[f.key], `${s.key}.${f.key}`)}</label>`;
      }).join('');
      const secHidden = !isVisible(s.showIf, answers) ? ' ep-e-sec--hidden' : '';
      return `<fieldset class="ep-e-sec${secHidden}"><legend>${esc(L(s.title))}${secHidden ? ' <span class="dk-tag mut">not shown for these answers</span>' : ''}</legend><div class="ep-e-grid">${body}</div></fieldset>`;
    }).join('');
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      const nextIsIndex = /^\d+$/.test(parts[i + 1]);
      if (cur[k] == null) cur[k] = nextIsIndex ? [] : {};
      cur = cur[k];
    }
    const last = parts[parts.length - 1];
    if (value === '' || value == null || (Array.isArray(value) && !value.length)) delete cur[last];
    else cur[last] = value;
  }

  function printAnswers(def, answers, clientName) {
    const w = window.open('', '_blank');
    if (!w) { Utils.toast('Allow pop-ups to print.', 'error'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(clientName)} — Estate Planning Questionnaire</title>
      <style>
        body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:32px;font-size:12.5px}
        h1{font-size:20px;margin:0 0 4px} .sub{color:#555;margin:0 0 18px;font-size:12px}
        h3{font-size:14px;border-bottom:1px solid #999;padding-bottom:3px;margin:18px 0 6px;break-after:avoid}
        dl{display:grid;grid-template-columns:38% 1fr;gap:3px 12px;margin:0} dt{color:#555} dd{margin:0;white-space:pre-wrap}
        .ep-a-row{grid-column:1/-1;font-weight:bold;margin-top:6px} .ep-a-sec{break-inside:avoid-page} .ep-a-none{color:#999}
      </style></head><body>
      <h1>${esc(clientName)}</h1><p class="sub">Estate Planning Questionnaire · printed ${esc(new Date().toLocaleString())}</p>
      ${answersHtml(def, answers)}
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  // ── The tab ────────────────────────────────────────────────────────────────
  function mount(root, ctx) {
    const { matter, client, callFunction } = ctx;
    const clientName = Utils.fullName(client) || 'Client';
    let data = null;          // /api/ep-intake/matter
    let tpl = null;           // /api/ep-intake/templates
    let editing = null;       // working copy of answers while editing
    let entering = false;     // editing is a new staff-entered questionnaire, not an edit
    let showOriginal = false;
    let lastLink = null;

    async function get(url) {
      const session = await Auth.getSession();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.error || `Error ${res.status}`), { status: res.status });
      return body;
    }

    async function load() {
      try {
        [data, tpl] = await Promise.all([
          get(`/api/ep-intake/matter?matter_id=${encodeURIComponent(matter.id)}`),
          get(`/api/ep-intake/templates?matter_id=${encodeURIComponent(matter.id)}`),
        ]);
        render();
      } catch (e) {
        root.innerHTML = `<p class="dk-empty">${e.status === 403
          ? 'You don’t have access to Estate Planning. An Owner can grant it in Settings → Permissions.'
          : esc(e.message)}</p>`;
      }
    }

    const latest = () => data.requests[0] || null;
    const latestSubmitted = () => data.requests.find(r => r.status === 'submitted') || null;
    const openReq = () => data.requests.find(r => r.status === 'open') || null;
    const defFor = (r) => data.definitions[r?.questionnaire_key] || data.definitions[data.default_key];

    // Starting point for "Fill it in yourself": whatever the client already saved on an
    // open link, else what the card knows about the client.
    function prefill() {
      const saved = openReq()?.draft_answers;
      if (saved && Object.keys(saved).length) return JSON.parse(JSON.stringify(saved));
      const c = client || {};
      const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const address = [c.address_line1, c.address_line2, cityLine].filter(Boolean).join('\n');
      const out = { client: {} };
      if (Utils.fullName(c)) out.client.full_legal_name = Utils.fullName(c);
      if (/^\d{4}-\d{2}-\d{2}/.test(c.dob || '')) out.client.dob = c.dob.slice(0, 10);
      if (c.phone) out.client.phone = c.phone;
      if (c.email) out.client.email = c.email;
      if (address) out.client.address = address;
      return out;
    }
    const enterBtn = (cls = 'btn btn--secondary') => (data.can_write && !latestSubmitted()
      ? `<button type="button" class="${cls}" data-ep-enter>Fill it in yourself</button>` : '');

    function deskbar() {
      const r = latest();
      const chips = [];
      if (!r) chips.push({ label: 'Questionnaire not sent', static: true });
      else if (r.status === 'submitted') chips.push({ label: `${r.entered_by_staff ? 'Entered by staff' : 'Submitted'} ${Utils.formatDate(r.submitted_at)}`, static: true });
      else if (r.status === 'open') {
        chips.push({ label: r.draft_saved_at ? `Client saved progress ${Utils.formatDate(r.draft_saved_at)}`
          : r.opened_at ? 'Client opened the link' : `Link sent ${Utils.formatDate(r.sent_at)}`, static: true, tone: 'warn' });
      } else chips.push({ label: `Last link ${STATUS[r.status]?.label.toLowerCase()}`, static: true, tone: 'warn' });
      chips.push({ n: tpl.drafts.length, label: tpl.drafts.length === 1 ? 'draft' : 'drafts', jump: 'ep-sec-draft' });
      return DK.deskbar(chips);
    }

    function sendForm() {
      const open = openReq();
      return `
        <div class="ep-send" id="ep-send">
          <div class="ep-send-grid">
            <label class="ep-e-field"><span>Email</span><input class="form-control" type="email" id="ep-send-email" value="${esc(client?.email || '')}"></label>
            <label class="ep-e-field"><span>Language</span>
              <select class="form-control" id="ep-send-lang"><option value="en">English</option><option value="es" ${open?.language === 'es' ? 'selected' : ''}>Español</option></select></label>
          </div>
          <label class="ep-send-check">${DK.toggle('id="ep-send-emailit"', true)} <span>Email the link to the client</span></label>
          <div class="ep-send-actions">
            <button type="button" class="btn btn--primary" id="ep-send-go">${open ? 'Send a new link' : 'Send questionnaire'}</button>
            <a class="btn btn--secondary" id="ep-preview" target="_blank" rel="noopener" href="/estate-intake?preview=1">Preview</a>
            ${enterBtn()}
          </div>
          ${data.can_write && !latestSubmitted() ? '<p class="ep-note">Taking the answers by phone or in the office? <b>Fill it in yourself</b> opens the same questionnaire here — no link is sent.</p>' : ''}
          ${open ? '<p class="ep-note">Sending a new link replaces the open one. Anything the client already saved carries over.</p>' : ''}
          ${lastLink ? `
            <div class="ep-link">
              <div><b>Link created.</b> Copy it now if you want to text it — for security it can’t be shown again.</div>
              <div class="ep-link-row"><input class="form-control" readonly value="${esc(lastLink)}" id="ep-link-val"><button type="button" class="btn btn--secondary" id="ep-link-copy">Copy</button></div>
            </div>` : ''}
        </div>`;
    }

    function requestsRegister() {
      if (!data.requests.length) return '<p class="dk-empty">No questionnaire has been sent for this matter yet.</p>';
      return `<div class="dk-register">${data.requests.map(r => {
        if (r.entered_by_staff) {
          return `<div class="dk-reg-row"><div><div class="dk-reg-title">Questionnaire ${DK.tag('Entered by staff', 'ok')}</div>
            <div class="dk-reg-meta">Filled in on the card ${esc(fmt(r.submitted_at))}<span class="sep">·</span>no client link</div></div><div class="dk-reg-act"></div></div>`;
        }
        const st = STATUS[r.status] || { label: r.status, kind: 'mut' };
        const meta = [
          `Sent ${esc(fmt(r.sent_at))}`,
          r.sent_to_email ? `to ${esc(r.sent_to_email)}${r.emailed ? '' : ' (not emailed)'}` : 'not emailed',
          r.language === 'es' ? 'Español' : 'English',
          r.status === 'open' ? `expires ${esc(Utils.formatDate(r.expires_at))}` : '',
          r.opened_at ? `opened ${esc(fmt(r.opened_at))}` : '',
          r.draft_saved_at && r.status === 'open' ? `saved ${esc(fmt(r.draft_saved_at))}` : '',
          r.submitted_at ? `submitted ${esc(fmt(r.submitted_at))}` : '',
        ].filter(Boolean).join('<span class="sep">·</span>');
        const acts = [];
        if (r.status === 'open' && Object.keys(r.draft_answers || {}).length) acts.push(`<button class="dk-linkbtn" data-ep-progress="${r.id}">View progress</button>`);
        if (r.status === 'open' && data.can_write) acts.push(`<button class="dk-linkbtn d" data-ep-revoke="${r.id}">Cancel link</button>`);
        return `<div class="dk-reg-row"><div><div class="dk-reg-title">Questionnaire ${DK.tag(st.label, st.kind)}</div>
          <div class="dk-reg-meta">${meta}</div></div><div class="dk-reg-act">${acts.join('')}</div></div>`;
      }).join('')}</div>`;
    }

    function answersSection() {
      const r = latestSubmitted();
      if (entering && editing) {
        const open = openReq();
        return `<div class="ep-note" style="margin-bottom:12px"><b>Filling in the questionnaire for ${esc(clientName)}.</b>
            Leave anything you don’t know yet blank — saving lists what’s still missing, and <b>Edit answers</b> picks it up later.
            ${open ? '<br>Saving closes the link sent to the client; anything they already saved is filled in below.' : ''}</div>
          <form id="ep-edit-form" class="ep-edit">${editorHtml(defFor(open), editing)}
          <div class="ep-send-actions"><button type="submit" class="btn btn--primary" id="ep-edit-save">Save answers</button>
          <button type="button" class="btn btn--secondary" id="ep-edit-cancel">Cancel</button></div></form>`;
      }
      if (!r) {
        return `<div class="dk-empty">Answers appear here once the client submits the questionnaire${data.can_write ? ' — or fill it in yourself.' : '.'}
          ${enterBtn('btn btn--secondary btn--sm')}</div>`;
      }
      const def = defFor(r);
      if (editing) {
        return `<form id="ep-edit-form" class="ep-edit">${editorHtml(def, editing)}
          <div class="ep-send-actions"><button type="submit" class="btn btn--primary" id="ep-edit-save">Save answers</button>
          <button type="button" class="btn btn--secondary" id="ep-edit-cancel">Cancel</button></div></form>`;
      }
      const original = r.entered_by_staff ? 'the first saved version' : 'what the client submitted';
      const edited = r.answers_updated_at
        ? `<span>Edited by staff ${esc(fmt(r.answers_updated_at))}.</span> <button class="dk-linkbtn" id="ep-orig">${showOriginal ? 'Show current answers' : `Show ${original}`}</button>` : '';
      const shown = showOriginal ? (r.answers_submitted || {}) : (r.answers || {});
      return `
        <div class="ep-ans-bar">
          <div class="ep-note">${r.entered_by_staff ? `Entered by staff ${esc(fmt(r.submitted_at))}. ` : ''}${showOriginal ? `<b>Showing ${original}.</b> ` : ''}${edited}</div>
          <div class="dk-reg-act">
            ${data.can_write && !showOriginal ? '<button class="btn btn--secondary btn--sm" id="ep-edit">Edit answers</button>' : ''}
            <button class="btn btn--secondary btn--sm" id="ep-print">Print</button>
          </div>
        </div>
        ${answersHtml(def, shown)}`;
    }

    function draftSection() {
      const r = latestSubmitted();
      const married = r && ['married', 'separated'].includes(r.answers?.marriage?.status) && r.answers?.marriage?.spouse_name;
      const templates = tpl.templates || [];
      const notInstalled = (tpl.starters || []).filter(s => !s.installed);

      const pick = templates.length ? `
        <div class="ep-tpl-list">${templates.map(t => `
          <label class="ep-tpl"><input type="checkbox" value="${t.id}" ${t.has_file ? '' : 'disabled'}>
            <span><b>${esc(t.name)}</b>${t.description ? `<span class="ep-tpl-desc">${esc(t.description)}</span>` : ''}${t.has_file ? '' : ' <span class="dk-tag warn">no .docx uploaded</span>'}</span></label>`).join('')}
        </div>
        <div class="ep-send-actions">
          ${married ? `<select class="form-control" id="ep-role" style="max-width:260px">
              <option value="client">For ${esc(r.answers.client?.full_legal_name || clientName)}</option>
              <option value="spouse">For the spouse, ${esc(r.answers.marriage.spouse_name)}</option></select>` : ''}
          <button class="btn btn--primary" id="ep-draft-go" ${r && data.can_write ? '' : 'disabled title="Needs questionnaire answers first"'}>Draft selected</button>
        </div>
        ${r ? '' : `<div class="ep-starters"><div><b>Drafting needs the questionnaire answers first</b> — the templates are filled from them
          (names, county, family, executors, agents). Send the questionnaire to the client, or fill it in yourself.</div>
          ${data.can_write ? `<div class="dk-reg-act"><button type="button" class="btn btn--secondary btn--sm" data-ep-jump="ep-send">Send questionnaire</button>${enterBtn('btn btn--secondary btn--sm')}</div>` : ''}</div>`}
        <div id="ep-draft-result"></div>` : '<p class="dk-empty">No estate-planning templates yet.</p>';

      const starters = notInstalled.length && data.can_write ? `
        <div class="ep-starters"><div><b>North Carolina starter templates</b> — ${notInstalled.map(s => esc(s.name)).join(', ')}.
          They fill in names, addresses and family details only. Bracketed choices in the will and trust are left for the attorney, and initials on the statutory forms are made by hand at signing. Review each one before first use.</div>
          <button class="btn btn--secondary btn--sm" id="ep-install">Install starter forms</button></div>` : '';

      const drafts = tpl.drafts.length ? `<div class="dk-register" style="margin-top:16px">${tpl.drafts.map(d => `
        <div class="dk-reg-row"><div><div class="dk-reg-title">${esc(d.file_name)} ${d.is_final ? DK.tag('Final', 'ok') : ''}</div>
          <div class="dk-reg-meta">${esc(fmt(d.created_at))}<span class="sep">·</span>${d.ep_role === 'spouse' ? 'spouse' : 'client'}<span class="sep">·</span>v${d.current_version_num || 1}</div></div>
          <div class="dk-reg-act"><button class="dk-linkbtn" data-ep-open="${d.id}">Open in Word</button></div></div>`).join('')}</div>` : '';

      return `${starters}${pick}
        <p class="ep-note">Your own will and trust templates: upload them in Settings → Word Templates and set “Fills from” to Estate Planning questionnaire.</p>
        ${drafts}`;
    }

    function render() {
      root.innerHTML = `
        <div class="ep-tab">
          ${deskbar()}
          <section class="dk-sec">${DK.sectionHead('Questionnaire')}${data.can_write ? sendForm() : ''}${requestsRegister()}
            <div id="ep-progress-view"></div></section>
          <section class="dk-sec" id="ep-sec-answers">${DK.sectionHead('Answers')}${answersSection()}</section>
          <section class="dk-sec" id="ep-sec-draft">${DK.sectionHead('Draft documents')}${draftSection()}</section>
        </div>`;
      DK.wireDeskbar && DK.wireDeskbar();
      wire();
    }

    function wire() {
      const $ = (id) => root.querySelector('#' + id);
      $('ep-send-lang')?.addEventListener('change', e => { $('ep-preview').href = `/estate-intake?preview=1&lang=${e.target.value}`; });
      if ($('ep-preview')) $('ep-preview').href = `/estate-intake?preview=1&lang=${$('ep-send-lang')?.value || 'en'}`;

      $('ep-send-go')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const emailIt = $('ep-send-emailit').checked;
        if (openReq() && !(await Utils.confirm('Send a new link? The current link will stop working; saved answers carry over.', { confirmLabel: 'Send new link' }))) return;
        btn.disabled = true;
        try {
          const res = await callFunction('/api/ep-intake/send', {
            matter_id: matter.id, language: $('ep-send-lang').value, email: $('ep-send-email').value.trim(), send_email: emailIt,
          });
          lastLink = res.link;
          Utils.toast(res.emailed ? 'Questionnaire emailed.' : emailIt ? 'Link created — email is not configured, copy the link below.' : 'Link created.', 'success');
          await load();
        } catch (err) { Utils.toast(err.message, 'error'); btn.disabled = false; }
      });
      $('ep-link-copy')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(lastLink).then(() => Utils.toast('Link copied.', 'success'), () => $('ep-link-val').select());
      });

      root.querySelectorAll('[data-ep-revoke]').forEach(b => b.addEventListener('click', async () => {
        if (!(await Utils.confirm('Cancel this link? The client will no longer be able to open it.', { danger: true, confirmLabel: 'Cancel link' }))) return;
        try { await callFunction('/api/ep-intake/revoke', { request_id: b.dataset.epRevoke }); lastLink = null; await load(); }
        catch (err) { Utils.toast(err.message, 'error'); }
      }));
      root.querySelectorAll('[data-ep-progress]').forEach(b => b.addEventListener('click', () => {
        const r = data.requests.find(x => x.id === b.dataset.epProgress);
        const box = $('ep-progress-view');
        box.innerHTML = box.innerHTML ? '' : `<div class="ep-note" style="margin-top:14px"><b>Progress so far</b> (not submitted — the client may still change it)</div>${answersHtml(defFor(r), r.draft_answers || {})}`;
      }));

      $('ep-print')?.addEventListener('click', () => {
        const r = latestSubmitted();
        printAnswers(defFor(r), showOriginal ? r.answers_submitted || {} : r.answers || {}, clientName);
      });
      $('ep-orig')?.addEventListener('click', () => { showOriginal = !showOriginal; render(); });
      $('ep-edit')?.addEventListener('click', () => { editing = JSON.parse(JSON.stringify(latestSubmitted().answers || {})); render(); });
      $('ep-edit-cancel')?.addEventListener('click', () => { editing = null; entering = false; render(); });
      root.querySelectorAll('[data-ep-enter]').forEach(b => b.addEventListener('click', () => {
        editing = prefill(); entering = true; showOriginal = false; render();
        root.querySelector('#ep-sec-answers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
      root.querySelectorAll('[data-ep-jump]').forEach(b => b.addEventListener('click', () => {
        const el = root.querySelector('#' + b.dataset.epJump);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.querySelector('input')?.focus({ preventScroll: true });
      }));

      const form = $('ep-edit-form');
      if (form) {
        const onChange = (e) => {
          const t = e.target;
          if (!t.dataset.path) return;
          if (t.type === 'checkbox') {
            const vals = [...form.querySelectorAll(`input[type=checkbox][data-path="${CSS.escape(t.dataset.path)}"]:checked`)].map(x => x.value);
            setPath(editing, t.dataset.path, vals);
          } else setPath(editing, t.dataset.path, t.value.trim());
          if (e.type === 'change' && (t.tagName === 'SELECT' || t.type === 'checkbox')) { const y = window.scrollY; render(); window.scrollTo(0, y); }
        };
        form.addEventListener('input', onChange);
        form.addEventListener('change', onChange);
        form.addEventListener('click', (e) => {
          const add = e.target.closest('[data-ep-add]');
          const rem = e.target.closest('[data-ep-remove]');
          if (!add && !rem) return;
          const [s, g, i] = (add || rem).dataset[add ? 'epAdd' : 'epRemove'].split('|');
          editing[s] = editing[s] || {};
          editing[s][g] = Array.isArray(editing[s][g]) ? editing[s][g] : [];
          if (add) editing[s][g].push({}); else editing[s][g].splice(Number(i), 1);
          const y = window.scrollY; render(); window.scrollTo(0, y);
        });
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = $('ep-edit-save'); btn.disabled = true;
          try {
            const res = entering
              ? await callFunction('/api/ep-intake/enter', { matter_id: matter.id, answers: editing })
              : await callFunction('/api/ep-intake/answers', { request_id: latestSubmitted().id, answers: editing });
            editing = null; entering = false; lastLink = null;
            if (res.warnings?.length) Utils.toast(`Saved. Still blank: ${res.warnings.slice(0, 3).join('; ')}${res.warnings.length > 3 ? '…' : ''}`, 'warning');
            else Utils.toast('Answers saved.', 'success');
            await load();
          } catch (err) { Utils.toast(err.message, 'error'); btn.disabled = false; }
        });
      }

      $('ep-install')?.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try { await callFunction('/api/ep-intake/install-starters', {}); Utils.toast('Starter forms installed.', 'success'); await load(); }
        catch (err) { Utils.toast(err.message, 'error'); e.currentTarget.disabled = false; }
      });

      $('ep-draft-go')?.addEventListener('click', async (e) => {
        const ids = [...root.querySelectorAll('.ep-tpl input:checked')].map(x => x.value);
        if (!ids.length) { Utils.toast('Pick at least one template.', 'error'); return; }
        const btn = e.currentTarget; btn.disabled = true;
        const out = $('ep-draft-result');
        try {
          const res = await callFunction('/api/ep-intake/draft', {
            matter_id: matter.id, template_ids: ids, role: $('ep-role')?.value || 'client', request_id: latestSubmitted()?.id,
          });
          tpl = await get(`/api/ep-intake/templates?matter_id=${encodeURIComponent(matter.id)}`);
          render();
          const box = root.querySelector('#ep-draft-result');
          box.innerHTML = `<div class="ep-link"><b>Drafted ${res.created.length} document${res.created.length === 1 ? '' : 's'}.</b>
            ${res.created.map(c => `<div class="ep-link-row"><span>${esc(c.file_name)}</span><a class="btn btn--secondary btn--sm" href="${esc(c.word_url)}">Open in Word</a></div>`).join('')}
            ${res.failed?.length ? `<div class="ep-note" style="color:var(--color-danger)">${res.failed.map(f => esc(`${f.name || 'Template'}: ${f.error}`)).join('<br>')}</div>` : ''}</div>`;
        } catch (err) { Utils.toast(err.message, 'error'); btn.disabled = false; if (out) out.innerHTML = ''; }
      });

      root.querySelectorAll('[data-ep-open]').forEach(b => b.addEventListener('click', async () => {
        try { const res = await callFunction('/api/drafting/open', { doc_id: b.dataset.epOpen }); window.location.href = res.word_url; }
        catch (err) { Utils.toast(err.message, 'error'); }
      }));
    }

    load();
  }

  window.EstatePlanningTab = { mount };
})();
