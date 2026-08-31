/**
 * LtcpBackend 的 Google 試算表實作（階段 2：唯讀）
 * ---------------------------------------------------------------------------
 * 資料放在各機構自己 Drive 裡的試算表，我方不持有任何個資。
 * 權限完全由 Drive 的分享機制決定：檢視者唯讀、編輯者可寫。
 *
 * 這一版只實作讀取路徑。寫入相關的方法一律擲錯而不是默默不做事 ——
 * 靜默失敗會讓使用者以為資料已經存檔。
 */

import type {
  LtcpBackend,
  UserSession,
  CardRecord,
  OrganizationInfo,
  AuditLog,
} from './types';
import { parseRoster, ROSTER_SHEET_TITLE, type SheetIssue } from './sheetSchema';
import { getAccessToken, requestAccessToken, revokeAccessToken, clearAccessToken } from './google/gisAuth';
import { fetchUserInfo, listRosterFiles, fetchSheetValues } from './google/googleApi';

const SESSION_KEY = 'ltcp_google_session';

const NOT_YET = (what: string) =>
  new Error(`${what}尚未開放：目前為唯讀階段，請直接在 Google 試算表中修改，或等待寫入功能上線。`);

/**
 * 已讀取過的名冊快取。
 *
 * 存在的理由是效能而非速度：Excel 匯入流程會「逐人」呼叫 getCard，
 * 在 Firestore 是 N 次讀取，在 Sheets API 會變成 N 次 HTTP 往返，
 * 以四十幾人的規模就足以撞到每分鐘配額。整張表讀一次放這裡即可。
 */
const rosterCache = new Map<string, { [cardId: string]: CardRecord }>();

/** 最近一次解析出的資料品質問題，供介面顯示（結構健檢的雛形） */
const issueCache = new Map<string, SheetIssue[]>();

export function getRosterIssues(spreadsheetId: string): SheetIssue[] {
  return issueCache.get(spreadsheetId) ?? [];
}

export function invalidateRosterCache(spreadsheetId?: string): void {
  if (spreadsheetId) {
    rosterCache.delete(spreadsheetId);
    issueCache.delete(spreadsheetId);
  } else {
    rosterCache.clear();
    issueCache.clear();
  }
}

// ── 身分 ────────────────────────────────────────────────────────

async function loginWithGoogle(): Promise<UserSession> {
  const token = await requestAccessToken(true);
  const info = await fetchUserInfo(token);
  const session: UserSession = {
    email: info.email,
    // 試算表模式下沒有「所屬機構」的概念，實際操作對象由使用者選擇哪份名冊決定
    orgId: '',
    name: info.name,
    role: 'user',
    status: 'active',
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function getCurrentSession(): UserSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function logout(): Promise<void> {
  localStorage.removeItem(SESSION_KEY);
  invalidateRosterCache();
  await revokeAccessToken();
}

// ── 名冊（對應原本的「機構」）────────────────────────────────────

async function listAccounts(): Promise<OrganizationInfo[]> {
  const token = await getAccessToken();
  const files = await listRosterFiles(token);
  return files.map((f) => ({
    orgId: f.id,
    name: f.name,
    email: f.owners?.[0]?.emailAddress || '',
    // 唯讀／可編輯直接來自 Drive 的實際權限，不是我們自己發明的角色
    role: f.capabilities?.canEdit ? 'user' : 'auditor',
    status: 'active' as const,
  }));
}

// ── 人員小卡 ────────────────────────────────────────────────────

async function getCardsByOrg(spreadsheetId: string): Promise<{ [cardId: string]: CardRecord }> {
  if (!spreadsheetId) return {};
  const token = await getAccessToken();
  const values = await fetchSheetValues(token, spreadsheetId, ROSTER_SHEET_TITLE);
  const { cards, issues } = parseRoster(values);
  rosterCache.set(spreadsheetId, cards);
  issueCache.set(spreadsheetId, issues);
  return cards;
}

async function getCard(spreadsheetId: string, cardId: string): Promise<CardRecord | null> {
  const cached = rosterCache.get(spreadsheetId);
  if (cached) return cached[cardId] ?? null;
  const cards = await getCardsByOrg(spreadsheetId);
  return cards[cardId] ?? null;
}

export const sheetsBackend: LtcpBackend = {
  authMode: 'google',

  loginWithGoogle,
  getCurrentSession,
  logout,

  login: async () => {
    throw new Error('此系統改用 Google 登入，不再使用帳號密碼。');
  },
  register: async () => {
    throw new Error('此系統改用 Google 登入，不需要註冊。建立名冊即可開始使用。');
  },
  sendPasswordReset: async () => {
    throw new Error('密碼由 Google 帳號管理，請至 Google 帳號設定重設。');
  },

  listAccounts,
  createOrg: async () => {
    throw NOT_YET('建立名冊');
  },
  updateOrgStatus: async () => {
    throw NOT_YET('變更名冊狀態');
  },
  deleteOrgCascade: async () => {
    throw NOT_YET('刪除名冊');
  },

  getCardsByOrg,
  getCard,
  saveCard: async () => {
    throw NOT_YET('儲存人員資料');
  },
  deleteCard: async () => {
    throw NOT_YET('刪除人員資料');
  },

  // 依決定不留操作紀錄，改以試算表自身的版本紀錄為準
  writeAuditLog: async () => {},
  getAuditLogs: async (): Promise<AuditLog[]> => [],
};

export { clearAccessToken };
