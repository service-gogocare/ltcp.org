/**
 * 資料存取門面
 * ---------------------------------------------------------------------------
 * UI 只認識這個檔案匯出的函式，不知道背後是 Firestore 還是別的東西。
 * 實際實作在 backend/ 底下，由 getBackend() 決定用哪一個。
 *
 * 之所以保留這層薄薄的門面而不是讓 UI 直接拿 backend 物件：
 * App.tsx 有十幾個呼叫點都是 `saveStudentCard(...)` 這種具名函式，
 * 維持同樣的簽名就不必為了換儲存層去改 UI。
 */

import { firestoreBackend } from "./backend/firestoreBackend";
import type { LtcpBackend, OrganizationInfo } from "./backend/types";

export type {
  UserRole,
  UserSession,
  CardRecord,
  OrganizationInfo,
  AuditLog,
  LtcpBackend,
} from "./backend/types";

/**
 * 目前使用的儲存層實作。
 * 導入 Google 試算表實作時，這裡會改成依設定或使用者選擇回傳不同的 backend。
 */
function getBackend(): LtcpBackend {
  return firestoreBackend;
}

// ── 身分 ────────────────────────────────────────────────────────
export const loginUser = (email: string, password: string) => getBackend().login(email, password);
export const registerUser = (email: string, password: string, orgName: string) =>
  getBackend().register(email, password, orgName);
export const logoutUser = () => getBackend().logout();
export const getCurrentSession = () => getBackend().getCurrentSession();
export const sendPasswordReset = (email: string) => getBackend().sendPasswordReset(email);

// ── 機構 ────────────────────────────────────────────────────────
export const getAllAccounts = () => getBackend().listAccounts();
export const adminCreateOrg = (
  email: string,
  orgName: string,
  role: Parameters<LtcpBackend['createOrg']>[2] = 'user',
) => getBackend().createOrg(email, orgName, role);
export const updateOrgStatus = (orgId: string, status: 'active' | 'disabled') =>
  getBackend().updateOrgStatus(orgId, status);
export const deleteOrganizationCascade = (orgId: string) => getBackend().deleteOrgCascade(orgId);

/** 稽查員沒有自己的學員小卡，選擇機構與統計時要排除 */
export function isRealOrganization(account: OrganizationInfo): boolean {
  return account.role !== 'auditor';
}

// ── 人員小卡 ────────────────────────────────────────────────────
export const getStudentCardsByOrg = (orgId: string) => getBackend().getCardsByOrg(orgId);
export const getStudentCard = (orgId: string, studentId: string) =>
  getBackend().getCard(orgId, studentId);
export const saveStudentCard = (
  orgId: string,
  studentId: string,
  record: Parameters<LtcpBackend['saveCard']>[2],
) => getBackend().saveCard(orgId, studentId, record);
export const deleteStudentCard = (orgId: string, studentId: string) =>
  getBackend().deleteCard(orgId, studentId);

// ── 稽核日誌 ────────────────────────────────────────────────────
export const writeAuditLog = (action: string, targetOrgId: string, details: string) =>
  getBackend().writeAuditLog(action, targetOrgId, details);
export const getAuditLogs = () => getBackend().getAuditLogs();
