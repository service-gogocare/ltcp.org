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
  /**
   * 該員的課程明細列（從 Excel 匯入時帶進來，從雲端載入時是空的）。
   * 欄位名稱由 resolveCourseColumns 模糊比對，所以型別只能到「字串鍵、值不明」。
   */
  rows: Record<string, unknown>[];
}

/**
 * 把身分證號／統一證號遮成「B122***111」的樣子，只用於**畫面顯示**。
 *
 * 保留前 4 碼與後 3 碼：足以在四十幾列的表格裡認出是哪一列、也足以跟紙本核對，
 * 但看到螢幕的人（旁邊經過的、視訊分享的對象）拼不回完整號碼。
 *
 * **不要拿它去存、去比對、去當鍵。** 身分證號是名冊的主鍵（composeCardId），
 * 遮罩過的值寫進試算表就等於毀掉那份名冊；匯出的 Excel 也必須是完整號碼，
 * 那是機構自己的資料，而且評鑑要對得起來。
 *
 * 星號數量跟著被遮的位數走，所以顯示長度與原號碼一致 ——
 * 固定三顆星會讓 11 碼的號碼看起來像 10 碼，那是另一種誤導。
 */
export function maskStudentId(studentId: string): string {
  const id = (studentId ?? '').trim();

  // 前 4 + 後 3 = 7；短於 8 碼就沒有中間可遮，而且格式不明，保守起見只留第一碼
  if (id.length < 8) {
    return id.length <= 1 ? id : `${id.slice(0, 1)}${'*'.repeat(id.length - 1)}`;
  }
  return `${id.slice(0, 4)}${'*'.repeat(id.length - 7)}${id.slice(-3)}`;
}
