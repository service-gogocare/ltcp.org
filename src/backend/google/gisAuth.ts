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

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  // 只能存取本程式建立的、或使用者透過 Picker 選取的檔案。
  // 刻意不要求完整 drive 權限：那屬於受限範圍，需要年度安全評估。
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done: () => void): void;
        };
      };
    };
  }
}

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
