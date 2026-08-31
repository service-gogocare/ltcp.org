/**
 * Drive 與 Sheets 的 REST 呼叫（薄封裝，不含業務邏輯）
 * ---------------------------------------------------------------------------
 * 只用 drive.file 範圍，因此 files.list 回傳的必然是「本程式建立的」或
 * 「使用者透過 Picker 選過的」檔案 —— 這正好就是我們要列出的名冊清單。
 */

import { ROSTER_APP_PROPERTY } from '../sheetSchema';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

export interface DriveFile {
  id: string;
  name: string;
  ownedByMe?: boolean;
  owners?: { emailAddress?: string }[];
  capabilities?: { canEdit?: boolean };
}

export interface GoogleUserInfo {
  email: string;
  name: string;
  picture?: string;
}

async function request<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      // 回應不是 JSON 就用狀態碼說明
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Google 拒絕了這次請求（${res.status}）：${detail || '權限不足或登入已過期'}。`);
    }
    if (res.status === 429) {
      throw new Error('Google API 請求過於頻繁，請稍候再試。');
    }
    throw new Error(`Google API 錯誤（${res.status}）：${detail || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchUserInfo(token: string): Promise<GoogleUserInfo> {
  const data = await request<{ email?: string; name?: string; picture?: string }>(USERINFO, token);
  if (!data.email) {
    throw new Error('無法取得 Google 帳號的電子郵件，請確認授權時已同意存取基本資料。');
  }
  return { email: data.email, name: data.name || data.email, picture: data.picture };
}

/** 列出所有帶有本系統標記的名冊試算表 */
export async function listRosterFiles(token: string): Promise<DriveFile[]> {
  const q = [
    `appProperties has { key='${ROSTER_APP_PROPERTY.key}' and value='${ROSTER_APP_PROPERTY.value}' }`,
    'trashed = false',
  ].join(' and ');
  const fields = 'nextPageToken, files(id, name, ownedByMe, owners(emailAddress), capabilities(canEdit))';

  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, fields, pageSize: '100', orderBy: 'name' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await request<{ files?: DriveFile[]; nextPageToken?: string }>(
      `${DRIVE_BASE}/files?${params}`,
      token,
    );
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files;
}

export async function fetchFileMeta(token: string, fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: 'id, name, ownedByMe, owners(emailAddress), capabilities(canEdit)',
  });
  return request<DriveFile>(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?${params}`, token);
}

/**
 * 讀取一個分頁的所有內容。
 * 用 FORMATTED_VALUE 取得「畫面上看到的字」—— 民國日期在試算表裡是文字，
 * 若使用者不小心讓儲存格變成真正的日期格式，這裡拿到的仍是可解析的字串。
 */
export async function fetchSheetValues(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<string[][]> {
  const range = encodeURIComponent(sheetTitle);
  const params = new URLSearchParams({
    valueRenderOption: 'FORMATTED_VALUE',
    majorDimension: 'ROWS',
  });
  const data = await request<{ values?: string[][] }>(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}?${params}`,
    token,
  );
  return data.values ?? [];
}

/** 取得試算表的分頁標題清單，用來確認結構是否正確 */
export async function fetchSheetTitles(token: string, spreadsheetId: string): Promise<string[]> {
  const params = new URLSearchParams({ fields: 'sheets(properties(title))' });
  const data = await request<{ sheets?: { properties?: { title?: string } }[] }>(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?${params}`,
    token,
  );
  return (data.sheets ?? []).map((s) => s.properties?.title || '').filter(Boolean);
}
