// Behavioural tests for the "Possible issues" component.
//
// These drive the REAL production renderer through a DOM stand-in and click its
// controls, rather than asserting on source strings. What they exist to hold:
//
//   * A suggestion is never a finding. It cannot move the attention count, the
//     report state, a severity, the history summary, or the email.
//   * Nothing claims a decision was saved unless a host handler said so.
//   * Absent or malformed suggestion data degrades to "show nothing".
//   * Hostile text stays text.
import { describe, it, expect, vi } from 'vitest';
import { renderExploration } from '../../pages/proof-scan/exploration.js';
import {
  ACTIONS,
  DISMISS_REASONS,
  DISMISS_REASON_IDS,
  MAX_SUGGESTIONS,
  OUTCOMES,
  createDecisionGate,
  decisionMessage,
  explorationHeading,
  normalizeExploration,
  runDecision,
} from '../../pages/proof-scan/exploration-model.js';
import { renderReport } from '../../pages/proof-scan/report.js';
import { buildReportModel } from '../../pages/proof-scan/report-model.js';
import {
  getSelectedScanProfile,
  validateAndComposeObservations,
} from '../../functions/api/proof-scan-contract.js';
import {
  byClass, byTag, click, fakeDocument, oneByClass, textOf,
} from '../support/fake-dom.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const suggestion = (over = {}) => ({
  suggestion_id: 'sug-1',
  title: 'Possible address inconsistency',
  description: 'Two documents give different mailing addresses.',
  evidence_label: 'Application, page 2 ↔ Statement, page 1',
  evidence_text: 'Application: 124 Oak Street\nStatement: 124 Oak Avenue',
  ...over,
});

const envelope = (...suggestions) => ({ schema_version: 1, suggestions });

// Renders with the shim and returns the section plus handy accessors.
function render(input, handlers = {}) {
  const doc = fakeDocument();
  const section = renderExploration(input, { doc, handlers });
  if (!section) return { section: null };
  const cards = byClass(section, 'ps-explore-item');
  return {
    section,
    cards,
    card: cards[0],
    accept: (i = 0) => oneByClass(cards[i], 'ps-explore-accept'),
    nominate: (i = 0) => oneByClass(cards[i], 'ps-explore-nominate'),
    dismissFold: (i = 0) => oneByClass(cards[i], 'ps-explore-dismiss'),
    choices: (i = 0) => byClass(cards[i], 'ps-explore-choice'),
    source: (i = 0) => oneByClass(cards[i], 'ps-explore-source'),
    evidence: (i = 0) => oneByClass(cards[i], 'ps-explore-evidence'),
    status: (i = 0) => oneByClass(cards[i], 'ps-explore-status'),
  };
}

const ok = () => vi.fn(async () => true);

// ── Visibility ────────────────────────────────────────────────────────────────

describe('possible issues — visibility', () => {
  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['an empty object', {}],
    ['an array', [{ suggestion_id: 'a', title: 'b' }]],
    ['a string', 'possible issues'],
    ['no suggestions array', { schema_version: 1 }],
    ['an empty suggestion list', { schema_version: 1, suggestions: [] }],
    ['an unknown schema version', { schema_version: 2, suggestions: [suggestion()] }],
    ['a missing schema version', { suggestions: [suggestion()] }],
  ])('renders nothing when given %s', (_name, input) => {
    expect(render(input).section).toBeNull();
  });

  it('renders nothing when every entry is malformed', () => {
    const junk = envelope(null, 'x', 42, [], {}, { title: 'no id' }, { suggestion_id: 'no title' });
    expect(render(junk).section).toBeNull();
  });

  it('keeps the good entries and drops the junk beside them', () => {
    const mixed = envelope(
      null,
      { suggestion_id: 'keep', title: 'A real one' },
      { title: 'dropped — no id' },
      42,
    );
    const { cards } = render(mixed);
    expect(cards).toHaveLength(1);
    expect(oneByClass(cards[0], 'ps-explore-title').textContent).toBe('A real one');
  });

  it('drops a duplicate suggestion_id rather than rendering it twice', () => {
    const dupes = envelope(
      { suggestion_id: 'same', title: 'First' },
      { suggestion_id: 'same', title: 'Second' },
    );
    const { cards } = render(dupes);
    expect(cards).toHaveLength(1);
    expect(oneByClass(cards[0], 'ps-explore-title').textContent).toBe('First');
  });

  it('caps a runaway suggestion list', () => {
    const many = Array.from({ length: MAX_SUGGESTIONS + 20 },
      (_, i) => suggestion({ suggestion_id: `s-${i}` }));
    const { cards } = render(envelope(...many));
    expect(cards).toHaveLength(MAX_SUGGESTIONS);
  });
});

// ── Heading, collapse, layout ─────────────────────────────────────────────────

describe('possible issues — heading and collapse', () => {
  it('heads the section "Possible issues: N"', () => {
    const { section } = render(envelope(
      suggestion({ suggestion_id: 'a' }),
      suggestion({ suggestion_id: 'b' }),
      suggestion({ suggestion_id: 'c' }),
    ));
    const head = oneByClass(section, 'ps-explore-head');
    expect(head.getAttribute('aria-label')).toBe('Possible issues: 3');
    expect(oneByClass(section, 'ps-explore-count').textContent).toBe('3');
    expect(textOf(head)).toContain('Possible issues:');
  });

  it('counts suggestions, never the official attention count', () => {
    expect(explorationHeading(1)).toBe('Possible issues: 1');
    expect(explorationHeading(0)).toBe('Possible issues: 0');
  });

  it('starts collapsed and reports that to assistive tech', () => {
    const { section } = render(envelope(suggestion()));
    expect(section.tagName).toBe('details');
    expect(section.open).toBe(false);
    expect(oneByClass(section, 'ps-explore-head').getAttribute('aria-expanded')).toBe('false');
  });

  it('is collapsed again on every fresh render, including a reopened scan', () => {
    const input = envelope(suggestion());
    const first = render(input);
    first.section.open = true;
    expect(first.section.open).toBe(true);
    // Reopening from history calls the renderer again; state does not survive.
    expect(render(input).section.open).toBe(false);
  });

  it('tracks aria-expanded when opened', () => {
    const { section } = render(envelope(suggestion()));
    section.open = true;
    expect(oneByClass(section, 'ps-explore-head').getAttribute('aria-expanded')).toBe('true');
  });

  it('says in the section itself that these are not counted as flags', () => {
    const { section } = render(envelope(suggestion()));
    const note = oneByClass(section, 'ps-explore-note').textContent;
    expect(note).toMatch(/not counted as flags/i);
    expect(note).toMatch(/do not change the report state/i);
  });
});

// ── Evidence ──────────────────────────────────────────────────────────────────

describe('possible issues — evidence disclosure', () => {
  it('hides the excerpt until the evidence link is used', async () => {
    const h = render(envelope(suggestion()));
    expect(h.evidence().hidden).toBe(true);
    expect(h.source().getAttribute('aria-expanded')).toBe('false');

    await click(h.source());
    expect(h.evidence().hidden).toBe(false);
    expect(h.source().getAttribute('aria-expanded')).toBe('true');

    await click(h.source());
    expect(h.evidence().hidden).toBe(true);
    expect(h.source().getAttribute('aria-expanded')).toBe('false');
  });

  it('labels the link for a screen reader', () => {
    const h = render(envelope(suggestion()));
    expect(h.source().getAttribute('aria-label'))
      .toBe('View evidence: Application, page 2 ↔ Statement, page 1');
  });

  it('shows no evidence control when there is no excerpt behind it', () => {
    const h = render(envelope(suggestion({ evidence_text: null })));
    expect(h.source()).toBeNull();
    expect(h.evidence()).toBeNull();
  });

  it('falls back to a usable link label when only the excerpt is supplied', () => {
    const h = render(envelope(suggestion({ evidence_label: null })));
    expect(h.source().textContent).toBe('View evidence');
  });
});

// ── Accept, then the separate rule nomination ─────────────────────────────────

describe('possible issues — accept', () => {
  it('reports the accept to the handler with stable identifiers', async () => {
    const onAccept = ok();
    const h = render(envelope(suggestion()), { onAccept });
    await click(h.accept());

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith({ action: 'accept', suggestion_id: 'sug-1' });
  });

  it('confirms for this package only, and says the report is unchanged', async () => {
    const h = render(envelope(suggestion()), { onAccept: ok() });
    await click(h.accept());

    expect(h.status().textContent).toMatch(/this package only/i);
    expect(h.status().textContent).toMatch(/count and the report state are unchanged/i);
    expect(h.accept().textContent).toBe('Accepted');
    expect(h.accept().disabled).toBe(true);
    expect(h.card.classList.contains('is-reviewed')).toBe(true);
  });

  it('reveals rule nomination only after a confirmed accept', async () => {
    const h = render(envelope(suggestion()), { onAccept: ok() });
    expect(h.nominate().hidden).toBe(true);

    await click(h.accept());
    expect(h.nominate().hidden).toBe(false);
    expect(h.nominate().textContent).toBe('Suggest as a future rule');
  });

  it('does not reveal rule nomination when the accept failed', async () => {
    const h = render(envelope(suggestion()), { onAccept: vi.fn(async () => { throw new Error('no'); }) });
    await click(h.accept());
    expect(h.nominate().hidden).toBe(true);
  });

  it('never nominates a rule as a side effect of accepting', async () => {
    const onNominateRule = ok();
    const h = render(envelope(suggestion()), { onAccept: ok(), onNominateRule });
    await click(h.accept());
    expect(onNominateRule).not.toHaveBeenCalled();

    // It takes a second, separate, deliberate click.
    await click(h.nominate());
    expect(onNominateRule).toHaveBeenCalledTimes(1);
    expect(onNominateRule).toHaveBeenCalledWith({ action: 'nominate_rule', suggestion_id: 'sug-1' });
  });

  it('says a nomination adds nothing to the checklist', async () => {
    const h = render(envelope(suggestion()), { onAccept: ok(), onNominateRule: ok() });
    await click(h.accept());
    await click(h.nominate());

    expect(h.status().textContent).toMatch(/nothing was added to the checklist/i);
    expect(h.nominate().textContent).toBe('Rule suggested');
    expect(h.nominate().disabled).toBe(true);
  });

  it('hides dismiss once the suggestion is accepted', async () => {
    const h = render(envelope(suggestion()), { onAccept: ok() });
    expect(h.dismissFold().hidden).toBe(false);
    await click(h.accept());
    expect(h.dismissFold().hidden).toBe(true);
  });
});

// ── Dismiss ───────────────────────────────────────────────────────────────────

describe('possible issues — dismiss', () => {
  it('offers exactly the three approved reasons, only inside the disclosure', () => {
    const h = render(envelope(suggestion()));
    const fold = h.dismissFold();
    expect(fold.tagName).toBe('details');
    expect(fold.open).toBe(false);

    expect(h.choices().map((c) => c.textContent)).toEqual([
      'Not an issue in this package',
      'Not useful',
      'Never suggest this reasoning again',
    ]);
    expect(h.choices().map((c) => c.dataset.reasonId)).toEqual(DISMISS_REASON_IDS);
  });

  it.each(DISMISS_REASONS.map((r) => [r.reason_id, r.label]))(
    'reports the "%s" reason to the handler',
    async (reason_id) => {
      const onDismiss = ok();
      const h = render(envelope(suggestion()), { onDismiss });
      const choice = h.choices().find((c) => c.dataset.reasonId === reason_id);
      await click(choice);

      expect(onDismiss).toHaveBeenCalledWith({
        action: 'dismiss', suggestion_id: 'sug-1', reason_id,
      });
      expect(h.card.classList.contains('is-dismissed')).toBe(true);
      expect(h.accept().hidden).toBe(true);
      expect(h.dismissFold().hidden).toBe(true);
    },
  );

  it('only claims permanent suppression for the reason that means it', async () => {
    const never = render(envelope(suggestion()), { onDismiss: ok() });
    await click(never.choices().find((c) => c.dataset.reasonId === 'never_suggest_reasoning'));
    expect(never.status().textContent).toMatch(/will not be suggested again/i);

    const local = render(envelope(suggestion()), { onDismiss: ok() });
    await click(local.choices().find((c) => c.dataset.reasonId === 'not_an_issue_here'));
    expect(local.status().textContent).toMatch(/^Dismissed: not an issue in this package\.$/);
    expect(local.status().textContent).not.toMatch(/again/i);
  });

  it('closes the disclosure after a reason is chosen', async () => {
    const h = render(envelope(suggestion()), { onDismiss: ok() });
    h.dismissFold().open = true;
    await click(h.choices()[0]);
    expect(h.dismissFold().open).toBe(false);
  });

  it('closes on Escape and returns focus to the toggle', async () => {
    const h = render(envelope(suggestion()));
    const toggle = oneByClass(h.card, 'ps-explore-dismiss-toggle');
    h.dismissFold().open = true;

    await h.dismissFold().dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(h.dismissFold().open).toBe(false);
    expect(toggle.focused).toBe(true);
  });

  it('ignores other keys', async () => {
    const h = render(envelope(suggestion()));
    h.dismissFold().open = true;
    await h.dismissFold().dispatchEvent({ type: 'keydown', key: 'a' });
    expect(h.dismissFold().open).toBe(true);
  });

  it('closes when focus leaves the disclosure entirely', async () => {
    const h = render(envelope(suggestion()));
    h.dismissFold().open = true;

    // Focus moving to a node inside the disclosure keeps it open.
    await h.dismissFold().dispatchEvent({ type: 'focusout', relatedTarget: h.choices()[1] });
    expect(h.dismissFold().open).toBe(true);

    // Focus moving outside closes it.
    await h.dismissFold().dispatchEvent({ type: 'focusout', relatedTarget: h.accept() });
    expect(h.dismissFold().open).toBe(false);
  });

  it('uses natively focusable controls throughout', () => {
    const h = render(envelope(suggestion()));
    // Every interactive affordance is a real button or a summary, so tab order
    // and activation come from the browser rather than from handlers here.
    for (const node of [h.accept(), h.nominate(), h.source(), ...h.choices()]) {
      expect(node.tagName).toBe('button');
      expect(node.type).toBe('button');
    }
    expect(oneByClass(h.card, 'ps-explore-dismiss-toggle').tagName).toBe('summary');
    expect(oneByClass(h.section, 'ps-explore-head').tagName).toBe('summary');
  });

  it('labels the disclosure with the suggestion it belongs to', () => {
    const h = render(envelope(suggestion()));
    const toggle = oneByClass(h.card, 'ps-explore-dismiss-toggle');
    expect(toggle.getAttribute('aria-label')).toBe('Dismiss: Possible address inconsistency');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    h.dismissFold().open = true;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});

// ── Callback outcomes ─────────────────────────────────────────────────────────

describe('possible issues — pending, success and failure', () => {
  it('shows pending while the handler is in flight, then the outcome', async () => {
    let release;
    const onAccept = vi.fn(() => new Promise((resolve) => { release = () => resolve(true); }));
    const h = render(envelope(suggestion()), { onAccept });

    const inFlight = click(h.accept());
    expect(h.status().textContent).toBe('Saving…');
    expect(h.accept().disabled).toBe(true);
    expect(h.accept().getAttribute('aria-busy')).toBe('true');
    expect(h.card.classList.contains('is-pending')).toBe(true);

    release();
    await inFlight;
    expect(h.card.classList.contains('is-pending')).toBe(false);
    expect(h.accept().hasAttribute('aria-busy')).toBe(false);
    expect(h.status().textContent).toMatch(/this package only/i);
  });

  it.each([
    ['the handler throws', vi.fn(async () => { throw new Error('boom'); })],
    ['the handler rejects', vi.fn(() => Promise.reject(new Error('boom')))],
    ['the handler returns false', vi.fn(async () => false)],
  ])('reports a failure when %s', async (_name, onAccept) => {
    const h = render(envelope(suggestion()), { onAccept });
    await click(h.accept());

    expect(h.status().textContent).toBe('That did not save. Try again.');
    expect(h.card.classList.contains('is-unresolved')).toBe(true);
    expect(h.card.classList.contains('is-reviewed')).toBe(false);
    // The control goes back to how it was, so it can be tried again.
    expect(h.accept().disabled).toBe(false);
    expect(h.accept().textContent).toBe('Accept');
    expect(h.nominate().hidden).toBe(true);
  });

  it('succeeds on a retry after a failure', async () => {
    const onAccept = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(true);
    const h = render(envelope(suggestion()), { onAccept });

    await click(h.accept());
    expect(h.status().textContent).toMatch(/did not save/i);

    await click(h.accept());
    expect(onAccept).toHaveBeenCalledTimes(2);
    expect(h.status().textContent).toMatch(/this package only/i);
    expect(h.accept().disabled).toBe(true);
    expect(h.card.classList.contains('is-unresolved')).toBe(false);
  });

  it('retries a dismissal after a failure too', async () => {
    const onDismiss = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(true);
    const h = render(envelope(suggestion()), { onDismiss });

    await click(h.choices()[0]);
    expect(h.status().textContent).toMatch(/nothing was suppressed/i);
    expect(h.choices()[0].disabled).toBe(false);

    await click(h.choices()[0]);
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(h.dismissFold().hidden).toBe(true);
  });

  it('drops a second click while a decision is still in flight', async () => {
    let release;
    const onAccept = vi.fn(() => new Promise((resolve) => { release = () => resolve(true); }));
    const h = render(envelope(suggestion()), { onAccept });

    const first = click(h.accept());
    const second = click(h.accept());
    release();
    await Promise.all([first, second]);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(h.status().textContent).toMatch(/this package only/i);
  });

  it('leaves the in-flight pending state alone when a click is dropped', async () => {
    // Regression: the dropped click used to clear the status line and the
    // pending class, so a decision still in flight looked like it had finished.
    let release;
    const onAccept = vi.fn(() => new Promise((resolve) => { release = () => resolve(true); }));
    const onDismiss = ok();
    const h = render(envelope(suggestion()), { onAccept, onDismiss });

    const accepting = click(h.accept());
    await click(h.choices()[0]);

    expect(h.status().textContent).toBe('Saving…');
    expect(h.card.classList.contains('is-pending')).toBe(true);
    expect(h.accept().disabled).toBe(true);
    expect(h.accept().getAttribute('aria-busy')).toBe('true');
    // The losing control was never disabled, so it stays usable.
    expect(h.choices()[0].disabled).toBe(false);

    release();
    await accepting;
    expect(h.card.classList.contains('is-pending')).toBe(false);
    expect(h.status().textContent).toMatch(/this package only/i);
  });

  it('does not let a dismissal race an accept on the same suggestion', async () => {
    let release;
    const onAccept = vi.fn(() => new Promise((resolve) => { release = () => resolve(true); }));
    const onDismiss = ok();
    const h = render(envelope(suggestion()), { onAccept, onDismiss });

    const accepting = click(h.accept());
    const dismissing = click(h.choices()[0]);
    release();
    await Promise.all([accepting, dismissing]);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('keeps the decisions on separate suggestions independent', async () => {
    let release;
    const onAccept = vi.fn((payload) => (payload.suggestion_id === 'a'
      ? new Promise((resolve) => { release = () => resolve(true); })
      : Promise.resolve(true)));
    const h = render(envelope(
      suggestion({ suggestion_id: 'a' }),
      suggestion({ suggestion_id: 'b' }),
    ), { onAccept });

    const slow = click(h.accept(0));
    await click(h.accept(1));
    // The second row resolved while the first was still pending.
    expect(h.status(1).textContent).toMatch(/this package only/i);
    expect(h.status(0).textContent).toBe('Saving…');

    release();
    await slow;
    expect(onAccept).toHaveBeenCalledTimes(2);
  });
});

// ── No handler wired ──────────────────────────────────────────────────────────

describe('possible issues — missing handlers never imply success', () => {
  it('says nothing was saved when accept has no handler', async () => {
    const h = render(envelope(suggestion()), {});
    await click(h.accept());

    expect(h.status().textContent).toBe('Not saved — decision handling is not connected yet.');
    expect(h.card.classList.contains('is-reviewed')).toBe(false);
    expect(h.accept().textContent).toBe('Accept');
    expect(h.accept().disabled).toBe(false);
    expect(h.nominate().hidden).toBe(true);
  });

  it('never claims a dismissal suppressed anything when no handler exists', async () => {
    const h = render(envelope(suggestion()), {});
    await click(h.choices().find((c) => c.dataset.reasonId === 'never_suggest_reasoning'));

    const message = h.status().textContent;
    expect(message).toMatch(/not saved/i);
    expect(message).toMatch(/nothing was suppressed/i);
    expect(message).not.toMatch(/will not be suggested again/i);
    // The row stays actionable — nothing was resolved.
    expect(h.card.classList.contains('is-dismissed')).toBe(false);
    expect(h.dismissFold().hidden).toBe(false);
  });

  it('never claims a rule was suggested when no handler exists', async () => {
    // Accept has to succeed first, so wire only that one.
    const h = render(envelope(suggestion()), { onAccept: ok() });
    await click(h.accept());
    await click(h.nominate());

    expect(h.status().textContent).toBe('Not sent — rule suggestions are not connected yet.');
    expect(h.nominate().textContent).toBe('Suggest as a future rule');
    expect(h.nominate().disabled).toBe(false);
  });

  it.each([null, undefined, 'not a function', 42, {}])(
    'treats a non-callable handler (%s) as absent rather than calling it',
    async (handler) => {
      const h = render(envelope(suggestion()), { onAccept: handler });
      await expect(click(h.accept())).resolves.toBeDefined();
      expect(h.status().textContent).toMatch(/not saved/i);
    },
  );
});

// ── Hostile text ──────────────────────────────────────────────────────────────

describe('possible issues — hostile text stays inert', () => {
  const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(1)> & "q" \'a\'';

  it('renders markup in every field as literal characters', () => {
    const h = render(envelope({
      suggestion_id: HOSTILE,
      title: HOSTILE,
      description: HOSTILE,
      evidence_label: HOSTILE,
      evidence_text: HOSTILE,
    }));

    // The strings are present, verbatim, as text.
    expect(oneByClass(h.card, 'ps-explore-title').textContent).toBe(HOSTILE);
    expect(oneByClass(h.card, 'ps-explore-desc').textContent).toBe(HOSTILE);
    expect(h.evidence().textContent).toBe(HOSTILE);

    // And no element was created for any of it.
    expect(byTag(h.section, 'script')).toHaveLength(0);
    expect(byTag(h.section, 'img')).toHaveLength(0);
    expect(byTag(h.section, 'iframe')).toHaveLength(0);
  });

  it('carries a hostile id to the handler as data, not as markup', async () => {
    const onAccept = ok();
    const h = render(envelope(suggestion({ suggestion_id: HOSTILE })), { onAccept });
    await click(h.accept());
    expect(onAccept).toHaveBeenCalledWith({ action: 'accept', suggestion_id: HOSTILE });
  });

  it('never writes HTML — the renderer has no innerHTML path', () => {
    const code = source('exploration.js');
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(source('exploration-model.js')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it('never reaches for storage', () => {
    for (const name of ['exploration.js', 'exploration-model.js']) {
      expect(source(name)).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it('makes no network call of its own', () => {
    expect(source('exploration.js')).not.toMatch(/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon/);
  });
});

// ── The model in isolation ────────────────────────────────────────────────────

describe('exploration model', () => {
  it('bounds oversized text instead of refusing it', () => {
    const { suggestions } = normalizeExploration(envelope(suggestion({
      title: 'T'.repeat(5000),
      description: 'D'.repeat(9000),
      evidence_text: 'E'.repeat(9000),
    })));
    expect(suggestions[0].title.length).toBe(300);
    expect(suggestions[0].description.length).toBe(2000);
    expect(suggestions[0].evidence_text.length).toBe(4000);
  });

  it('treats blank strings as absent', () => {
    const { visible } = normalizeExploration(envelope({ suggestion_id: '  ', title: 'x' }));
    expect(visible).toBe(false);
    const { suggestions } = normalizeExploration(envelope(suggestion({ description: '   ' })));
    expect(suggestions[0].description).toBeNull();
  });

  it('drops an evidence label with no excerpt behind it', () => {
    const { suggestions } = normalizeExploration(envelope(suggestion({ evidence_text: '  ' })));
    expect(suggestions[0].evidence_label).toBeNull();
    expect(suggestions[0].evidence_text).toBeNull();
  });

  it('skips an absent handler without calling anything', async () => {
    const gate = createDecisionGate();
    expect(await runDecision(gate, undefined, {})).toEqual({ outcome: OUTCOMES.UNHANDLED });
    expect(gate.pending).toBe(false);
  });

  it('frees the gate after a failure so a retry can run', async () => {
    const gate = createDecisionGate();
    const failing = vi.fn(async () => { throw new Error('x'); });
    expect((await runDecision(gate, failing, {})).outcome).toBe(OUTCOMES.FAILURE);
    expect(gate.pending).toBe(false);
    expect((await runDecision(gate, ok(), {})).outcome).toBe(OUTCOMES.SUCCESS);
  });

  it('never produces a reassuring message for a failed or unhandled decision', () => {
    for (const action of Object.values(ACTIONS)) {
      for (const outcome of [OUTCOMES.FAILURE, OUTCOMES.UNHANDLED]) {
        const message = decisionMessage(action, outcome);
        expect(message).toMatch(/not saved|did not save|not sent|did not send/i);
        expect(message).not.toMatch(/\bnoted\b|\bdismissed\b|\bsuccess/i);
      }
    }
  });
});

// ── Isolation from the approved checklist result ──────────────────────────────

describe('possible issues cannot touch the official result', () => {
  const profile = getSelectedScanProfile('daca_renewal');
  const SCAN = { filename: 'daca-renewal-package.pdf', scanned_at: '2026-09-02T12:00:00Z' };

  function composed() {
    const observations = {
      client_observed: {
        name: 'Jane Doe', a_number: 'A123456789', ead_expires: '01/15/2027',
        date_of_birth: null, ssn_last4: '4321', uscis_account_number: null,
        phone: null, email: null, address: null,
      },
      package_items: profile.package_items.map((item) => ({
        item_id: item.item_id, status: 'clear', locations: [], evidence: null, reason: null,
      })),
      rule_results: profile.rules.map((rule) => ({
        rule_id: rule.rule_id, status: 'clear', summary: null, locations: [],
        evidence: null, reason: null, not_checked_item_ids: null,
      })),
    };
    const result = validateAndComposeObservations(profile, observations, SCAN);
    if (!result.ok) throw new Error('fixture did not compose');
    return {
      schema_version: profile.contract.result_schema_version,
      scan_profile: profile.profile_id,
      profile_version: profile.profile_version,
      profile_label: profile.label,
      scan: result.scan,
      report_state: result.report_state,
      primary_report_language: result.primary_report_language,
      attention_count: result.attention_count,
      attention_items: result.attention_items,
      unsuppressed_not_checked_count: result.unsuppressed_not_checked_count,
      client_observed: result.client_observed,
      package_items: result.package_items,
      rule_results: result.rule_results,
    };
  }

  it('leaves the report model untouched when suggestions are present', () => {
    const result = composed();
    const withSuggestions = { ...result, exploration: envelope(suggestion(), suggestion({ suggestion_id: 'b' })) };

    const clean = buildReportModel(result);
    const alongside = buildReportModel(withSuggestions);

    expect(alongside.attention_count).toBe(clean.attention_count);
    expect(alongside.attention_count).toBe(0);
    expect(alongside.report_state).toBe('no_issues_found');
    expect(alongside.primary_report_language).toBe('No issues found');
    expect(alongside.needs_attention).toEqual(clean.needs_attention);
    expect(alongside.not_checked).toEqual(clean.not_checked);
    // buildReportModel has no concept of a suggestion at all.
    expect(JSON.stringify(alongside)).not.toContain('sug-1');
  });

  it('has no suggestion vocabulary in the checklist model or its output', () => {
    const model = buildReportModel(composed());
    expect(Object.keys(model)).not.toContain('exploration');
    expect(Object.keys(model)).not.toContain('suggestions');
    expect(source('report-model.js')).not.toMatch(/exploration|suggestion/i);
  });
});

// ── Placement inside the report ───────────────────────────────────────────────

describe('possible issues placement', () => {
  const model = (over = {}) => ({
    scan: { filename: 'p.pdf', scanned_at: null },
    scan_type_label: 'DACA renewal',
    report_state: 'no_issues_found',
    primary_report_language: 'No issues found',
    attention_count: 0,
    client: { primary: [], secondary: [] },
    needs_attention: [],
    included: [],
    groups: [{ form: 'I-821D', items: [], cleared: 0, total: 0, outstanding: [] }],
    not_checked: [],
    ...over,
  });

  const notice = () => ({
    kind: 'rule', id: 'PS-1', status: 'not_checked', severity: null,
    headline: 'Unreadable.', expected: null, where: null, reason: null,
    evidence: null, blocked: [],
  });

  // renderReport needs a couple of browser globals its animation path touches.
  function drawReport(reportModel, options) {
    const doc = fakeDocument();
    const mount = doc.createElement('div');
    const priorDoc = globalThis.document;
    const priorMatch = globalThis.matchMedia;
    const priorRaf = globalThis.requestAnimationFrame;
    globalThis.document = doc;
    globalThis.matchMedia = () => ({ matches: true });
    globalThis.requestAnimationFrame = (fn) => fn();
    try {
      renderReport(reportModel, mount, options);
    } finally {
      globalThis.document = priorDoc;
      globalThis.matchMedia = priorMatch;
      globalThis.requestAnimationFrame = priorRaf;
    }
    return mount;
  }

  const explorationOptions = (input) => ({
    exploration: input,
    renderExploration: (data, opts) => renderExploration(data, { ...opts, doc: fakeDocument() }),
  });

  it('draws nothing when the report carries no suggestion envelope', () => {
    const mount = drawReport(model(), explorationOptions(undefined));
    expect(byClass(mount, 'ps-explore')).toHaveLength(0);
    // And nothing at all when the seam itself is absent.
    expect(byClass(drawReport(model(), {}), 'ps-explore')).toHaveLength(0);
  });

  it('sits after "Not checked" and before the standing reminder', () => {
    const mount = drawReport(model({ not_checked: [notice()] }), explorationOptions(envelope(suggestion())));
    const classes = mount.childNodes.map((n) => n.className);

    const notCheckedAt = classes.findIndex((c, i) => c === 'psr-block'
      && textOf(mount.childNodes[i]).includes('Not checked'));
    const exploreAt = classes.findIndex((c) => c === 'ps-explore');
    const noteAt = classes.indexOf('psr-standing-note');

    expect(notCheckedAt).toBeGreaterThan(-1);
    expect(exploreAt).toBeGreaterThan(notCheckedAt);
    expect(noteAt).toBeGreaterThan(exploreAt);
  });

  it('follows the check groups when there is no "Not checked" section', () => {
    const mount = drawReport(model(), explorationOptions(envelope(suggestion())));
    const classes = mount.childNodes.map((n) => n.className);

    expect(classes.some((c) => c === 'psr-block')).toBe(true);
    const lastBlockAt = classes.lastIndexOf('psr-block');
    const exploreAt = classes.indexOf('ps-explore');
    expect(exploreAt).toBeGreaterThan(lastBlockAt);
    expect(classes.indexOf('psr-standing-note')).toBeGreaterThan(exploreAt);
  });

  it('keeps the standing staff-review reminder last either way', () => {
    const mount = drawReport(model(), explorationOptions(envelope(suggestion())));
    const last = mount.childNodes[mount.childNodes.length - 1];
    expect(last.className).toBe('psr-standing-note');
    expect(last.textContent).toBe('Staff review is still required before filing.');
  });
});

// ── Source-level seam guarantees ──────────────────────────────────────────────

const pageSources = import.meta.glob('../../pages/proof-scan/*.js', {
  query: '?raw', import: 'default', eager: true,
});
const source = (name) => pageSources[`../../pages/proof-scan/${name}`]
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((line) => line.replace(/(^|\s)\/\/.*$/, '')).join('\n');
