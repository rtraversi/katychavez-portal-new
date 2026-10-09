// stages.js: Draft Review, Pre-flight and Physical Scan, ported from the v2
// Lab's review.js and physical-scan.js and wired to the Batch 2 run route.
//
// The flow is the Lab's: choose a scope where it applies (D-56), add the files
// (the 1.2 drop zone, with the file list and the size limit stated on it,
// D-95), run (the 1.2 scan sweep), and the report unseals. What is drawn is the
// result the server stored (D-18). A fresh run clears the stage's sign-off on
// the server (D-75); the screen shows the sign-offs the server returns.

import {
  el, t, button, section, dropZone, scanButton, reveal, scrollTo, fmtMb, fmtWhen, errorLine, icon,
} from './ui.js';
import {
  checkFiles, totalBytes, LIMITS, SCOPED_STAGES, isGeneral, isSignedOff, latestRuns, emailOutcome,
} from './model.js';
import { renderReviewResult, renderPhysicalScanResult } from './results.js';
import { renderPossibleIssues } from './possible-issues.js';
import { errorText } from './api.js';

const NEXT = { draft_review: ['preflight', 'physical_scan'], preflight: ['physical_scan'], physical_scan: [] };

export function stageLocal(ctx, stage) {
  ctx.stages ||= {};
  return (ctx.stages[stage] ||= { scope: null, form: null, files: [], email: false, error: '', response: null, stored: null });
}

// Opening a stage shows its latest stored result, read back from the server.
export async function loadStoredRun(ctx, stage) {
  const local = stageLocal(ctx, stage);
  const latest = latestRuns(ctx.view.runs)[stage];
  if (!latest) { local.stored = null; return; }
  if (local.stored?.run_id === latest.id) return;
  const res = await ctx.api.getRun(latest.id);
  if (!res.ok || !res.data?.run?.result_json) { local.stored = null; local.error = res.ok ? '' : errorText(res); return; }
  local.stored = { run_id: res.data.run.id, result: res.data.run.result_json, issues: res.data.possible_issues || [], created_at: res.data.run.created_at };
}

export function renderStage(mount, ctx, stage) {
  const view = ctx.view;
  const general = isGeneral(view);
  const local = stageLocal(ctx, stage);
  const scoped = SCOPED_STAGES.has(stage);
  if (scoped && !local.scope) local.scope = 'whole';
  if (general) local.scope = scoped ? 'whole' : null; // D-93: no forms list to pick from

  if (stage === 'preflight') mount.appendChild(el('p', 'v2-hint v2-stage-intro', t('review.preflight.optional')));
  if (stage === 'physical_scan') mount.appendChild(el('p', 'v2-hint v2-stage-intro', t('ps.intro')));

  const setup = section(t(stage === 'physical_scan' ? 'ps.files_heading' : 'review.files_heading'));
  mount.appendChild(setup.wrap);
  drawSetup(setup.body);

  const results = section(t(stage === 'physical_scan' ? 'r12.scan_results' : 'review.results'));
  mount.appendChild(results.wrap);
  drawResults(results.body, results.wrap);

  // ── Setup ──────────────────────────────────────────────────────────────────

  function drawSetup(b) {
    if (scoped && !general) {
      const scopeRow = el('div', 'v2-scope');
      scopeRow.setAttribute('role', 'group');
      scopeRow.setAttribute('aria-label', t('scope.label'));
      for (const s of ['individual', 'whole']) {
        const btn = button('', 'v2-scope-btn', () => {
          if (local.scope === s) return;
          local.scope = s;
          local.files = local.files.filter((f) => f.kind === 'package' || s === 'whole');
          ctx.redraw();
        });
        btn.dataset.scope = s;
        btn.setAttribute('aria-pressed', String(local.scope === s));
        btn.appendChild(el('span', 'v2-scope-name', t(`scope.${s}`)));
        btn.appendChild(el('span', 'v2-scope-desc', t(`scope.${s}.${stage}`)));
        scopeRow.appendChild(btn);
      }
      b.appendChild(scopeRow);
    }

    if (local.scope === 'individual') {
      const forms = ctx.formsFor(view.case.case_type);
      if (!local.form || !forms.includes(local.form)) local.form = forms[0] || null;
      const row = el('div', 'v2-form-pick');
      const lab = el('label', 'v2-add-label', t('review.pick_form'));
      lab.htmlFor = `ps2-form-${stage}`;
      const sel = el('select', 'ps-select v2-inline-select');
      sel.id = `ps2-form-${stage}`;
      forms.forEach((f) => { const o = el('option', null, f); o.value = f; o.selected = f === local.form; sel.appendChild(o); });
      sel.value = local.form || '';
      sel.addEventListener('change', () => { local.form = sel.value; });
      row.append(lab, sel);
      b.appendChild(row);
    }

    const pkg = local.files.filter((f) => f.kind === 'package');
    const title = stage === 'physical_scan' ? (pkg.length ? t('ps.drop.ready') : t('ps.drop.title'))
      : pkg.length ? t('review.drop.ready') : t(`review.drop.title.${stage}`);
    const meta = pkg.length ? t('files.total', { n: local.files.length, mb: fmtMb(totalBytes(local.files.map((f) => f.file))) })
      : stage === 'physical_scan' ? t('ps.drop.meta') : t(`review.drop.meta.${local.scope}`);
    b.appendChild(dropZone({
      title, meta, ready: pkg.length > 0, landed: local.landed === 'package',
      multiple: local.scope !== 'individual',
      files: pkg.map((f) => fileRow(f)),
      note: t('limit.note'),
      onFiles: (files) => addFiles(files, 'package'),
    }));

    // Pre-flight only, optional: the client's marked-up pages and the corrected pages (D-68).
    if (stage === 'preflight') {
      const marked = local.files.filter((f) => f.kind === 'marked');
      const corrected = local.files.filter((f) => f.kind === 'corrected');
      const any = marked.length + corrected.length > 0;
      const zone = dropZone({
        title: any ? t('pf.corr.drop.ready') : t('pf.corr.drop.title'),
        meta: any ? null : t('pf.corr.optional'),
        ready: any, secondary: true, landed: local.landed === 'marked' || local.landed === 'corrected',
        files: [...marked, ...corrected].map((f) => fileRow(f, t(f.kind === 'marked' ? 'pf.corr.file.marked' : 'pf.corr.file.corrected'))),
        chooseLabel: t('pf.corr.add_marked'),
        onFiles: (files) => addFiles(files, 'marked'),
        extra: [correctedPicker()],
      });
      zone.classList.add('v2-corrections-drop');
      b.appendChild(zone);
    }
    local.landed = null;

    if (local.error) b.appendChild(errorLine(local.error));

    const bar = el('div', 'dk-toolbar v2-run-bar');
    const runLabel = stage === 'physical_scan' ? t('ps.run') : t(`review.run.${stage}`);
    const runBtn = scanButton(runLabel, run, !pkg.length && !(stage === 'preflight' && local.files.length));
    if (local.justRan) { runBtn.classList.add('is-complete'); runBtn.textContent = t('scan.done'); local.justRan = false; }
    bar.appendChild(runBtn);
    // D-61: optional, off unless turned on, sent only once the run is stored.
    const emailBox = el('label', 'v2-check v2-email-toggle');
    const email = el('input');
    email.type = 'checkbox';
    email.checked = local.email;
    email.addEventListener('change', () => { local.email = email.checked; });
    emailBox.append(email, el('span', null, t('email.toggle')));
    bar.appendChild(emailBox);
    b.appendChild(bar);
    b.appendChild(el('p', 'v2-hint v2-email-hint', `${t('review.run_note')} ${t('email.hint')}`));
  }

  // A second picker inside the corrections zone for the corrected pages.
  function correctedPicker() {
    const input = el('input', 'v2-file-input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
    input.hidden = true;
    input.addEventListener('change', () => {
      const list = [...(input.files || [])];
      input.value = '';
      if (list.length) return addFiles(list, 'corrected');
      return undefined;
    });
    const b = button(t('pf.corr.add_corrected'), 'btn btn--secondary v2-corrected-pick', (ev) => { ev?.stopPropagation?.(); input.click?.(); });
    const wrap = el('span', 'v2-corrected');
    wrap.append(b, input);
    return wrap;
  }

  function fileRow(f, kindLabel) {
    return {
      name: f.file.name,
      meta: [kindLabel, t('files.size', { mb: fmtMb(f.file.size) })].filter(Boolean).join(' · '),
      onRemove: () => { local.files = local.files.filter((x) => x !== f); local.error = ''; ctx.redraw(); },
    };
  }

  // D-95: the limits are checked here too, before anything is read or sent.
  function addFiles(files, kind) {
    const list = local.scope === 'individual' && kind === 'package' ? files.slice(0, 1) : files;
    const keep = local.scope === 'individual' && kind === 'package' ? local.files.filter((f) => f.kind !== 'package') : local.files;
    const problem = checkFiles(list, keep.map((f) => f.file));
    if (problem) { local.error = t(problem.key, problem.vars); ctx.redraw(); return; }
    local.error = '';
    local.files = [...keep, ...list.map((file) => ({ file, kind }))];
    local.landed = kind;
    ctx.redraw();
  }

  async function run() {
    const files = local.files;
    const pkgCount = files.filter((f) => f.kind === 'package').length;
    if (!pkgCount && !(stage === 'preflight' && files.length)) { local.error = t('review.add_files_first'); ctx.redraw(); return false; }
    const problem = checkFiles([], files.map((f) => f.file));
    if (problem) { local.error = t(problem.key, problem.vars); ctx.redraw(); return false; }
    local.error = '';
    const res = await ctx.api.run({
      caseId: view.case.id, stage,
      scope: scoped ? local.scope : null,
      form: local.scope === 'individual' ? local.form : null,
      files, email: local.email,
    });
    if (!res.ok) {
      local.error = res.status === 409 ? `${t('review.gate_blocked')} ${(res.data.evidence_requirement?.messages || []).join(' ')}`.trim()
        : t('review.run_failed', { error: errorText(res) });
      ctx.redraw();
      return false;
    }
    local.response = { ...res.data, emailed: local.email };
    local.stored = { run_id: res.data.run_id, result: res.data.result, issues: res.data.possible_issues || [], created_at: res.data.result?.scan?.scanned_at, fresh: true };
    local.files = [];
    local.justRan = true;
    if (res.data.case_view) ctx.setView(res.data.case_view, { scrollToResult: stage });
    else ctx.redraw({ scrollToResult: stage });
    return true;
  }

  // ── Results ────────────────────────────────────────────────────────────────

  function drawResults(body, wrap) {
    const stored = local.stored;
    if (!stored?.result) {
      wrap.hidden = true;
      return;
    }
    const resp = stored.fresh ? local.response : null;
    if (resp?.stored === false) body.appendChild(errorLine(resp.storage_error || t('review.not_stored')));
    if (resp?.follow_up_error) body.appendChild(errorLine(resp.follow_up_error));

    const card = el('div', `card ps-report v2-result${stage === 'physical_scan' ? '' : ' v2-review-result'}`);
    card.dataset.stage = stage;
    body.appendChild(card);
    const issuesCtx = { api: ctx.api, caseTypeLabel: view.case.case_type_label };
    // Fixed values from Pre-flight corrections were proposed to the case card (D-72).
    const proposedFromRun = (view.suggestions || []).filter((s) => s.run_id && s.run_id === stored.run_id).length;
    const resultCtx = { openStage: ctx.openStage, proposedFromRun };
    if (stage === 'physical_scan') {
      renderPhysicalScanResult(stored.result, card, {
        ...resultCtx,
        afterReport: (extra) => renderPossibleIssues(extra, stored.issues, issuesCtx),
      });
    } else {
      renderReviewResult(stored.result, card, resultCtx);
      renderPossibleIssues(card, stored.issues, issuesCtx);
    }
    if (stored.fresh) { reveal(card); stored.fresh = false; }

    if (stored.run_id) body.appendChild(signOff());
    if (resp?.emailed) body.appendChild(emailNote(resp));
  }

  // D-75: "Mark this stage reviewed". The report itself never changes.
  function signOff() {
    const on = isSignedOff(view, stage);
    const wrap = el('div', `v2-signoff${on ? ' is-on' : ''}`);
    const lab = el('label', 'v2-signoff-label');
    const cb = el('input', 'v2-signoff-input');
    cb.type = 'checkbox';
    cb.checked = on;
    const box = el('span', 'v2-signoff-box');
    box.appendChild(icon('check'));
    const words = el('span', 'v2-signoff-words');
    words.appendChild(el('span', 'v2-signoff-title', t(on ? 'signoff.on' : 'signoff.title')));
    words.appendChild(el('span', 'v2-signoff-sub', t('signoff.sub')));
    lab.append(cb, box, words);
    cb.addEventListener('change', async () => {
      const want = cb.checked;
      cb.disabled = true;
      const res = await ctx.api.signOff(view.case.id, stage, want);
      cb.disabled = false;
      if (!res.ok) { local.error = t('signoff.error', { error: errorText(res) }); cb.checked = !want; ctx.redraw(); return; }
      ctx.setView({ ...view, signoffs: res.data.signoffs || [] });
    });
    wrap.appendChild(lab);
    if (on && NEXT[stage].length) {
      const go = el('div', 'v2-signoff-next');
      NEXT[stage].forEach((k, i) => go.appendChild(button(t('signoff.next', { stage: t(`stage.${k}`) }),
        i === NEXT[stage].length - 1 ? 'btn btn--primary' : 'btn btn--secondary', () => ctx.openStage(k))));
      wrap.appendChild(go);
    }
    return wrap;
  }

  // What the optional email did, with what it carries (D-61, D-43).
  function emailNote(resp) {
    const box = el('div', 'v2-email');
    const preview = el('div', 'v2-email-preview');
    const bar = el('div', 'v2-email-bar');
    bar.appendChild(icon('mail'));
    bar.appendChild(el('span', 'v2-email-flag', t(emailOutcome(resp) || 'email.not_sent')));
    preview.appendChild(bar);
    const line = (k, v) => {
      const r = el('div', 'psr-nf');
      r.appendChild(el('span', 'psr-nf-k', k));
      r.appendChild(el('span', 'psr-nf-v', v));
      return r;
    };
    const r = resp.result || {};
    preview.appendChild(line(t('email.subject'), t('email.subject_value', { case_type: r.case_type_label, stage: r.stage_label, phrase: r.primary_report_language })));
    const body = el('div', 'v2-email-body');
    body.appendChild(el('p', null, t('email.body_result', { stage: r.stage_label, phrase: r.primary_report_language })));
    body.appendChild(el('p', null, r.staff_review_reminder || t('state.reminder')));
    preview.appendChild(body);
    box.appendChild(preview);
    return box;
  }
}

export const lastRunLine = (ctx, stage) => {
  const latest = latestRuns(ctx.view.runs)[stage];
  return latest ? t('review.stored_run', { when: fmtWhen(latest.created_at) }) : t('review.no_run');
};

export { LIMITS };
