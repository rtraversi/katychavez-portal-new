// exploration-model.js — the "Possible issues" data contract and decision logic.
// Pure: no DOM, no fetch, no storage.
//
// WHY THIS IS A SEPARATE MODULE FROM report-model.js
// --------------------------------------------------
// Exploratory suggestions are NOT checklist results. They carry no rule ID, no
// severity, no profile version, and no coverage guarantee, and they are never
// validated by the strict server contract. Mixing them into the approved result
// shape would put unvalidated material one property access away from the
// attention count, the report state and the notification email.
//
// So they travel in their own envelope, are validated here at the component
// boundary, and reach the renderer as a separate argument. buildReportModel()
// neither reads nor produces any of this, which is what makes it structurally
// impossible for a suggestion to move an official number.
//
// WHAT A SUGGESTION MAY CONTAIN
// -----------------------------
//   {
//     schema_version: 1,
//     suggestions: [{
//       suggestion_id: string,      stable, unique within the set
//       title:         string,      the one-line concern
//       description:   string|null  why it might matter
//       evidence_label:string|null  the disclosure link text
//       evidence_text: string|null  the excerpt revealed on disclosure
//     }]
//   }
//
// Every field is plain text. There is no HTML anywhere in this contract, and the
// renderer writes all of it through text nodes, so there is nothing for a hostile
// string to do but be read.

export const EXPLORATION_SCHEMA_VERSION = 1;

// Bounds, so absent or corrupt data degrades to "show nothing" rather than to a
// wall of text or a hung page.
export const MAX_SUGGESTIONS = 25;
export const MAX_TITLE_LENGTH = 300;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_EVIDENCE_LABEL_LENGTH = 300;
export const MAX_EVIDENCE_TEXT_LENGTH = 4000;

// ── Stable identifiers ───────────────────────────────────────────────────────
//
// Handlers are told what happened with these, never with display copy. Wording
// can be rewritten without changing what a stored decision means.

export const ACTIONS = {
  ACCEPT: 'accept',
  DISMISS: 'dismiss',
  NOMINATE_RULE: 'nominate_rule',
};

// Reason IDs are the durable half; `label` is what staff read and may change.
export const DISMISS_REASONS = [
  { reason_id: 'not_an_issue_here', label: 'Not an issue in this package' },
  { reason_id: 'not_useful', label: 'Not useful' },
  { reason_id: 'never_suggest_reasoning', label: 'Never suggest this reasoning again' },
];

export const DISMISS_REASON_IDS = DISMISS_REASONS.map((reason) => reason.reason_id);

// ── Validation ───────────────────────────────────────────────────────────────

const trimmed = (value, max) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
};

// One suggestion, or null if it cannot be shown safely. A malformed entry is
// dropped on its own; it never invalidates the entries around it and never
// throws into the renderer.
function normalizeSuggestion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const suggestionId = trimmed(raw.suggestion_id, 200);
  const title = trimmed(raw.title, MAX_TITLE_LENGTH);
  // A suggestion with no id cannot be reported to a handler, and one with no
  // title has nothing to say. Both are required.
  if (!suggestionId || !title) return null;

  const evidenceLabel = trimmed(raw.evidence_label, MAX_EVIDENCE_LABEL_LENGTH);
  const evidenceText = trimmed(raw.evidence_text, MAX_EVIDENCE_TEXT_LENGTH);

  return {
    suggestion_id: suggestionId,
    title,
    description: trimmed(raw.description, MAX_DESCRIPTION_LENGTH),
    // Evidence needs both halves to be a disclosure: a label with nothing behind
    // it is a link to an empty box.
    evidence_label: evidenceText ? (evidenceLabel || 'View evidence') : null,
    evidence_text: evidenceText,
  };
}

// Returns { visible, suggestions, count }. `visible` is false whenever there is
// nothing supported to show — no data, wrong version, wrong shape, or every
// entry malformed — and the renderer draws nothing at all in that case.
export function normalizeExploration(input) {
  const empty = { visible: false, suggestions: [], count: 0 };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return empty;
  if (input.schema_version !== EXPLORATION_SCHEMA_VERSION) return empty;
  if (!Array.isArray(input.suggestions)) return empty;

  const seen = new Set();
  const suggestions = [];
  for (const raw of input.suggestions) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    const suggestion = normalizeSuggestion(raw);
    if (!suggestion || seen.has(suggestion.suggestion_id)) continue;
    seen.add(suggestion.suggestion_id);
    suggestions.push(suggestion);
  }

  if (!suggestions.length) return empty;
  return { visible: true, suggestions, count: suggestions.length };
}

// The heading. Counts suggestions only — it is deliberately unrelated to
// attention_count, which stays the official number.
export function explorationHeading(count) {
  return `Possible issues: ${count}`;
}

export const EXPLORATION_NOTE =
  'Suggestions only. These are not checks, are not counted as flags, and do not '
  + 'change the report state.';

// ── Decision outcomes ────────────────────────────────────────────────────────
//
// Four outcomes, and the renderer says something different for each. The one that
// matters most is `unhandled`: when no handler is wired, the component must not
// look like anything was saved or permanently suppressed.

export const OUTCOMES = {
  SKIPPED: 'skipped',
  SUCCESS: 'success',
  FAILURE: 'failure',
  UNHANDLED: 'unhandled',
};

// Serialises decisions per suggestion. A second click while one is in flight is
// dropped rather than queued, so a slow handler cannot be invoked twice.
export function createDecisionGate() {
  let pending = false;
  return {
    get pending() { return pending; },
    async run(work) {
      if (pending) return { outcome: OUTCOMES.SKIPPED };
      pending = true;
      try {
        return await work();
      } finally {
        // Cleared on failure too, which is what keeps retry available.
        pending = false;
      }
    },
  };
}

// Calls a host-supplied handler and classifies the result. A handler that throws,
// rejects, or returns `false` is a failure the staff member can retry; an absent
// handler is `unhandled` and never reported as success.
export async function runDecision(gate, handler, payload) {
  if (typeof handler !== 'function') return { outcome: OUTCOMES.UNHANDLED };
  return gate.run(async () => {
    try {
      const result = await handler(payload);
      if (result === false) return { outcome: OUTCOMES.FAILURE, error: null };
      return { outcome: OUTCOMES.SUCCESS, result };
    } catch (error) {
      return { outcome: OUTCOMES.FAILURE, error };
    }
  });
}

// ── Status copy ──────────────────────────────────────────────────────────────
//
// One table, so no branch in the renderer can invent a reassuring sentence. Note
// that nothing here says a decision was stored unless the handler said so.

export const PENDING_MESSAGE = 'Saving…';

const UNHANDLED_MESSAGE = {
  [ACTIONS.ACCEPT]: 'Not saved — decision handling is not connected yet.',
  [ACTIONS.DISMISS]: 'Not saved — nothing was suppressed. Decision handling is not connected yet.',
  [ACTIONS.NOMINATE_RULE]: 'Not sent — rule suggestions are not connected yet.',
};

const FAILURE_MESSAGE = {
  [ACTIONS.ACCEPT]: 'That did not save. Try again.',
  [ACTIONS.DISMISS]: 'That did not save. Nothing was suppressed. Try again.',
  [ACTIONS.NOMINATE_RULE]: 'That did not send. Try again.',
};

export function decisionMessage(action, outcome, reasonId) {
  if (outcome === OUTCOMES.UNHANDLED) return UNHANDLED_MESSAGE[action] || UNHANDLED_MESSAGE[ACTIONS.ACCEPT];
  if (outcome === OUTCOMES.FAILURE) return FAILURE_MESSAGE[action] || FAILURE_MESSAGE[ACTIONS.ACCEPT];
  if (outcome !== OUTCOMES.SUCCESS) return '';

  if (action === ACTIONS.ACCEPT) {
    return 'Noted for this package only. The checklist, the count and the report state are unchanged.';
  }
  if (action === ACTIONS.NOMINATE_RULE) {
    return 'Sent as a rule suggestion. Nothing was added to the checklist.';
  }
  if (reasonId === 'never_suggest_reasoning') {
    return 'Dismissed. This reasoning will not be suggested again.';
  }
  const reason = DISMISS_REASONS.find((entry) => entry.reason_id === reasonId);
  return reason ? `Dismissed: ${reason.label.toLowerCase()}.` : 'Dismissed.';
}
