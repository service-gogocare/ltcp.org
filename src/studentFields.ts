/**
 * 人員資料的可選值。
 *
 * ROLE_OPTIONS 必須與 App.tsx 的 normalizeRole() 輸出一致 ——
 * 小卡的文件 ID 是「身分證號_職業類別」，這裡出現 normalizeRole 產不出來的字串，
 * 下次從 Excel 匯入時就會對不到同一份文件而生出重複小卡。
 *
 * 放在獨立模組而不是跟元件同檔，是為了讓 react-refresh 能正常熱更新元件檔。
 */
export const ROLE_OPTIONS = [
  '照顧服務人員',
  '居家服務督導員',
  '專業服務人員',
  '照顧管理人員',
  '個案管理人員',
];

export const NATIONALITY_OPTIONS = ['臺灣', '印尼', '越南', '菲律賓', '泰國'];

/** 表格上可直接編輯的文字欄位（日期另有換算邏輯，走 onDateChange） */
export type EditableField = 'name' | 'nationality' | 'role';

/** 表格上的一列人員資料 */
export interface StudentRow {
  selected: boolean;
  /** 複合鍵，等於 `身分證號_職業類別`，也是雲端文件 ID */
  id: string;
  /** 身分證號，例如 A123456789 */
  studentId: string;
  /**
   * 這一列目前在雲端對應的文件 ID；undefined 代表還沒寫進雲端。
   * 改了職業類別會讓複合鍵（id）變掉，儲存時必須寫入新 ID 並刪掉這個舊 ID，
   * 否則同一個人會留下兩份文件 —— 正是 3e2c752 換 key 時發生過的事。
   */
  originalId?: string;
  name: string;
  nationality: string;
  role: string;
  earliestDate: string;
  effectiveDate: string;
  expiryDate: string;
  /** 該員的課程明細列（從 Excel 匯入時帶進來，從雲端載入時是空的） */
  rows: unknown[];
}
