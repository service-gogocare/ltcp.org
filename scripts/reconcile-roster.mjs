#!/usr/bin/env node
/**
 * 名冊 vs 雲端小卡 對帳（唯讀、離線）
 * ---------------------------------------------------------------------------
 * 輸入：
 *   1. 機構提供的職登名冊 Excel（欄位：姓名／職登類別／出生年月日／長照小卡到期日）
 *   2. audit-duplicate-cards.mjs 產出的 card-audit-<orgId>.csv
 *
 * 輸出：以名冊的「長照小卡到期日」當權威來源，判斷每一組重複小卡裡
 *       哪一份文件的日期是對的、職類 key 是否正確、應該留哪份刪哪份。
 *
 * 完全不連 Firestore、不寫入任何雲端資料，只讀本機兩個檔案並產生報表。
 *
 * 用法（兩個檔案都會自動在目前目錄尋找，通常不用給參數）：
 *   node scripts/reconcile-roster.mjs
 *   node scripts/reconcile-roster.mjs --audit=./card-audit-org_n3tkfl.csv
 *
 * 註：Windows 上中文檔名經過 argv 會被改壞，所以名冊預設用關鍵字掃描目前目錄，
 *     而不是從命令列吃路徑。
 */

import * as XLSX from 'xlsx';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeRole, effectiveFromExpiry, addYears, diffDays, parseRosterDate,
  toCsv, parseCsv, parseArgv,
} from './lib/ltcp-shared.mjs';

const ROSTER_KEYWORD = '童庭';   // 名冊檔名關鍵字（中文寫在原始碼裡才不會被 argv 改壞）

const argv = parseArgv(process.argv.slice(2));

// --- 找輸入檔 --------------------------------------------------------------
function findRoster() {
  if (typeof argv.roster === 'string') return argv.roster;
  const hits = readdirSync(process.cwd())
    .filter((f) => /\.xlsx?$/i.test(f) && f.includes(ROSTER_KEYWORD));
  if (hits.length === 0) {
    console.error(`找不到檔名含「${ROSTER_KEYWORD}」的 Excel 名冊，請用 --roster=<路徑> 指定。`);
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`檔名含「${ROSTER_KEYWORD}」的 Excel 有多個，請用 --roster 指定：\n  ${hits.join('\n  ')}`);
    process.exit(1);
  }
  return join(process.cwd(), hits[0]);
}
function findAudit() {
  if (typeof argv.audit === 'string') return argv.audit;
  const hits = readdirSync(process.cwd()).filter((f) => /^card-audit-.*\.csv$/i.test(f));
  if (hits.length !== 1) {
    console.error(`目前目錄的 card-audit-*.csv 有 ${hits.length} 個，請用 --audit=<路徑> 指定。`);
    process.exit(1);
  }
  return join(process.cwd(), hits[0]);
}

// --- 主流程 ----------------------------------------------------------------
const rosterPath = findRoster();
const auditPath = findAudit();
console.log(`名冊：${rosterPath}`);
console.log(`盤點結果：${auditPath}\n`);

const wb = XLSX.read(readFileSync(rosterPath), { type: 'buffer', cellDates: true });
const sheetName = wb.SheetNames[0];
const rosterRaw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });

const cols = Object.keys(rosterRaw[0] || {});
const nameCol = cols.find((c) => c.includes('姓名'));
const roleCol = cols.find((c) => c.includes('職登類別') || c.includes('職業類別') || c.includes('類別'));
const expiryCol = cols.find((c) => c.includes('到期'));
const birthCol = cols.find((c) => c.includes('出生'));
if (!nameCol || !roleCol || !expiryCol) {
  console.error(`名冊欄位不齊全，實際欄位：${cols.join('、')}`);
  process.exit(1);
}

const roster = rosterRaw
  .map((r) => {
    const ed = parseRosterDate(r[expiryCol]);
    return {
      name: String(r[nameCol] || '').trim(),
      roleRaw: String(r[roleCol] || '').trim(),
      role: normalizeRole(r[roleCol]),
      expiry: ed.roc,
      expiryRaw: ed.raw,
      expiryMalformed: ed.malformed,
      birth: birthCol ? parseRosterDate(r[birthCol]).roc : '',
    };
  })
  .filter((r) => r.name);

// 雲端盤點結果：依姓名分組
const auditRows = parseCsv(readFileSync(auditPath, 'utf8'));
const cloudByName = new Map();
for (const r of auditRows) {
  const nm = (r['姓名'] || '').trim();
  if (!nm) continue;
  if (!cloudByName.has(nm)) cloudByName.set(nm, []);
  cloudByName.get(nm).push({
    pid: r['身分證號'],
    docId: r['文件ID'],
    era: r['新舊制'],
    roleField: r['role欄位'],
    roleNormalized: r['正規化職類'],
    effectiveDate: r['生效日期'],
    expiryDate: r['到期日期'],
    category: r['分類'],
  });
}

// 姓名重複檢查（比對只能靠姓名，重名會誤判）
const rosterNameCount = new Map();
for (const r of roster) rosterNameCount.set(r.name, (rosterNameCount.get(r.name) || 0) + 1);
const dupRosterNames = [...rosterNameCount].filter(([, n]) => n > 1).map(([n]) => n);
const cloudPidsPerName = new Map();
for (const [nm, docs] of cloudByName) cloudPidsPerName.set(nm, new Set(docs.map((d) => d.pid)));
const dupCloudNames = [...cloudPidsPerName].filter(([, s]) => s.size > 1).map(([n]) => n);

console.log('='.repeat(72));
console.log(`名冊 ${roster.length} 人／雲端 ${cloudByName.size} 人（${auditRows.length} 份文件）`);
console.log('='.repeat(72));
if (dupRosterNames.length) console.log(`⚠ 名冊有重複姓名，無法只靠姓名對帳：${dupRosterNames.join('、')}`);
if (dupCloudNames.length) console.log(`⚠ 雲端有同名不同身分證號：${dupCloudNames.join('、')}`);

const plans = [];
const notInCloud = [];
for (const p of roster) {
  const docs = cloudByName.get(p.name);
  if (!docs) { notInCloud.push(p); continue; }

  // 名冊到期日 vs 每份文件的到期日
  // renewed：名冊到期日剛好是這份文件到期日再加 6 年 —— 代表這張卡已經展延一期，
  // 雲端留的是上一期，名冊才是現行有效期，不是打錯。
  const annotated = docs.map((d) => ({
    ...d,
    diff: diffDays(d.expiryDate, p.expiry),
    renewed: !!d.expiryDate && addYears(d.expiryDate, 6) === p.expiry,
  }));
  const exact = annotated.filter((d) => d.diff === 0);
  const correctKey = `${docs[0].pid}_${p.role}`;
  const keyMatch = annotated.filter((d) => d.docId === correctKey);

  let verdict, keep = null, fixTo = null;
  if (exact.length === 1) {
    keep = exact[0];
    verdict = keep.era === '舊制' ? '只有舊制日期正確' : '只有新制日期正確';
  } else if (exact.length > 1) {
    keep = exact.find((d) => d.docId === correctKey) || exact[0];
    verdict = '多份日期都正確';
  } else {
    verdict = '兩份都不符名冊';
    keep = keyMatch[0] || annotated[0];
    fixTo = { expiry: p.expiry, effective: effectiveFromExpiry(p.expiry) };
  }
  const drop = annotated.filter((d) => d.docId !== keep.docId);
  // 保留的那份如果不是正確 key，合併時要搬到 correctKey；
  // 另外檢查現有新制文件的後綴職類是否跟名冊不一致（那是真正的職類判錯）
  const roleConflict = annotated.some((d) => d.era === '新制' && d.roleNormalized !== p.role);

  plans.push({ person: p, docs: annotated, verdict, keep, drop, correctKey, fixTo, roleConflict });
}

const rosterNames = new Set(roster.map((r) => r.name));
const notInRoster = [...cloudByName.entries()].filter(([nm]) => !rosterNames.has(nm));

// 姓名寫法不同（例如「佘」與「余」）會造成兩邊各自漏配。
// 在雙方的剩餘名單裡用「到期日完全相同」互相配對，只提報疑似，不自動合併。
const suspectedPairs = [];
for (const p of notInCloud) {
  for (const [nm, docs] of notInRoster) {
    if (docs.some((d) => d.expiryDate && d.expiryDate === p.expiry)) {
      suspectedPairs.push({ roster: p, cloudName: nm, docs });
    }
  }
}
const suspectedRosterNames = new Set(suspectedPairs.map((s) => s.roster.name));
const suspectedCloudNames = new Set(suspectedPairs.map((s) => s.cloudName));
const trulyNotInCloud = notInCloud.filter((p) => !suspectedRosterNames.has(p.name));
const trulyNotInRoster = notInRoster.filter(([nm]) => !suspectedCloudNames.has(nm));
const malformedDates = roster.filter((p) => p.expiryMalformed);

// --- 報表 ------------------------------------------------------------------
const byVerdict = (v) => plans.filter((p) => p.verdict === v);
console.log('\n【對帳結果統計】以名冊「長照小卡到期日」為權威');
console.log(`  只有舊制那份日期正確（→ 保留舊制的日期，搬到新制 key）：${byVerdict('只有舊制日期正確').length} 人`);
console.log(`  只有新制那份日期正確（→ 直接刪舊制）：${byVerdict('只有新制日期正確').length} 人`);
console.log(`  兩份日期都正確（→ 隨便留一份）：${byVerdict('多份日期都正確').length} 人`);
const noMatch = byVerdict('兩份都不符名冊');
const renewedOnly = noMatch.filter((p) => p.docs.some((d) => d.renewed));
console.log(`  ⚠ 兩份都不符名冊（→ 要改成名冊日期）：${noMatch.length} 人`);
console.log(`     其中屬「舊卡已展延一期」（名冊＝雲端某份 +6 年）：${renewedOnly.length} 人`);
console.log(`  ⚠ 新制文件的職類與名冊不符：${plans.filter((p) => p.roleConflict).length} 人`);
console.log(`  疑似同一人但姓名寫法不同：${suspectedPairs.length} 組`);
console.log(`  名冊有、雲端沒有：${trulyNotInCloud.length} 人`);
console.log(`  雲端有、名冊沒有：${trulyNotInRoster.length} 人`);
if (malformedDates.length) {
  console.log(`\n⚠ 名冊有 ${malformedDates.length} 格到期日格式不正規，已推斷但請人工確認：`);
  for (const p of malformedDates) {
    console.log(`    ${p.name}　原始值「${p.expiryRaw}」　推斷為 ${p.expiry || '無法推斷'}`);
  }
}
if (suspectedPairs.length) {
  console.log('\n⚠ 疑似同一人（到期日完全相同，但姓名用字不同）—— 請確認後再併：');
  for (const s of suspectedPairs) {
    console.log(`    名冊「${s.roster.name}」(到期${s.roster.expiry}) ←→ 雲端「${s.cloudName}」`);
    for (const d of s.docs) console.log(`        ${d.docId}　到期=${d.expiryDate}`);
  }
}

console.log('\n【逐人明細】');
for (const pl of plans) {
  const p = pl.person;
  console.log(`\n  ${p.name}　名冊職類=${p.roleRaw}　名冊到期日=${p.expiry}　→ 判定：${pl.verdict}`);
  for (const d of pl.docs) {
    const mark = d.docId === pl.keep.docId ? '保留' : '刪除';
    const dd = d.diff === null ? '無法比較'
      : d.diff === 0 ? '與名冊相符'
      : d.renewed ? `與名冊差 ${d.diff} 天，剛好是名冊的前一期（+6 年＝名冊值，已展延）`
      : `與名冊差 ${d.diff} 天`;
    console.log(`      [${mark}] ${d.era}  ${d.docId}`);
    console.log(`             role欄位=${d.roleField}　到期=${d.expiryDate}（${dd}）　生效=${d.effectiveDate}`);
  }
  if (pl.keep.docId !== pl.correctKey) {
    console.log(`      → 保留的資料要搬到正確的文件 ID：${pl.correctKey}（依名冊職登類別）`);
  }
  if (pl.roleConflict) {
    console.log(`      ⚠ 現有新制文件的職類與名冊不符（名冊=${pl.person.role}）`);
  }
  if (pl.fixTo) {
    console.log(`      ⚠ 保留的那份日期要改為：生效=${pl.fixTo.effective}　到期=${pl.fixTo.expiry}`);
  }
}

if (trulyNotInCloud.length) {
  console.log('\n【名冊有、雲端查無此人】可能是姓名寫法不同或還沒匯入');
  for (const p of trulyNotInCloud) console.log(`  ${p.name}\t${p.roleRaw}\t到期=${p.expiry}\t生日=${p.birth}`);
}
if (trulyNotInRoster.length) {
  console.log('\n【雲端有、名冊沒有】可能已離職，或名冊只列部分人員 —— 合併時不要動到');
  for (const [nm, docs] of trulyNotInRoster) {
    console.log(`  ${nm}\t${docs.map((d) => `${d.docId}(到期${d.expiryDate})`).join('　')}`);
  }
}

// --- CSV --------------------------------------------------------------------
const outPath = typeof argv.out === 'string' ? argv.out : './roster-reconcile.csv';
const header = ['判定', '姓名', '身分證號', '名冊職登類別', '名冊到期日', '處置', '文件ID',
  '新舊制', 'role欄位', '文件到期日', '與名冊差(天)', '文件生效日', '正確文件ID', '應改到期日', '應改生效日'];
const rows = [header];
for (const pl of plans) {
  for (const d of pl.docs) {
    rows.push([
      pl.verdict, pl.person.name, d.pid, pl.person.roleRaw, pl.person.expiry,
      d.docId === pl.keep.docId ? '保留' : '刪除', d.docId, d.era, d.roleField,
      d.expiryDate, d.diff === null ? '' : d.diff, d.effectiveDate,
      pl.correctKey, pl.fixTo ? pl.fixTo.expiry : '', pl.fixTo ? pl.fixTo.effective : '',
    ]);
  }
}
for (const p of trulyNotInCloud) {
  rows.push(['名冊有雲端無', p.name, '', p.roleRaw, p.expiry, '', '', '', '', '', '', '', '', '', '']);
}
for (const [nm, docs] of trulyNotInRoster) {
  for (const d of docs) {
    rows.push(['雲端有名冊無', nm, d.pid, '', '', '不要動', d.docId, d.era, d.roleField,
      d.expiryDate, '', d.effectiveDate, '', '', '']);
  }
}
for (const s of suspectedPairs) {
  for (const d of s.docs) {
    rows.push([`疑似同一人(名冊寫${s.roster.name})`, s.cloudName, d.pid, s.roster.roleRaw, s.roster.expiry,
      '待確認', d.docId, d.era, d.roleField, d.expiryDate,
      d.expiryDate === s.roster.expiry ? 0 : '', d.effectiveDate, `${d.pid}_${s.roster.role}`, '', '']);
  }
}
writeFileSync(outPath, toCsv(rows), 'utf8');
console.log(`\n明細已寫入：${outPath}（${rows.length - 1} 列）`);
