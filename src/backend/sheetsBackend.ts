/**
 * LtcpBackend 的 Google 試算表實作
 * ---------------------------------------------------------------------------
 * 資料放在各機構自己 Drive 裡的試算表，我方不持有任何個資。
 * 權限完全由 Drive 的分享機制決定：檢視者唯讀、編輯者可寫。
 *
 * 人員資料的讀寫都已實作。名冊本身的建立與刪除仍擲錯 ——
 * 那屬於 Drive 的檔案管理，尚未接上介面，擲錯而不是默默不做事，
 * 靜默失敗會讓使用者以為操作成功了。
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
  planSheetWrites,
  planSheetDeletes,
  toA1Range,
  MONTHLY_SHEET_TITLE,
  MONTHLY_COLUMNS,
  MONTHLY_HEADER_ROW,
  parseMonthlyReport,
  planMonthlyReplace,
  type SheetIssue,
} from './sheetSchema';
import type { MonthlyPointRecord } from '../monthlyPoints';
import { ROLE_OPTIONS, NATIONALITY_OPTIONS } from '../studentFields';
import { getAccessToken, requestAccessToken, revokeAccessToken, clearAccessToken, getClientId } from './google/gisAuth';
import {
  fetchUserInfo,
  listAccessibleSpreadsheets,
  hasRosterTag,
  fetchSheetValues,
  createSpreadsheet,
  updateSheetValues,
  batchUpdateSpreadsheet,
  setAppProperties,
  batchUpdateValues,
  appendSheetValues,
  deleteSheetRows,
  addSheet,
  replaceSheetRows,
  fetchSheetIdByTitle,
  fetchFileMeta,
  type DriveFile,
} from './google/googleApi';
import { pickSpreadsheet } from './google/picker';

const SESSION_KEY = 'ltcp_google_session';

const NOT_YET = (what: string) =>
  new Error(`${what}尚未開放。人員資料的新增、修改與刪除已可使用；名冊本身請直接在 Google 雲端硬碟中管理。`);

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

/** 積分月報上的資料品質問題，與名冊的分開存：兩張表壞掉的原因完全不同 */
const monthlyIssueCache = new Map<string, SheetIssue[]>();

export function getMonthlyIssues(spreadsheetId: string): SheetIssue[] {
  return monthlyIssueCache.get(spreadsheetId) ?? [];
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

const PICKED_KEY = 'ltcp_picked_rosters';

/**
 * 使用者透過 Picker 選過的試算表 ID。
 *
 * 為什麼要自己記：drive.file 範圍下，透過 Picker 授權的檔案是否會出現在
 * files.list 的查詢結果並不保證，而且別人分享的名冊也不一定帶有我們的
 * appProperties 標記。自己記一份，清單就不必依賴那些不確定的行為。
 */
function readPickedIds(): string[] {
  try {
    const raw = localStorage.getItem(PICKED_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writePickedIds(ids: string[]): void {
  localStorage.setItem(PICKED_KEY, JSON.stringify([...new Set(ids)]));
}

function toOrganizationInfo(f: DriveFile): OrganizationInfo {
  return {
    orgId: f.id,
    name: f.name,
    email: f.owners?.[0]?.emailAddress || '',
    role: 'user',
    status: 'active',
    // 直接取自 Drive 的實際權限：檢視者拿到 false，編輯者拿到 true
    canEdit: f.capabilities?.canEdit === true,
  };
}

/**
 * 上一次列出名冊時遇到的問題。
 *
 * 存在的理由：這裡的失敗不該讓整份清單掛掉（其他名冊還是要能用），
 * 但也絕不能靜默吞掉 —— 之前就是因為 catch 什麼都不做，
 * 使用者只看到「找不到任何名冊」，完全無法判斷是權限、標記還是 API 的問題。
 */
let lastListDiagnostics: string[] = [];

export function getListDiagnostics(): string[] {
  return lastListDiagnostics;
}

async function listAccounts(): Promise<OrganizationInfo[]> {
  const token = await getAccessToken();
  const diagnostics: string[] = [];

  const accessible = await listAccessibleSpreadsheets(token);
  const pickedIds = new Set(readPickedIds());

  const byId = new Map<string, OrganizationInfo>();
  let taggedCount = 0;
  let pickedFromList = 0;

  for (const f of accessible) {
    if (hasRosterTag(f)) {
      taggedCount++;
      byId.set(f.id, toOrganizationInfo(f));
    } else if (pickedIds.has(f.id)) {
      // 使用者親自選過，就算沒有本系統的標記也列出來
      pickedFromList++;
      byId.set(f.id, toOrganizationInfo(f));
    }
  }

  // 選過但沒出現在上面清單裡的，逐一直接查詢。
  // drive.file 範圍下「Picker 授權的檔案會不會出現在 files.list」沒有保證，
  // 所以這條路是必要的後備，不是多餘的重複查詢。
  const stillValid: string[] = [];
  let fetchedDirectly = 0;
  for (const id of pickedIds) {
    if (byId.has(id)) {
      stillValid.push(id);
      continue;
    }
    try {
      const meta = await fetchFileMeta(token, id);
      byId.set(id, toOrganizationInfo(meta));
      stillValid.push(id);
      fetchedDirectly++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push(`選過的名冊 ${id} 讀不到，已從清單移除：${message}`);
    }
  }
  if (stillValid.length !== pickedIds.size) writePickedIds(stillValid);

  diagnostics.unshift(
    `可存取的試算表 ${accessible.length} 份：帶標記 ${taggedCount}、選過 ${pickedFromList}、`
    + `另外直接查到 ${fetchedDirectly}。`,
  );
  lastListDiagnostics = diagnostics;

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

/**
 * 開啟 Google 檔案選擇器讓使用者選一份名冊，並記住它。
 * 回傳選到的試算表；使用者取消時回傳 null。
 */
export async function pickRoster(): Promise<{ id: string; name: string } | null> {
  const doc = await pickSpreadsheet();
  if (!doc) return null;
  writePickedIds([...readPickedIds(), doc.id]);
  invalidateRosterCache(doc.id);
  return { id: doc.id, name: doc.name || doc.id };
}

/** 從清單移除（只忘記本機記錄，不會刪除雲端硬碟上的檔案） */
export function forgetPickedRoster(spreadsheetId: string): void {
  writePickedIds(readPickedIds().filter((id) => id !== spreadsheetId));
  invalidateRosterCache(spreadsheetId);
}

// ── 人員小卡 ────────────────────────────────────────────────────

async function getCardsByOrg(spreadsheetId: string): Promise<{ [cardId: string]: CardRecord }> {
  if (!spreadsheetId) return {};
  const token = await getAccessToken();
  let values: string[][];
  try {
    values = await fetchSheetValues(token, spreadsheetId, ROSTER_SHEET_TITLE);
  } catch (err) {
    // 分頁不存在時 Sheets API 只會回「Unable to parse range」，看不出問題在哪。
    // 使用者透過 Picker 可能選到任何一份試算表，這個情況很常見。
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Unable to parse range') || message.includes('400')) {
      throw new Error(
        `這份試算表沒有「${ROSTER_SHEET_TITLE}」分頁，可能不是本系統的名冊。請確認選到正確的檔案，或改用「＋ 建立名冊」新建一份。`,
        { cause: err },
      );
    }
    throw err;
  }
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

// ── 寫入 ────────────────────────────────────────────────────────

/**
 * 儲存一批人員資料。
 *
 * 每次都先重讀試算表現況再規劃寫入，不依賴載入時的快取 ——
 * 期間別人可能已經改過內容，照著舊快取算列號會寫到錯的列。
 */
async function saveCards(
  spreadsheetId: string,
  writes: { cardId: string; record: CardRecord }[],
): Promise<void> {
  if (!spreadsheetId) throw new Error('沒有選擇名冊，無法儲存。');
  if (writes.length === 0) return;

  const token = await getAccessToken();
  const current = await fetchSheetValues(token, spreadsheetId, ROSTER_SHEET_TITLE);
  const plan = planSheetWrites(current, writes);
  if (plan.blocked) throw new Error(plan.blocked);

  await batchUpdateValues(
    token,
    spreadsheetId,
    plan.updates.map((u) => ({
      range: toA1Range(ROSTER_SHEET_TITLE, u.rowIndex, u.startCol, u.endCol),
      values: [u.values],
    })),
  );
  await appendSheetValues(token, spreadsheetId, ROSTER_SHEET_TITLE, plan.appends);

  invalidateRosterCache(spreadsheetId);
}

async function deleteCards(spreadsheetId: string, cardIds: string[]): Promise<void> {
  if (!spreadsheetId) throw new Error('沒有選擇名冊，無法刪除。');
  if (cardIds.length === 0) return;

  const token = await getAccessToken();
  const current = await fetchSheetValues(token, spreadsheetId, ROSTER_SHEET_TITLE);
  const { rowIndexes, notFound } = planSheetDeletes(current, cardIds);

  if (rowIndexes.length > 0) {
    const sheetIds = await fetchSheetIdByTitle(token, spreadsheetId);
    const sheetId = sheetIds[ROSTER_SHEET_TITLE];
    if (sheetId === undefined) {
      throw new Error(`這份試算表找不到「${ROSTER_SHEET_TITLE}」分頁，無法刪除資料。`);
    }
    await deleteSheetRows(token, spreadsheetId, sheetId, rowIndexes);
  }

  invalidateRosterCache(spreadsheetId);

  if (notFound.length > 0 && rowIndexes.length === 0) {
    throw new Error(`名冊中找不到要刪除的資料（${notFound.join('、')}），可能已經被其他人刪掉了。`);
  }
}

// ── 積分月報 ────────────────────────────────────────────────────

/** 某個月報欄位在試算表上的欄索引（0 起算） */
function monthlyColumnIndex(key: (typeof MONTHLY_COLUMNS)[number]['key']): number {
  return MONTHLY_COLUMNS.findIndex((c) => c.key === key);
}

function monthlyTextFormatRequest(sheetId: number, key: 'month' | 'analyzedEffectiveDate') {
  const col = monthlyColumnIndex(key);
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
      // 民國格式必須以文字保存，否則「114/03」會被試算表當成日期換算掉
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
}

/**
 * 補上「積分月報」分頁並寫入標題列，回傳它的 sheetId。
 *
 * 既有名冊都是在積分月報存在之前建立的，所以不能假設這張分頁一定在 ——
 * 第一次儲存分析結果時才建。
 */
async function createMonthlySheet(token: string, spreadsheetId: string): Promise<number> {
  const sheetId = await addSheet(token, spreadsheetId, MONTHLY_SHEET_TITLE);
  await updateSheetValues(token, spreadsheetId, MONTHLY_SHEET_TITLE, [[...MONTHLY_HEADER_ROW]]);
  await batchUpdateSpreadsheet(token, spreadsheetId, [
    monthlyTextFormatRequest(sheetId, 'month'),
    monthlyTextFormatRequest(sheetId, 'analyzedEffectiveDate'),
  ]);
  return sheetId;
}

async function getMonthlyReport(spreadsheetId: string): Promise<MonthlyPointRecord[]> {
  if (!spreadsheetId) return [];
  const token = await getAccessToken();

  let values: string[][];
  try {
    values = await fetchSheetValues(token, spreadsheetId, MONTHLY_SHEET_TITLE);
  } catch (err) {
    // 分頁不存在時 Sheets API 只回「Unable to parse range」。
    // 這份名冊從沒存過分析結果 —— 是正常狀態，不該當成錯誤丟給使用者。
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Unable to parse range') || message.includes('400')) {
      monthlyIssueCache.set(spreadsheetId, []);
      return [];
    }
    throw err;
  }

  const { records, issues } = parseMonthlyReport(values);
  monthlyIssueCache.set(spreadsheetId, issues);
  return records;
}

async function saveMonthlyReport(
  spreadsheetId: string,
  records: MonthlyPointRecord[],
  monthRange: { from: string; to: string } | null,
): Promise<void> {
  if (!spreadsheetId) throw new Error('沒有選擇名冊，無法儲存積分月報。');

  const token = await getAccessToken();
  const sheetIds = await fetchSheetIdByTitle(token, spreadsheetId);
  const existingSheetId = sheetIds[MONTHLY_SHEET_TITLE];
  let sheetId: number;
  let current: (string | number)[][];

  if (existingSheetId === undefined) {
    sheetId = await createMonthlySheet(token, spreadsheetId);
    current = [[...MONTHLY_HEADER_ROW]];
  } else {
    sheetId = existingSheetId;
    // 每次都重讀現況再規劃，不依賴載入時的快取：
    // 期間別人可能已經改過內容，照著舊快取算列號會刪到錯的列
    current = await fetchSheetValues(token, spreadsheetId, MONTHLY_SHEET_TITLE);
  }

  const plan = planMonthlyReplace(current, records, monthRange);
  if (plan.blocked) throw new Error(plan.blocked);

  // 刪除與附加合成單一次 batchUpdate：分兩次送，中間失敗會讓某個月
  // 少掉資料或出現兩份而數字加倍
  await replaceSheetRows(token, spreadsheetId, sheetId, plan.deleteRowIndexes, plan.appends);

  monthlyIssueCache.delete(spreadsheetId);
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

  // email 與 role 是 Firestore 時代的帳號概念，試算表模式用不到 ——
  // 誰能存取由 Drive 的分享設定決定，不是由我們發的角色決定
  createOrg: async (_email, orgName) => {
    const name = orgName.trim();
    if (!name) throw new Error('請輸入名冊名稱。');
    const { spreadsheetId } = await createRosterSpreadsheet(name);
    return spreadsheetId;
  },

  getOrgUrl: (spreadsheetId) =>
    spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null,

  updateOrgStatus: async () => {
    throw NOT_YET('變更名冊狀態');
  },
  deleteOrgCascade: async () => {
    throw NOT_YET('刪除名冊');
  },

  getCardsByOrg,
  getCard,
  saveCard: (spreadsheetId, cardId, record) => saveCards(spreadsheetId, [{ cardId, record }]),
  saveCards,
  deleteCard: (spreadsheetId, cardId) => deleteCards(spreadsheetId, [cardId]),
  deleteCards,

  getMonthlyReport,
  saveMonthlyReport,

  // 依決定不留操作紀錄，改以試算表自身的版本紀錄為準
  writeAuditLog: async () => {},
  getAuditLogs: async (): Promise<AuditLog[]> => [],
};

export { clearAccessToken };
