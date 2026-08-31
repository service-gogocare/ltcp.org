/**
 * Google Picker：讓使用者選取別人分享的名冊試算表
 * ---------------------------------------------------------------------------
 * 為什麼非它不可：drive.file 範圍只涵蓋「本程式建立的」與「使用者透過 Picker
 * 選過的」檔案。別人分享給你的名冊，即使你在 Drive 看得到，程式也讀不到，
 * 必須由使用者親自選一次才算授權。這是共用名冊的必要條件，不是便利功能。
 *
 * 需要 API 金鑰（VITE_GOOGLE_API_KEY），與 OAuth 用戶端 ID 是兩回事。
 */

import { getAccessToken, getClientId } from './gisAuth';

const GAPI_SRC = 'https://apis.google.com/js/api.js';

export function getApiKey(): string {
  return import.meta.env.VITE_GOOGLE_API_KEY || '';
}

/**
 * Cloud 專案編號，Picker 的 setAppId 需要。
 *
 * 這一步是 drive.file 範圍下的必要條件：Picker 本身用使用者的 Google 身分
 * 瀏覽整個雲端硬碟，跟本程式的授權範圍無關，所以它看得到檔案；但要讓「選取」
 * 真的把該檔案的存取權授予本程式，必須用 setAppId 指明是哪個應用程式。
 * 少了它，選完之後 files.get 會回 404 File not found —— 看起來像檔案不存在，
 * 實際上是本程式沒有被授權。
 *
 * 專案編號就是 OAuth 用戶端 ID 的數字前綴，所以不必另外設定環境變數。
 */
export function getAppId(): string {
  const override = import.meta.env.VITE_GOOGLE_APP_ID;
  if (override) return String(override);
  const clientId = getClientId();
  const prefix = clientId.split('-')[0];
  return /^\d+$/.test(prefix) ? prefix : '';
}

let gapiLoading: Promise<void> | null = null;
let pickerLoading: Promise<void> | null = null;

function loadScript(src: string, errorMessage: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error(errorMessage)));
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

async function ensurePicker(): Promise<NonNullable<NonNullable<Window['google']>['picker']>> {
  if (window.google?.picker) return window.google.picker;

  if (!gapiLoading) {
    gapiLoading = loadScript(GAPI_SRC, '無法載入 Google 檔案選擇器，請檢查網路連線或瀏覽器擴充功能是否封鎖。');
  }
  await gapiLoading;

  if (!pickerLoading) {
    pickerLoading = new Promise<void>((resolve, reject) => {
      if (!window.gapi) {
        reject(new Error('Google 選擇器元件載入後仍無法使用，請重新整理頁面再試。'));
        return;
      }
      window.gapi.load('picker', () => resolve());
    });
  }
  await pickerLoading;

  if (!window.google?.picker) {
    throw new Error('Google 選擇器元件載入失敗，請重新整理頁面再試。');
  }
  return window.google.picker;
}

/**
 * 開啟選擇器，回傳選到的試算表；使用者取消時回傳 null。
 * 只顯示試算表 —— 選到別的檔案類型對本系統毫無意義。
 */
export async function pickSpreadsheet(): Promise<GooglePickerDoc | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('系統設定不完整：缺少 VITE_GOOGLE_API_KEY，無法開啟檔案選擇器。請在 .env 填入 Google Cloud 的 API 金鑰並重新啟動開發伺服器。');
  }

  const appId = getAppId();
  if (!appId) {
    throw new Error('系統設定不完整：無法從用戶端 ID 推斷 Cloud 專案編號。請設定 VITE_GOOGLE_APP_ID 為專案編號後重新啟動開發伺服器。');
  }

  const token = await getAccessToken();
  const picker = await ensurePicker();

  return new Promise<GooglePickerDoc | null>((resolve, reject) => {
    try {
      const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
      view.setIncludeFolders(true);

      const instance = new picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        // 沒有這一行，選取不會把 drive.file 權限授予本程式
        .setAppId(appId)
        .setTitle('選擇要開啟的名冊試算表')
        .addView(view)
        .setCallback((response) => {
          if (response.action === picker.Action.PICKED) {
            const doc = response.docs?.[0];
            instance.dispose();
            resolve(doc ?? null);
          } else if (response.action === picker.Action.CANCEL) {
            instance.dispose();
            resolve(null);
          }
          // 其他 action（例如 loaded）不處理，選擇器仍開著
        })
        .build();

      instance.setVisible(true);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
