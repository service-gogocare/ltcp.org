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
  isMock: boolean;
  auth: Auth | null;
  db: Firestore | null;
  /**
   * 正式環境缺少設定或初始化失敗時的致命錯誤訊息。
   * 有值代表「後端不可用」，且系統不會降級成 Mock —— 避免一次部署失誤
   * 就讓網站變成接受測試帳密的無防護 localStorage 應用。
   */
  fatalError?: string;
  error?: unknown;
}

// Mock（localStorage）模式僅允許在開發環境使用
const ALLOW_MOCK = import.meta.env.DEV;

let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let isMockMode = false;
let fatalError: string | null = null;

export function initFirebase(config: FirebaseConfig | null): FirebaseStatus {
  authInstance = null;
  firestoreInstance = null;
  isMockMode = false;
  fatalError = null;

  if (!config || !config.apiKey) {
    if (!ALLOW_MOCK) {
      fatalError = "系統設定不完整：缺少 Firebase 環境變數（VITE_FIREBASE_*）。正式環境不會降級為本機測試模式，請聯絡系統管理員檢查部署設定。";
      console.error("[firebase] 缺少 VITE_FIREBASE_* 環境變數，正式環境拒絕降級為 Mock 模式。");
      return { isMock: false, auth: null, db: null, fatalError };
    }
    isMockMode = true;
    console.warn("[firebase][dev] 未設定環境變數，使用本機 Mock 資料庫 (localStorage)");
    return { isMock: true, auth: null, db: null };
  }

  try {
    const app = getApps().length === 0 ? initializeApp(config) : getApp();
    authInstance = getAuth(app);
    firestoreInstance = getFirestore(app);
    console.log("Firebase initialized successfully");
    return { isMock: false, auth: authInstance, db: firestoreInstance };
  } catch (error) {
    authInstance = null;
    firestoreInstance = null;
    if (!ALLOW_MOCK) {
      fatalError = "系統設定不完整：Firebase 初始化失敗。正式環境不會降級為本機測試模式，請聯絡系統管理員。";
      console.error("[firebase] 初始化失敗，正式環境拒絕降級為 Mock 模式:", error);
      return { isMock: false, auth: null, db: null, fatalError, error };
    }
    isMockMode = true;
    console.warn("[firebase][dev] 初始化失敗，改用本機 Mock 資料庫:", error);
    return { isMock: true, auth: null, db: null, error };
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
  // 「強制 Mock」開關只在開發環境生效。
  // 否則任何人都能在正式站用 devtools 設定 localStorage 切成假的超級管理員畫面。
  const forceMock = ALLOW_MOCK && localStorage.getItem("ltcp_force_mock") === "true";
  if (forceMock) {
    return { isMock: true, auth: null, db: null };
  }

  return {
    isMock: isMockMode,
    auth: authInstance,
    db: firestoreInstance,
    ...(fatalError ? { fatalError } : {}),
  };
}

/**
 * 後端不可用時直接擲錯。
 * 必須在呼叫 dbService 的認證入口前使用：那裡的 `isMock || !auth || !db` 判斷
 * 會把 auth/db 為 null 的情況當成 Mock，反而繞過這個保護。
 */
export function assertBackendAvailable(): void {
  if (fatalError) {
    throw new Error(fatalError);
  }
}
