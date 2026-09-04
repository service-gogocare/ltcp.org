/**
 * 外部連結與 public/ 底下的靜態檔案位址
 * ---------------------------------------------------------------------------
 * 集中一處而不是散在各元件裡：手冊與商標同時出現在頁尾與積分更新工具列，
 * 各寫一份路徑的話換檔名時會漏掉一邊，而漏掉的那邊是 404 —— 沒有任何跡象。
 *
 * public/ 底下的檔名刻意用 ASCII：中文檔名在部署環境的網址轉義上不可靠。
 */

/** 衛福部長照機構人力系統。積分名冊 Excel 是從這裡匯出的 */
export const MOHW_LTCPAP_URL = 'https://ltcpap.mohw.gov.tw/molc/auth/login?targetUri=%2F';

/** OG100 匯出積分名冊的操作手冊（75 頁 PDF） */
export const MANUAL_URL = '/og100-manual.pdf';

export const LOGO_URL = '/gogocare-logo.png';

export const COMPANY_PORTAL_URL = 'https://portaly.cc/Care.Yorozuya';
