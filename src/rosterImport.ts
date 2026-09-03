/**
 * 名冊匯入（純邏輯，不碰檔案 I/O）
 * ---------------------------------------------------------------------------
 * 這是「人員名單」的唯一批次建立途徑。衛福部的積分 Excel **不再**用來新增人員：
 * 它不含長照小卡起訖日，靠它建人只會產生一批算不出證書年度的人員，
 * 而那些「效期外」的列看起來像真資料卻是錯的。
 *
 * 所以人員名單改由這裡進來 —— 使用者下載範本、填好起訖日、上傳。
 * 起訖日是必填，缺了就不收那一列，理由同上。
 */

import { normalizeDateToRocStr, rocStrToDate, calculateExpiryDate, calculateEffectiveDate } from './calculator';
import { ROLE_OPTIONS, NATIONALITY_OPTIONS, normalizeRole } from './studentFields';
import { composeCardId } from './cardPlan';
import type { CardRecord } from './backend/types';

/** 範本的欄位順序，與名冊試算表一致，使用者才不會覺得是兩套東西 */
export const ROSTER_TEMPLATE_HEADER = [
  '身分證號', '姓名', '國籍', '職業類別', '生效日期', '到期日期',
] as const;

/**
 * 範本的說明列。放在標題列之下、資料之上。
 *
 * 為什麼要有：使用者拿到一張空表最常做錯的兩件事是日期格式與職業類別寫法。
 * 解析時會把這一列認出來略過（見 isGuideRow），不會被當成人員。
 */
export const ROSTER_TEMPLATE_GUIDE = [
  '例：A123456789',
  '例：王小明',
  `可填：${NATIONALITY_OPTIONS.join('／')}`,
  `可填：${ROLE_OPTIONS.join('／')}`,
  // 每一格都必須以 isGuideRow 認得的前綴開頭，否則說明列會被當成人員資料
  '例：113/08/20（民國年）',
  '留空會自動算（生效日＋6年－1天）',
];

export type RosterImportIssueKind =
  | 'missingColumn' | 'emptyId' | 'emptyName' | 'missingDates' | 'invalidDate' | 'duplicate' | 'unknownRole';

export interface RosterImportIssue {
  kind: RosterImportIssueKind;
  /** 檔案上的列號（1 起算，含標題列） */
  row: number;
  message: string;
}

export interface ParsedRosterImport {
  /** 以「身分證號_職業類別」為鍵，可直接餵給 saveStudentCards */
  cards: { [cardId: string]: CardRecord };
  issues: RosterImportIssue[];
}

/** 說明列的特徵是每一格都以「例：」或「可填：」或「留空」開頭 */
function isGuideRow(cells: string[]): boolean {
  const filled = cells.filter((c) => c);
  return filled.length > 0
    && filled.every((c) => c.startsWith('例：') || c.startsWith('可填：') || c.startsWith('留空'));
}

/**
 * 解析名冊匯入檔。
 *
 * values[0] 是標題列。欄位依標題名稱對應而非位置 —— 使用者調換欄位順序很常見，
 * 照位置讀會把姓名讀成身分證號。
 */
export function parseRosterImport(values: string[][]): ParsedRosterImport {
  const issues: RosterImportIssue[] = [];
  const cards: { [cardId: string]: CardRecord } = {};

  if (values.length === 0) {
    issues.push({ kind: 'missingColumn', row: 1, message: '檔案是空的，找不到標題列。' });
    return { cards, issues };
  }

  const header = values[0].map((h) => String(h ?? '').trim());
  const find = (...keywords: string[]) =>
    header.findIndex((h) => h && keywords.some((k) => h.includes(k)));

  const idx = {
    studentId: find('身分證', '身份證', '統一證號'),
    name: find('姓名'),
    nationality: find('國籍'),
    role: find('職業類別', '職登類別', '類別'),
    effectiveDate: find('生效'),
    expiryDate: find('到期'),
  };

  const missing = ([
    ['身分證號', idx.studentId], ['姓名', idx.name], ['職業類別', idx.role],
  ] as const).filter(([, i]) => i < 0).map(([label]) => label);
  if (missing.length > 0) {
    issues.push({
      kind: 'missingColumn',
      row: 1,
      message: `標題列缺少必要欄位：${missing.join('、')}。請用系統提供的名冊範本，或確認第一列的欄位名稱。`,
    });
    // 缺必要欄位就整批不解析，避免把錯位的資料當成正確資料收進來
    return { cards, issues };
  }

  const seenAt = new Map<string, number>();

  for (let r = 1; r < values.length; r++) {
    const raw = values[r] ?? [];
    const cell = (i: number) => (i < 0 ? '' : String(raw[i] ?? '').trim());
    const fileRow = r + 1;

    const cells = raw.map((c) => String(c ?? '').trim());
    if (cells.every((c) => c === '')) continue;      // 空白列
    if (isGuideRow(cells)) continue;                 // 範本的說明列

    const studentId = cell(idx.studentId);
    const name = cell(idx.name);
    const rawRole = cell(idx.role);

    if (!studentId) {
      issues.push({ kind: 'emptyId', row: fileRow, message: `第 ${fileRow} 列沒有身分證號，已略過。` });
      continue;
    }
    if (!name) {
      issues.push({ kind: 'emptyName', row: fileRow, message: `第 ${fileRow} 列（${studentId}）沒有姓名，已略過。` });
      continue;
    }

    const role = normalizeRole(rawRole);
    if (rawRole && !ROLE_OPTIONS.includes(rawRole)) {
      issues.push({
        kind: 'unknownRole',
        row: fileRow,
        message: `第 ${fileRow} 列的職業類別「${rawRole}」不在選項內，已視為「${role}」。`,
      });
    }

    // 只填一個日期就自動補另一個 —— 兩者是「＋6 年 −1 天」的固定關係，
    // 要求使用者兩邊都填只是在製造不一致的機會
    let effectiveDate = normalizeDateToRocStr(cell(idx.effectiveDate));
    let expiryDate = normalizeDateToRocStr(cell(idx.expiryDate));
    if (effectiveDate && !expiryDate) expiryDate = calculateExpiryDate(effectiveDate);
    if (!effectiveDate && expiryDate) effectiveDate = calculateEffectiveDate(expiryDate);

    if (!effectiveDate && !expiryDate) {
      issues.push({
        kind: 'missingDates',
        row: fileRow,
        message: `第 ${fileRow} 列（${name}）沒有小卡起訖日，已略過。沒有效期就算不出證書年度，`
          + `所以起訖日是必填 —— 填生效日或到期日其中一個即可，另一個會自動算出來。`,
      });
      continue;
    }
    if (!rocStrToDate(effectiveDate) || !rocStrToDate(expiryDate)) {
      issues.push({
        kind: 'invalidDate',
        row: fileRow,
        message: `第 ${fileRow} 列（${name}）的日期無法解析：生效「${cell(idx.effectiveDate) || '空白'}」、`
          + `到期「${cell(idx.expiryDate) || '空白'}」。請用民國年格式，例如 113/08/20。`,
      });
      continue;
    }

    const cardId = composeCardId(studentId, role);
    const firstAt = seenAt.get(cardId);
    if (firstAt !== undefined) {
      // 保留先出現的那筆，與名冊解析的行為一致
      issues.push({
        kind: 'duplicate',
        row: fileRow,
        message: `第 ${fileRow} 列與第 ${firstAt} 列重複（${studentId}／${role}），已略過這一列。`,
      });
      continue;
    }
    seenAt.set(cardId, fileRow);

    const nationality = cell(idx.nationality);
    cards[cardId] = {
      name,
      role,
      nationality: NATIONALITY_OPTIONS.includes(nationality) ? nationality : '臺灣',
      effectiveDate,
      expiryDate,
    };
  }

  return { cards, issues };
}

/** 範本內容：標題列 + 說明列。空白的資料列不預先放，避免被誤存成真人員 */
export function buildRosterTemplate(): string[][] {
  return [[...ROSTER_TEMPLATE_HEADER], [...ROSTER_TEMPLATE_GUIDE]];
}
