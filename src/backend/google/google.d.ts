/**
 * Google 前端指令碼的全域型別
 * ---------------------------------------------------------------------------
 * gisAuth 與 picker 都掛在同一個 window.google 上，宣告必須集中在一處，
 * 否則兩個檔案各自 declare 會互相衝突。
 * 只宣告本專案實際用到的部分。
 */

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  /** 實際被授予的範圍，以空白分隔。使用者可以只勾一部分，所以要檢查 */
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GooglePickerDoc {
  id: string;
  name?: string;
  mimeType?: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDoc[];
}

interface GooglePickerView {
  setMimeTypes(mimeTypes: string): GooglePickerView;
  setIncludeFolders(include: boolean): GooglePickerView;
}

interface GooglePicker {
  setVisible(visible: boolean): void;
  dispose(): void;
}

interface GooglePickerBuilder {
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  /** Cloud 專案編號。drive.file 範圍下沒設定，選取不會授予檔案存取權 */
  setAppId(appId: string): GooglePickerBuilder;
  setTitle(title: string): GooglePickerBuilder;
  addView(view: GooglePickerView | string): GooglePickerBuilder;
  setCallback(callback: (response: GooglePickerResponse) => void): GooglePickerBuilder;
  build(): GooglePicker;
}

interface Window {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient(config: {
          client_id: string;
          scope: string;
          callback: (response: GisTokenResponse) => void;
          error_callback?: (error: { type?: string; message?: string }) => void;
        }): GisTokenClient;
        revoke(token: string, done: () => void): void;
      };
    };
    picker?: {
      PickerBuilder: new () => GooglePickerBuilder;
      DocsView: new (viewId?: string) => GooglePickerView;
      ViewId: { SPREADSHEETS: string };
      Action: { PICKED: string; CANCEL: string };
      Feature: { NAV_HIDDEN: string };
    };
  };
  gapi?: {
    load(libraries: string, callback: () => void): void;
  };
}
