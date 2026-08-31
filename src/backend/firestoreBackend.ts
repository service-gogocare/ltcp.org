/**
 * LtcpBackend 的 Firestore 實作
 * ---------------------------------------------------------------------------
 * 由原本的 dbService.ts 搬移而來，行為完全相同，只做了兩件事：
 *   1. 移除 localStorage 的 Mock 模式分支（正式環境本來就不該有降級路徑）
 *   2. 收斂成 LtcpBackend 介面，讓之後的 Google 試算表實作可以並行存在
 */

import { assertBackendAvailable, getFirebaseStatus } from "../firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
import type {
  LtcpBackend,
  UserSession,
  UserRole,
  CardRecord,
  OrganizationInfo,
  AuditLog,
} from "./types";

const SESSION_KEY = "ltcp_firebase_user_session";

/** 取得已初始化的 auth 與 db，後端不可用時直接擲錯而不是回傳 null */
function requireFirebase() {
  assertBackendAvailable();
  const { auth, db } = getFirebaseStatus();
  if (!auth || !db) {
    throw new Error("後端尚未就緒，請稍後再試或聯絡系統管理員。");
  }
  return { auth, db };
}

// ── 身分 ────────────────────────────────────────────────────────

async function login(email: string, password: string): Promise<UserSession> {
  const { auth, db } = requireFirebase();

  const credential = await signInWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;

  const orgDoc = await getDoc(doc(db, "users", uid));
  if (orgDoc.exists()) {
    const data = orgDoc.data();
    if (data.status === 'disabled') {
      await signOut(auth);
      throw new Error("此帳號已被停用，請聯絡系統管理員。");
    }
    const session: UserSession = {
      email: credential.user.email || email,
      orgId: data.orgId || uid,
      name: data.name || "長照機構",
      role: (data.role as UserRole) || "user",
      status: data.status || 'active',
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  // orgId 一律等於 uid：這樣 firestore.rules 才驗得出「這個 orgId 真的屬於你」。
  // 舊寫法用 uid 的前 6 碼，規則能驗但理論上會碰撞；更早的 registerUser 用
  // 隨機字串，規則完全無從驗證，等於讓註冊者可以填別家機構的 orgId
  // 直接讀寫對方的小卡（canReadOrg / canWriteOrg 只比對 orgId 欄位）。
  const orgId = uid;
  const name = "長照機構 (" + email.split("@")[0] + ")";
  const role: UserRole = "user";
  const status = "active" as const;
  await setDoc(doc(db, "users", uid), { orgId, name, email, role, status });
  const session: UserSession = { email, orgId, name, role, status };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function register(email: string, password: string, orgName: string): Promise<UserSession> {
  const { auth, db } = requireFirebase();

  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;
  // orgId 一律等於 uid，理由同 login()。
  // 語意上「自行註冊＝開一個新機構」；同機構要加第二個帳號由管理員配發。
  const orgId = uid;
  const role: UserRole = "user";
  await setDoc(doc(db, "users", uid), { orgId, name: orgName, email, role });
  const session: UserSession = { email, orgId, name: orgName, role };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function logout(): Promise<void> {
  localStorage.removeItem(SESSION_KEY);
  const { auth } = getFirebaseStatus();
  if (auth) {
    await signOut(auth);
  }
}

function getCurrentSession(): UserSession | null {
  const userJson = localStorage.getItem(SESSION_KEY);
  return userJson ? JSON.parse(userJson) : null;
}

async function sendPasswordReset(email: string): Promise<void> {
  const { auth } = requireFirebase();
  await sendPasswordResetEmail(auth, email);
}

// ── 機構 ────────────────────────────────────────────────────────

async function listAccounts(): Promise<OrganizationInfo[]> {
  const { db } = requireFirebase();
  const isManageable = (role: string) => role !== 'admin' && role !== 'super_admin';

  const querySnapshot = await getDocs(collection(db, "users"));
  const list: OrganizationInfo[] = [];
  querySnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.orgId && isManageable(data.role || 'user')) {
      list.push({
        orgId: data.orgId,
        name: data.name || data.email || "未命名機構",
        email: data.email || "",
        role: data.role || "user",
        status: data.status || "active",
      });
    }
  });
  return list;
}

async function createOrg(email: string, orgName: string, role: UserRole = 'user'): Promise<void> {
  const { db } = requireFirebase();
  const orgId = "org_" + Math.random().toString(36).substring(2, 8);
  await writeAuditLog(
    `建立新機構帳號`,
    orgId,
    `帳號電子郵件: ${email}, 機構名稱: ${orgName}, 角色權限: ${role}`,
  );

  const newUid = "admin_created_" + Math.random().toString(36).substring(2, 10);
  await setDoc(doc(db, "users", newUid), {
    email,
    orgId,
    name: orgName,
    role,
    status: 'active',
    createdAt: new Date().toISOString(),
  });
}

async function updateOrgStatus(orgId: string, status: 'active' | 'disabled'): Promise<void> {
  const { db } = requireFirebase();
  await writeAuditLog(
    `變更機構狀態為 [${status === 'active' ? '啟用' : '停用'}]`,
    orgId,
    `將機構 ID ${orgId} 的帳號狀態改為 ${status}`,
  );

  const querySnapshot = await getDocs(collection(db, "users"));
  let docIdToUpdate: string | null = null;
  querySnapshot.forEach((docSnap) => {
    if (docSnap.data().orgId === orgId) {
      docIdToUpdate = docSnap.id;
    }
  });

  if (!docIdToUpdate) {
    throw new Error("在 Firestore 中找不到該機構的使用者文件");
  }
  await setDoc(doc(db, "users", docIdToUpdate), { status }, { merge: true });
}

async function deleteOrgCascade(orgId: string): Promise<void> {
  const { db } = requireFirebase();
  await writeAuditLog(
    "刪除機構（級聯刪除旗下人員資料）",
    orgId,
    `刪除機構 ID ${orgId} 並清空其小卡資料庫`,
  );

  const querySnapshot = await getDocs(collection(db, "users"));
  let docIdToDelete: string | null = null;
  querySnapshot.forEach((docSnap) => {
    if (docSnap.data().orgId === orgId) {
      docIdToDelete = docSnap.id;
    }
  });
  if (docIdToDelete) {
    await deleteDoc(doc(db, "users", docIdToDelete));
  }

  const cardsSnapshot = await getDocs(collection(db, `organizations/${orgId}/student_cards`));
  for (const cardDoc of cardsSnapshot.docs) {
    await deleteDoc(doc(db, `organizations/${orgId}/student_cards/${cardDoc.id}`));
  }
}

// ── 人員小卡 ────────────────────────────────────────────────────

/** 把 Firestore 文件轉成 CardRecord；缺欄位時補預設值 */
function toCardRecord(data: Record<string, unknown>): CardRecord {
  return {
    effectiveDate: (data.effectiveDate as string) || "",
    expiryDate: (data.expiryDate as string) || "",
    name: (data.name as string) || "",
    role: (data.role as string) || "照顧服務員",
    nationality: (data.nationality as string) || "臺灣",
  };
}

async function getCardsByOrg(orgId: string): Promise<{ [cardId: string]: CardRecord }> {
  const { db } = requireFirebase();
  const querySnapshot = await getDocs(collection(db, `organizations/${orgId}/student_cards`));
  const cards: { [cardId: string]: CardRecord } = {};
  querySnapshot.forEach((docSnap) => {
    cards[docSnap.id] = toCardRecord(docSnap.data());
  });
  return cards;
}

async function getCard(orgId: string, cardId: string): Promise<CardRecord | null> {
  const { db } = requireFirebase();
  const cardDoc = await getDoc(doc(db, `organizations/${orgId}/student_cards/${cardId}`));
  return cardDoc.exists() ? toCardRecord(cardDoc.data()) : null;
}

async function saveCard(orgId: string, cardId: string, record: CardRecord): Promise<void> {
  const { db } = requireFirebase();
  await setDoc(
    doc(db, `organizations/${orgId}/student_cards/${cardId}`),
    { ...record, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

async function deleteCard(orgId: string, cardId: string): Promise<void> {
  const { db } = requireFirebase();
  await writeAuditLog("刪除學員小卡", orgId, `移除了學員小卡資料，學員身分證字號: ${cardId}`);
  await deleteDoc(doc(db, `organizations/${orgId}/student_cards/${cardId}`));
}

// ── 稽核日誌 ────────────────────────────────────────────────────

async function writeAuditLog(action: string, targetOrgId: string, details: string): Promise<void> {
  const { auth, db } = requireFirebase();

  // operatorEmail 一律取自 Auth 當下登入的使用者，不用 localStorage 的 session。
  // firestore.rules 會驗證 operatorEmail 必須等於 request.auth.token.email；
  // 沿用可被前端改寫的 session 值會在 session 過期或被竄改時被規則擋下。
  const operatorEmail = auth.currentUser?.email;
  if (!operatorEmail) {
    throw new Error("登入狀態已失效，無法寫入稽核日誌，請重新登入後再試。");
  }

  const log: AuditLog = {
    timestamp: new Date().toISOString(),
    operatorEmail,
    action,
    targetOrgId,
    details,
  };
  await setDoc(doc(collection(db, "audit_logs")), log);
}

async function getAuditLogs(): Promise<AuditLog[]> {
  const { db } = requireFirebase();
  const querySnapshot = await getDocs(collection(db, "audit_logs"));
  const logs: AuditLog[] = [];
  querySnapshot.forEach((docSnap) => {
    const data = docSnap.data();
    logs.push({
      id: docSnap.id,
      timestamp: data.timestamp || "",
      operatorEmail: data.operatorEmail || "",
      action: data.action || "",
      targetOrgId: data.targetOrgId || "",
      details: data.details || "",
    });
  });
  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export const firestoreBackend: LtcpBackend = {
  authMode: 'password',
  login,
  loginWithGoogle: async () => {
    throw new Error('目前使用帳號密碼登入，未啟用 Google 登入。');
  },
  register,
  logout,
  getCurrentSession,
  sendPasswordReset,
  listAccounts,
  createOrg,
  updateOrgStatus,
  deleteOrgCascade,
  getCardsByOrg,
  getCard,
  saveCard,
  deleteCard,
  writeAuditLog,
  getAuditLogs,
};
