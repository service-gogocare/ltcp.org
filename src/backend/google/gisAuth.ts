/**
 * Google Identity Services 的存取權杖管理
 * ---------------------------------------------------------------------------
 * 純前端流程拿不到 refresh token，access token 一小時就過期。因此這裡：
 *   - 快取權杖與到期時間，提早 60 秒視為過期，避免請求送到一半才失效
 *   - 續期優先用 prompt: '' 靜默取得，使用者不會看到任何畫面
 *   - 靜默失敗才拋錯，由呼叫端提示重新登入
 *
 * 這個檔案無法用單元測試覆蓋（依賴 Google 的外部指令碼與瀏覽器環境），
 * 所以刻意保持很薄：只做權杖管理，不含任何業務邏輯。
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * 沒有這個範圍，這個系統什麼都做不了：名冊清單、讀寫、建檔全部會被 Google 擋掉。
 *
 * 使用者一路按下去而沒有授予它時，我們仍然會拿到一個看起來正常的權杖 ——
 * 只是那個權杖對 Drive 與 Sheets 一律回 403。
 *
 * Google 的同意畫面有兩種形狀，實測都會遇到：
 *   - 首次授權：「選取要讓…存取的範圍」，這一項左邊有**核取方塊且預設不勾**
 *   - 增量授權：「要求取得其他存取權」，只把這一項列出來、**沒有核取方塊**，
 *     按「繼續」就等於授予（畫面文案是「如果授予這項存取權…」）
 * 提示文字必須同時涵蓋兩者 —— 只講「勾起來」的話，看到第二種畫面的人會
 * 找不到方塊而卡住。
 */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * 「拿到權杖但沒授予 drive.file」專用的錯誤型別。
 *
 * 分出型別是為了讓 UI 認得它 —— 這個失敗的正確處置和其他登入失敗完全不同：
 * 其他失敗要使用者「再試一次」，這一個要使用者「再試一次**並且勾一個框**」，
 * 而那個框正是他上一次沒注意到的東西。用字串比對訊息去分辨太脆弱。
 *
 * Google 的細分授權（granular consent）刻意讓每一項都預設不勾、由使用者主動
 * 授予，沒有任何參數能預先打勾（include_granted_scopes 也不行），
 * 所以只能在被拒絕之後把路縮短。
 */
export class MissingDriveScopeError extends Error {
  constructor(message: string) {
    super(message);
    // 用 name 而不是 instanceof 判斷：轉譯目標較舊時 Error 子類的原型鏈會斷
    this.name = 'MissingDriveScopeError';
  }
}

export function isMissingDriveScopeError(err: unknown): boolean {
  return err instanceof Error && err.name === 'MissingDriveScopeError';
}

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  // 只能存取本程式建立的、或使用者透過 Picker 選取的檔案。
  // 刻意不要求完整 drive 權限：那屬於受限範圍，需要年度安全評估。
  DRIVE_FILE_SCOPE,
].join(' ');

// 型別宣告集中在 google.d.ts（gisAuth 與 picker 共用同一個 window.google）
type TokenResponse = GisTokenResponse;
type TokenClient = GisTokenClient;

/** 提早 60 秒視為過期，留給請求本身的時間 */
const EXPIRY_MARGIN_MS = 60_000;

let cachedToken: string | null = null;
let expiresAt = 0;
let tokenClient: TokenClient | null = null;
let pending: ((response: TokenResponse) => void) | null = null;
let gisLoading: Promise<void> | null = null;

export function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;

  gisLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error('無法載入 Google 登入元件，請檢查網路連線或瀏覽器擴充功能是否封鎖。')));
    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return gisLoading;
}

async function ensureTokenClient(): Promise<TokenClient> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error('系統設定不完整：缺少 VITE_GOOGLE_CLIENT_ID，請聯絡系統管理員。');
  }
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google 登入元件載入後仍無法使用，請重新整理頁面再試。');
  }

  if (!tokenClient) {
    // Vite 只在啟動時讀一次 .env，改了設定沒重啟就會沿用舊值。
    // invalid_client 幾乎都是這個原因，所以開發時把實際用的 ID 印出來對照。
    if (import.meta.env.DEV) {
      console.info(`[gisAuth] 使用的 client_id：${clientId}`);
    }
    tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      // GIS 的回呼是設定在 client 上而非每次請求，所以用 pending 把它接回 Promise
      callback: (response) => {
        const resolve = pending;
        pending = null;
        resolve?.(response);
      },
      error_callback: (error) => {
        const resolve = pending;
        pending = null;
        resolve?.({ error: error.type || 'popup_failed', error_description: error.message });
      },
    });
  }
  return tokenClient;
}

/**
 * 取得存取權杖。
 * @param interactive true 會在需要時彈出 Google 的同意視窗；false 只做靜默續期。
 */
export async function requestAccessToken(interactive: boolean): Promise<string> {
  const client = await ensureTokenClient();

  const response = await new Promise<TokenResponse>((resolve) => {
    pending = resolve;
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });

  if (response.error || !response.access_token) {
    throw new Error(
      response.error === 'popup_closed' || response.error === 'popup_failed'
        ? '登入視窗被關閉或被瀏覽器封鎖，請允許彈出視窗後再試一次。'
        : `Google 授權失敗：${response.error_description || response.error || '未知錯誤'}`,
    );
  }

  // 在這裡擋下「拿到權杖但沒授予檔案存取權」。不擋的話，失敗會在很遠的地方
  // 以「Google 拒絕了這次請求（403）」出現，而 403 完全看不出原因是沒勾選 ——
  // Drive 與 Sheets 的每一個呼叫都會失敗，看起來像整個 Google 掛了。
  const granted = (response.scope ?? '').split(' ').filter(Boolean);
  if (!granted.includes(DRIVE_FILE_SCOPE)) {
    throw new MissingDriveScopeError(
      '登入成功，但沒有取得 Google 雲端硬碟的檔案存取權，因此無法讀寫任何名冊。'
      + '請重新授權，並允許「查看、編輯、建立及刪除您使用這個應用程式開啟或建立的'
      + 'Google 雲端硬碟檔案」這一項。',
    );
  }

  cachedToken = response.access_token;
  expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
  return cachedToken;
}

/** 取得可用的權杖；已過期就靜默續期，續期失敗才擲錯要求重新登入 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < expiresAt - EXPIRY_MARGIN_MS) {
    return cachedToken;
  }
  try {
    return await requestAccessToken(false);
  } catch {
    cachedToken = null;
    throw new Error('Google 登入已過期，請重新登入後再試。表格上未儲存的修改仍會保留。');
  }
}

export function clearAccessToken(): void {
  cachedToken = null;
  expiresAt = 0;
}

export async function revokeAccessToken(): Promise<void> {
  const token = cachedToken;
  clearAccessToken();
  if (!token) return;
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return;
  await new Promise<void>((resolve) => oauth2.revoke(token, resolve));
}
