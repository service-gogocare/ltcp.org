import { assertBackendAvailable, getFirebaseStatus } from "./firebase";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  sendPasswordResetEmail
} from "firebase/auth";
import { 
  doc, 
  getDoc, 
  setDoc,
  collection,
  getDocs,
  deleteDoc
} from "firebase/firestore";

export type UserRole = 'super_admin' | 'auditor' | 'org_admin' | 'user' | 'admin';

export interface UserSession {
  email: string;
  orgId: string;
  name: string;
  role: UserRole;
  status?: 'active' | 'disabled';
}

export interface CardRecord {
  effectiveDate: string;
  expiryDate: string;
  name: string;
  role?: string;
  nationality?: string;
}

// Helper to get mock user from localStorage
function getMockUser(): UserSession | null {
  const data = localStorage.getItem("ltcp_mock_user");
  return data ? JSON.parse(data) : null;
}

// Authentication operations
export async function loginUser(email: string, password: string): Promise<UserSession> {
  assertBackendAvailable(); // 正式環境後端不可用時直接失敗，不得默默改走 Mock 帳密
  const { isMock, auth, db } = getFirebaseStatus();
  
  if (isMock || !auth || !db) {
    // Mock authentication
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    const matched = Object.values(users).find((u: any) => u.email === email && u.password === password) as any;
    
    // Check seed accounts first
    if (email === "admin@example.com" && password === "adminpassword") {
      const session: UserSession = { email, orgId: "admin_all", name: "超級管理員", role: "admin", status: "active" };
      localStorage.setItem("ltcp_mock_user", JSON.stringify(session));
      return session;
    }
    
    if (email === "test@example.com" && password === "password") {
      const session: UserSession = { email, orgId: "org_default", name: "預設長照機構", role: "user", status: "active" };
      localStorage.setItem("ltcp_mock_user", JSON.stringify(session));
      return session;
    }

    if (email === "auditor@example.com" && password === "auditorpassword") {
      const session: UserSession = { email, orgId: "admin_all", name: "區域稽查員", role: "auditor", status: "active" };
      localStorage.setItem("ltcp_mock_user", JSON.stringify(session));
      return session;
    }
    
    if (matched) {
      if (matched.status === 'disabled') {
        throw new Error("此帳號已被停用，請聯絡系統管理員。");
      }
      const session: UserSession = { 
        email: matched.email, 
        orgId: matched.orgId, 
        name: matched.name,
        role: matched.role || 'user',
        status: matched.status || 'active'
      };
      localStorage.setItem("ltcp_mock_user", JSON.stringify(session));
      return session;
    }
    
    throw new Error("帳號或密碼錯誤（測試帳號: test@example.com 密碼: password，稽查員: auditor@example.com 密碼: auditorpassword，管理員: admin@example.com 密碼: adminpassword）");
  } else {
    // Real Firebase auth
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;
    // Get organization info from firestore
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
        status: data.status || 'active'
      };
      localStorage.setItem("ltcp_firebase_user_session", JSON.stringify(session));
      return session;
    } else {
      const orgId = "org_" + uid.substring(0, 6);
      const name = "長照機構 (" + email.split("@")[0] + ")";
      const role = "user";
      const status = "active";
      await setDoc(doc(db, "users", uid), { orgId, name, email, role, status });
      const session: UserSession = { email, orgId, name, role, status };
      localStorage.setItem("ltcp_firebase_user_session", JSON.stringify(session));
      return session;
    }
  }
}

export async function registerUser(email: string, password: string, orgName: string): Promise<UserSession> {
  assertBackendAvailable(); // 同上：避免誤部署時在 localStorage 裡建立「真實」帳號
  const { isMock, auth, db } = getFirebaseStatus();
  const orgId = "org_" + Math.random().toString(36).substring(2, 8);

  if (isMock || !auth || !db) {
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    if (users[email] || email === "test@example.com" || email === "admin@example.com") {
      throw new Error("此電子郵件已被註冊");
    }
    users[email] = { email, password, orgId, name: orgName, role: 'user' };
    localStorage.setItem("ltcp_mock_users", JSON.stringify(users));
    
    const session: UserSession = { email, orgId, name: orgName, role: 'user' };
    localStorage.setItem("ltcp_mock_user", JSON.stringify(session));
    return session;
  } else {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;
    const role = "user";
    await setDoc(doc(db, "users", uid), { orgId, name: orgName, email, role });
    const session: UserSession = { email, orgId, name: orgName, role };
    localStorage.setItem("ltcp_firebase_user_session", JSON.stringify(session));
    return session;
  }
}

export async function logoutUser(): Promise<void> {
  const { isMock, auth } = getFirebaseStatus();
  if (isMock || !auth) {
    localStorage.removeItem("ltcp_mock_user");
  } else {
    localStorage.removeItem("ltcp_firebase_user_session");
    await signOut(auth);
  }
}

export function getCurrentSession(): UserSession | null {
  const { isMock, auth } = getFirebaseStatus();
  if (isMock || !auth) {
    return getMockUser();
  } else {
    const userJson = localStorage.getItem("ltcp_firebase_user_session");
    return userJson ? JSON.parse(userJson) : null;
  }
}

// Reset Password API
export async function sendPasswordReset(email: string): Promise<{ isMock: boolean; link?: string }> {
  assertBackendAvailable(); // 同上：避免正式站彈出 Mock 的假重設連結
  const { isMock, auth } = getFirebaseStatus();
  if (isMock || !auth) {
    // Mock simulation
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    const matched = Object.values(users).find((u: any) => u.email === email);
    
    if (email !== "test@example.com" && email !== "admin@example.com" && !matched) {
      throw new Error("此電子郵件尚未註冊");
    }
    const link = `http://localhost:5173/reset-password?email=${encodeURIComponent(email)}`;
    console.log(`[Mock] Password reset link simulated for ${email}. Link: ${link}`);
    return { isMock: true, link };
  } else {
    await sendPasswordResetEmail(auth, email);
    return { isMock: false };
  }
}

// Admin Helper: Get all institutions with complete details
export interface OrganizationInfo {
  orgId: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'disabled';
}

/**
 * 列出所有可被管理的帳號：一般長照機構與唯讀稽查員，排除系統管理者本身。
 *
 * 注意：這裡刻意「不」排除 auditor。稽查員也需要能被檢視、停用與刪除；
 * 舊版在這一層就把 auditor 濾掉，導致建立出來的稽查員帳號在 UI 完全消失、無法管理。
 * 只有「選擇機構」下拉選單與到期統計才需要排除稽查員（稽查員沒有學員小卡），
 * 那個過濾放在呼叫端做。
 */
export async function getAllAccounts(): Promise<OrganizationInfo[]> {
  const { isMock, db } = getFirebaseStatus();

  const isManageable = (role: string) => role !== 'admin' && role !== 'super_admin';

  if (isMock || !db) {
    const list: OrganizationInfo[] = [
      { orgId: "org_default", name: "預設長照機構", email: "test@example.com", role: "user", status: "active" }
    ];
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    Object.values(users).forEach((u: any) => {
      if (isManageable(u.role || 'user')) {
        list.push({
          orgId: u.orgId,
          name: u.name || "長照機構",
          email: u.email,
          role: u.role || 'user',
          status: u.status || 'active'
        });
      }
    });
    return list;
  } else {
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
          status: data.status || "active"
        });
      }
    });
    return list;
  }
}

/** 稽查員沒有自己的學員小卡，選擇機構與統計時要排除 */
export function isRealOrganization(account: OrganizationInfo): boolean {
  return account.role !== 'auditor';
}

// Admin Helper: Get all cards by organization
export async function getStudentCardsByOrg(orgId: string): Promise<{ [studentId: string]: CardRecord }> {
  const { isMock, db } = getFirebaseStatus();
  if (isMock || !db) {
    return JSON.parse(localStorage.getItem(`ltcp_mock_cards_${orgId}`) || "{}");
  } else {
    const querySnapshot = await getDocs(collection(db, `organizations/${orgId}/student_cards`));
    const cards: { [studentId: string]: CardRecord } = {};
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      cards[doc.id] = {
        effectiveDate: data.effectiveDate || "",
        expiryDate: data.expiryDate || "",
        name: data.name || "",
        role: data.role || "照顧服務員",
        nationality: data.nationality || "臺灣"
      };
    });
    return cards;
  }
}

// Student card storage/retrieval (Standard)
export async function getStudentCard(orgId: string, studentId: string): Promise<CardRecord | null> {
  const { isMock, db } = getFirebaseStatus();
  
  if (isMock || !db) {
    const cards = JSON.parse(localStorage.getItem(`ltcp_mock_cards_${orgId}`) || "{}");
    return cards[studentId] || null;
  } else {
    const cardDoc = await getDoc(doc(db, `organizations/${orgId}/student_cards/${studentId}`));
    if (cardDoc.exists()) {
      const data = cardDoc.data();
      return {
        effectiveDate: data.effectiveDate || "",
        expiryDate: data.expiryDate || "",
        name: data.name || "",
        role: data.role || "照顧服務員",
        nationality: data.nationality || "臺灣"
      };
    }
    return null;
  }
}

export async function saveStudentCard(orgId: string, studentId: string, record: CardRecord): Promise<void> {
  const { isMock, db } = getFirebaseStatus();
  
  if (isMock || !db) {
    const key = `ltcp_mock_cards_${orgId}`;
    const cards = JSON.parse(localStorage.getItem(key) || "{}");
    cards[studentId] = record;
    localStorage.setItem(key, JSON.stringify(cards));
  } else {
    await setDoc(doc(db, `organizations/${orgId}/student_cards/${studentId}`), {
      ...record,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }
}

// -------------------------------------------------------------
// NEW: Audit Logs and Administrative API Methods
// -------------------------------------------------------------

export interface AuditLog {
  id?: string;
  timestamp: string;
  operatorEmail: string;
  action: string;
  targetOrgId: string;
  details: string;
}

export async function writeAuditLog(action: string, targetOrgId: string, details: string): Promise<void> {
  const { isMock, db, auth } = getFirebaseStatus();

  if (isMock || !db) {
    const session = getCurrentSession();
    const log: AuditLog = {
      timestamp: new Date().toISOString(),
      operatorEmail: session ? session.email : "system@example.com",
      action,
      targetOrgId,
      details
    };
    const logs = JSON.parse(localStorage.getItem("ltcp_mock_audit_logs") || "[]");
    logs.push({ ...log, id: Math.random().toString(36).substring(2, 9) });
    localStorage.setItem("ltcp_mock_audit_logs", JSON.stringify(logs));
    return;
  }

  // 正式模式下 operatorEmail 一律取自 Auth 當下登入的使用者，不用 localStorage 的 session。
  // firestore.rules 會驗證 operatorEmail 必須等於 request.auth.token.email；
  // 沿用可被前端改寫的 session 值會在 session 過期或被竄改時被規則擋下。
  const operatorEmail = auth?.currentUser?.email;
  if (!operatorEmail) {
    throw new Error("登入狀態已失效，無法寫入稽核日誌，請重新登入後再試。");
  }

  const log: AuditLog = {
    timestamp: new Date().toISOString(),
    operatorEmail,
    action,
    targetOrgId,
    details
  };
  await setDoc(doc(collection(db, "audit_logs")), log);
}

export async function getAuditLogs(): Promise<AuditLog[]> {
  const { isMock, db } = getFirebaseStatus();
  if (isMock || !db) {
    const logs = JSON.parse(localStorage.getItem("ltcp_mock_audit_logs") || "[]");
    return logs.sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp));
  } else {
    const querySnapshot = await getDocs(collection(db, "audit_logs"));
    const logs: AuditLog[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      logs.push({
        id: doc.id,
        timestamp: data.timestamp || "",
        operatorEmail: data.operatorEmail || "",
        action: data.action || "",
        targetOrgId: data.targetOrgId || "",
        details: data.details || ""
      });
    });
    return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}

export async function updateOrgStatus(orgId: string, status: 'active' | 'disabled'): Promise<void> {
  const { isMock, db } = getFirebaseStatus();
  await writeAuditLog(`變更機構狀態為 [${status === 'active' ? '啟用' : '停用'}]`, orgId, `將機構 ID ${orgId} 的帳號狀態改為 ${status}`);

  if (isMock || !db) {
    if (orgId === "org_default") {
      throw new Error("系統預設機構無法被停用！");
    }
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    const foundEmail = Object.keys(users).find(k => users[k].orgId === orgId);
    if (foundEmail) {
      users[foundEmail].status = status;
      localStorage.setItem("ltcp_mock_users", JSON.stringify(users));
    } else {
      throw new Error("找不到對應的 Mock 機構資料");
    }
  } else {
    const querySnapshot = await getDocs(collection(db, "users"));
    let docIdToUpdate: string | null = null;
    querySnapshot.forEach((doc) => {
      if (doc.data().orgId === orgId) {
        docIdToUpdate = doc.id;
      }
    });

    if (docIdToUpdate) {
      await setDoc(doc(db, "users", docIdToUpdate), { status }, { merge: true });
    } else {
      throw new Error("在 Firestore 中找不到該機構的使用者文件");
    }
  }
}

export async function deleteOrganizationCascade(orgId: string): Promise<void> {
  const { isMock, db } = getFirebaseStatus();
  await writeAuditLog("刪除機構（級聯刪除旗下人員資料）", orgId, `刪除機構 ID ${orgId} 並清空其小卡資料庫`);

  if (isMock || !db) {
    if (orgId === "org_default") {
      throw new Error("系統預設機構不能被刪除！");
    }
    // Delete user profile
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    const foundEmail = Object.keys(users).find(k => users[k].orgId === orgId);
    if (foundEmail) {
      delete users[foundEmail];
      localStorage.setItem("ltcp_mock_users", JSON.stringify(users));
    }
    // Delete student cards
    localStorage.removeItem(`ltcp_mock_cards_${orgId}`);
  } else {
    // Delete user profile in Firestore
    const querySnapshot = await getDocs(collection(db, "users"));
    let docIdToDelete: string | null = null;
    querySnapshot.forEach((doc) => {
      if (doc.data().orgId === orgId) {
        docIdToDelete = doc.id;
      }
    });
    if (docIdToDelete) {
      await deleteDoc(doc(db, "users", docIdToDelete));
    }

    // Delete student cards in Firestore subcollection
    const cardsSnapshot = await getDocs(collection(db, `organizations/${orgId}/student_cards`));
    for (const cardDoc of cardsSnapshot.docs) {
      await deleteDoc(doc(db, `organizations/${orgId}/student_cards/${cardDoc.id}`));
    }
  }
}

export async function deleteStudentCard(orgId: string, studentId: string): Promise<void> {
  const { isMock, db } = getFirebaseStatus();
  await writeAuditLog("刪除學員小卡", orgId, `移除了學員小卡資料，學員身分證字號: ${studentId}`);

  if (isMock || !db) {
    const key = `ltcp_mock_cards_${orgId}`;
    const cards = JSON.parse(localStorage.getItem(key) || "{}");
    if (cards[studentId]) {
      delete cards[studentId];
      localStorage.setItem(key, JSON.stringify(cards));
    }
  } else {
    await deleteDoc(doc(db, `organizations/${orgId}/student_cards/${studentId}`));
  }
}

export async function adminCreateOrg(email: string, orgName: string, role: UserRole = 'user'): Promise<void> {
  const { isMock, db } = getFirebaseStatus();
  const orgId = "org_" + Math.random().toString(36).substring(2, 8);
  await writeAuditLog(`建立新機構帳號`, orgId, `帳號電子郵件: ${email}, 機構名稱: ${orgName}, 角色權限: ${role}`);

  if (isMock || !db) {
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    if (users[email] || email === "test@example.com" || email === "admin@example.com" || email === "auditor@example.com") {
      throw new Error("此電子郵件已被註冊");
    }
    users[email] = { email, password: "password", orgId, name: orgName, role, status: 'active' };
    localStorage.setItem("ltcp_mock_users", JSON.stringify(users));
  } else {
    const newUid = "admin_created_" + Math.random().toString(36).substring(2, 10);
    await setDoc(doc(db, "users", newUid), {
      email,
      orgId,
      name: orgName,
      role,
      status: 'active',
      createdAt: new Date().toISOString()
    });
  }
}


