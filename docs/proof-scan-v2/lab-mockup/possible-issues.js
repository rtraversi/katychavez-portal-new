// possible-issues.js: the 1.2 exploration preview, reused as-is (D-39), with the
// v2 actions wired on top (D-59, D-60). It never touches the attention count,
// the report state, or the email: it only ever writes inside its own section.
import { renderExplorationPreview } from '/ui-lab/exploration-preview.js';
import { el, t, button } from '/v2-lab/ui.js';
import { state, nextId } from '/v2-lab/state.js';

// The 1.2 control labels, verbatim, used to find its buttons.
const SUGGEST = 'Suggest as a future rule';
const NEVER = 'Never suggest this reasoning again';

const isSuppressed = (title) => state.suppressed.some((s) => s.reasoning === title);

function suggestEditor(card, title, description, promote, status) {
  const box = el('div', 'v2-suggest');
  const id = nextId('suggest');

  const wordLabel = el('label', 'v2-ref-label', t('suggest.wording'));
  wordLabel.htmlFor = `${id}-wording`;
  const wording = el('textarea', 'v2-input v2-textarea');
  wording.id = `${id}-wording`;
  wording.value = `${title}. ${description}`;
  wording.rows = 3;

  const scope = el('fieldset', 'v2-suggest-scope');
  scope.appendChild(el('legend', 'v2-ref-label', t('suggest.scope')));
  [['case', t('suggest.scope.case')], ['firm', t('suggest.scope.firm')]].forEach(([value, label], i) => {
    const opt = el('label', 'v2-check');
    const r = el('input');
    r.type = 'radio';
    r.name = `${id}-scope`;
    r.value = value;
    r.checked = i === 0;
    opt.append(r, el('span', null, label));
    scope.appendChild(opt);
  });
  scope.appendChild(el('p', 'v2-hint', t('suggest.scope.recommended')));

  const actions = el('div', 'v2-proposal-actions');
  actions.appendChild(button(t('suggest.save'), 'btn btn--primary', () => {
    const text = wording.value.trim();
    if (!text) { wording.focus(); return; }
    const chosen = scope.querySelector('input:checked').value;
    state.learnedRules.push({
      id: nextId('learned'), title: text, scope: chosen,
      caseType: chosen === 'case' ? 'daca_renewal' : null,
      stage: state.stage, addedAt: new Date(),
    });
    box.remove();
    promote.textContent = t('suggest.added_btn');
    promote.disabled = true;
    status.textContent = t('suggest.added');
  }));
  actions.appendChild(button(t('suggest.cancel'), 'btn btn--ghost', () => { box.remove(); promote.hidden = false; promote.focus(); }));

  box.append(wordLabel, wording, scope, el('p', 'v2-hint', t('suggest.future_only')), actions);
  return box;
}

// A Possible issue raised by the v2 Lab itself (e.g. expired evidence, D-100 #5),
// built in the 1.2 card shape so the same actions work on it.
function extraCard({ title, description, source, excerpt }) {
  const card = el('article', 'ps-explore-item');
  const head = el('div', 'ps-explore-row-head');
  head.appendChild(el('h3', null, title));
  const actions = el('div', 'ps-explore-actions');
  const status = el('p', 'ps-explore-note');
  status.setAttribute('role', 'status');
  const accept = button('Accept', 'ps-explore-control ps-explore-accept');
  const promote = button(SUGGEST, 'ps-explore-control');
  promote.hidden = true;
  const dismiss = el('details', 'ps-explore-dismiss');
  dismiss.appendChild(el('summary', 'ps-explore-control', 'Dismiss'));
  const choices = el('div', 'ps-explore-choices');
  ['Not an issue in this package', 'Not useful', NEVER].forEach((x) => choices.appendChild(button(x, 'ps-explore-control')));
  dismiss.appendChild(choices);
  accept.addEventListener('click', () => {
    status.textContent = t('pi.accepted');
    accept.textContent = 'Accepted'; accept.disabled = true; dismiss.hidden = true; promote.hidden = false;
    card.classList.add('is-reviewed');
  });
  actions.append(accept, dismiss, promote);
  head.appendChild(actions);
  const evidence = el('pre', null, excerpt);
  evidence.hidden = true;
  const view = button(source, 'ps-explore-source', () => { evidence.hidden = !evidence.hidden; });
  card.append(head, el('p', null, description), view, evidence, status);
  return card;
}

export function renderPossibleIssues(mount, extras = []) {
  renderExplorationPreview(mount);
  const fold = mount.querySelector('#ps-exploration-preview');
  if (!fold) return;
  const firstItem = fold.querySelector('.ps-explore-item');
  extras.filter((x) => !isSuppressed(x.title)).forEach((x) => fold.insertBefore(extraCard(x), firstItem));

  // D-59: firm-wide suppression. Suppressed reasoning does not come back.
  const syncCount = () => {
    const n = fold.querySelectorAll('.ps-explore-item').length;
    const count = fold.querySelector('.ps-explore-count');
    if (count) count.textContent = String(n);
  };
  fold.querySelectorAll('.ps-explore-item').forEach((card) => {
    if (isSuppressed(card.querySelector('h3')?.textContent)) card.remove();
  });
  syncCount();
  // One note, not two: replace the 1.2 line rather than stacking another under it.
  const note = fold.querySelector(':scope > .ps-explore-note');
  if (note) note.textContent = t('pi.powerless');

  // Capture phase, so these run instead of the 1.2 preview's demo handlers.
  fold.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    const card = b?.closest('.ps-explore-item');
    if (!b || !card) return;
    const title = card.querySelector('h3').textContent;
    const status = card.querySelector('[role="status"]');

    if (b.textContent === SUGGEST) {
      ev.stopPropagation();
      if (card.querySelector('.v2-suggest')) return;
      b.hidden = true;
      const description = card.querySelector(':scope > p')?.textContent || '';
      status.textContent = '';
      status.after(suggestEditor(card, title, description, b, status));
      card.querySelector('.v2-suggest textarea').focus();
      return;
    }

    if (b.closest('.ps-explore-choices')) {
      ev.stopPropagation();
      const dismiss = card.querySelector('.ps-explore-dismiss');
      const accept = card.querySelector('.ps-explore-accept');
      if (b.textContent === NEVER) {
        if (!isSuppressed(title)) state.suppressed.push({ reasoning: title, origin: 'dismissal', addedAt: new Date() });
        status.textContent = t('pi.never');
      } else {
        status.textContent = t('pi.dismissed', { choice: b.textContent });
      }
      accept.hidden = true;
      dismiss.open = false;
      dismiss.hidden = true;
      card.classList.add('is-reviewed');
    }
  }, true);
}
