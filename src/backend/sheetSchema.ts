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
import type { AttributeBucket } from '../calculator';
import { ROLE_OPTIONS, normalizeRole } from '../studentFields';
import { splitCardId, composeCardId } from '../cardPlan';
import {
  ATTRIBUTE_BUCKETS,
  CATEGORY_BUCKETS,
  CARD_YEAR_OUT_OF_RANGE,
  MONTH_UNASSIGNED,
  isReplacedByUpload,
  monthSortKey,
  type CategoryBucket,
  type MonthlyPointRecord,
  type MonthlyPointRow,
} from '../monthlyPoints';
import type { TrendTable } from '../monthlyReview';
import type { CardRecord } from './types';

export const ROSTER_SHEET_TITLE = '人員名冊';
export const METADATA_SHEET_TITLE = '_metadata';
export const SCHEMA_VERSION = '1';

/** Drive 檔案上的標記，用來從使用者的雲端硬碟裡認出「這是本系統的名冊」 */
export const ROSTER_APP_PROPERTY = { key: 'ltcpRoster', value: '1' } as const;

export type ColumnKey =
  | 'studentId' | 'name' | 'nationality' | 'role' | 'effectiveDate' | 'expiryDate';

export interface ColumnSpec<K extends string> {
  key: K;
  header: string;
  /** 標題比對用的關鍵字，命中任何一個就算對應成功 */
  aliases: string[];
  required: boolean;
}

export const ROSTER_COLUMNS: ColumnSpec<ColumnKey>[] = [
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
  | 'unknownRole'      // 職業類別不在選項內，已自動正規化
  | 'invalidMonth'     // 積分月報的曆月無法解析
  | 'invalidCardYear'; // 積分月報的證書年度無法解析

export interface SheetIssue {
  kind: IssueKind;
  /** 試算表上的列號（1 起算，含標題列）；標題列本身的問題為 1 */
  row: number;
  message: string;
}

export interface HeaderMap<K extends string> {
  index: Partial<Record<K, number>>;
  missing: string[];
}

/**
 * 依標題名稱找出各欄位在第幾欄；找不到必要欄位就列進 missing。
 *
 * `columns` **刻意不給預設值**：給了的話，未來就可能拿名冊的欄位定義去對
 * 積分月報的標題列，而且不會有任何錯誤 —— 只會安靜地全部對不到。
 */
export function mapHeaders<K extends string>(
  headerRow: (string | number)[],
  columns: ColumnSpec<K>[],
): HeaderMap<K> {
  const cleaned = headerRow.map((h) => String(h ?? '').trim());
  const index: Partial<Record<K, number>> = {};
  const missing: string[] = [];

  for (const col of columns) {
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

  const { index, missing } = mapHeaders(values[0], ROSTER_COLUMNS);
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
  const { index, missing } = mapHeaders(currentValues[0], ROSTER_COLUMNS);
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
  const { index, missing } = mapHeaders(currentValues[0], ROSTER_COLUMNS);
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


// ── 積分月報 ────────────────────────────────────────────────────
//
// 為什麼有些欄位標題掛著 ※：同一筆課程積分會同時落進「屬性桶」與「類別桶」。
// 一門 1 分的原住民族文化課程（屬性為專業課程、實體）會讓「專業課程-實體」
// 與「※新制文化-原住民族」各加 1 —— 那不是兩分，是同一分的兩種切法。
// **只有不帶 ※ 的八個屬性欄相加才是計入 120 分總分的積分。**
// 掛 ※ 的欄是四大核心與文化課程的檢核用，把整列橫著加總會得到約兩倍的數字。

export const MONTHLY_SHEET_TITLE = '積分月報';

/** 曆月無法判定的列在試算表上顯示成這個字（對應 MONTH_UNASSIGNED） */
export const MONTH_UNASSIGNED_LABEL = '無法歸月';

/** 課程日期不在任何證書年度內的列（對應 CARD_YEAR_OUT_OF_RANGE） */
export const CARD_YEAR_OUT_OF_RANGE_LABEL = '效期外';

/** 舊制文化屬性拆解的欄位鍵，加前綴以免與屬性桶本身撞名 */
export type CulturalOldColumnKey = `old_${AttributeBucket}`;

export type MonthlyColumnKey =
  | 'studentId' | 'name' | 'role' | 'month' | 'cardYear' | 'analyzedEffectiveDate'
  | AttributeBucket
  | CategoryBucket
  | CulturalOldColumnKey;

const ATTRIBUTE_HEADER: Record<AttributeBucket, string> = {
  professionalPhysical: '專業課程-實體',
  professionalOnline: '專業課程-網路',
  qualityPhysical: '專業品質-實體',
  qualityOnline: '專業品質-網路',
  ethicsPhysical: '專業倫理-實體',
  ethicsOnline: '專業倫理-網路',
  regulationsPhysical: '專業法規-實體',
  regulationsOnline: '專業法規-網路',
};

const CATEGORY_HEADER: Record<CategoryBucket, string> = {
  fireSafety: '※消防安全',
  emergencyResponse: '※緊急應變',
  infectionControl: '※感染管制',
  genderSensitivity: '※性別敏感度',
  culturalOld: '※舊制文化合計',
  culturalNewIndigenous: '※新制文化-原住民族',
  culturalNewMulticultural: '※新制文化-多元族群',
};

const CULTURAL_OLD_HEADER: Record<AttributeBucket, string> = {
  professionalPhysical: '※舊制文化-專業-實體',
  professionalOnline: '※舊制文化-專業-網路',
  qualityPhysical: '※舊制文化-品質-實體',
  qualityOnline: '※舊制文化-品質-網路',
  ethicsPhysical: '※舊制文化-倫理-實體',
  ethicsOnline: '※舊制文化-倫理-網路',
  regulationsPhysical: '※舊制文化-法規-實體',
  regulationsOnline: '※舊制文化-法規-網路',
};

/** 積分欄的標題就是它唯一的別名：這張表是程式寫的，不必像名冊那樣做模糊比對 */
function pointsColumn(key: MonthlyColumnKey, header: string): ColumnSpec<MonthlyColumnKey> {
  return { key, header, aliases: [header], required: false };
}

export const MONTHLY_COLUMNS: ColumnSpec<MonthlyColumnKey>[] = [
  { key: 'studentId', header: '身分證號', aliases: ['身分證號'], required: true },
  { key: 'name', header: '姓名', aliases: ['姓名'], required: false },
  // 同一人可能同時具備兩種職業類別、各自一張小卡，少了這欄兩者會併成一列
  { key: 'role', header: '職業類別', aliases: ['職業類別'], required: true },
  { key: 'month', header: '曆月', aliases: ['曆月'], required: true },
  { key: 'cardYear', header: '證書年度', aliases: ['證書年度'], required: true },
  { key: 'analyzedEffectiveDate', header: '分析時生效日', aliases: ['分析時生效日'], required: false },
  ...ATTRIBUTE_BUCKETS.map((k) => pointsColumn(k, ATTRIBUTE_HEADER[k])),
  ...CATEGORY_BUCKETS.map((k) => pointsColumn(k, CATEGORY_HEADER[k])),
  ...ATTRIBUTE_BUCKETS.map((k) => pointsColumn(`old_${k}` as MonthlyColumnKey, CULTURAL_OLD_HEADER[k])),
];

export const MONTHLY_HEADER_ROW = MONTHLY_COLUMNS.map((c) => c.header);

/**
 * 0 一律寫成空字串，非 0 寫成**數字**。
 *
 * 空字串：23 個積分欄大多是 0，全部印出來會讓人根本讀不下去。
 * 數字而非字串：使用者會直接開試算表核對，寫成文字的話 SUM 加不起來。
 * 相對地曆月與生效日必須維持字串，否則 `114/03` 會被 Sheets 當成日期換算掉。
 */
function pointsCell(value: number): string | number {
  return value === 0 ? '' : value;
}

function parsePointsCell(raw: string): number {
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

/** 證書年度序號 → 顯示字串。0 代表課程日期落在效期外 */
export function cardYearLabel(index: number): string {
  return index === CARD_YEAR_OUT_OF_RANGE ? CARD_YEAR_OUT_OF_RANGE_LABEL : `第${index}年`;
}

/** 把一筆月報紀錄排成試算表的一列，欄位順序與 MONTHLY_HEADER_ROW 一致 */
export function monthlyRecordToRow(record: MonthlyPointRecord): (string | number)[] {
  const { row } = record;
  const byKey: Partial<Record<MonthlyColumnKey, string | number>> = {
    studentId: splitCardId(record.cardId).studentId,
    name: record.name,
    role: splitCardId(record.cardId).role,
    month: row.month === MONTH_UNASSIGNED ? MONTH_UNASSIGNED_LABEL : row.month,
    cardYear: cardYearLabel(row.cardYearIndex),
    analyzedEffectiveDate: record.analyzedEffectiveDate,
  };
  ATTRIBUTE_BUCKETS.forEach((k) => { byKey[k] = pointsCell(row.buckets[k]); });
  CATEGORY_BUCKETS.forEach((k) => { byKey[k] = pointsCell(row.categories[k]); });
  ATTRIBUTE_BUCKETS.forEach((k) => {
    byKey[`old_${k}` as MonthlyColumnKey] = pointsCell(row.culturalOldByBucket[k]);
  });

  return MONTHLY_COLUMNS.map((c) => byKey[c.key] ?? '');
}

/** 組出完整的積分月報內容（標題列 + 所有資料列），供建立分頁與整批覆寫使用 */
export function buildMonthlyValues(records: MonthlyPointRecord[]): (string | number)[][] {
  return [[...MONTHLY_HEADER_ROW], ...records.map(monthlyRecordToRow)];
}

export interface ParsedMonthlyReport {
  records: MonthlyPointRecord[];
  issues: SheetIssue[];
}

/**
 * 解析整張積分月報。
 *
 * 壞資料一律不猜：曆月或證書年度看不懂時**保留該列的積分**並記一則問題，
 * 而不是丟掉。積分總額是最需要守住的東西，看不懂的分類頂多讓逐年檢核少一筆，
 * 丟掉卻會讓總分莫名變少而且無從追查。
 */
export function parseMonthlyReport(values: (string | number)[][]): ParsedMonthlyReport {
  const issues: SheetIssue[] = [];
  const records: MonthlyPointRecord[] = [];

  if (values.length === 0) return { records, issues };

  const { index, missing } = mapHeaders(values[0], MONTHLY_COLUMNS);
  if (missing.length > 0) {
    issues.push({
      kind: 'missingColumn',
      row: 1,
      message: `積分月報的標題列缺少必要欄位：${missing.join('、')}。請確認第一列的欄位名稱。`,
    });
    return { records, issues };
  }

  const cell = (row: (string | number)[], key: MonthlyColumnKey): string => {
    const i = index[key];
    return i === undefined ? '' : String(row[i] ?? '').trim();
  };

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const sheetRow = r + 1;
    if (!row || row.every((v) => String(v ?? '').trim() === '')) continue;

    const studentId = cell(row, 'studentId');
    if (!studentId) {
      issues.push({ kind: 'emptyId', row: sheetRow, message: `積分月報第 ${sheetRow} 列沒有身分證號，已略過。` });
      continue;
    }
    const role = normalizeRole(cell(row, 'role'));

    const rawMonth = cell(row, 'month');
    let month = MONTH_UNASSIGNED;
    if (rawMonth !== MONTH_UNASSIGNED_LABEL) {
      month = rawMonth;
      if (isNaN(monthSortKey(rawMonth))) {
        issues.push({
          kind: 'invalidMonth',
          row: sheetRow,
          message: `積分月報第 ${sheetRow} 列的曆月「${rawMonth || '空白'}」無法解析，積分已保留但不會被重新上傳取代。`,
        });
      }
    }

    const rawYear = cell(row, 'cardYear');
    let cardYearIndex = CARD_YEAR_OUT_OF_RANGE;
    const yearMatch = /^第(\d+)年$/.exec(rawYear);
    if (yearMatch) {
      cardYearIndex = Number(yearMatch[1]);
    } else if (rawYear !== CARD_YEAR_OUT_OF_RANGE_LABEL) {
      issues.push({
        kind: 'invalidCardYear',
        row: sheetRow,
        message: `積分月報第 ${sheetRow} 列的證書年度「${rawYear || '空白'}」無法解析，已視為效期外；該列積分仍計入總分。`,
      });
    }

    const pointRow: MonthlyPointRow = {
      month,
      cardYearIndex,
      buckets: {} as MonthlyPointRow['buckets'],
      categories: {} as MonthlyPointRow['categories'],
      culturalOldByBucket: {} as MonthlyPointRow['culturalOldByBucket'],
    };
    ATTRIBUTE_BUCKETS.forEach((k) => { pointRow.buckets[k] = parsePointsCell(cell(row, k)); });
    CATEGORY_BUCKETS.forEach((k) => { pointRow.categories[k] = parsePointsCell(cell(row, k)); });
    ATTRIBUTE_BUCKETS.forEach((k) => {
      pointRow.culturalOldByBucket[k] = parsePointsCell(cell(row, `old_${k}` as MonthlyColumnKey));
    });

    records.push({
      cardId: composeCardId(studentId, role),
      name: cell(row, 'name'),
      analyzedEffectiveDate: cell(row, 'analyzedEffectiveDate'),
      row: pointRow,
    });
  }

  return { records, issues };
}

export interface MonthlyReplacePlan {
  /** 要刪除的列索引（0 起算，含標題列），**由大到小** */
  deleteRowIndexes: number[];
  appends: (string | number)[][];
  /** 無法安全寫入時的原因；有值時上面兩者必為空 */
  blocked?: string;
}

/**
 * 規劃「這次分析的結果」要怎麼取代積分月報上的既有資料。
 *
 * 取代的是**匯出月（含）以前的所有月份 × 這次出現的人員**。
 * 「這次出現的人員」由 `touchedCardIds` 明確指定，不從 `records` 推導 ——
 * 某人這個月的課全部變成「不符合」時他一列都不會產出，但舊資料仍須清掉。
 *
 *   - 衛福部每次匯出都是生平全紀錄，所以同一份檔重跑幾次結果一樣（不會加倍）
 *   - 被撤銷的課一定清得掉：整個月都沒課了也還在取代範圍內
 *   - 重傳較舊的匯出檔時，比它新的月份不會被抹掉
 *   - 這次沒出現的人員，資料原封不動
 *
 * 另外一律刪除這些人員的「無法歸月」列：那種列沒有日期，永遠落不進任何範圍，
 * 不特別處理的話會在試算表上永久累積，每次上傳都多一份。
 *
 * 曆月看不懂的列（使用者手改過）**不刪** —— 我們看不懂的東西不替使用者決定要不要毀掉，
 * 由 parseMonthlyReport 記成問題讓人自己處理。
 */
export function planMonthlyReplace(
  currentValues: (string | number)[][],
  records: MonthlyPointRecord[],
  throughMonth: string,
  touchedCardIds: string[],
): MonthlyReplacePlan {
  const appends = records.map(monthlyRecordToRow);

  // 分頁還不存在或完全是空的：沒有東西要刪，直接附加
  if (currentValues.length === 0) return { deleteRowIndexes: [], appends };

  const { index, missing } = mapHeaders(currentValues[0], MONTHLY_COLUMNS);
  if (missing.length > 0) {
    return {
      deleteRowIndexes: [],
      appends: [],
      blocked: `積分月報的標題列缺少必要欄位：${missing.join('、')}，無法安全寫入。請先修正標題列，或刪掉整張「${MONTHLY_SHEET_TITLE}」分頁讓系統重建。`,
    };
  }

  const touched = new Set(touchedCardIds);

  const deleteRowIndexes: number[] = [];
  for (let r = 1; r < currentValues.length; r++) {
    const row = currentValues[r] ?? [];
    const sid = String(row[index.studentId!] ?? '').trim();
    if (!sid) continue;
    const cardId = composeCardId(sid, normalizeRole(String(row[index.role!] ?? '').trim()));
    if (!touched.has(cardId)) continue;

    // 顯示用的「無法歸月」要先還原成內部值，取代規則才認得它
    const rawMonth = String(row[index.month!] ?? '').trim();
    const month = rawMonth === MONTH_UNASSIGNED_LABEL ? MONTH_UNASSIGNED : rawMonth;
    if (isReplacedByUpload(month, throughMonth)) deleteRowIndexes.push(r);
  }

  return { deleteRowIndexes: deleteRowIndexes.sort((a, b) => b - a), appends };
}

// ── 積分總表 ────────────────────────────────────────────────────
//
// 一人一列、涵蓋整個 6 年週期的快照，欄位與「下載本次分析結果」那個 Excel
// 完全相同 —— 試算表上看到的就是下載回去的那組數字。
//
// **這張表是衍生的**：每次儲存都從積分月報整張重算重寫，不是獨立維護的資料。
// 所以它不可能與月報不一致；反過來說，它也沒有「每月／歷年」的維度 ——
// 每個人只有一列，時間軸在積分月報那張表上。

export const SUMMARY_SHEET_TITLE = '積分總表';

export const SUMMARY_COLUMNS: string[] = [
  '身分證號', '國籍', '姓名', '職業類別',
  '專業課程_實體', '專業課程_網路', '專業課程_總計',
  '專業品質_實體', '專業品質_網路',
  '專業倫理_實體', '專業倫理_網路',
  '專業法規_實體', '專業法規_網路',
  '品質倫理法規_總計',
  '消防安全', '緊急應變', '感染管制', '性別敏感度', '四大核心_總計',
  '原住民族與多元族群文化(舊)', '舊制文化超上限未採計',
  '原住民族文化(新)', '多元族群文化(新)', '新制文化逐年檢核',
  '實體課程(raw total)', '網路課程(raw total)', '最終總計',
  '小卡起始日', '小卡到期日', '注意',
];

/** 積分總表上要維持文字格式的欄（民國日期會被 Sheets 當西元換算掉） */
export const SUMMARY_TEXT_COLUMNS = ['身分證號', '小卡起始日', '小卡到期日'];

/**
 * 組出整張積分總表（標題列 + 每人一列）。
 *
 * 數字維持數字型別，讓使用者在試算表上 SUM 得起來；其餘一律轉字串。
 * 缺的欄位寫空白而不是略過 —— 欄位順序必須固定，否則欄位會錯位。
 */
export function buildSummaryValues(
  rows: Record<string, string | number>[],
): (string | number)[][] {
  return [
    [...SUMMARY_COLUMNS],
    ...rows.map((row) => SUMMARY_COLUMNS.map((col) => {
      const value = row[col];
      if (typeof value === 'number') return value;
      return value === undefined || value === null ? '' : String(value);
    })),
  ];
}

// ── 累計走勢 ────────────────────────────────────────────────────
//
// 目的：讓使用者**開試算表就看到圖**，不必開網頁。
//
// 版面上最重要的決定是**一次只看一個人的一個年度**。原本把 57 個月攤成 57 欄
// 的寬表要橫拉很久才看得完，而且沒辦法用公式挑出「某人某年度的 12 個月」——
// 每個人的生效月不同，同一個年度落在不同的欄。
//
// 所以資料改放在隱藏的長表（一列一個「人員 × 曆月」），顯示面只留：
//   - 兩個下拉選單（人員／證書年度）＋ 三條 FILTER 陣列公式挑出那 12 個月
//   - 一張綁在那 12 個月上的折線圖，選單一改圖就跟著變
//   - 下方一覽表只有 6 欄（含每人一格的 SPARKLINE），不再有橫向捲軸

export const TREND_SHEET_TITLE = '累計走勢';
export const TREND_DATA_SHEET_TITLE = '_走勢資料';

/** 隱藏長表的欄位順序 */
export const TREND_DATA_HEADER = ['人員鍵', '顯示名稱', '證書年度', '曆月', '累計實得', '應達進度'];
/** 人員下拉選單的來源清單放在長表的哪一欄（0 起算） */
export const TREND_DATA_LIST_COL = 7;

// 顯示面的列位置（0 起算）
export const TREND_SELECT_PERSON_ROW = 0;
export const TREND_SELECT_YEAR_ROW = 1;
export const TREND_PERIOD_ROW = 2;
export const TREND_YEAREND_ROW = 3;
export const TREND_MONTH_ROW = 5;
export const TREND_EARNED_ROW = 6;
export const TREND_EXPECTED_ROW = 7;
export const TREND_CHART_ANCHOR_ROW = 9;
export const TREND_LIST_TITLE_ROW = 26;
export const TREND_LIST_HEADER_ROW = 27;
export const TREND_LIST_FIRST_ROW = 28;

/** 標籤在 A 欄，資料從 B 欄開始，一個年度剛好 12 個月 */
export const TREND_FIRST_DATA_COL = 1;
export const TREND_MONTHS_PER_YEAR = 12;

export const TREND_LIST_HEADER = ['身分證號', '職業類別', '姓名', '累計走勢', '目前', '應達'];
/** 一覽表的 SPARKLINE 放在第幾欄（0 起算） */
export const TREND_LIST_SPARKLINE_COL = 3;

/** A1 表示法用的欄字母 */
const dataColLetter = columnLetter(TREND_FIRST_DATA_COL);
const lastColLetter = columnLetter(TREND_FIRST_DATA_COL + TREND_MONTHS_PER_YEAR - 1);
/** 試算表列號從 1 起算 */
const sheetRow = (rowIndex: number) => rowIndex + 1;

/**
 * 挑出「選定人員 × 選定年度」那一段的陣列公式。
 *
 * 一格一條 FILTER 就夠 —— TRANSPOSE 讓它橫著展開成 12 欄，
 * 選單一改就整條重算。逐格寫 INDEX 的話同一張表會有 36 條公式。
 */
function trendFilterFormula(dataCol: string): string {
  const data = `'${TREND_DATA_SHEET_TITLE}'`;
  return `=IFERROR(TRANSPOSE(FILTER(${data}!${dataCol}2:${dataCol},`
    + ` ${data}!B2:B=$B$${sheetRow(TREND_SELECT_PERSON_ROW)},`
    + ` ${data}!C2:C=$B$${sheetRow(TREND_SELECT_YEAR_ROW)})), "")`;
}

/**
 * SPARKLINE 的 y 軸固定 0~120，這樣所有人的高度才可以互相比較。
 * 代價：超過 120 分的人會在頂端截平 —— 讀起來是「已經滿了」，
 * 確切數字就在同一列的「目前」欄。
 */
function trendSparkline(fromRow: number, toRow: number): string {
  const data = `'${TREND_DATA_SHEET_TITLE}'`;
  const options = '{"charttype","line";"ymin",0;"ymax",120;"color","#0891b2";"linewidth",2}';
  return `=IFERROR(SPARKLINE(${data}!E${fromRow}:E${toRow}, ${options}), "")`;
}

/** 隱藏長表的內容。第 8 欄（H）另外放人員清單，供下拉選單當來源 */
export function buildTrendData(table: TrendTable): (string | number)[][] {
  const width = TREND_DATA_LIST_COL + 1;
  const blank = (): (string | number)[] => new Array(width).fill('');

  const header = blank();
  TREND_DATA_HEADER.forEach((h, i) => { header[i] = h; });
  header[TREND_DATA_LIST_COL] = '人員清單';

  const rows = table.points.map((pt) => {
    const row = blank();
    row[0] = pt.cardId;
    row[1] = pt.display;
    row[2] = `第${pt.cardYearIndex}年`;
    row[3] = pt.month;
    row[4] = pt.total;
    row[5] = pt.expected;
    return row;
  });

  // 人員清單與長表列數無關，短的那邊補空白列
  table.people.forEach((person, i) => {
    while (rows.length <= i) rows.push(blank());
    rows[i][TREND_DATA_LIST_COL] = person.display;
  });

  return [header, ...rows];
}

/**
 * 公式會橫向展開的範圍。這些格子**不可以**被值寫入碰到。
 *
 * 寫入空字串不等於清空：那一格會變成「看起來是空的但有值」，
 * 而陣列公式不覆蓋有值的儲存格，TRANSPOSE(FILTER(...)) 就展不開而回報 #REF!。
 * 值寫入必須完全避開這幾列的 B 欄之後，並在寫公式前用 values.clear 清乾淨。
 */
export const TREND_FORMULA_SPILL_RANGE =
  `${dataColLetter}${sheetRow(TREND_PERIOD_ROW)}:${lastColLetter}${sheetRow(TREND_EXPECTED_ROW)}`;

/** 顯示面的內容（不含公式 —— 那要用 USER_ENTERED 另外寫） */
export function buildTrendValues(table: TrendTable): (string | number)[][] {
  const width = TREND_FIRST_DATA_COL + TREND_MONTHS_PER_YEAR;
  const blank = (): (string | number)[] => new Array(width).fill('');
  /** 只有 A 欄標籤的列：後面不補空字串，免得佔住公式要展開的格子 */
  const labelOnly = (label: string): (string | number)[] => [label];

  const values: (string | number)[][] = [];
  for (let r = 0; r < TREND_LIST_FIRST_ROW; r++) values.push(blank());

  // 這兩列的 B 欄是下拉選單的值，由值寫入負責
  values[TREND_SELECT_PERSON_ROW][0] = '人員';
  values[TREND_SELECT_YEAR_ROW][0] = '證書年度';
  // 第一次打開不該是空白的，所以先選好第一個人與第 1 年
  values[TREND_SELECT_PERSON_ROW][1] = table.people[0]?.display ?? '';
  values[TREND_SELECT_YEAR_ROW][1] = '第1年';

  // 以下五列的 B 欄之後全是公式的地盤，只寫 A 欄標籤，其餘一格都不碰
  values[TREND_PERIOD_ROW] = labelOnly('期間');
  values[TREND_YEAREND_ROW] = labelOnly('年度末累計');
  values[TREND_MONTH_ROW] = labelOnly('曆月');
  values[TREND_EARNED_ROW] = labelOnly('累計實得');
  values[TREND_EXPECTED_ROW] = labelOnly('應達進度');

  values[TREND_LIST_TITLE_ROW][0] = '全部人員一覽（走勢圖涵蓋該員的整個證書期間）';
  TREND_LIST_HEADER.forEach((h, i) => { values[TREND_LIST_HEADER_ROW][i] = h; });

  for (const person of table.people) {
    const row = blank();
    row[0] = person.studentId;
    row[1] = person.role;
    row[2] = person.name;
    row[TREND_LIST_SPARKLINE_COL] = '';   // 公式另外寫
    row[4] = person.current;
    row[5] = person.expected;
    values.push(row);
  }

  return values;
}

export interface TrendFormulaBlock {
  /** A1 表示法的範圍（不含分頁名） */
  range: string;
  values: string[][];
}

/**
 * 顯示面要用 USER_ENTERED 寫入的公式。
 * 分開回傳是因為值必須用 RAW（民國月份會被當日期換算），公式不能。
 */
/**
 * 取範圍中最後一個非空值。
 *
 * **不要改回 `LOOKUP(2,1/(範圍<>""),範圍)`。** 那個慣用法在這裡會壞：
 * 它依賴 `1/(範圍<>"")` 產生「前面一串 1、後面一串 #DIV/0!」的非均勻向量，
 * 二分搜尋才找得到最後一個 1。但這裡的年度**填滿 12 個月時整列都是 1**，
 * 搜尋鍵 2 大於所有元素而元素又全部相等，Google Sheets 的二分搜尋會落在
 * 第一格 —— 症狀就是「期間」顯示成 112/02 ~ 112/02。
 * 未滿 12 個月的年度反而正常，因為尾端的空格造出了那串 #DIV/0!。
 *
 * 改用 INDEX + COUNTA。範圍的內容一律是從最左邊連續填過來的
 * （FILTER + TRANSPOSE 不會在中間留洞），所以最後一個非空值就是第 COUNTA 個。
 *
 * `MAX(1, COUNTA(...))` 不能省：COUNTA 為 0 時 `INDEX(範圍, 1, 0)` 在
 * Google Sheets 裡**回傳整列陣列**而不是單一格，塞不進一格就是 #REF!，
 * 而且外層的 IF 救不了 —— Sheets 仍會評估 false 分支的陣列形狀。
 */
function lastNonEmpty(range: string): string {
  return `IFERROR(INDEX(${range},1,MAX(1,COUNTA(${range}))),"")`;
}

export function buildTrendFormulas(table: TrendTable): TrendFormulaBlock[] {
  const monthRange = `${dataColLetter}${sheetRow(TREND_MONTH_ROW)}:${lastColLetter}${sheetRow(TREND_MONTH_ROW)}`;
  const earnedRange = `${dataColLetter}${sheetRow(TREND_EARNED_ROW)}:${lastColLetter}${sheetRow(TREND_EARNED_ROW)}`;

  const blocks: TrendFormulaBlock[] = [
    {
      range: `B${sheetRow(TREND_PERIOD_ROW)}`,
      values: [[
        `=IF(COUNTA(${monthRange})=0,"（此年度沒有資料）",`
        + `${dataColLetter}${sheetRow(TREND_MONTH_ROW)}&" ~ "&${lastNonEmpty(monthRange)})`,
      ]],
    },
    {
      range: `B${sheetRow(TREND_YEAREND_ROW)}`,
      values: [[`=IF(COUNTA(${earnedRange})=0,"",${lastNonEmpty(earnedRange)})`]],
    },
    { range: `B${sheetRow(TREND_MONTH_ROW)}`, values: [[trendFilterFormula('D')]] },
    { range: `B${sheetRow(TREND_EARNED_ROW)}`, values: [[trendFilterFormula('E')]] },
    { range: `B${sheetRow(TREND_EXPECTED_ROW)}`, values: [[trendFilterFormula('F')]] },
  ];

  if (table.people.length > 0) {
    const col = columnLetter(TREND_LIST_SPARKLINE_COL);
    const first = sheetRow(TREND_LIST_FIRST_ROW);
    blocks.push({
      range: `${col}${first}:${col}${first + table.people.length - 1}`,
      // 長表第 1 列是標題，所以 index 0 對應試算表第 2 列
      values: table.people.map((p) => [trendSparkline(p.fromIndex + 2, p.toIndex + 2)]),
    });
  }

  return blocks;
}

/** 年度下拉選單的選項 */
export function trendYearOptions(table: TrendTable): string[] {
  return Array.from({ length: table.maxCardYear }, (_, i) => `第${i + 1}年`);
}
