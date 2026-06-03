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
  error?: unknown;
}

let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let isMockMode = true;

export function initFirebase(config: FirebaseConfig | null): FirebaseStatus {
  if (!config || !config.apiKey) {
    isMockMode = true;
    authInstance = null;
    firestoreInstance = null;
    console.log("Using Mock Database (LocalStorage)");
    return { isMock: true, auth: null, db: null };
  }

  try {
    const app = getApps().length === 0 ? initializeApp(config) : getApp();
    authInstance = getAuth(app);
    firestoreInstance = getFirestore(app);
    isMockMode = false;
    console.log("Firebase initialized successfully");
    return { isMock: false, auth: authInstance, db: firestoreInstance };
  } catch (error) {
    console.error("Failed to initialize Firebase, falling back to Mock Mode:", error);
    isMockMode = true;
    authInstance = null;
    firestoreInstance = null;
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
  return {
    isMock: isMockMode,
    auth: authInstance,
    db: firestoreInstance
  };
}
