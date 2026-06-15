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

  const STATUS_BADGE = { intake: 'normal', active: 'active', on_hold: 'pending', closed: 'closed' };

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
      summary.style.borderLeftColor = 'var(--color-success)';
      summary.innerHTML = `
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" style="width:20px;height:20px;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>
          <div>
            <div style="font-weight:600;color:var(--color-success)">No matches found</div>
            <div class="text-sm text-muted">No existing clients or opposing parties matched these names.</div>
          </div>
        </div>`;
    } else {
      summary.style.borderLeftColor = 'var(--color-warning, #f59e0b)';
      summary.innerHTML = `
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-warning,#f59e0b)" stroke-width="2" style="width:20px;height:20px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div>
            <div style="font-weight:600">${total_found} match${total_found !== 1 ? 'es' : ''} found</div>
            <div class="text-sm text-muted">Review each match carefully and record your decision below.</div>
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
    matchesBody.innerHTML = matches.map(m => {
      const isClient = m.type === 'existing_client';
      const badge = isClient
        ? `<span class="badge badge--urgent">Existing Client</span>`
        : `<span class="badge badge--pending">Opposing Party</span>`;

      const matterRows = m.type === 'existing_client'
        ? (m.matters || []).map(mt =>
            `<div class="text-sm" style="margin-top:var(--space-1)">
               <span class="badge badge--${STATUS_BADGE[mt.status] || 'normal'}" style="font-size:11px">${Utils.titleCase(mt.status)}</span>
               ${CASE_LABELS[mt.case_type] || Utils.titleCase(mt.case_type)}
               ${mt.case_number ? `· <span class="text-muted">${Utils.esc(mt.case_number)}</span>` : ''}
             </div>`).join('')
        : m.matter ? `<div class="text-sm" style="margin-top:var(--space-1)">
               <span class="badge badge--${STATUS_BADGE[m.matter.status] || 'normal'}" style="font-size:11px">${Utils.titleCase(m.matter.status)}</span>
               ${CASE_LABELS[m.matter.case_type] || Utils.titleCase(m.matter.case_type)}
               ${m.matter.case_number ? `· <span class="text-muted">${Utils.esc(m.matter.case_number)}</span>` : ''}
               ${m.related_client ? `<div class="text-muted" style="margin-top:2px">Our client: ${Utils.esc(m.related_client)}</div>` : ''}
             </div>` : '';

      return `
        <div style="display:flex;gap:var(--space-4);padding:var(--space-4);border:1px solid ${isClient ? '#fca5a5' : 'var(--color-border)'};border-radius:var(--radius-md);margin-bottom:var(--space-3);background:${isClient ? 'var(--color-danger-bg)' : 'transparent'}">
          <div style="width:36px;height:36px;border-radius:50%;background:${isClient ? 'var(--color-danger)' : 'var(--color-warning,#f59e0b)'};color:#fff;display:grid;place-items:center;font-size:var(--text-xs);font-weight:600;flex-shrink:0">
            ${Utils.esc(m.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2))}
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
              <span style="font-weight:600">${Utils.esc(m.name)}</span>
              ${badge}
            </div>
            <div class="text-sm text-muted" style="margin-top:2px">
              Found in: ${Utils.esc(m.matched_in)} · Searched for: <em>${Utils.esc(m.searched_for)}</em>
            </div>
            ${m.email ? `<div class="text-sm text-muted">${Utils.esc(m.email)}</div>` : ''}
            ${matterRows}
          </div>
        </div>`;
    }).join('');

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
        body.innerHTML = `<div style="padding:var(--space-8);text-align:center;color:var(--color-text-muted)">No checks recorded yet.</div>`;
        return;
      }

      const OUTCOME_BADGE = {
        clear:         `<span class="badge badge--active">Clear</span>`,
        conflict:      `<span class="badge badge--closed">Conflict</span>`,
        review_needed: `<span class="badge badge--pending">Review Needed</span>`,
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
              <td>${r.outcome ? OUTCOME_BADGE[r.outcome] || Utils.esc(r.outcome) : '<span class="text-muted">—</span>'}</td>
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
