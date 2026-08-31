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
    fatalError = "系統設定不完整：缺少 Firebase 環境變數（VITE_FIREBASE_*），請聯絡系統管理員檢查部署設定。";
    console.error("[firebase] 缺少 VITE_FIREBASE_* 環境變數。");
    return { auth: null, db: null, fatalError };
  }

  try {
    const app = getApps().length === 0 ? initializeApp(config) : getApp();
    authInstance = getAuth(app);
    firestoreInstance = getFirestore(app);
    console.log("Firebase initialized successfully");
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
