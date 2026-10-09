// email.js: optional notification, off by default (D-61). Shows what WOULD be
// sent: the official stage result and a report link, nothing else. Possible
// issues never appear in it (D-36, D-59). Nothing is ever sent.
import { el, t } from '/v2-lab/ui.js';

let enabled = false; // off by default; remembered only until reload

export function renderEmail(mount, { caseLabel, stageLabel, phrase }) {
  mount.textContent = '';
  const box = el('div', 'v2-email');

  const toggle = el('label', 'v2-check v2-email-toggle');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = enabled;
  toggle.append(input, el('span', null, t('email.toggle')));
  box.appendChild(toggle);
  box.appendChild(el('p', 'v2-hint', t('email.hint')));

  const preview = el('div', 'v2-email-preview');
  const line = (k, v) => {
    const r = el('div', 'psr-nf');
    r.appendChild(el('span', 'psr-nf-k', k));
    r.appendChild(el('span', 'psr-nf-v', v));
    return r;
  };
  const bar = el('div', 'v2-email-bar');
  bar.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg>');
  bar.appendChild(el('span', 'v2-email-flag', t('email.not_sent')));
  preview.appendChild(bar);
  preview.appendChild(line(t('email.to'), t('email.to_value')));
  preview.appendChild(line(t('email.subject'), t('email.subject_value', { case_type: caseLabel, stage: stageLabel, phrase })));
  const body = el('div', 'v2-email-body');
  body.appendChild(el('p', null, t('email.body_result', { stage: stageLabel, phrase })));
  body.appendChild(el('p', null, t('state.reminder')));
  body.appendChild(el('p', null, t('email.body_link')));
  body.appendChild(el('p', 'v2-email-link', t('email.link_value')));
  preview.appendChild(body);
  preview.hidden = !enabled;
  box.appendChild(preview);

  input.addEventListener('change', () => { enabled = input.checked; preview.hidden = !enabled; });
  mount.appendChild(box);
}
