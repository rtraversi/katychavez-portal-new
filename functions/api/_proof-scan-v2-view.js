// _proof-scan-v2-view.js: a stored stage result with the staff clears applied. NOT a route.
//
// Pure. D-132 (Max 2026-10-16): staff clear any needs-attention, not-checked,
// needs-info or please-confirm item with one click, no reason. D-139: marking
// the stage reviewed clears every item. D-143: a clear shows just "Cleared".
// The server stores the clears and decides what they mean (D-18): the result
// line ("3 of 3 cleared, no item needs attention", Max's wording), every count
// on the page, the summary strip, each form's check list and the Evidence
// Match rows inside "Whole package" (D-140, D-145). The page draws this and
// counts nothing itself.
//
// The stored result is never changed: the scan's own findings stay as they
// were found. Older results (schema 2, before the merged list of D-135) are
// shown item by item as they were stored.

import { reportStateLanguage } from './proof-scan-contract.js';
import { FIELD_LABELS, ROLE_LABELS } from './_proof-scan-v2-common.js';
import { docWord } from './_proof-scan-v2-merge.js';

const formKey = (f) => String(f ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const roleWord = (r) => (ROLE_LABELS[r] || '').toLowerCase();
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// The stable key of each clearable item that is not itself an attention item.
export const confirmKey = (c) => (String(c.rule_id).startsWith('confirm:') ? c.rule_id : `pc:${c.rule_id}`);
export const notCheckedKey = (ruleId) => `nc:${ruleId}`;

function formOrder(result) {
  const order = [];
  for (const i of result?.package_items || []) if (i.form && !order.includes(i.form)) order.push(i.form);
  for (const f of result?.forms_found || []) if (f.form && !order.includes(f.form)) order.push(f.form);
  return order;
}

// Evidence Match (D-140): one check row per document, in "Whole package".
function evidenceRows(result, attention, cleared) {
  const groups = new Map();
  for (const r of result?.evidence_matches || []) {
    // One row per document: a marriage certificate is one document even though
    // each spouse's own facts on it are checked against their own forms.
    const k = `${r.evidence}|${r.source}|${r.evidence_where || ''}`;
    if (!groups.has(k)) groups.set(k, { evidence: r.evidence, owners: [], source: r.source, rows: [] });
    const g = groups.get(k);
    for (const o of r.owner_roles || []) if (!g.owners.includes(o)) g.owners.push(o);
    g.rows.push(r);
  }
  return [...groups.values()].map((g) => {
    const ok = g.rows.every((r) => r.ok || r.gentle);
    const owners = g.owners.map(roleWord).filter(Boolean);
    const doc = `The ${owners.length ? `${joinAnd(owners)}'s ` : ''}${docWord(g.evidence)}${g.source === 'package' ? ' in the package' : ''}`;
    const forms = [...new Set(g.rows.map((r) => r.form))];
    const fields = [...new Set(g.rows.map((r) => FIELD_LABELS[r.field] || r.field))];
    const related = attention.filter((a) => a.kind === 'fact' && (a.source_docs || []).includes(g.evidence)
      && (!g.owners.length || g.owners.includes(a.person_role))).map((a) => a.key);
    const isCleared = !ok && related.length > 0 && related.every((k) => cleared.has(k));
    return {
      kind: 'evidence', key: null, rule_id: 'PS-304', status: ok ? 'clear' : 'needs_attention', cleared: isCleared, related,
      title: ok ? `${doc} matches the ${joinAnd(forms)} (${joinAnd(fields)}).`
        : isCleared ? `${doc} does not match the forms. Its differences were cleared in Needs attention.`
          : `${doc} does not match the forms. The differences are in Needs attention.`,
      where: null,
    };
  });
}

export function reportView(result, clearRows = [], { possibleIssues = [] } = {}) {
  const cleared = new Map(clearRows.map((c) => [c.item_key, c.via]));
  const isCleared = (k) => Boolean(k) && cleared.has(k);
  const checks = result?.checks || [];
  const byRule = new Map(checks.map((c) => [c.rule_id, c]));
  const whereOf = (c) => [c?.form, c?.where, ...(c?.locations || [])].filter(Boolean).join(' · ') || null;

  const attention = (result?.attention || []).map((a) => {
    const c = a.kind === 'check' ? byRule.get(a.rule_id) : null;
    return {
      ...a,
      ...(c ? { expected: c.expected || null, where: whereOf(c), reason: c.reason || c.summary || null } : {}),
      cleared: isCleared(a.key),
    };
  });
  const notChecked = [
    ...checks.filter((c) => c.status === 'not_checked').map((c) => ({
      key: notCheckedKey(c.rule_id), rule_id: c.rule_id, title: c.title, where: whereOf(c), reason: c.reason || null,
    })),
    ...(result?.package_items || []).filter((i) => i.status === 'unreadable').map((i) => ({
      key: notCheckedKey(`item:${i.item_id}`), rule_id: `item:${i.item_id}`,
      title: `${i.form}${i.instance ? ` (${i.instance})` : ''} could not be read.`, where: (i.locations || []).join(' · ') || null, reason: null,
    })),
  ].map((x) => ({ ...x, cleared: isCleared(x.key) }));
  const confirm = checks.filter((c) => c.status === 'please_confirm')
    .map((c) => ({ key: confirmKey(c), rule_id: c.rule_id, title: c.title, cleared: isCleared(confirmKey(c)) }));
  const needsInfo = [
    ...(result?.notes || []).filter((n) => n.kind === 'needs_info')
      .map((n) => ({ key: `ni:${n.person_role}:${n.field}`, title: n.title })),
    ...checks.filter((c) => c.status === 'needs_info').map((c) => ({ key: `ni:rule:${c.rule_id}`, title: c.title, form: c.form || null })),
  ].map((x) => ({ ...x, cleared: isCleared(x.key) }));

  // Each form's check list. A gentle confirm never sits in a form's list (it
  // made forms look failed, Max 10-16); a cleared item reads as cleared there too.
  const order = formOrder(result);
  const listed = checks.filter((c) => !c.counted_by_items && c.status !== 'please_confirm');
  const byForm = new Map();
  for (const c of listed) {
    const k = c.form || '';
    if (!byForm.has(k)) byForm.set(k, []);
    const key = c.status === 'needs_attention' ? `rule:${c.rule_id}` : c.status === 'not_checked' ? notCheckedKey(c.rule_id) : null;
    byForm.get(k).push({ kind: 'check', key, rule_id: c.rule_id, status: c.status, title: c.title, where: c.where || null, cleared: isCleared(key), consistency: Boolean(c.consistency) });
  }
  const ev = evidenceRows(result, attention, cleared);
  if (ev.length) {
    if (!byForm.has('')) byForm.set('', []);
    byForm.get('').push(...ev);
  }
  const rank = (form) => {
    if (!form) return order.length + 1;
    const i = order.findIndex((f) => formKey(f) === formKey(form));
    return i < 0 ? order.length : i;
  };
  const groups = [...byForm.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([form, rows]) => {
    const passed = rows.filter((r) => r.status === 'clear' || r.cleared).length;
    const soft = rows.filter((r) => r.status === 'needs_info' && !r.cleared).length;
    const clean = passed + soft === rows.length;
    return {
      form: form || null, rows, passed, total: rows.length, clean,
      evidence_from: rows.findIndex((r) => r.kind === 'evidence'),
      outstanding: rows.filter((r) => !(r.status === 'clear' || r.cleared || r.status === 'needs_info')).map((r) => ({ status: r.status, title: r.title })),
    };
  });

  // The result line (Max 2026-10-16: "it should say 3 of 3 cleared, no item
  // needs attention"). Needs-attention and not-checked items keep a stage from
  // being done; confirms and needs-info never did.
  const counted = [...attention, ...notChecked];
  const openAttention = attention.filter((a) => !a.cleared).length;
  const openNotChecked = notChecked.filter((x) => !x.cleared).length;
  const clearedCounted = counted.filter((x) => x.cleared).length;
  const note = clearedCounted ? `${clearedCounted} of ${counted.length} cleared` : null;
  let line;
  let state;
  if (openAttention) {
    state = 'items_need_attention';
    line = { text: reportStateLanguage(state, openAttention), tone: 'attention', note };
  } else if (openNotChecked) {
    state = 'review_incomplete';
    line = { text: reportStateLanguage(state), tone: 'incomplete', note };
  } else if (clearedCounted) {
    state = 'no_issues_found';
    line = { text: `${clearedCounted} of ${counted.length} cleared, no item needs attention`, tone: 'clear', note: null };
  } else {
    state = result?.report_state || 'no_issues_found';
    line = { text: result?.primary_report_language || reportStateLanguage(state, 0), tone: state === 'items_need_attention' ? 'attention' : state === 'review_incomplete' ? 'incomplete' : 'clear', note: null };
  }

  // The summary strip (approved 10-16): what is left to fix and to confirm, the
  // possible issues, and a bar that fills as items clear.
  const all = [...attention, ...notChecked, ...confirm, ...needsInfo];
  const done = all.filter((x) => x.cleared).length;
  const strip = {
    fix: openAttention,
    confirm: confirm.filter((x) => !x.cleared).length,
    possible: possibleIssues.filter((p) => p.status === 'open').length,
    total: all.length,
    cleared: done,
    all_cleared: all.length > 0 && done === all.length,
  };

  return {
    state, line, strip, attention, not_checked: notChecked, confirm, needs_info: needsInfo, groups,
    clearable: all.map((x) => x.key),
    merged: (result?.schema_version || 0) >= 3,
  };
}
