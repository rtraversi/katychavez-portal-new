// Bank Accounts: read a Quicken QIF export. Pure functions, no DOM. The page parses the
// file in the browser and sends the result to POST /api/bank-feeds (action 'import'),
// which decides what to add and what to match. Tests import this directly.
//
// QIF is line-based. A "!" line starts a section, each record is a run of lines whose
// first character says what the line holds, and "^" ends the record:
//
//   !Type:Bank              transactions (also CCard, Cash, Oth A, Oth L)
//   D10/ 1'26               date (Quicken writes 2000+ years as M/D'YY)
//   T-2,000.00              amount (U is the same thing, older spelling)
//   PTrans Chase Credit…    payee
//   MMemo                   memo
//   LPersonal               category; [Name] is a transfer; /Class is dropped
//   SPayroll  E…  $-41.23   one line of a split: category, memo, amount (repeats)
//   ^
//   !Type:Cat               the category list: N name, I = income, E = expense
//   !Account                account header: N name, T type; the transactions that
//                           follow belong to it (multi-account exports)
//
// Everything else (investments, memorized payees, classes, prices) is skipped.

import { normalizeCategoryName } from './categorize.js';

const TXN_TYPES = new Set(['bank', 'ccard', 'cash', 'oth a', 'oth l']);

// Bytes → text. Quicken for Windows writes the ANSI code page, not UTF-8, so a payee
// like "Farmacias Benavides" with an accent would come out garbled if read as UTF-8.
export function decodeQifBytes(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

// "10/ 1'26" · "10/01/2026" · "1/5/26" · "2026-01-05" → "YYYY-MM-DD", or null.
// US month/day order, which is what US Quicken writes.
export function parseQifDate(raw) {
  const v = String(raw ?? '').replace(/\s+/g, '');
  let y; let mo; let d;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})(['/.-])(\d{2}|\d{4})$/.exec(v);
    if (!m) return null;
    mo = +m[1]; d = +m[2]; y = +m[4];
    if (m[4].length === 2) y = m[3] === "'" ? 2000 + y : (y < 50 ? 2000 + y : 1900 + y);
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// "-2,000.00" · "$1,000.00" · "(30.00)" → number, or null.
export function parseQifAmount(raw) {
  let s = String(raw ?? '').replace(/[$,\s]/g, '');
  if (!s) return null;
  let neg = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { neg = true; s = paren[1]; }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const cents = (n) => Math.round(n * 100);

// QIF text → {
//   entries:    [{ account, date, amount, payee, memo, category, splits }]
//               splits is null, or [{ category, memo, amount }] adding up to amount
//   categories: [{ name, kind }]      from !Type:Cat, when the export included it
//   accounts:   [{ name, count, from, to }]
//   skipped:    records that had no readable date or amount
//   warnings:   [string]
// }
export function parseQif(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const entries = [];
  const categories = new Map();
  const warnings = [];
  let skipped = 0;
  let section = null;          // 'txn' | 'cat' | 'account' | null (skip)
  let account = null;          // name from the latest !Account block
  let rec = {};

  const finish = () => {
    const r = rec;
    rec = {};
    if (!Object.keys(r).length) return;
    if (section === 'account') { if (r.name) account = r.name; return; }
    if (section === 'cat') {
      const name = normalizeCategoryName(r.name);
      if (name && !categories.has(name.toLowerCase())) categories.set(name.toLowerCase(), { name, kind: r.income ? 'income' : 'expense' });
      return;
    }
    if (section !== 'txn') return;

    const date = parseQifDate(r.date);
    const amount = parseQifAmount(r.amount);
    if (!date || amount === null) { skipped++; return; }

    let category = normalizeCategoryName(r.category);
    let splits = null;
    const parts = (r.splits || []).filter(s => s.amount !== null || s.category);
    if (parts.length === 1) {
      category = normalizeCategoryName(parts[0].category) || category;
    } else if (parts.length > 1) {
      const sum = parts.reduce((n, s) => n + cents(s.amount ?? 0), 0);
      if (parts.every(s => s.amount !== null) && sum === cents(amount)) {
        splits = parts.map(s => ({ category: normalizeCategoryName(s.category), memo: s.memo || null, amount: s.amount }));
        category = null;
      } else {
        warnings.push(`${date} ${r.payee || ''} ${amount.toFixed(2)}: its split lines don't add up to the total, so it comes in uncategorized.`.replace(/\s+/g, ' '));
        category = null;
      }
    }

    entries.push({
      account: account || 'Quicken',
      date,
      amount,
      payee: r.payee || null,
      memo: r.memo || null,
      category,
      splits,
    });
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    if (line[0] === '!') {
      finish();
      const h = line.slice(1).trim().toLowerCase();
      if (h === 'account') section = 'account';
      else if (h.startsWith('type:')) {
        const t = h.slice(5).trim();
        section = TXN_TYPES.has(t) ? 'txn' : t === 'cat' ? 'cat' : null;
      } else if (h.startsWith('option:') || h.startsWith('clear:')) {
        // AutoSwitch flags: no effect on what we read.
      } else section = null;
      continue;
    }
    if (line[0] === '^') { finish(); continue; }
    if (!section) continue;

    const code = line[0];
    const val = line.slice(1).trim();
    if (section === 'account') {
      if (code === 'N') rec.name = val;
      continue;
    }
    if (section === 'cat') {
      if (code === 'N') rec.name = val;
      else if (code === 'I') rec.income = true;
      else if (code === 'E') rec.income = false;
      continue;
    }
    // Transactions. "/Class" after a category is Quicken's class tag, not part of it.
    switch (code) {
      case 'D': rec.date = val; break;
      case 'T': rec.amount = val; break;
      case 'U': if (rec.amount === undefined) rec.amount = val; break;
      case 'P': rec.payee = val; break;
      case 'M': rec.memo = val; break;
      case 'L': rec.category = val.split('/')[0]; break;
      case 'S': (rec.splits ||= []).push({ category: val.split('/')[0], memo: null, amount: null }); break;
      case 'E': if (rec.splits?.length) rec.splits[rec.splits.length - 1].memo = val; break;
      case '$': if (rec.splits?.length) rec.splits[rec.splits.length - 1].amount = parseQifAmount(val); break;
      default: break;
    }
  }
  finish();

  const accounts = new Map();
  for (const e of entries) {
    const a = accounts.get(e.account) || { name: e.account, count: 0, from: e.date, to: e.date };
    a.count++;
    if (e.date < a.from) a.from = e.date;
    if (e.date > a.to) a.to = e.date;
    accounts.set(e.account, a);
  }

  return { entries, categories: [...categories.values()], accounts: [...accounts.values()], skipped, warnings };
}
