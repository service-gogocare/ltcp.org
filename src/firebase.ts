import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface FirebaseStatus {
  auth: Auth | null;
  db: Firestore | null;
  /**
   * 缺少設定或初始化失敗時的致命錯誤訊息。有值代表「後端不可用」。
   * 這裡沒有任何降級路徑 —— 過去的 localStorage Mock 模式已移除，
   * 一次部署失誤不該讓網站變成接受任意帳密的無防護應用。
   */
  fatalError?: string;
  error?: unknown;
}

let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let fatalError: string | null = null;

export function initFirebase(config: FirebaseConfig | null): FirebaseStatus {
  authInstance = null;
  firestoreInstance = null;
  fatalError = null;

  if (!config || !config.apiKey) {
    // 記下 fatalError，但**不印 console.error**。
    //
    // 這個模組在模組載入時就會被執行（dbService 靜態匯入 firestoreBackend），
    // 而現在預設的儲存層是 Google 試算表 —— 那個模式根本不需要 Firebase。
    // 印出來的話，線上每次開頁面都會出現一行「請聯絡系統管理員檢查部署設定」，
    // 那是假警報，而假警報會讓真正的錯誤被當成背景雜訊忽略掉。
    //
    // 真的要用 Firestore 時，這個訊息會由 assertBackendAvailable() 與
    // getBackendStatus() 在「使用的那一刻」講出來 —— 那時它才是真的錯誤。
    fatalError = "系統設定不完整：缺少 Firebase 環境變數（VITE_FIREBASE_*），請聯絡系統管理員檢查部署設定。";
    return { auth: null, db: null, fatalError };
  }

  try {
    const app = getApps().length === 0 ? initializeApp(config) : getApp();
    authInstance = getAuth(app);
    firestoreInstance = getFirestore(app);

    return { auth: authInstance, db: firestoreInstance };
  } catch (error) {
    authInstance = null;
    firestoreInstance = null;
    fatalError = "系統設定不完整：Firebase 初始化失敗，請聯絡系統管理員。";
    console.error("[firebase] 初始化失敗:", error);
    return { auth: null, db: null, fatalError, error };
  }
}

// Load credentials from environment variables
const envConfig: FirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

if (envConfig.apiKey) {
  initFirebase(envConfig);
} else {
  initFirebase(null);
}

export function getFirebaseStatus(): FirebaseStatus {
  return {
    auth: authInstance,
    db: firestoreInstance,
    ...(fatalError ? { fatalError } : {}),
  };
}

/**
 * 後端不可用時直接擲錯。
 * 必須在呼叫 dbService 的認證入口前使用。
 */
export function assertBackendAvailable(): void {
  if (fatalError) {
    throw new Error(fatalError);
  }
}
