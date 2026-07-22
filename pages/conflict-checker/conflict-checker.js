// Conflict Checker page logic.
'use strict';

(async function ConflictCheckerPage() {

  const CASE_LABELS = {
    divorce: 'Divorce', sapcr_original: 'SAPCR – Original', sapcr_modification: 'SAPCR – Modification',
    enforcement: 'Enforcement', custody: 'Custody', custody_modification: 'Custody Mod.',
    child_support: 'Child Support', child_support_modification: 'Child Support Mod.',
    paternity: 'Paternity', prenuptial_agreement: 'Prenup', postnuptial_agreement: 'Postnup',
    protective_order: 'Protective Order', adoption: 'Adoption', other: 'Other',
  };

  // status → Docket tag kind (warn|ok|mut|acc|crit)
  const STATUS_TAG = { intake: 'mut', active: 'ok', on_hold: 'warn', closed: 'mut' };

  let currentCheckId  = null;
  let extraNameCount  = 0;

  // ── Extra names ──────────────────────────────────────────────────────────────

  document.getElementById('cc-add-name').addEventListener('click', () => {
    extraNameCount++;
    const idx  = extraNameCount;
    const row  = document.createElement('div');
    row.id     = `cc-extra-${idx}`;
    row.className = 'field-row';
    row.style.marginBottom = 'var(--space-4)';
    row.innerHTML = `
      <div class="field" style="flex:1">
        <label>Additional name — first</label>
        <input type="text" class="cc-extra-first" placeholder="First name" autocomplete="off">
      </div>
      <div class="field" style="flex:1">
        <label>Last name</label>
        <input type="text" class="cc-extra-last" placeholder="Last name" autocomplete="off">
      </div>
      <button type="button" class="btn btn--ghost btn--sm cc-remove-extra" data-idx="${idx}"
        style="align-self:flex-end;margin-bottom:4px" title="Remove">×</button>`;
    document.getElementById('cc-extra-names').appendChild(row);
    row.querySelector('.cc-remove-extra').addEventListener('click', () => row.remove());
  });

  // ── Form submit (run check) ──────────────────────────────────────────────────

  document.getElementById('cc-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl  = document.getElementById('cc-form-error');
    const runBtn = document.getElementById('cc-run-btn');

    errEl.classList.add('hidden');
    currentCheckId = null;

    const clientFirst = document.getElementById('cc-client-first').value.trim();
    const clientLast  = document.getElementById('cc-client-last').value.trim();
    if (!clientFirst && !clientLast) {
      errEl.textContent = 'Enter at least a first or last name for the prospective client.';
      errEl.classList.remove('hidden');
      return;
    }

    const oppFirst = document.getElementById('cc-opp-first').value.trim();
    const oppLast  = document.getElementById('cc-opp-last').value.trim();

    const additionalNames = [];
    document.querySelectorAll('#cc-extra-names .field-row').forEach(row => {
      const f = row.querySelector('.cc-extra-first')?.value.trim();
      const l = row.querySelector('.cc-extra-last')?.value.trim();
      if (f || l) additionalNames.push(`${f} ${l}`.trim());
    });

    Utils.setLoading(runBtn, true);

    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/run-conflict-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          prospective_client_name: `${clientFirst} ${clientLast}`.trim(),
          opposing_party_name:     (oppFirst || oppLast) ? `${oppFirst} ${oppLast}`.trim() : null,
          additional_names:        additionalNames,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check failed.');

      currentCheckId = data.check_id;
      renderResults(data);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      Utils.setLoading(runBtn, false);
    }
  });

  // ── Render results ───────────────────────────────────────────────────────────

  function renderResults({ matches, total_found }) {
    // Reset decision section
    document.querySelectorAll('input[name="cc-outcome"]').forEach(r => r.checked = false);
    document.getElementById('cc-notes').value = '';
    document.getElementById('cc-decision-error').classList.add('hidden');
    document.getElementById('cc-saved-msg').classList.add('hidden');

    const section = document.getElementById('cc-results-section');
    section.classList.remove('hidden');

    // Summary banner
    const summary = document.getElementById('cc-summary');
    if (total_found === 0) {
      summary.innerHTML = `
        <div class="dk-empty" style="display:flex;align-items:center;gap:12px">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" style="width:22px;height:22px;flex-shrink:0"><path d="M12 2 3 7v6c0 5 3.8 8.3 9 9 5.2-.7 9-4 9-9V7z"/><polyline points="9 12 11 14 15 10"/></svg>
          <div>
            <div style="font-family:var(--font-serif);font-size:16px;font-weight:600;color:var(--ink)">No conflicts found</div>
            <div style="color:var(--ink-soft);margin-top:2px">No existing clients or opposing parties matched these names.</div>
          </div>
        </div>`;
    } else {
      summary.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;background:var(--surface);border-top:2px solid var(--color-warning);border-radius:0 0 var(--r-card) var(--r-card);box-shadow:var(--card-shadow)">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2" style="width:22px;height:22px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div>
            <div style="font-family:var(--font-serif);font-size:16px;font-weight:600;color:var(--ink)">${total_found} match${total_found !== 1 ? 'es' : ''} found</div>
            <div style="color:var(--ink-soft);margin-top:2px">Review each match carefully and record your decision below.</div>
          </div>
        </div>`;
    }

    // Match cards
    const matchesCard = document.getElementById('cc-matches-card');
    const matchesBody = document.getElementById('cc-matches-body');

    if (!total_found) {
      matchesCard.classList.add('hidden');
      return;
    }

    matchesCard.classList.remove('hidden');
    const PRIOR_OUTCOME_LABEL = {
      clear:         'previously marked “No conflict”',
      conflict:      'previously marked “Conflict”',
      review_needed: 'previously marked “Review needed”',
    };

    // One matter rendered as a register meta line (status tag + case type + number)
    const matterMeta = (mt, extra = '') =>
      `<div class="dk-reg-meta">${DK.tag(Utils.titleCase(mt.status), STATUS_TAG[mt.status] || 'mut')}<span>${Utils.esc(CASE_LABELS[mt.case_type] || Utils.titleCase(mt.case_type))}</span>${mt.case_number ? `<span class="sep">·</span><span>${Utils.esc(mt.case_number)}</span>` : ''}${extra}</div>`;

    matchesBody.innerHTML = '<div class="dk-register">' + matches.map(m => {
      // ── Prior conflict-check inquiry ──────────────────────────────────────
      // Surfaced prominently: a past inquirer (even one marked "clear") can
      // conflict us out of the party now adverse to them (Rule 1.18).
      if (m.type === 'prior_inquiry') {
        const when    = Utils.formatDate(m.checked_at?.slice(0, 10));
        const outcome = m.prior_outcome ? PRIOR_OUTCOME_LABEL[m.prior_outcome] || Utils.esc(m.prior_outcome) : 'no decision recorded';
        return `
          <div class="dk-reg-row" style="align-items:start">
            <div style="min-width:0">
              <div class="dk-reg-title"><span>${Utils.esc(m.name)}</span>${DK.tag('Prior Inquiry', 'crit')}</div>
              <div class="dk-reg-meta">
                <span>Contacted the firm <strong>${when}</strong></span>${m.checked_by_name ? `<span class="sep">·</span><span>checked by ${Utils.esc(m.checked_by_name)}</span>` : ''}<span class="sep">·</span><span>${outcome}</span>
              </div>
              <div class="dk-reg-meta">
                <span>Matched on ${Utils.esc(m.matched_field)}: <em>${Utils.esc(m.matched_value)}</em></span><span class="sep">·</span><span>Searched: <em>${Utils.esc(m.searched_for)}</em></span>
              </div>
              ${m.opposing_party ? `<div class="dk-reg-meta"><span>That inquiry’s opposing party: ${Utils.esc(m.opposing_party)}</span></div>` : ''}
              ${m.notes ? `<div class="dk-reg-meta"><span>Notes: ${Utils.esc(m.notes)}</span></div>` : ''}
              <div class="dk-reg-meta"><span class="danger">A prior consultation may conflict the firm out of the adverse party — confirm before proceeding.</span></div>
            </div>
          </div>`;
      }

      const isClient = m.type === 'existing_client';
      const sev = isClient ? DK.tag('Existing Client', 'crit') : DK.tag('Opposing Party', 'warn');

      const matterRows = isClient
        ? (m.matters || []).map(mt => matterMeta(mt)).join('')
        : m.matter
          ? matterMeta(m.matter, m.related_client ? `<span class="sep">·</span><span>Our client: ${Utils.esc(m.related_client)}</span>` : '')
          : '';

      return `
        <div class="dk-reg-row" style="align-items:start">
          <div style="min-width:0">
            <div class="dk-reg-title"><span>${Utils.esc(m.name)}</span>${sev}</div>
            <div class="dk-reg-meta">
              <span>Found in: ${Utils.esc(m.matched_in)}</span><span class="sep">·</span><span>Searched: <em>${Utils.esc(m.searched_for)}</em></span>
            </div>
            ${m.email ? `<div class="dk-reg-meta"><span>${Utils.esc(m.email)}</span></div>` : ''}
            ${matterRows}
          </div>
        </div>`;
    }).join('') + '</div>';

    // Scroll to results
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Save decision ────────────────────────────────────────────────────────────

  document.getElementById('cc-save-btn').addEventListener('click', async () => {
    const errEl    = document.getElementById('cc-decision-error');
    const savedMsg = document.getElementById('cc-saved-msg');
    const saveBtn  = document.getElementById('cc-save-btn');

    errEl.classList.add('hidden');
    savedMsg.classList.add('hidden');

    const outcome = document.querySelector('input[name="cc-outcome"]:checked')?.value;
    if (!outcome) {
      errEl.textContent = 'Please select an outcome before saving.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!currentCheckId) {
      errEl.textContent = 'Run a check first before saving a decision.';
      errEl.classList.remove('hidden');
      return;
    }

    Utils.setLoading(saveBtn, true);
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/run-conflict-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          save:     true,
          check_id: currentCheckId,
          outcome,
          notes:    document.getElementById('cc-notes').value.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      savedMsg.classList.remove('hidden');
      loadHistory();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      Utils.setLoading(saveBtn, false);
    }
  });

  // ── History ──────────────────────────────────────────────────────────────────

  async function loadHistory() {
    const body = document.getElementById('cc-history-body');
    try {
      const { data, error } = await db
        .from('conflict_checks')
        .select('id, checked_at, prospective_client_name, opposing_party_name, outcome, notes, checked_by, users:checked_by(first_name, last_name)')
        .order('checked_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      if (!data?.length) {
        body.innerHTML = `<div class="dk-empty">No checks recorded yet.</div>`;
        return;
      }

      const OUTCOME_TAG = {
        clear:         DK.tag('Clear', 'ok'),
        conflict:      DK.tag('Conflict', 'crit'),
        review_needed: DK.tag('Review Needed', 'warn'),
      };

      body.innerHTML = `
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th>Date</th><th>Prospective Client</th><th>Opposing Party</th>
              <th>Outcome</th><th>Checked By</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(r => `<tr>
              <td class="text-sm text-muted">${Utils.formatDate(r.checked_at?.slice(0,10))}</td>
              <td style="font-weight:500">${Utils.esc(r.prospective_client_name)}</td>
              <td class="text-muted">${Utils.esc(r.opposing_party_name || '—')}</td>
              <td>${r.outcome ? OUTCOME_TAG[r.outcome] || Utils.esc(r.outcome) : '<span class="text-muted">—</span>'}</td>
              <td class="text-muted">${r.users ? Utils.esc(Utils.fullName(r.users)) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`;
    } catch (err) {
      body.innerHTML = `<div style="padding:var(--space-4);color:var(--color-danger)">${Utils.esc(err.message)}</div>`;
    }
  }

  document.getElementById('cc-refresh-history').addEventListener('click', loadHistory);

  // ── Init ──────────────────────────────────────────────────────────────────────
  await loadHistory();

})();
