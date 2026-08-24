#!/usr/bin/env node
/**
 * 小卡文件 ID 正規化遷移
 * ---------------------------------------------------------------------------
 * 把 student_cards 從「舊制（ID 只有身分證號、沒有 role 欄位）＋新制（ID 為
 * 身分證號_職類）並存」收斂成每人一份，並以機構名冊的長照小卡到期日為權威。
 *
 * 合併規則（2026-08-24 與使用者確認）：
 *   1. 文件 ID 一律 `身分證號_名冊職登類別`
 *   2. 到期日取名冊值；生效日＝到期日 + 1 天 - 6 年（同 calculateEffectiveDate）
 *   3. 姓名以名冊寫法為正（雲端「余月純」→ 名冊「佘月純」）
 *   4. 名冊上沒有的人：不刪人，沿用舊制文件的日期，職類取現有新制文件的後綴
 *
 * 預設是 dry-run，只印出「將寫入／將刪除」清單，不動雲端。
 * 確認清單後再加 --apply 才會真的執行；--apply 會先把整個 collection 備份成 JSON。
 *
 * 用法：
 *   node --env-file=.env scripts/migrate-card-keys.mjs --email=you@example.com
 *   node --env-file=.env scripts/migrate-card-keys.mjs --email=... --apply
 *   node --env-file=.env scripts/migrate-card-keys.mjs --email=... --restore=card-backup-org_xxx.json
 *
 * 離線驗證計畫邏輯（不登入、不連線；--apply 在此模式下會被拒絕）：
 *   node scripts/migrate-card-keys.mjs --from-json=<備份或 fixture>.json
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, addDoc, terminate,
} from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  normalizeRole, effectiveFromExpiry, parseRosterDate, splitCardId,
  toCsv, parseArgv, askPassword,
} from './lib/ltcp-shared.mjs';

const ROSTER_KEYWORD = '童庭';   // 名冊檔名關鍵字（中文放原始碼，argv 會被 Windows 改壞）

/**
 * 雲端姓名 → 名冊姓名。使用者確認過的同一人不同寫法。
 * 只在這張表裡的才會被視為同一人，腳本不做任何模糊比對。
 */
const NAME_ALIASES = { 余月純: '佘月純' };

const argv = parseArgv(process.argv.slice(2));
const EMAIL = argv.email || process.env.LTCP_EMAIL || '';
const ORG_ID = typeof argv['org-id'] === 'string' ? argv['org-id'] : '';
const APPLY = argv.apply === true;
const RESTORE = typeof argv.restore === 'string' ? argv.restore : '';
const FROM_JSON = typeof argv['from-json'] === 'string' ? argv['from-json'] : '';

if (FROM_JSON && APPLY) {
  console.error('錯誤：--from-json 是離線驗證模式，不可與 --apply 併用。');
  process.exit(1);
}
if (!EMAIL && !FROM_JSON) {
  console.error('錯誤：請提供登入信箱，例如 --email=you@example.com');
  process.exit(1);
}

function findRoster() {
  if (typeof argv.roster === 'string') return argv.roster;
  const hits = readdirSync(process.cwd()).filter((f) => /\.xlsx?$/i.test(f) && f.includes(ROSTER_KEYWORD));
  if (hits.length !== 1) {
    console.error(`檔名含「${ROSTER_KEYWORD}」的 Excel 有 ${hits.length} 個，請用 --roster=<路徑> 指定。`);
    process.exit(1);
  }
  return join(process.cwd(), hits[0]);
}

function ask(promptText) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (a) => { rl.close(); resolve(a.trim()); });
  });
}

async function main() {
  // 離線模式：只驗證計畫邏輯，不登入也不連線
  if (FROM_JSON) {
    const text = readFileSync(FROM_JSON, 'utf8');
    const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    const cards = raw.map(({ id, ...data }) => ({ docId: id, ...splitCardId(id), data }));
    console.log(`\n離線模式：${FROM_JSON}（${cards.length} 份文件），未連線任何資料庫`);
    planAndReport(cards, 'offline');
    console.log('\n離線驗證結束，沒有任何雲端操作。');
    return;
  }

  const config = {
    apiKey: process.env.VITE_FIREBASE_API_KEY || '',
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.VITE_FIREBASE_APP_ID || '',
  };
  if (!config.apiKey || !config.projectId) {
    console.error('錯誤：讀不到 VITE_FIREBASE_* 環境變數。請用 node --env-file=.env 執行。');
    process.exit(1);
  }

  const password = argv.password || process.env.LTCP_PASSWORD ||
    await askPassword(`請輸入 ${EMAIL} 的密碼：`, { createInterface });
  if (!password) {
    console.error('錯誤：沒有密碼，無法登入。');
    process.exit(1);
  }

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  console.log(`\n專案：${config.projectId}　模式：${RESTORE ? '還原' : (APPLY ? '★ 實際寫入 (--apply)' : 'dry-run（不會動雲端）')}`);

  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, EMAIL, password);
  } catch (err) {
    console.error(`登入失敗：${err.code || err.message}`);
    await terminate(db);
    process.exit(1);
  }
  console.log(`登入成功：${cred.user.email}`);

  const orgId = ORG_ID || await resolveOrgId(db, cred.user.uid);
  console.log(`目標機構：${orgId}\n`);

  if (RESTORE) {
    await restore(db, orgId, cred.user.email);
    await terminate(db);
    process.exit(0);
  }

  // --- 讀雲端現況 ---
  const cardsSnap = await getDocs(collection(db, `organizations/${orgId}/student_cards`));
  const cards = [];
  cardsSnap.forEach((d) => cards.push({ docId: d.id, ...splitCardId(d.id), data: d.data() }));
  console.log(`雲端現有 ${cards.length} 份小卡文件`);

  const { plans, blocked, deleteCount, byPid } = planAndReport(cards, orgId);

  if (!APPLY) {
    console.log('\n這是 dry-run，雲端資料完全沒有被動到。');
    console.log('確認以上清單後，加 --apply 才會實際執行。');
    await terminate(db);
    process.exit(0);
  }

  // --- 實際執行 ---
  const backupPath = `./card-backup-${orgId}.json`;
  writeFileSync(backupPath, JSON.stringify(cards.map((c) => ({ id: c.docId, ...c.data })), null, 2), 'utf8');
  console.log(`\n已備份現況 ${cards.length} 份文件到：${backupPath}`);
  console.log(`（要還原時：node --env-file=.env scripts/migrate-card-keys.mjs --email=... --restore=${backupPath}）`);

  if (argv.force !== true) {
    const answer = await ask(`\n即將寫入 ${plans.length} 份、刪除 ${deleteCount} 份。輸入 APPLY 確認執行：`);
    if (answer !== 'APPLY') {
      console.log('已取消，雲端資料未被動到。');
      await terminate(db);
      process.exit(0);
    }
  }

  let written = 0, deleted = 0;
  // 先寫入再刪除：任何時刻資料都至少存在一份，中途失敗也不會遺失
  for (const p of plans) {
    await setDoc(doc(db, `organizations/${orgId}/student_cards/${p.targetId}`), {
      ...p.record,
      updatedAt: new Date().toISOString(),
    });
    written++;
  }
  console.log(`寫入完成：${written} 份`);
  for (const p of plans) {
    for (const d of p.toDelete) {
      await deleteDoc(doc(db, `organizations/${orgId}/student_cards/${d.docId}`));
      deleted++;
    }
  }
  console.log(`刪除完成：${deleted} 份`);

  await writeAuditLog(db, cred.user.email, orgId,
    `小卡文件 ID 正規化遷移：寫入 ${written} 份、刪除 ${deleted} 份，備份於 ${backupPath}`);

  // --- 執行後驗證 ---
  const after = await getDocs(collection(db, `organizations/${orgId}/student_cards`));
  const afterIds = new Set();
  after.forEach((d) => afterIds.add(d.id));
  const missing = plans.filter((p) => !afterIds.has(p.targetId)).map((p) => p.targetId);
  const leftover = [...afterIds].filter((id) => !plans.some((p) => p.targetId === id));
  const expected = plans.length + blocked.reduce((n, b) => n + (byPid.get(b.pid)?.length || 0), 0);
  console.log(`\n驗證：目前 collection 有 ${afterIds.size} 份文件（預期 ${expected}）`);
  if (missing.length) console.log(`  ❌ 應存在但找不到：${missing.join('、')}`);
  if (leftover.length) console.log(`  殘留（含跳過的人）：${leftover.join('、')}`);
  if (!missing.length) console.log('  ✓ 每筆目標文件都存在');

  await terminate(db);
  process.exit(0);
}

/** 讀名冊、組出遷移計畫並印成報表。純計算＋印字，不碰雲端。 */
function planAndReport(cards, orgId) {
  // --- 讀名冊 ---
  const rosterPath = findRoster();
  const wb = XLSX.read(readFileSync(rosterPath), { type: 'buffer', cellDates: true });
  const rosterRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const cols = Object.keys(rosterRows[0] || {});
  const nameCol = cols.find((c) => c.includes('姓名'));
  const roleCol = cols.find((c) => c.includes('職登類別') || c.includes('職業類別') || c.includes('類別'));
  const expiryCol = cols.find((c) => c.includes('到期'));
  if (!nameCol || !roleCol || !expiryCol) {
    console.error(`名冊欄位不齊全，實際欄位：${cols.join('、')}`);
    process.exit(1);
  }
  const rosterByName = new Map();
  const malformed = [];
  for (const r of rosterRows) {
    const nm = String(r[nameCol] || '').trim();
    if (!nm) continue;
    const ed = parseRosterDate(r[expiryCol]);
    if (ed.malformed) malformed.push({ name: nm, raw: ed.raw, roc: ed.roc });
    rosterByName.set(nm, {
      name: nm,
      roleRaw: String(r[roleCol] || '').trim(),
      role: normalizeRole(r[roleCol]),
      expiry: ed.roc,
    });
  }
  console.log(`名冊 ${rosterByName.size} 人　來源：${rosterPath}`);
  if (malformed.length) {
    console.log('⚠ 名冊有格式不正規的到期日，已推斷：');
    for (const m of malformed) console.log(`    ${m.name}　「${m.raw}」→ ${m.roc}`);
  }

  // --- 組遷移計畫 ---
  const byPid = new Map();
  for (const c of cards) {
    if (!byPid.has(c.pid)) byPid.set(c.pid, []);
    byPid.get(c.pid).push(c);
  }

  const plans = [], blocked = [];
  for (const [pid, docs] of byPid) {
    const legacy = docs.find((d) => d.isLegacy);
    const composites = docs.filter((d) => !d.isLegacy);
    const cloudName = (legacy?.data.name || composites[0]?.data.name || '').trim();
    const rosterName = NAME_ALIASES[cloudName] || cloudName;
    const roster = rosterByName.get(rosterName);

    // 同名不同身分證號會讓姓名比對失效，寧可停下來也不要亂併
    const sameNameOtherPid = [...byPid.entries()].filter(([otherPid, otherDocs]) =>
      otherPid !== pid &&
      (otherDocs.find((d) => d.isLegacy)?.data.name || otherDocs[0]?.data.name || '').trim() === cloudName);
    if (roster && sameNameOtherPid.length > 0) {
      blocked.push({ pid, cloudName, reason: `雲端有同名不同身分證號（${sameNameOtherPid.map(([p]) => p).join('、')}），無法確定對應名冊哪一列` });
      continue;
    }

    let role, expiryDate, effectiveDate, name, source;
    if (roster) {
      role = roster.role;
      expiryDate = roster.expiry;
      effectiveDate = effectiveFromExpiry(roster.expiry);
      name = roster.name;                       // 姓名以名冊寫法為正
      source = `名冊（${roster.roleRaw}／到期 ${roster.expiry}）`;
      if (!expiryDate || !effectiveDate) {
        blocked.push({ pid, cloudName, reason: `名冊到期日無法解析（${roster.expiry || '空白'}）` });
        continue;
      }
    } else {
      // 名冊上沒有這個人：不刪人，沿用舊制文件的日期；職類只能取現有新制文件的後綴
      const keep = legacy || composites[0];
      role = composites.length > 0
        ? normalizeRole(composites[0].data.role || composites[0].suffix)
        : normalizeRole(keep.data.role || '');
      expiryDate = keep.data.expiryDate || '';
      effectiveDate = keep.data.effectiveDate || '';
      name = cloudName;
      source = `名冊無此人，沿用 ${keep.docId} 的日期`;
      if (!expiryDate || !effectiveDate) {
        blocked.push({ pid, cloudName, reason: `名冊無此人且 ${keep.docId} 的日期是空的，無法決定要留什麼` });
        continue;
      }
    }

    const targetId = `${pid}_${role}`;
    const existing = docs.find((d) => d.docId === targetId);
    const record = {
      name,
      role,
      nationality: (legacy?.data.nationality || composites[0]?.data.nationality || '臺灣'),
      effectiveDate,
      expiryDate,
    };
    plans.push({
      pid, cloudName, targetId, record, source,
      isNewDoc: !existing,
      before: existing ? existing.data : null,
      toDelete: docs.filter((d) => d.docId !== targetId),
    });
  }

  // --- 印出計畫 ---
  const changed = plans.filter((p) => p.isNewDoc || fieldDiffs(p.before, p.record).length > 0);
  const deleteCount = plans.reduce((n, p) => n + p.toDelete.length, 0);
  console.log('\n' + '='.repeat(72));
  console.log(`遷移計畫：${cards.length} 份文件 → ${plans.length} 份（每人一份）`);
  console.log(`  將寫入：${plans.length} 份（其中 ${plans.filter((p) => p.isNewDoc).length} 份是新建、${changed.length} 份內容有變動）`);
  console.log(`  將刪除：${deleteCount} 份`);
  if (blocked.length) console.log(`  ⚠ 跳過（無法安全處理）：${blocked.length} 人`);
  console.log('='.repeat(72));

  for (const p of plans) {
    const diffs = p.isNewDoc ? [] : fieldDiffs(p.before, p.record);
    const tag = p.isNewDoc ? '新建' : (diffs.length ? '覆寫' : '內容不變');
    console.log(`\n  ${p.record.name}　${p.pid}　[${tag}] ${p.targetId}`);
    console.log(`      依據：${p.source}`);
    if (p.isNewDoc) {
      console.log(`      寫入：職類=${p.record.role}　生效=${p.record.effectiveDate}　到期=${p.record.expiryDate}　國籍=${p.record.nationality}`);
    } else {
      for (const d of diffs) console.log(`      ${d.field}：${d.from || '(空)'} → ${d.to || '(空)'}`);
    }
    for (const d of p.toDelete) {
      console.log(`      刪除：${d.docId}（職類欄位=${d.data.role ?? '(不存在)'}　生效=${d.data.effectiveDate || '(空)'}　到期=${d.data.expiryDate || '(空)'}）`);
    }
  }

  if (blocked.length) {
    console.log('\n【跳過的人】這些完全不會被動到，需要人工處理');
    for (const b of blocked) console.log(`  ${b.cloudName || '(無姓名)'}\t${b.pid}\t${b.reason}`);
  }

  // 計畫存成 CSV 方便留存
  const planCsv = [['處置', '姓名', '身分證號', '文件ID', '職類', '生效日期', '到期日期', '國籍', '依據']];
  for (const p of plans) {
    planCsv.push([p.isNewDoc ? '新建' : '覆寫', p.record.name, p.pid, p.targetId, p.record.role,
      p.record.effectiveDate, p.record.expiryDate, p.record.nationality, p.source]);
    for (const d of p.toDelete) {
      planCsv.push(['刪除', d.data.name || '', p.pid, d.docId, d.data.role ?? '(不存在)',
        d.data.effectiveDate || '', d.data.expiryDate || '', d.data.nationality || '', '']);
    }
  }
  for (const b of blocked) planCsv.push(['跳過', b.cloudName, b.pid, '', '', '', '', '', b.reason]);
  const planPath = `./migration-plan-${orgId}.csv`;
  writeFileSync(planPath, toCsv(planCsv), 'utf8');
  console.log(`\n計畫明細已寫入：${planPath}`);

  return { plans, blocked, deleteCount, byPid };
}

function fieldDiffs(before, record) {
  if (!before) return [];
  const out = [];
  for (const f of ['name', 'role', 'nationality', 'effectiveDate', 'expiryDate']) {
    const from = before[f] === undefined ? '' : String(before[f]);
    const to = String(record[f] ?? '');
    if (from !== to) out.push({ field: f, from: before[f] === undefined ? '(欄位不存在)' : from, to });
  }
  return out;
}

async function resolveOrgId(db, uid) {
  const accounts = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach((d) => {
      const data = d.data();
      if (data.orgId) accounts.push({ orgId: data.orgId, name: data.name || data.email || '' });
    });
  } catch (err) {
    const me = await getDoc(doc(db, 'users', uid));
    if (me.exists() && me.data().orgId) return me.data().orgId;
    console.error(`無法決定機構：${err.code || err.message}，請用 --org-id 指定。`);
    process.exit(1);
  }
  const matched = accounts.filter((a) => a.name.includes(ROSTER_KEYWORD) || a.orgId.includes(ROSTER_KEYWORD));
  if (matched.length !== 1) {
    console.error(`關鍵字「${ROSTER_KEYWORD}」對到 ${matched.length} 個機構，請用 --org-id 指定。`);
    process.exit(1);
  }
  return matched[0].orgId;
}

/** 稽核日誌欄位受 firestore.rules 的 isValidAuditLog 檢查，只能是這五個欄位 */
async function writeAuditLog(db, operatorEmail, targetOrgId, details) {
  try {
    await addDoc(collection(db, 'audit_logs'), {
      timestamp: new Date().toISOString(),
      operatorEmail,
      action: '小卡資料遷移（腳本）',
      targetOrgId,
      details: details.slice(0, 2000),
    });
    console.log('已寫入稽核日誌');
  } catch (err) {
    console.warn(`⚠ 稽核日誌寫入失敗（資料遷移本身已完成）：${err.code || err.message}`);
  }
}

async function restore(db, orgId, operatorEmail) {
  const backup = JSON.parse(readFileSync(RESTORE, 'utf8'));
  console.log(`備份檔 ${RESTORE} 含 ${backup.length} 份文件`);
  const snap = await getDocs(collection(db, `organizations/${orgId}/student_cards`));
  const currentIds = [];
  snap.forEach((d) => currentIds.push(d.id));
  const backupIds = new Set(backup.map((b) => b.id));
  const toRemove = currentIds.filter((id) => !backupIds.has(id));

  console.log(`將還原 ${backup.length} 份文件，並刪除備份中不存在的 ${toRemove.length} 份：${toRemove.join('、') || '(無)'}`);
  const answer = await ask('輸入 RESTORE 確認執行：');
  if (answer !== 'RESTORE') { console.log('已取消。'); return; }

  for (const b of backup) {
    const { id, ...data } = b;
    await setDoc(doc(db, `organizations/${orgId}/student_cards/${id}`), data);
  }
  for (const id of toRemove) {
    await deleteDoc(doc(db, `organizations/${orgId}/student_cards/${id}`));
  }
  console.log(`還原完成：寫回 ${backup.length} 份、刪除 ${toRemove.length} 份`);
  await writeAuditLog(db, operatorEmail, orgId, `從備份 ${RESTORE} 還原小卡資料：寫回 ${backup.length} 份、刪除 ${toRemove.length} 份`);
}

main().catch((err) => {
  console.error('遷移失敗：', err);
  process.exit(1);
});
