/**
 * 人員資料的可選值與職類正規化。
 *
 * ROLE_OPTIONS 必須與 normalizeRole() 的輸出一致 ——
 * 小卡的識別鍵是「身分證號_職業類別」，這裡出現 normalizeRole 產不出來的字串，
 * 下次匯入時就會對不到同一筆而生出重複資料。
 *
 * 放在獨立模組而不是跟元件同檔：一來 react-refresh 才能正常熱更新元件檔，
 * 二來 backend 的試算表解析也要用 normalizeRole，不能為此把 React 拉進去。
 */
export const ROLE_OPTIONS = [
  '照顧服務人員',
  '居家服務督導員',
  '專業服務人員',
  '照顧管理人員',
  '個案管理人員',
];

/** 把各種寫法的職業類別收斂成 ROLE_OPTIONS 裡的其中一種 */
export function normalizeRole(roleStr: string): string {
  const s = String(roleStr || '').trim();
  if (s.includes('居家服務督導') || s.includes('居家督導') || s.includes('居督')) {
    return '居家服務督導員';
  }
  if (s.includes('照顧服務') || s.includes('照服')) {
    return '照顧服務人員';
  }
  if (s.includes('個案管理') || s.includes('個管')) {
    return '個案管理人員';
  }
  if (s.includes('照顧管理') || s.includes('照管')) {
    return '照顧管理人員';
  }
  if (
    s.includes('專業服務') || s.includes('社工') || s.includes('護理') || s.includes('醫師') ||
    s.includes('治療師') || s.includes('物理治療') || s.includes('職能治療')
  ) {
    return '專業服務人員';
  }
  return '照顧服務人員'; // fallback
}

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
