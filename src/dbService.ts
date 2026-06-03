import { getFirebaseStatus } from "./firebase";
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
  getDocs
} from "firebase/firestore";

export interface UserSession {
  email: string;
  orgId: string;
  name: string;
  role: 'user' | 'admin';
}

export interface CardRecord {
  effectiveDate: string;
  expiryDate: string;
  name: string;
}

// Helper to get mock user from localStorage
function getMockUser(): UserSession | null {
  const data = localStorage.getItem("ltcp_mock_user");
  return data ? JSON.parse(data) : null;
}

// Authentication operations
export async function loginUser(email: string, password: string): Promise<UserSession> {
  const { isMock, auth, db } = getFirebaseStatus();
  
  if (isMock || !auth || !db) {
    // Mock authentication
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    const matched = Object.values(users).find((u: any) => u.email === email && u.password === password) as any;
    
    // Check seed accounts first
    if (email === "admin@example.com" && password === "adminpassword") {
      const session: UserSession = { email, orgId: "admin_all", name: "超級管理員", role: "admin" };
      localStorage.setItem("ltcp_mock_user", JSON.stringify(session));
      return session;
    }
    
    if (email === "test@example.com" && password === "password") {
      const session: UserSession = { email, orgId: "org_default", name: "預設長照機構", role: "user" };
      localStorage.setItem("ltcp_mock_user", JSON.stringify(session));
      return session;
    }

    if (matched) {
      const session: UserSession = { 
        email: matched.email, 
        orgId: matched.orgId, 
        name: matched.name,
        role: matched.role || 'user'
      };
      localStorage.setItem("ltcp_mock_user", JSON.stringify(session));
      return session;
    }
    
    throw new Error("帳號或密碼錯誤（測試帳號: test@example.com 密碼: password，管理員: admin@example.com 密碼: adminpassword）");
  } else {
    // Real Firebase auth
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;
    // Get organization info from firestore
    const orgDoc = await getDoc(doc(db, "users", uid));
    if (orgDoc.exists()) {
      const data = orgDoc.data();
      const session: UserSession = {
        email: credential.user.email || email,
        orgId: data.orgId || uid,
        name: data.name || "長照機構",
        role: (data.role as 'user' | 'admin') || "user"
      };
      localStorage.setItem("ltcp_firebase_user_session", JSON.stringify(session));
      return session;
    } else {
      const orgId = "org_" + uid.substring(0, 6);
      const name = "長照機構 (" + email.split("@")[0] + ")";
      const role = "user";
      await setDoc(doc(db, "users", uid), { orgId, name, email, role });
      const session: UserSession = { email, orgId, name, role };
      localStorage.setItem("ltcp_firebase_user_session", JSON.stringify(session));
      return session;
    }
  }
}

export async function registerUser(email: string, password: string, orgName: string): Promise<UserSession> {
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

// Admin Helper: Get all institutions
export async function getAllOrganizations(): Promise<{ orgId: string; name: string }[]> {
  const { isMock, db } = getFirebaseStatus();
  if (isMock || !db) {
    const list = [{ orgId: "org_default", name: "預設長照機構" }];
    const users = JSON.parse(localStorage.getItem("ltcp_mock_users") || "{}");
    Object.values(users).forEach((u: any) => {
      list.push({ orgId: u.orgId, name: u.name });
    });
    return list;
  } else {
    const querySnapshot = await getDocs(collection(db, "users"));
    const list: { orgId: string; name: string }[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.orgId && data.role !== "admin") {
        list.push({ orgId: data.orgId, name: data.name || data.email });
      }
    });
    return list;
  }
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
        name: data.name || ""
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
        name: data.name || ""
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

