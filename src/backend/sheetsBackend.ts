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
import {
  parseRoster,
  buildRosterValues,
  ROSTER_SHEET_TITLE,
  METADATA_SHEET_TITLE,
  ROSTER_COLUMNS,
  ROSTER_APP_PROPERTY,
  SCHEMA_VERSION,
  type SheetIssue,
} from './sheetSchema';
import { ROLE_OPTIONS, NATIONALITY_OPTIONS } from '../studentFields';
import { getAccessToken, requestAccessToken, revokeAccessToken, clearAccessToken, getClientId } from './google/gisAuth';
import {
  fetchUserInfo,
  listRosterFiles,
  fetchSheetValues,
  createSpreadsheet,
  updateSheetValues,
  batchUpdateSpreadsheet,
  setAppProperties,
} from './google/googleApi';

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

// ── 建立名冊 ────────────────────────────────────────────────────

/** 某個欄位在試算表上的欄索引（0 起算），用來設資料驗證與格式 */
function columnIndex(key: (typeof ROSTER_COLUMNS)[number]['key']): number {
  return ROSTER_COLUMNS.findIndex((c) => c.key === key);
}

function dropdownRequest(sheetId: number, key: 'role' | 'nationality', options: string[]) {
  const col = columnIndex(key);
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: options.map((v) => ({ userEnteredValue: v })) },
        showCustomUi: true,
        // 只警告不強制：使用者貼上整批資料時不該被整個擋下來，
        // 真正的把關在讀取端的 parseRoster
        strict: false,
      },
    },
  };
}

function textFormatRequest(sheetId: number, key: 'effectiveDate' | 'expiryDate') {
  const col = columnIndex(key);
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
      // 民國日期必須以文字保存，否則「113/08/20」會被試算表當成西元日期換算掉
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
}

/**
 * 建立一份結構正確的名冊試算表。
 *
 * 順序有意義：先建檔與寫入內容，最後才設 appProperties 標記 ——
 * 標記是本系統認出名冊的依據，中途失敗時寧可留下一份「沒被認出的試算表」，
 * 也不要留下一份「被認出但結構不完整」的檔案。
 */
export async function createRosterSpreadsheet(
  title: string,
  cards: { [cardId: string]: CardRecord } = {},
): Promise<{ spreadsheetId: string }> {
  const token = await getAccessToken();

  const { spreadsheetId, sheetIdByTitle } = await createSpreadsheet(token, title, [
    { title: ROSTER_SHEET_TITLE },
    { title: METADATA_SHEET_TITLE, hidden: true },
  ]);

  await updateSheetValues(token, spreadsheetId, ROSTER_SHEET_TITLE, buildRosterValues(cards));
  await updateSheetValues(token, spreadsheetId, METADATA_SHEET_TITLE, [
    ['schemaVersion', SCHEMA_VERSION],
    ['機構名稱', title],
    ['建立時間', new Date().toISOString()],
  ]);

  const rosterSheetId = sheetIdByTitle[ROSTER_SHEET_TITLE];
  if (rosterSheetId !== undefined) {
    await batchUpdateSpreadsheet(token, spreadsheetId, [
      dropdownRequest(rosterSheetId, 'role', ROLE_OPTIONS),
      dropdownRequest(rosterSheetId, 'nationality', NATIONALITY_OPTIONS),
      textFormatRequest(rosterSheetId, 'effectiveDate'),
      textFormatRequest(rosterSheetId, 'expiryDate'),
    ]);
  }

  await setAppProperties(token, spreadsheetId, {
    [ROSTER_APP_PROPERTY.key]: ROSTER_APP_PROPERTY.value,
  });

  invalidateRosterCache(spreadsheetId);
  return { spreadsheetId };
}

/** 開發用：建立一份含範例資料的名冊，讓階段 2 的讀取路徑能在真實環境驗證 */
export async function createSampleRoster(): Promise<{ spreadsheetId: string }> {
  return createRosterSpreadsheet(`測試名冊 ${new Date().toLocaleString('zh-TW')}`, {
    'A123456789_照顧服務人員': {
      name: '王小明', role: '照顧服務人員', nationality: '臺灣',
      effectiveDate: '113/08/20', expiryDate: '119/08/19',
    },
    'B120169842_居家服務督導員': {
      name: '李小龍', role: '居家服務督導員', nationality: '臺灣',
      effectiveDate: '112/02/25', expiryDate: '118/02/24',
    },
    'C200000002_照顧服務人員': {
      name: '陳美玉', role: '照顧服務人員', nationality: '印尼',
      effectiveDate: '110/05/05', expiryDate: '116/05/04',
    },
  });
}

export const sheetsBackend: LtcpBackend = {
  authMode: 'google',

  status: () => {
    // 試算表模式完全不使用 Firebase，所以 Firebase 有沒有設定好與這裡無關。
    // 這個模式唯一必要的設定是 OAuth 用戶端 ID。
    const hasClientId = !!getClientId();
    return {
      label: 'Google 試算表',
      ready: hasClientId,
      ...(hasClientId ? {} : {
        error: '系統設定不完整：缺少 VITE_GOOGLE_CLIENT_ID。請在 .env 填入 Google Cloud 的 OAuth 用戶端 ID，並重新啟動開發伺服器。',
      }),
    };
  },


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
