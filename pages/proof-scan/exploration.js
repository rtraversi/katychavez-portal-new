// exploration.js — renders the "Possible issues" section.
//
// Ported from the approved UI Lab preview (ui-lab/exploration-preview.js, v=6)
// with its fictional findings and its simulated success handlers left behind.
// The lab pretended a decision was saved; this component only ever says what a
// real host handler told it.
//
// Boundaries, all load-bearing:
//   1. Suggestions arrive in their own envelope and are validated by
//      exploration-model.js before anything is drawn. They never touch the
//      checklist result, so they cannot move the attention count, the report
//      state, a severity, the history summary, or the notification email.
//   2. Every string reaches the page through textContent on a node this file
//      created. There is no innerHTML path, so a suggestion containing markup is
//      drawn as characters.
//   3. Accept, dismiss and rule nomination are dependency-injected callbacks. No
//      handler means no decision: the row says so plainly instead of showing a
//      success it cannot back up. Nothing is written to localStorage.
//   4. Rule nomination is a separate, explicit action that appears only after an
//      accept the host actually confirmed. Accepting never creates a rule.

import {
  ACTIONS,
  DISMISS_REASONS,
  EXPLORATION_NOTE,
  OUTCOMES,
  PENDING_MESSAGE,
  createDecisionGate,
  decisionMessage,
  runDecision,
  explorationHeading,
  normalizeExploration,
} from './exploration-model.js';

// `doc` is injectable so the component can be driven in tests without a browser.
export function renderExploration(input, options = {}) {
  const doc = options.doc || document;
  const handlers = options.handlers || {};

  const model = normalizeExploration(input);
  // Nothing supported to show — draw nothing at all. A real scan supplies no
  // suggestion envelope today, so this is the production path.
  if (!model.visible) return null;

  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const button = (label, cls, onClick) => {
    const node = el('button', cls, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };

  // Always collapsed on first paint, including when history reopens a scan:
  // `open` is never set here and no caller can pass it in.
  const fold = el('details', 'ps-explore');

  const head = el('summary', 'ps-explore-head');
  head.appendChild(el('span', null, 'Possible issues:'));
  head.appendChild(el('span', 'ps-explore-count', String(model.count)));
  // The visible heading is split so the count can wear its own badge; the label
  // keeps it one phrase — "Possible issues: 2" — for a screen reader.
  head.setAttribute('aria-label', explorationHeading(model.count));
  head.setAttribute('aria-expanded', 'false');
  fold.addEventListener('toggle', () => head.setAttribute('aria-expanded', String(fold.open)));
  fold.appendChild(head);

  // Restates the boundary where staff read it, not only in the code.
  fold.appendChild(el('p', 'ps-explore-note', EXPLORATION_NOTE));

  for (const suggestion of model.suggestions) {
    fold.appendChild(suggestionCard(suggestion));
  }

  return fold;

  // ── One suggestion ─────────────────────────────────────────────────────────

  function suggestionCard(suggestion) {
    const card = el('article', 'ps-explore-item');
    card.dataset.suggestionId = suggestion.suggestion_id;

    // aria-live, so a decision outcome is announced rather than only coloured.
    const status = el('p', 'ps-explore-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const gate = createDecisionGate();

    // Every control routes through here, which is the single place that knows
    // how to show pending, success, failure and "no handler".
    async function decide(action, control, payload, onSuccess) {
      // Checked BEFORE anything is touched. A click that arrives while another
      // decision is in flight must change nothing at all — not the status line,
      // not the pending class, not a control — or it would visually cancel the
      // decision it lost the race to.
      if (gate.pending) return OUTCOMES.SKIPPED;

      const previousLabel = control.textContent;
      status.textContent = PENDING_MESSAGE;
      card.classList.add('is-pending');
      control.disabled = true;
      control.setAttribute('aria-busy', 'true');

      const { outcome } = await runDecisionFor(action, payload);

      // The gate is the authority on double submission; this is the same guard
      // one layer down, for a race the check above could not see.
      if (outcome === OUTCOMES.SKIPPED) return outcome;

      card.classList.remove('is-pending');
      control.removeAttribute('aria-busy');
      status.textContent = decisionMessage(action, outcome, payload.reason_id);

      if (outcome === OUTCOMES.SUCCESS) {
        onSuccess();
      } else {
        // Failure and "no handler" both leave the control usable, so the staff
        // member can try again once the problem is fixed.
        control.disabled = false;
        control.textContent = previousLabel;
        card.classList.add('is-unresolved');
      }
      return outcome;
    }

    function runDecisionFor(action, payload) {
      const handler = action === ACTIONS.ACCEPT ? handlers.onAccept
        : action === ACTIONS.DISMISS ? handlers.onDismiss
          : handlers.onNominateRule;
      // `gate` is per-suggestion, so one row's slow handler never blocks another.
      return runDecision(gate, handler, payload);
    }

    // ── Heading and controls ─────────────────────────────────────────────────

    const heading = el('div', 'ps-explore-row-head');
    heading.appendChild(el('h3', 'ps-explore-title', suggestion.title));

    const actions = el('div', 'ps-explore-actions');

    // Appears only after an accept the host confirmed. Nomination is its own
    // deliberate action — accepting a suggestion never proposes a rule.
    const nominate = button('Suggest as a future rule', 'ps-explore-control ps-explore-nominate',
      () => decide(
        ACTIONS.NOMINATE_RULE,
        nominate,
        { action: ACTIONS.NOMINATE_RULE, suggestion_id: suggestion.suggestion_id },
        () => { nominate.textContent = 'Rule suggested'; nominate.disabled = true; },
      ));
    nominate.hidden = true;

    const accept = button('Accept', 'ps-explore-control ps-explore-accept', () => decide(
      ACTIONS.ACCEPT,
      accept,
      { action: ACTIONS.ACCEPT, suggestion_id: suggestion.suggestion_id },
      () => {
        accept.textContent = 'Accepted';
        accept.disabled = true;
        dismiss.hidden = true;
        nominate.hidden = false;
        card.classList.remove('is-unresolved');
        card.classList.add('is-reviewed');
      },
    ));

    // ── Dismiss, with its reasons ────────────────────────────────────────────
    //
    // A <details> so the choices exist in the DOM only when opened, and so
    // keyboard users get the native disclosure behaviour for free.

    const dismiss = el('details', 'ps-explore-dismiss');
    const dismissToggle = el('summary', 'ps-explore-control ps-explore-dismiss-toggle', 'Dismiss');
    dismissToggle.setAttribute('aria-label', `Dismiss: ${suggestion.title}`);
    dismissToggle.setAttribute('aria-expanded', 'false');
    dismiss.addEventListener('toggle', () => dismissToggle.setAttribute('aria-expanded', String(dismiss.open)));

    const choices = el('div', 'ps-explore-choices');
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', 'Reason for dismissing');

    for (const reason of DISMISS_REASONS) {
      const choice = button(reason.label, 'ps-explore-control ps-explore-choice', () => decide(
        ACTIONS.DISMISS,
        choice,
        {
          action: ACTIONS.DISMISS,
          suggestion_id: suggestion.suggestion_id,
          reason_id: reason.reason_id,
        },
        () => {
          accept.hidden = true;
          dismiss.open = false;
          dismiss.hidden = true;
          card.classList.remove('is-unresolved');
          card.classList.add('is-reviewed', 'is-dismissed');
        },
      ));
      choice.dataset.reasonId = reason.reason_id;
      choices.appendChild(choice);
    }

    dismiss.appendChild(dismissToggle);
    dismiss.appendChild(choices);
    dismiss.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { dismiss.open = false; dismissToggle.focus?.(); }
    });
    dismiss.addEventListener('focusout', (event) => {
      if (!dismiss.contains?.(event.relatedTarget)) dismiss.open = false;
    });

    actions.appendChild(accept);
    actions.appendChild(dismiss);
    actions.appendChild(nominate);
    heading.appendChild(actions);
    card.appendChild(heading);

    if (suggestion.description) {
      card.appendChild(el('p', 'ps-explore-desc', suggestion.description));
    }

    // ── Evidence disclosure ──────────────────────────────────────────────────
    //
    // Only when there is an excerpt behind it. The excerpt is a text node in a
    // <pre>, so whitespace is preserved and markup is not.

    if (suggestion.evidence_text) {
      const evidence = el('pre', 'ps-explore-evidence', suggestion.evidence_text);
      evidence.hidden = true;

      const view = button(suggestion.evidence_label, 'ps-explore-source', () => {
        evidence.hidden = !evidence.hidden;
        view.setAttribute('aria-expanded', String(!evidence.hidden));
      });
      view.setAttribute('aria-expanded', 'false');
      view.setAttribute('aria-label', `View evidence: ${suggestion.evidence_label}`);

      card.appendChild(view);
      card.appendChild(evidence);
    }

    card.appendChild(status);
    return card;
  }
}
