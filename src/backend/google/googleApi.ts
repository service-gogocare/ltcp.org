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
  appProperties?: Record<string, string>;
}

const FILE_FIELDS = 'id,name,ownedByMe,owners(emailAddress),capabilities(canEdit),appProperties';

export interface GoogleUserInfo {
  email: string;
  name: string;
  picture?: string;
}

async function request<T>(
  url: string,
  token: string,
  init?: { method: string; body: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      // 回應不是 JSON 就用狀態碼說明
    }
    if (res.status === 401 || res.status === 403) {
      // 403 幾乎只有三種成因，而 Google 的訊息常常看不出是哪一種，所以列出來。
      // 最常見的是第一種：drive.file 在同意畫面上是可勾選項目，沒勾也會拿到權杖。
      throw new Error(
        `Google 拒絕了這次請求（${res.status}）：${detail || '權限不足或登入已過期'}。\n\n`
        + '常見原因：\n'
        + '1. 登入時沒有勾選雲端硬碟的檔案存取權（同意畫面上那是選填項目）——'
        + '請登出後重新登入並勾選。\n'
        + '2. Google Cloud 專案沒有啟用 Drive API 或 Sheets API。\n'
        + '3. 登入已過期，請重新登入。',
      );
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

/**
 * 列出本程式有權存取的所有試算表。
 *
 * 刻意不在伺服器端用 appProperties 過濾：drive.file 範圍本身已經把結果限縮到
 * 「本程式建立的」與「使用者透過 Picker 選過的」檔案，範圍已經夠窄；
 * 而 appProperties 查詢對「別人建立、分享給我」的檔案是否生效沒有保證。
 * 改成把 appProperties 一起取回來，由呼叫端自己判斷哪些是名冊。
 */
export async function listAccessibleSpreadsheets(token: string): Promise<DriveFile[]> {
  const q = "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false";
  const fields = `nextPageToken,files(${FILE_FIELDS})`;

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

export function hasRosterTag(file: DriveFile): boolean {
  return file.appProperties?.[ROSTER_APP_PROPERTY.key] === ROSTER_APP_PROPERTY.value;
}

export async function fetchFileMeta(token: string, fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: FILE_FIELDS });
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

/** 建立空白試算表，回傳 { spreadsheetId, sheetIds } */
export async function createSpreadsheet(
  token: string,
  title: string,
  sheetTitles: { title: string; hidden?: boolean }[],
): Promise<{ spreadsheetId: string; sheetIdByTitle: Record<string, number> }> {
  const data = await request<{
    spreadsheetId: string;
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  }>(SHEETS_BASE, token, {
    method: 'POST',
    body: {
      properties: { title },
      sheets: sheetTitles.map((s) => ({
        properties: {
          title: s.title,
          hidden: s.hidden ?? false,
          gridProperties: { frozenRowCount: s.hidden ? 0 : 1 },
        },
      })),
    },
  });

  const sheetIdByTitle: Record<string, number> = {};
  for (const sheet of data.sheets ?? []) {
    const t = sheet.properties?.title;
    const id = sheet.properties?.sheetId;
    if (t !== undefined && id !== undefined) sheetIdByTitle[t] = id;
  }
  return { spreadsheetId: data.spreadsheetId, sheetIdByTitle };
}

/**
 * 寫入一個分頁的內容。
 *
 * 預設 RAW —— 若讓 Sheets 自行解析，「113/08/20」會被當成西元日期換算掉。
 * 只有要寫**公式**時才用 USER_ENTERED：RAW 會把 `=SPARKLINE(...)`
 * 當成純文字存進去，畫面上就是一串公式而不是圖。
 */
export async function updateSheetValues(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
  /** 數字要維持數字型別，使用者才 SUM 得起來；RAW 會照送出的 JSON 型別存 */
  values: (string | number)[][],
  valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW',
): Promise<void> {
  const range = encodeURIComponent(sheetTitle);
  const params = new URLSearchParams({ valueInputOption });
  await request(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}?${params}`,
    token,
    { method: 'PUT', body: { values } },
  );
}

/**
 * 清空一個分頁的所有值（保留分頁本身與格式）。
 *
 * 整張覆寫時必須先清：values.update 只會蓋掉它寫到的範圍，
 * 人員變少時尾巴會留著上一次的列，看起來像有人重複。
 */
export async function clearSheetValues(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<void> {
  const range = encodeURIComponent(sheetTitle);
  await request(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}:clear`,
    token,
    { method: 'POST', body: {} },
  );
}

/** 一次送出多個範圍的更新，避免逐列呼叫撞到每分鐘配額 */
export async function batchUpdateValues(
  token: string,
  spreadsheetId: string,
  data: { range: string; values: (string | number)[][] }[],
  valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW',
): Promise<void> {
  if (data.length === 0) return;
  await request(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, token, {
    method: 'POST',
    body: { valueInputOption, data },
  });
}

/**
 * 某個分頁上現有的圖表 ID。
 *
 * 重建圖表前一定要先問：addChart 每次都是「新增」，不先刪掉舊的就會一次疊一張，
 * 儲存幾次之後試算表上會有一堆長得一樣的圖。
 */
export async function fetchChartIds(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<number[]> {
  const params = new URLSearchParams({ fields: 'sheets(properties(title),charts(chartId))' });
  const data = await request<{
    sheets?: { properties?: { title?: string }; charts?: { chartId?: number }[] }[];
  }>(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?${params}`, token);

  const sheet = (data.sheets ?? []).find((sh) => sh.properties?.title === sheetTitle);
  return (sheet?.charts ?? [])
    .map((c) => c.chartId)
    .filter((id): id is number => id !== undefined);
}

/** 把新列附加到分頁最後 */
export async function appendSheetValues(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
  values: string[][],
): Promise<void> {
  if (values.length === 0) return;
  const range = encodeURIComponent(sheetTitle);
  const params = new URLSearchParams({
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
  });
  await request(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?${params}`,
    token,
    { method: 'POST', body: { values } },
  );
}

/**
 * 刪除指定的列。
 * rowIndexes 必須由大到小排序 —— 由小到大刪會讓後面的索引位移而刪錯列。
 */
export async function deleteSheetRows(
  token: string,
  spreadsheetId: string,
  sheetId: number,
  rowIndexes: number[],
): Promise<void> {
  if (rowIndexes.length === 0) return;
  const requests = rowIndexes.map((rowIndex) => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
    },
  }));
  await batchUpdateSpreadsheet(token, spreadsheetId, requests);
}

/** 取得分頁標題對應的 sheetId，刪除列時需要 */
export async function fetchSheetIdByTitle(
  token: string,
  spreadsheetId: string,
): Promise<Record<string, number>> {
  const params = new URLSearchParams({ fields: 'sheets(properties(sheetId,title))' });
  const data = await request<{ sheets?: { properties?: { sheetId?: number; title?: string } }[] }>(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?${params}`,
    token,
  );
  const map: Record<string, number> = {};
  for (const s of data.sheets ?? []) {
    const t = s.properties?.title;
    const id = s.properties?.sheetId;
    if (t !== undefined && id !== undefined) map[t] = id;
  }
  return map;
}

/**
 * 新增一個分頁，回傳它的 sheetId。
 *
 * 既有名冊是在「積分月報」存在之前建立的，所以這張分頁只能在第一次
 * 儲存分析結果時補上，不能假設它一定存在。
 */
export async function addSheet(
  token: string,
  spreadsheetId: string,
  title: string,
  hidden = false,
): Promise<number> {
  const data = await request<{
    replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
  }>(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, token, {
    method: 'POST',
    body: {
      requests: [{
        addSheet: { properties: { title, hidden, gridProperties: { frozenRowCount: 1 } } },
      }],
    },
  });
  const sheetId = data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId === undefined) {
    throw new Error(`建立「${title}」分頁後沒有取回 sheetId，無法繼續寫入。`);
  }
  return sheetId;
}

/**
 * 在**單一次** batchUpdate 裡先刪除指定的列、再把新列附加到最後。
 *
 * 為什麼一定要合成一次呼叫：分兩次送的話，中間失敗會留下半套結果 ——
 * 先刪後附加失敗會少掉資料，先附加後刪失敗會讓同一個月出現兩份而數字加倍。
 * Sheets 的 batchUpdate 是全有全無，一次送出就不會有中間狀態。
 *
 * rowIndexes 必須由大到小排序 —— 由小到大刪會讓後面的索引位移而刪錯列。
 */
export async function replaceSheetRows(
  token: string,
  spreadsheetId: string,
  sheetId: number,
  deleteRowIndexes: number[],
  appendRows: (string | number)[][],
): Promise<void> {
  const requests: unknown[] = deleteRowIndexes.map((rowIndex) => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
    },
  }));

  if (appendRows.length > 0) {
    requests.push({
      appendCells: {
        sheetId,
        rows: appendRows.map((row) => ({
          values: row.map((v) => {
            if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
            // 空字串寫成空白儲存格；其餘一律當字串，
            // 讓 Sheets 不去解析「114/03」這種民國格式
            return v === '' ? {} : { userEnteredValue: { stringValue: v } };
          }),
        })),
        fields: 'userEnteredValue',
      },
    });
  }

  if (requests.length === 0) return;
  await batchUpdateSpreadsheet(token, spreadsheetId, requests);
}

export async function batchUpdateSpreadsheet(
  token: string,
  spreadsheetId: string,
  requests: unknown[],
): Promise<void> {
  await request(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, token, {
    method: 'POST',
    body: { requests },
  });
}

/** 設定 Drive 檔案的 appProperties —— 這是本系統之後認出名冊的唯一依據 */
export async function setAppProperties(
  token: string,
  fileId: string,
  appProperties: Record<string, string>,
): Promise<void> {
  await request(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, token, {
    method: 'PATCH',
    body: { appProperties },
  });
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
