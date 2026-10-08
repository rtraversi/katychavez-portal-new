// possible-issues.js: the "Possible issues" section (D-35 to D-39, D-59, D-60,
// D-86), wired to the authenticated decision route.
//
// It is drawn from the run's stored Possible issues, in their own violet
// section below everything the checker owns. They are never counted, never
// change the report state and never reach the email (D-36): this module has no
// access to the result at all, only to the issue rows.
//
// The 1.2 component (pages/proof-scan/exploration.js) is not reused here: it
// cannot show a decision already stored, and its rule nomination is one click
// with no wording or scope, where v2 lets staff edit both first (D-60). The
// classes, the dismiss reasons and the layout are the same, so it looks the same.

import { DISMISS_REASONS } from '../proof-scan/exploration-model.js';
import { el, t, button } from './ui.js';
import { errorText } from './api.js';

export function renderPossibleIssues(container, issues, ctx) {
  if (!Array.isArray(issues) || !issues.length) return null;
  const fold = el('details', 'ps-explore v2-possible');
  const head = el('summary', 'ps-explore-head');
  head.appendChild(el('span', null, t('pi.heading')));
  head.appendChild(el('span', 'ps-explore-count', String(issues.length)));
  head.setAttribute('aria-label', `${t('pi.heading')}: ${issues.length}`);
  fold.appendChild(head);
  fold.appendChild(el('p', 'ps-explore-note', t('pi.powerless')));
  if (issues.some((i) => !i.id)) fold.appendChild(el('p', 'ps-explore-note', t('pi.not_stored')));
  issues.forEach((issue) => fold.appendChild(card(issue, ctx)));
  container.appendChild(fold);
  return fold;
}

function card(issue, ctx) {
  const item = el('article', 'ps-explore-item');
  if (issue.id) item.dataset.issueId = issue.id;
  const status = el('p', 'ps-explore-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const heading = el('div', 'ps-explore-row-head');
  heading.appendChild(el('h3', 'ps-explore-title', issue.title));
  const actions = el('div', 'ps-explore-actions');
  heading.appendChild(actions);
  item.appendChild(heading);

  if (issue.description) item.appendChild(el('p', 'ps-explore-desc', issue.description));
  const facts = el('div', 'v2-pi-facts');
  for (const [key, value] of [['pi.why', issue.why_it_matters], ['pi.uncertainty', issue.uncertainty]]) {
    if (!value) continue;
    const r = el('div', 'psr-nf');
    r.appendChild(el('span', 'psr-nf-k', t(key)));
    r.appendChild(el('span', 'psr-nf-v', value));
    facts.appendChild(r);
  }
  if (facts.childNodes.length) item.appendChild(facts);
  if (issue.evidence) {
    const evidence = el('pre', 'ps-explore-evidence', issue.evidence);
    evidence.hidden = true;
    const viewBtn = button(t('pi.evidence'), 'ps-explore-source', () => {
      evidence.hidden = !evidence.hidden;
      viewBtn.setAttribute('aria-expanded', String(!evidence.hidden));
    });
    viewBtn.setAttribute('aria-expanded', 'false');
    item.append(viewBtn, evidence);
  }
  item.appendChild(status);

  let state = issue.status || 'open';
  let busy = false;

  async function decide(body, onDone) {
    if (busy) return;
    busy = true;
    status.textContent = t('pi.saving');
    item.classList.add('is-pending');
    const res = await ctx.api.possibleIssue(body);
    busy = false;
    item.classList.remove('is-pending');
    if (!res.ok) { status.textContent = t('pi.failed', { error: errorText(res) }); item.classList.add('is-unresolved'); return; }
    item.classList.remove('is-unresolved');
    onDone(res.data);
  }

  function draw() {
    actions.textContent = '';
    item.classList.toggle?.('is-reviewed', state !== 'open');
    if (!issue.id) return;
    if (state === 'open') {
      actions.appendChild(button(t('pi.accept'), 'ps-explore-control ps-explore-accept', () => decide(
        { action: 'accept', issue_id: issue.id },
        () => { state = 'accepted'; status.textContent = t('pi.accepted'); draw(); },
      )));
      const dismiss = el('details', 'ps-explore-dismiss');
      const toggle = el('summary', 'ps-explore-control ps-explore-dismiss-toggle', t('pi.dismiss'));
      dismiss.appendChild(toggle);
      const choices = el('div', 'ps-explore-choices');
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', t('pi.dismiss_reasons'));
      for (const reason of DISMISS_REASONS) {
        const choice = button(reason.label, 'ps-explore-control ps-explore-choice', () => decide(
          { action: 'dismiss', issue_id: issue.id, reason: reason.reason_id },
          () => {
            state = 'dismissed';
            status.textContent = reason.reason_id === 'never_suggest_reasoning' ? t('pi.never') : t('pi.dismissed', { choice: reason.label });
            draw();
          },
        ));
        choice.dataset.reasonId = reason.reason_id;
        choices.appendChild(choice);
      }
      dismiss.appendChild(choices);
      actions.appendChild(dismiss);
    } else if (state === 'accepted') {
      // D-38: suggesting a rule is its own step, only after accepting.
      const suggest = button(t('pi.suggest'), 'ps-explore-control ps-explore-nominate', () => {
        suggest.hidden = true;
        status.textContent = '';
        status.before?.(editor(issue, ctx, {
          onSave: (rule) => decide({ action: 'suggest_rule', issue_id: issue.id, rule }, () => {
            state = 'rule_added';
            status.textContent = t('suggest.added');
            draw();
          }),
          onCancel: () => { suggest.hidden = false; },
        }));
      });
      actions.appendChild(suggest);
    } else if (state === 'rule_added') {
      const done = button(t('suggest.added_btn'), 'ps-explore-control ps-explore-nominate');
      done.disabled = true;
      actions.appendChild(done);
    }
  }
  draw();
  return item;
}

// D-60: staff may edit the wording and choose the scope before it becomes a rule.
function editor(issue, ctx, { onSave, onCancel }) {
  const box = el('div', 'v2-suggest');
  const id = `ps2-suggest-${issue.id}`;
  const wordLabel = el('label', 'v2-ref-label', t('suggest.wording'));
  wordLabel.htmlFor = `${id}-wording`;
  const wording = el('textarea', 'v2-input v2-textarea');
  wording.id = `${id}-wording`;
  wording.rows = 3;
  wording.value = [issue.title, issue.description].filter(Boolean).join('. ').slice(0, 500);
  const scope = el('fieldset', 'v2-suggest-scope');
  scope.appendChild(el('legend', 'v2-ref-label', t('suggest.scope')));
  const radios = [];
  [['case_type', t('suggest.scope.case', { case_type: ctx.caseTypeLabel || '' })], ['firm', t('suggest.scope.firm')]].forEach(([value, label], i) => {
    const opt = el('label', 'v2-check');
    const r = el('input');
    r.type = 'radio';
    r.name = `${id}-scope`;
    r.value = value;
    r.checked = i === 0;
    radios.push(r);
    opt.append(r, el('span', null, label));
    scope.appendChild(opt);
  });
  scope.appendChild(el('p', 'v2-hint', t('suggest.scope.recommended')));
  const actions = el('div', 'v2-proposal-actions');
  actions.appendChild(button(t('suggest.save'), 'btn btn--primary v2-suggest-save', () => {
    const title = wording.value.trim();
    if (!title) { wording.focus?.(); return undefined; }
    const chosen = radios.find((r) => r.checked)?.value || 'case_type';
    box.remove?.();
    return onSave({ scope: chosen, title: title.slice(0, 500) });
  }));
  actions.appendChild(button(t('suggest.cancel'), 'btn btn--ghost', () => { box.remove?.(); onCancel(); }));
  box.append(wordLabel, wording, scope, el('p', 'v2-hint', t('suggest.future_only')), actions);
  return box;
}
