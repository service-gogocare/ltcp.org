/**
 * 名冊試算表的欄位結構與解析（純函式，不碰網路）
 * ---------------------------------------------------------------------------
 * 試算表沒有任何唯一鍵約束，也擋不住使用者手動插欄、改標題、貼上整塊資料。
 * 所以這裡遵守兩個原則：
 *   1. 依標題名稱對應欄位，不依欄位順序（沿用 Excel 匯入既有做法）
 *   2. 遇到壞資料不整批失敗，逐列記錄問題讓使用者能看見並修正
 *
 * 這是整個 Google 試算表實作裡唯一能用單元測試蓋住的部分，
 * 也是最容易出錯的部分（童庭那批重複小卡就是同一類問題）。
 */

import { normalizeDateToRocStr, rocStrToDate } from '../calculator';
import { ROLE_OPTIONS, normalizeRole } from '../studentFields';
import { splitCardId } from '../cardPlan';
import type { CardRecord } from './types';

export const ROSTER_SHEET_TITLE = '人員名冊';
export const METADATA_SHEET_TITLE = '_metadata';
export const SCHEMA_VERSION = '1';

/** Drive 檔案上的標記，用來從使用者的雲端硬碟裡認出「這是本系統的名冊」 */
export const ROSTER_APP_PROPERTY = { key: 'ltcpRoster', value: '1' } as const;

export type ColumnKey =
  | 'studentId' | 'name' | 'nationality' | 'role' | 'effectiveDate' | 'expiryDate';

interface ColumnSpec {
  key: ColumnKey;
  header: string;
  /** 標題比對用的關鍵字，命中任何一個就算對應成功 */
  aliases: string[];
  required: boolean;
}

export const ROSTER_COLUMNS: ColumnSpec[] = [
  { key: 'studentId', header: '身分證號', aliases: ['身分證', '身份證', '統一證號'], required: true },
  { key: 'name', header: '姓名', aliases: ['姓名'], required: true },
  { key: 'nationality', header: '國籍', aliases: ['國籍'], required: false },
  { key: 'role', header: '職業類別', aliases: ['職業類別', '職登類別', '類別'], required: true },
  { key: 'effectiveDate', header: '生效日期', aliases: ['生效'], required: true },
  { key: 'expiryDate', header: '到期日期', aliases: ['到期'], required: true },
];

export const ROSTER_HEADER_ROW = ROSTER_COLUMNS.map((c) => c.header);

export type IssueKind =
  | 'missingColumn'    // 標題列缺少必要欄位
  | 'emptyId'          // 身分證號空白，無法產生識別鍵
  | 'emptyName'        // 姓名空白
  | 'invalidDate'      // 日期無法解析成民國日期
  | 'duplicate'        // 身分證號＋職業類別重複
  | 'unknownRole';     // 職業類別不在選項內，已自動正規化

export interface SheetIssue {
  kind: IssueKind;
  /** 試算表上的列號（1 起算，含標題列）；標題列本身的問題為 1 */
  row: number;
  message: string;
}

export interface HeaderMap {
  index: Partial<Record<ColumnKey, number>>;
  missing: string[];
}

/** 依標題名稱找出各欄位在第幾欄；找不到必要欄位就列進 missing */
export function mapHeaders(headerRow: string[]): HeaderMap {
  const cleaned = headerRow.map((h) => String(h ?? '').trim());
  const index: Partial<Record<ColumnKey, number>> = {};
  const missing: string[] = [];

  for (const col of ROSTER_COLUMNS) {
    const found = cleaned.findIndex((h) => h && col.aliases.some((a) => h.includes(a)));
    if (found >= 0) {
      index[col.key] = found;
    } else if (col.required) {
      missing.push(col.header);
    }
  }
  return { index, missing };
}

export interface ParsedRoster {
  /** 以「身分證號_職業類別」為鍵，與 Firestore 實作的回傳形狀相同 */
  cards: { [cardId: string]: CardRecord };
  issues: SheetIssue[];
}

/**
 * 解析整張名冊。
 * values[0] 是標題列，其餘為資料列；空白列會被略過而不記為問題。
 */
export function parseRoster(values: string[][]): ParsedRoster {
  const issues: SheetIssue[] = [];
  const cards: { [cardId: string]: CardRecord } = {};

  if (values.length === 0) {
    issues.push({ kind: 'missingColumn', row: 1, message: '試算表是空的，找不到標題列。' });
    return { cards, issues };
  }

  const { index, missing } = mapHeaders(values[0]);
  if (missing.length > 0) {
    issues.push({
      kind: 'missingColumn',
      row: 1,
      message: `標題列缺少必要欄位：${missing.join('、')}。請確認第一列的欄位名稱。`,
    });
    // 缺必要欄位就不往下解析，避免把錯位的資料當成正確資料讀進來
    return { cards, issues };
  }

  const cell = (row: string[], key: ColumnKey): string => {
    const i = index[key];
    return i === undefined ? '' : String(row[i] ?? '').trim();
  };

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const sheetRow = r + 1; // 試算表列號從 1 起算
    if (!row || row.every((v) => String(v ?? '').trim() === '')) continue;

    const studentId = cell(row, 'studentId');
    const name = cell(row, 'name');
    const rawRole = cell(row, 'role');

    if (!studentId) {
      issues.push({ kind: 'emptyId', row: sheetRow, message: `第 ${sheetRow} 列沒有身分證號，已略過。` });
      continue;
    }

    const role = normalizeRole(rawRole);
    if (rawRole && !ROLE_OPTIONS.includes(rawRole)) {
      issues.push({
        kind: 'unknownRole',
        row: sheetRow,
        message: `第 ${sheetRow} 列的職業類別「${rawRole}」不在選項內，已視為「${role}」。`,
      });
    }

    if (!name) {
      issues.push({ kind: 'emptyName', row: sheetRow, message: `第 ${sheetRow} 列（${studentId}）沒有姓名。` });
    }

    const effectiveDate = normalizeDateToRocStr(cell(row, 'effectiveDate'));
    const expiryDate = normalizeDateToRocStr(cell(row, 'expiryDate'));
    for (const [label, value] of [['生效日期', effectiveDate], ['到期日期', expiryDate]] as const) {
      if (!rocStrToDate(value)) {
        issues.push({
          kind: 'invalidDate',
          row: sheetRow,
          message: `第 ${sheetRow} 列（${name || studentId}）的${label}無法解析：「${value || '空白'}」。`,
        });
      }
    }

    const cardId = `${studentId}_${role}`;
    if (cards[cardId]) {
      // 保留先出現的那筆。覆蓋掉的話，使用者看到的會是最後一列，
      // 但重複的成因通常是後面被貼進來的那列才是多餘的。
      issues.push({
        kind: 'duplicate',
        row: sheetRow,
        message: `第 ${sheetRow} 列與前面的資料重複（${studentId}／${role}），已略過這一列。`,
      });
      continue;
    }

    cards[cardId] = {
      name,
      role,
      nationality: cell(row, 'nationality') || '臺灣',
      effectiveDate,
      expiryDate,
    };
  }

  return { cards, issues };
}

// ── 寫入規劃 ────────────────────────────────────────────────────

/** 欄索引轉試算表欄名：0 → A、25 → Z、26 → AA */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** 組出 A1 表示法。分頁名稱含空格或中文時要加單引號，內部的單引號要跳脫 */
export function toA1Range(sheetTitle: string, rowIndex: number, startCol: number, endCol: number): string {
  const title = `'${sheetTitle.replace(/'/g, "''")}'`;
  const row = rowIndex + 1;
  return `${title}!${columnLetter(startCol)}${row}:${columnLetter(endCol)}${row}`;
}

export interface RowUpdate {
  /** 0 起算的列索引（含標題列，所以第一筆資料是 1） */
  rowIndex: number;
  startCol: number;
  endCol: number;
  values: string[];
}

export interface SheetWritePlan {
  updates: RowUpdate[];
  appends: string[][];
  /** 無法安全寫入時的原因；有值時 updates 與 appends 必為空 */
  blocked?: string;
}

/**
 * 規劃「儲存」要對試算表做什麼。
 *
 * 三個刻意的行為：
 *   1. 只更新與新增，**絕不刪除**。表格上的資料可能只是整份名冊的一部分
 *      （例如剛匯入一份只含部分人員的 Excel），照著它刪列會毀掉其他人的資料。
 *      刪除是獨立的操作，走 planSheetDeletes。
 *   2. 依實際的標題位置寫入，而不是固定的 A..F。使用者調換過欄位順序時，
 *      照位置寫會把資料寫到錯的欄。
 *   3. 更新範圍內若有沒對應到的欄（例如使用者自己加的備註欄夾在中間），
 *      沿用該儲存格原本的內容，不清空。
 */
export function planSheetWrites(
  currentValues: string[][],
  writes: { cardId: string; record: CardRecord }[],
): SheetWritePlan {
  if (currentValues.length === 0) {
    return { updates: [], appends: [], blocked: '試算表是空的，找不到標題列，無法安全寫入。' };
  }
  const { index, missing } = mapHeaders(currentValues[0]);
  if (missing.length > 0) {
    return {
      updates: [],
      appends: [],
      blocked: `標題列缺少必要欄位：${missing.join('、')}，無法安全寫入。請先修正名冊的標題列。`,
    };
  }

  const positions = ROSTER_COLUMNS
    .map((c) => ({ key: c.key, col: index[c.key] }))
    .filter((p): p is { key: ColumnKey; col: number } => p.col !== undefined);
  const startCol = Math.min(...positions.map((p) => p.col));
  const endCol = Math.max(...positions.map((p) => p.col));

  // 現有列的 cardId → 列索引。重複時保留先出現的那筆，與 parseRoster 一致
  const rowOf = new Map<string, number>();
  for (let r = 1; r < currentValues.length; r++) {
    const row = currentValues[r] ?? [];
    const sid = String(row[index.studentId!] ?? '').trim();
    if (!sid) continue;
    const cardId = `${sid}_${normalizeRole(String(row[index.role!] ?? '').trim())}`;
    if (!rowOf.has(cardId)) rowOf.set(cardId, r);
  }

  const updates: RowUpdate[] = [];
  const appends: string[][] = [];
  let nextAppendRow = currentValues.length;

  for (const { cardId, record } of writes) {
    const cells = valuesByColumn(cardId, record, positions, startCol, endCol);
    const existingRow = rowOf.get(cardId);

    // 新列沒有原值可沿用，未對應到的欄一律留空
    const asNewRow = cells.map((v) => v ?? '');

    if (existingRow === undefined) {
      // 新增的列也要記進 rowOf，同一批裡出現兩次相同 cardId 時才不會附加兩列
      rowOf.set(cardId, nextAppendRow);
      nextAppendRow++;
      appends.push(asNewRow);
    } else if (existingRow >= currentValues.length) {
      // 這一輪稍早才決定要附加的，內容以最後一次為準
      appends[existingRow - currentValues.length] = asNewRow;
    } else {
      const original = currentValues[existingRow] ?? [];
      const merged = cells.map((v, i) => (v === null ? String(original[startCol + i] ?? '') : v));
      updates.push({ rowIndex: existingRow, startCol, endCol, values: merged as string[] });
    }
  }

  return { updates, appends };
}

/** 依實際欄位位置排出一列的內容；沒對應到的欄回傳 null 代表「沿用原值」 */
function valuesByColumn(
  cardId: string,
  record: CardRecord,
  positions: { key: ColumnKey; col: number }[],
  startCol: number,
  endCol: number,
): (string | null)[] {
  const row = cardToRow(cardId, record);
  const byKey: Record<string, string> = {};
  ROSTER_COLUMNS.forEach((c, i) => { byKey[c.key] = row[i]; });

  const cells: (string | null)[] = new Array(endCol - startCol + 1).fill(null);
  for (const p of positions) {
    cells[p.col - startCol] = byKey[p.key] ?? '';
  }
  return cells;
}

/**
 * 規劃「刪除」要移除哪幾列。
 * 回傳的列索引**由大到小排序** —— 由小到大逐列刪除會讓後面的索引全部位移，
 * 刪到第二筆就已經刪錯列了。
 */
export function planSheetDeletes(
  currentValues: string[][],
  cardIds: string[],
): { rowIndexes: number[]; notFound: string[] } {
  if (currentValues.length === 0) return { rowIndexes: [], notFound: [...cardIds] };
  const { index, missing } = mapHeaders(currentValues[0]);
  if (missing.length > 0) return { rowIndexes: [], notFound: [...cardIds] };

  const rowsOf = new Map<string, number[]>();
  for (let r = 1; r < currentValues.length; r++) {
    const row = currentValues[r] ?? [];
    const sid = String(row[index.studentId!] ?? '').trim();
    if (!sid) continue;
    const cardId = `${sid}_${normalizeRole(String(row[index.role!] ?? '').trim())}`;
    if (!rowsOf.has(cardId)) rowsOf.set(cardId, []);
    rowsOf.get(cardId)!.push(r);
  }

  const rowIndexes: number[] = [];
  const notFound: string[] = [];
  for (const cardId of cardIds) {
    const rows = rowsOf.get(cardId);
    if (!rows || rows.length === 0) {
      notFound.push(cardId);
      continue;
    }
    // 重複列一併刪掉：使用者要刪的是「這個人」，留著重複列只會再次造成混亂
    rowIndexes.push(...rows);
  }

  return {
    rowIndexes: [...new Set(rowIndexes)].sort((a, b) => b - a),
    notFound,
  };
}

/** 把一筆小卡轉成試算表的一列，欄位順序與 ROSTER_HEADER_ROW 一致 */
export function cardToRow(cardId: string, record: CardRecord): string[] {
  return [
    splitCardId(cardId).studentId,
    record.name,
    record.nationality || '臺灣',
    record.role || '',
    record.effectiveDate,
    record.expiryDate,
  ];
}

/** 組出完整的試算表內容（標題列 + 所有資料列），供建檔與整批覆寫使用 */
export function buildRosterValues(cards: { [cardId: string]: CardRecord }): string[][] {
  return [
    [...ROSTER_HEADER_ROW],
    ...Object.entries(cards).map(([cardId, record]) => cardToRow(cardId, record)),
  ];
}
