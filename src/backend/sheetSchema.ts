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

/** 把一筆小卡轉成試算表的一列，欄位順序與 ROSTER_HEADER_ROW 一致 */
export function cardToRow(cardId: string, record: CardRecord): string[] {
  const sep = cardId.indexOf('_');
  const studentId = sep === -1 ? cardId : cardId.slice(0, sep);
  return [
    studentId,
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
