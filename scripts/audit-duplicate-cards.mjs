#!/usr/bin/env node
/**
 * 學員小卡重複盤點（唯讀）
 * ---------------------------------------------------------------------------
 * 背景：commit 3e2c752 之前，student_cards 的文件 ID 只用身分證號，職業類別直接
 * 存 Excel 原字串（例如「照顧服務員」）。之後改成複合鍵「身分證號_正規化職類」，
 * 職類一律經過 normalizeRole() 轉成「照顧服務人員」等五種。結果同一個人可能同時
 * 存在新舊兩份文件，管理面板會列出兩列，儀表板統計也會重複計算。
 *
 * 這支腳本只做盤點：全程僅呼叫 getDoc / getDocs，沒有 import 任何寫入 API
 * （setDoc / updateDoc / deleteDoc / writeBatch 一個都沒有），不會動到任何資料。
 *
 * 用法：
 *   node --env-file=.env scripts/audit-duplicate-cards.mjs --email=you@example.com
 *   node --env-file=.env scripts/audit-duplicate-cards.mjs --email=... --org-name=童庭
 *   node --env-file=.env scripts/audit-duplicate-cards.mjs --email=... --org-id=org_xxx
 *   node --env-file=.env scripts/audit-duplicate-cards.mjs --email=... --all-orgs
 *
 * 離線自我驗證（完全不連 Firestore，用來確認報表邏輯）：
 *   node scripts/audit-duplicate-cards.mjs --from-json=fixture.json
 *   fixture 格式：[{ "id": "A123456789", "role": "照顧服務員", "name": "王小明", ... }]
 *
 * 密碼：不帶 --password 時會在終端機隱藏輸入；也可用環境變數 LTCP_PASSWORD。
 * 輸出：終端機摘要 + CSV 明細（預設 ./card-audit-<orgId>.csv，*.csv 已被 gitignore）
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, terminate } from 'firebase/firestore';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  normalizeRole, splitCardId, diffDays, expiryStatus, toCsv, parseArgv, askPassword,
} from './lib/ltcp-shared.mjs';

// --- CLI 參數 --------------------------------------------------------------
const argv = parseArgv(process.argv.slice(2));

const EMAIL = argv.email || process.env.LTCP_EMAIL || '';
const ORG_NAME_KEYWORD = typeof argv['org-name'] === 'string' ? argv['org-name'] : '童庭';
const ORG_ID = typeof argv['org-id'] === 'string' ? argv['org-id'] : '';
const ALL_ORGS = argv['all-orgs'] === true;
const FROM_JSON = typeof argv['from-json'] === 'string' ? argv['from-json'] : '';

if (!EMAIL && !FROM_JSON) {
  console.error('錯誤：請提供登入信箱，例如 --email=you@example.com');
  process.exit(1);
}

// 職類正規化、民國日期換算、密碼輸入都放在共用模組，避免各腳本各自複製後走鐘

// --- 主流程 ----------------------------------------------------------------
async function main() {
  // 離線模式：直接吃本機 JSON，不登入、不連 Firestore
  if (FROM_JSON) {
    const text = readFileSync(FROM_JSON, 'utf8');
    const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);   // 容忍 BOM
    const docs = raw.map(({ id, ...data }) => ({ id, data }));
    console.log(`\n離線模式：${FROM_JSON}（${docs.length} 份文件），未連線任何資料庫`);
    auditDocs(docs, { orgId: 'offline-fixture', name: FROM_JSON });
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

  console.log(`\n專案：${config.projectId}`);
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, EMAIL, password);
  } catch (err) {
    console.error(`登入失敗：${err.code || err.message}`);
    await terminate(db);
    process.exit(1);
  }
  console.log(`登入成功：${cred.user.email} (uid ${cred.user.uid})`);

  // 讀自己的 users 文件，先確認權限等級（讀不到不致命，只是無法列機構清單）
  let myProfile = null;
  try {
    const snap = await getDoc(doc(db, 'users', cred.user.uid));
    myProfile = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn(`（讀取自身 users 文件失敗：${err.code || err.message}）`);
  }
  console.log(`帳號權限：${myProfile?.role || '未知'}　所屬機構：${myProfile?.orgId || '未知'}\n`);

  const targets = await resolveTargets(db, myProfile);
  if (targets.length === 0) {
    console.error('找不到符合條件的機構，請改用 --org-id=<orgId> 指定。');
    await terminate(db);
    process.exit(1);
  }

  for (const target of targets) {
    const snap = await getDocs(collection(db, `organizations/${target.orgId}/student_cards`));
    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, data: d.data() }));
    auditDocs(docs, target);
  }

  await terminate(db);
  process.exit(0);
}

async function resolveTargets(db, myProfile) {
  if (ORG_ID) return [{ orgId: ORG_ID, name: ORG_ID }];

  let accounts = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach((d) => {
      const data = d.data();
      if (data.orgId) {
        accounts.push({
          orgId: data.orgId,
          name: data.name || data.email || '未命名機構',
          role: data.role || 'user',
        });
      }
    });
  } catch (err) {
    console.warn(`無法列出 users 集合（${err.code || err.message}），改用自己的 orgId。`);
    return myProfile?.orgId ? [{ orgId: myProfile.orgId, name: myProfile.name || myProfile.orgId }] : [];
  }

  // 同一 orgId 可能有多個帳號，去重
  const byOrg = new Map();
  for (const a of accounts) if (!byOrg.has(a.orgId)) byOrg.set(a.orgId, a);
  accounts = [...byOrg.values()];

  if (ALL_ORGS) {
    // 稽查員沒有自己的小卡（見 isRealOrganization），排除
    return accounts.filter((a) => a.role !== 'auditor');
  }

  const matched = accounts.filter(
    (a) => a.name.includes(ORG_NAME_KEYWORD) || a.orgId.includes(ORG_NAME_KEYWORD)
  );
  if (matched.length === 0) {
    console.error(`關鍵字「${ORG_NAME_KEYWORD}」找不到機構。現有機構：`);
    for (const a of accounts) console.error(`  ${a.orgId}\t${a.name}\t${a.role}`);
    return [];
  }
  if (matched.length > 1) {
    console.error(`關鍵字「${ORG_NAME_KEYWORD}」對到多個機構，請用 --org-id 指定：`);
    for (const a of matched) console.error(`  ${a.orgId}\t${a.name}`);
    return [];
  }
  return matched;
}

function auditDocs(docs, target) {
  const line = '='.repeat(72);
  console.log(line);
  console.log(`盤點機構：${target.name}　(orgId: ${target.orgId})`);
  console.log(line);

  const cards = [];
  for (const { id: docId, data } of docs) {
    const { pid, suffix, isLegacy } = splitCardId(docId);
    const roleRaw = typeof data.role === 'string' ? data.role : undefined;
    cards.push({
      docId,
      pid,
      suffix,
      isLegacy,
      name: data.name || '',
      nationality: data.nationality || '',
      roleRaw,                                   // undefined 代表文件裡沒有 role 欄位
      roleNormalized: normalizeRole(roleRaw ?? suffix),
      effectiveDate: data.effectiveDate || '',
      expiryDate: data.expiryDate || '',
      updatedAt: data.updatedAt || '',
    });
  }

  if (cards.length === 0) {
    console.log('此機構沒有任何小卡文件。\n');
    return;
  }

  // 依身分證號分組
  const groups = new Map();
  for (const c of cards) {
    if (!groups.has(c.pid)) groups.set(c.pid, []);
    groups.get(c.pid).push(c);
  }

  const findings = [];
  let legacyCount = 0;
  let suffixMismatchCount = 0;

  for (const [pid, list] of groups) {
    list.sort((a, b) => a.docId.localeCompare(b.docId));
    for (const c of list) {
      if (c.isLegacy) legacyCount++;
      if (!c.isLegacy && c.suffix !== c.roleNormalized) suffixMismatchCount++;
    }

    if (list.length === 1) {
      const only = list[0];
      if (only.isLegacy) {
        findings.push({ type: 'LEGACY_ONLY', pid, list });          // 只需換 key
      } else if (only.suffix !== only.roleNormalized) {
        findings.push({ type: 'SUFFIX_MISMATCH', pid, list });      // 下次匯入會生出第二份
      } else {
        findings.push({ type: 'OK', pid, list });
      }
      continue;
    }

    // 多份文件：正規化職類相同 = 真重複；不同 = 可能是同一人兩種職登類別
    const byRole = new Map();
    for (const c of list) {
      if (!byRole.has(c.roleNormalized)) byRole.set(c.roleNormalized, []);
      byRole.get(c.roleNormalized).push(c);
    }
    const collided = [...byRole.values()].filter((g) => g.length > 1);
    findings.push(collided.length > 0
      ? { type: 'DUPLICATE', pid, list, collided }
      : { type: 'MULTI_ROLE', pid, list });
  }

  const dup = findings.filter((f) => f.type === 'DUPLICATE');
  const legacyOnly = findings.filter((f) => f.type === 'LEGACY_ONLY');
  const multiRole = findings.filter((f) => f.type === 'MULTI_ROLE');
  const mismatch = findings.filter((f) => f.type === 'SUFFIX_MISMATCH');

  console.log('【總覽】');
  console.log(`  小卡文件總數（管理面板列出的筆數）：${cards.length}`);
  console.log(`  不同身分證號的人數：${groups.size}`);
  console.log(`  舊制文件（ID 沒有 _ 後綴）：${legacyCount}`);
  console.log(`  後綴與 role 欄位不一致的文件：${suffixMismatchCount}`);
  console.log(`  ⚠ 真重複（同一人同一職類有多份文件）：${dup.length} 組，共 ${dup.reduce((n, f) => n + f.list.length, 0)} 份文件`);
  console.log(`  · 舊制孤兒（只有舊文件，需換 key 但無衝突）：${legacyOnly.length} 人`);
  console.log(`  · 後綴未正規化（未來會再生重複）：${mismatch.length} 人`);
  console.log(`  · 一人多職類（可能合法，不建議合併）：${multiRole.length} 人`);
  console.log(`  儀表板「小卡總數」相對實際人數多算：${cards.length - groups.size} 筆\n`);

  if (dup.length > 0) {
    console.log('【真重複明細】');
    for (const f of dup) {
      const nm = f.list.find((c) => c.name)?.name || '(無姓名)';
      console.log(`\n  ${nm}　${f.pid}`);
      // 印出這個人「所有」文件，不只是互相衝突的那幾份 ——
      // 例如同時有 _照顧服務人員 與 _居家服務督導員 時，第三份也必須看得到。
      const collidedIds = new Set(f.collided.flat().map((c) => c.docId));
      for (const c of f.list) {
        const roleShown = c.roleRaw === undefined ? '(role 欄位不存在)' : c.roleRaw;
        const tag = collidedIds.has(c.docId) ? '' : '　※ 職類不同，未與上列衝突';
        console.log(
          `    ${c.isLegacy ? '舊制' : '新制'}  ${c.docId}${tag}` +
          `\n          職類欄位=${roleShown}　正規化=${c.roleNormalized}` +
          `\n          生效=${c.effectiveDate || '(空)'}　到期=${c.expiryDate || '(空)'}　${expiryStatus(c.expiryDate)}` +
          (c.updatedAt ? `\n          updatedAt=${c.updatedAt}` : '')
        );
      }
      for (const g of f.collided) {
        // 兩兩比較日期差
        for (let i = 0; i < g.length - 1; i++) {
          for (let j = i + 1; j < g.length; j++) {
            const de = diffDays(g[i].effectiveDate, g[j].effectiveDate);
            const dx = diffDays(g[i].expiryDate, g[j].expiryDate);
            if (de === 0 && dx === 0) {
              console.log(`      ↳ ${g[i].docId} vs ${g[j].docId}：日期完全相同（可安全合併）`);
            } else {
              const newer = de === null ? '' : `　→ 生效日較新的是 ${de > 0 ? g[i].docId : g[j].docId}`;
              console.log(
                `      ↳ ${g[i].docId} vs ${g[j].docId}：` +
                `生效日差 ${de === null ? '無法比較' : `${de} 天`}、` +
                `到期日差 ${dx === null ? '無法比較' : `${dx} 天`}${newer}`
              );
            }
          }
        }
      }
    }
    console.log('');
  }

  if (legacyOnly.length > 0) {
    console.log('【舊制孤兒】只有舊文件、新制那邊沒有對應，換 ID 不會撞資料');
    for (const f of legacyOnly) {
      const c = f.list[0];
      console.log(`  ${c.name || '(無姓名)'}\t${c.docId}\t→ 應為 ${c.pid}_${c.roleNormalized}\t生效=${c.effectiveDate}\t到期=${c.expiryDate}`);
    }
    console.log('');
  }

  if (mismatch.length > 0) {
    console.log('【後綴未正規化】ID 後綴不是 normalizeRole 的輸出，下次 Excel 匯入會再生一份新文件');
    for (const f of mismatch) {
      const c = f.list[0];
      console.log(`  ${c.name || '(無姓名)'}\t${c.docId}\t→ 應為 ${c.pid}_${c.roleNormalized}\t生效=${c.effectiveDate}\t到期=${c.expiryDate}`);
    }
    console.log('');
  }

  if (multiRole.length > 0) {
    console.log('【一人多職類】同一身分證號有不同職類，這在長照登錄上可能是合法的，先不要合併');
    for (const f of multiRole) {
      const nm = f.list.find((c) => c.name)?.name || '(無姓名)';
      console.log(`  ${nm}\t${f.pid}`);
      for (const c of f.list) {
        console.log(`      ${c.docId}\t職類=${c.roleRaw ?? '(欄位不存在)'}\t生效=${c.effectiveDate}\t到期=${c.expiryDate}`);
      }
    }
    console.log('');
  }

  // CSV 明細（Excel 開啟需要 BOM）
  const outPath = typeof argv.out === 'string' ? argv.out : `./card-audit-${target.orgId}.csv`;
  const header = ['分類', '身分證號', '姓名', '文件ID', '新舊制', 'role欄位', '正規化職類',
    'ID後綴', '後綴是否相符', '生效日期', '到期日期', '到期狀態', 'updatedAt'];
  const typeLabel = {
    DUPLICATE: '真重複',
    LEGACY_ONLY: '舊制孤兒',
    SUFFIX_MISMATCH: '後綴未正規化',
    MULTI_ROLE: '一人多職類',
    OK: '正常',
  };
  // 依嚴重度排序，CSV 打開後最需要處理的在最上面
  const order = ['DUPLICATE', 'LEGACY_ONLY', 'SUFFIX_MISMATCH', 'MULTI_ROLE', 'OK'];
  findings.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.pid.localeCompare(b.pid));
  const csvRows = [header];
  for (const f of findings) {
    for (const c of f.list) {
      csvRows.push([
        typeLabel[f.type] || f.type,
        c.pid,
        c.name,
        c.docId,
        c.isLegacy ? '舊制' : '新制',
        c.roleRaw ?? '(欄位不存在)',
        c.roleNormalized,
        c.suffix || '(無)',
        c.isLegacy ? '-' : (c.suffix === c.roleNormalized ? '相符' : '不相符'),
        c.effectiveDate,
        c.expiryDate,
        expiryStatus(c.expiryDate),
        c.updatedAt,
      ]);
    }
  }
  writeFileSync(outPath, toCsv(csvRows), 'utf8');
  console.log(`明細已寫入：${outPath}（${csvRows.length - 1} 列）\n`);
}

main().catch((err) => {
  console.error('盤點失敗：', err);
  process.exit(1);
});
