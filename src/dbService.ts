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
import { sheetsBackend } from "./backend/sheetsBackend";
import type { LtcpBackend, OrganizationInfo } from "./backend/types";

export type {
  UserRole,
  UserSession,
  CardRecord,
  OrganizationInfo,
  AuditLog,
  AuthMode,
  LtcpBackend,
} from "./backend/types";

export { getRosterIssues, createSampleRoster } from "./backend/sheetsBackend";
export type { SheetIssue } from "./backend/sheetSchema";

/**
 * 目前使用的儲存層實作，由 VITE_BACKEND 決定。
 *
 * 'sheets'    資料放在各機構自己的 Google 試算表（名冊自主託管計畫的目標）
 * 'firestore' 我方 Firestore（預設，維持現況直到遷移完成）
 *
 * 兩套實作並存是刻意的：Firestore 上還有真實資料，切換必須能隨時退回。
 */
function getBackend(): LtcpBackend {
  return import.meta.env.VITE_BACKEND === 'sheets' ? sheetsBackend : firestoreBackend;
}

/** UI 用來決定要顯示帳密表單還是 Google 登入按鈕 */
export const getAuthMode = () => getBackend().authMode;

/** UI 用來顯示目前用的是哪個儲存層，以及設定是否完整 */
export const getBackendStatus = () => getBackend().status();

// ── 身分 ────────────────────────────────────────────────────────
export const loginUser = (email: string, password: string) => getBackend().login(email, password);
export const loginWithGoogle = () => getBackend().loginWithGoogle();
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
/** 目前這份名冊可以直接開啟的網址；沒有的話回傳 null */
export const getOrgUrl = (orgId: string) => getBackend().getOrgUrl(orgId);
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
export const saveStudentCards = (
  orgId: string,
  writes: Parameters<LtcpBackend['saveCards']>[1],
) => getBackend().saveCards(orgId, writes);
export const deleteStudentCards = (orgId: string, studentIds: string[]) =>
  getBackend().deleteCards(orgId, studentIds);

// ── 稽核日誌 ────────────────────────────────────────────────────
export const writeAuditLog = (action: string, targetOrgId: string, details: string) =>
  getBackend().writeAuditLog(action, targetOrgId, details);
export const getAuditLogs = () => getBackend().getAuditLogs();
