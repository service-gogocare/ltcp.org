/**
 * 小卡維運腳本的共用工具
 * ---------------------------------------------------------------------------
 * audit-duplicate-cards.mjs、reconcile-roster.mjs、migrate-card-keys.mjs
 * 三支都要用同一套職類正規化與民國日期換算，所以集中在這裡；
 * 三份各自複製會在規則變動時悄悄走鐘。
 *
 * normalizeRole 必須與 src/App.tsx 的同名函式一致（那邊是 .tsx 且 import React，
 * node 無法直接載入），改動時兩邊要一起改。
 * 日期換算對應 src/calculator.ts 的 rocStrToDate / dateToRocStr /
 * calculateExpiryDate / calculateEffectiveDate。
 */

export const ROLE_OPTIONS = [
  '照顧服務人員',
  '居家服務督導員',
  '專業服務人員',
  '照顧管理人員',
  '個案管理人員',
];

export function normalizeRole(roleStr) {
  const s = String(roleStr || '').trim();
  if (s.includes('居家服務督導') || s.includes('居家督導') || s.includes('居督')) return '居家服務督導員';
  if (s.includes('照顧服務') || s.includes('照服')) return '照顧服務人員';
  if (s.includes('個案管理') || s.includes('個管')) return '個案管理人員';
  if (s.includes('照顧管理') || s.includes('照管')) return '照顧管理人員';
  if (
    s.includes('專業服務') || s.includes('社工') || s.includes('護理') || s.includes('醫師') ||
    s.includes('治療師') || s.includes('物理治療') || s.includes('職能治療')
  ) return '專業服務人員';
  return '照顧服務人員'; // fallback
}

export const MS_PER_DAY = 86400000;

export function rocStrToDate(rocStr) {
  if (!rocStr) return null;
  const p = String(rocStr).split('/');
  if (p.length !== 3) return null;
  const y = parseInt(p[0], 10) + 1911, m = parseInt(p[1], 10) - 1, d = parseInt(p[2], 10);
  if ([y, m, d].some(Number.isNaN)) return null;
  const dt = new Date(y, m, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function dateToRocStr(date) {
  const y = date.getFullYear() - 1911;
  return `${y}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

/** 生效日 → 到期日：+6 年再減 1 天（同 calculateExpiryDate） */
export function expiryFromEffective(effectiveRoc) {
  const dt = rocStrToDate(effectiveRoc);
  if (!dt) return '';
  const t = new Date(dt.getFullYear() + 6, dt.getMonth(), dt.getDate());
  t.setDate(t.getDate() - 1);
  return dateToRocStr(t);
}

/** 到期日 → 生效日：+1 天再減 6 年（同 calculateEffectiveDate） */
export function effectiveFromExpiry(expiryRoc) {
  const dt = rocStrToDate(expiryRoc);
  if (!dt) return '';
  const t = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  t.setDate(t.getDate() + 1);
  return dateToRocStr(new Date(t.getFullYear() - 6, t.getMonth(), t.getDate()));
}

export function addYears(rocStr, n) {
  const dt = rocStrToDate(rocStr);
  if (!dt) return '';
  return dateToRocStr(new Date(dt.getFullYear() + n, dt.getMonth(), dt.getDate()));
}

export function diffDays(a, b) {
  const da = rocStrToDate(a), db = rocStrToDate(b);
  if (!da || !db) return null;
  return Math.round((da.getTime() - db.getTime()) / MS_PER_DAY);
}

export function expiryStatus(expiry, today = new Date()) {
  const dt = rocStrToDate(expiry);
  if (!dt) return '日期無法解析';
  const days = Math.round((dt.getTime() - today.getTime()) / MS_PER_DAY);
  if (days < 0) return `已過期 ${-days} 天`;
  if (days <= 90) return `${days} 天內到期`;
  return '有效';
}

/**
 * 名冊日期 → { roc, raw, malformed }。
 * cellDates 會把正常日期格給成 Date；被手打成文字的格子可能是「2027/0303」
 * 這種漏斜線的寫法，能推斷但標記 malformed，交給報表提醒人工確認。
 */
export function parseRosterDate(v) {
  if (v === '' || v === null || v === undefined) return { roc: '', raw: '', malformed: false };
  if (v instanceof Date) return { roc: dateToRocStr(v), raw: dateToRocStr(v), malformed: false };
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * MS_PER_DAY));
    const roc = `${d.getUTCFullYear() - 1911}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
    return { roc, raw: String(v), malformed: false };
  }
  const raw = String(v).trim();
  const toRoc = (y, m, d) => `${y > 1911 ? y - 1911 : y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;

  const three = raw.split(/[/\-.]/).map((x) => parseInt(x, 10));
  if (three.length === 3 && three.every((n) => !Number.isNaN(n))) {
    return { roc: toRoc(three[0], three[1], three[2]), raw, malformed: false };
  }
  const mmdd = raw.match(/^(\d{2,4})[/\-.](\d{2})(\d{2})$/);   // 2027/0303
  if (mmdd) return { roc: toRoc(+mmdd[1], +mmdd[2], +mmdd[3]), raw, malformed: true };
  const solid = raw.match(/^(\d{2,4})(\d{2})(\d{2})$/);        // 20270303
  if (solid) return { roc: toRoc(+solid[1], +solid[2], +solid[3]), raw, malformed: true };
  return { roc: '', raw, malformed: true };
}

/** 文件 ID → { pid, suffix, isLegacy }；舊制 ID 只有身分證號，沒有 _職類 後綴 */
export function splitCardId(docId) {
  const sep = docId.indexOf('_');
  return sep === -1
    ? { pid: docId, suffix: '', isLegacy: true }
    : { pid: docId.slice(0, sep), suffix: docId.slice(sep + 1), isLegacy: false };
}

// --- CSV -------------------------------------------------------------------
export function toCsv(rows) {
  return '﻿' + rows
    .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
}

// --- CLI 小工具 -------------------------------------------------------------
export function parseArgv(list) {
  const argv = {};
  for (const raw of list) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
  }
  return argv;
}

/** 在終端機隱藏輸入密碼 */
export function askPassword(promptText, { createInterface }) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let promptShown = false;
    rl._writeToOutput = function (str) {
      if (!promptShown) { rl.output.write(str); promptShown = true; return; }
      if (str.includes('\n')) rl.output.write('\n');
    };
    rl.question(promptText, (answer) => { rl.close(); resolve(answer); });
  });
}
