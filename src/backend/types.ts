/**
 * 儲存層介面
 * ---------------------------------------------------------------------------
 * UI 只透過 dbService 的門面呼叫這裡定義的介面，不直接碰任何 Firestore API。
 * 這是「名冊自主託管計畫」的第一步：把實作換成 Google 試算表時，
 * 只要提供另一個 LtcpBackend 實作，App.tsx 幾乎不用改。
 *
 * 目前唯一的實作是 firestoreBackend。
 */

import type { MonthlyPointRecord } from '../monthlyPoints';
import type { TrendTable } from '../monthlyReview';

export type UserRole = 'super_admin' | 'auditor' | 'org_admin' | 'user' | 'admin';

export interface UserSession {
  email: string;
  orgId: string;
  name: string;
  role: UserRole;
  status?: 'active' | 'disabled';
}

/** 一位人員的小卡內容。文件 ID 是「身分證號_職業類別」，不放在這裡。 */
export interface CardRecord {
  effectiveDate: string;
  expiryDate: string;
  name: string;
  role?: string;
  nationality?: string;
}

export interface OrganizationInfo {
  orgId: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'disabled';
  /**
   * 目前登入者能不能修改這份資料。
   * 試算表模式直接取自 Drive 的 capabilities.canEdit —— 是真實權限，
   * 不是我們自己發的角色。Firestore 模式回傳 true，那邊的唯讀是靠
   * 登入者本身的 auditor 角色控制。
   */
  canEdit: boolean;
}

export interface AuditLog {
  id?: string;
  timestamp: string;
  operatorEmail: string;
  action: string;
  targetOrgId: string;
  details: string;
}

/**
 * 這個實作用哪一種登入方式。介面刻意讓兩種方式都存在、由 authMode 決定用哪個，
 * 而不是把 Google 流程硬塞進 login(email, password) 的簽名裡 ——
 * 那樣呼叫端得傳兩個假的空字串，讀起來會不知道發生什麼事。
 */
export type AuthMode = 'password' | 'google';

/**
 * 儲存層目前的狀態，供介面顯示。
 * 由各實作自己回報 —— 否則畫面得自己判斷 Firebase 有沒有初始化成功，
 * 在試算表模式下就會顯示與實際使用的後端無關的訊息。
 */
export interface BackendStatus {
  /** 顯示用的簡短名稱，例如「Google 試算表」 */
  label: string;
  /** 設定是否完整、可以開始操作 */
  ready: boolean;
  /** 未就緒的原因，會直接顯示給使用者 */
  error?: string;
}

export interface LtcpBackend {
  readonly authMode: AuthMode;

  /** 這個實作目前是否可用，以及要在畫面上怎麼稱呼它 */
  status(): BackendStatus;

  // ── 身分 ──────────────────────────────────────────
  /** authMode 為 'password' 時使用 */
  login(email: string, password: string): Promise<UserSession>;
  /** authMode 為 'google' 時使用 */
  loginWithGoogle(): Promise<UserSession>;
  register(email: string, password: string, orgName: string): Promise<UserSession>;
  logout(): Promise<void>;
  getCurrentSession(): UserSession | null;
  sendPasswordReset(email: string): Promise<void>;

  // ── 機構 ──────────────────────────────────────────
  /**
   * 列出所有可被管理的帳號：一般長照機構與唯讀稽查員，排除系統管理者本身。
   *
   * 注意：這裡刻意「不」排除 auditor。稽查員也需要能被檢視、停用與刪除；
   * 舊版在這一層就把 auditor 濾掉，導致建立出來的稽查員帳號在 UI 完全消失。
   * 只有「選擇機構」下拉選單與到期統計才需要排除稽查員（稽查員沒有學員小卡），
   * 那個過濾放在呼叫端做（見 isRealOrganization）。
   */
  listAccounts(): Promise<OrganizationInfo[]>;
  /** 建立後回傳新的 orgId，呼叫端才能立刻切換過去 */
  createOrg(email: string, orgName: string, role: UserRole): Promise<string>;
  /**
   * 這份名冊在使用者端可以直接開啟的網址。
   * Firestore 實作沒有這個概念，回傳 null，介面就不顯示連結。
   */
  getOrgUrl(orgId: string): string | null;
  updateOrgStatus(orgId: string, status: 'active' | 'disabled'): Promise<void>;
  deleteOrgCascade(orgId: string): Promise<void>;

  // ── 人員小卡 ──────────────────────────────────────
  getCardsByOrg(orgId: string): Promise<{ [cardId: string]: CardRecord }>;
  getCard(orgId: string, cardId: string): Promise<CardRecord | null>;
  saveCard(orgId: string, cardId: string, record: CardRecord): Promise<void>;
  deleteCard(orgId: string, cardId: string): Promise<void>;

  /**
   * 批次版本。存在的理由是 Sheets API：逐筆呼叫等於逐筆 HTTP 往返，
   * 四十幾人就足以撞到每分鐘配額。Firestore 實作內部仍是迴圈，
   * 但呼叫端一律用批次介面，換實作時才不必再改 UI。
   */
  saveCards(orgId: string, writes: { cardId: string; record: CardRecord }[]): Promise<void>;
  deleteCards(orgId: string, cardIds: string[]): Promise<void>;

  // ── 積分月報 ──────────────────────────────────────
  /**
   * 讀出這份名冊已存的月份積分。
   * 分頁不存在時回傳空陣列 —— 「還沒存過分析結果」是正常狀態，不是錯誤。
   */
  getMonthlyReport(orgId: string): Promise<MonthlyPointRecord[]>;

  /**
   * 取代式寫入：只覆蓋 `monthRange` 涵蓋的曆月 × `records` 涉及的人員。
   *
   * `throughMonth` 是這次匯出檔的匯出月（民國 `115/06`），取代到它為止。
   * 衛福部每次匯出都是生平全紀錄，所以用「到某月為止」而不是區間 ——
   * 被撤銷的課才清得掉。空字串代表判斷不出匯出月，此時只清「無法歸月」的列。
   */
  saveMonthlyReport(
    orgId: string,
    records: MonthlyPointRecord[],
    throughMonth: string,
    /** 這次上傳涵蓋的所有人員，不是產出了紀錄的人員（見 planMonthlyReplace） */
    touchedCardIds: string[],
  ): Promise<void>;

  /**
   * 寫入「積分總表」：一人一列的快照，欄位與下載的分析報表相同。
   *
   * 這張表是**衍生的**，每次整張重寫，沒有部分取代的語意 ——
   * 內容一律由積分月報重算而來，所以不可能與月報不一致。
   */
  saveSummaryReport(orgId: string, rows: Record<string, string | number>[]): Promise<void>;

  /**
   * 寫入「累計走勢」：每人一格的原生 SPARKLINE 迷你圖，加一張全機構平均折線圖。
   *
   * 目的是讓使用者**開試算表就看到圖**，不必開網頁。與積分總表一樣是衍生的，
   * 每次整張重寫。
   */
  saveTrendReport(orgId: string, table: TrendTable): Promise<void>;

  // ── 稽核日誌 ──────────────────────────────────────
  writeAuditLog(action: string, targetOrgId: string, details: string): Promise<void>;
  getAuditLogs(): Promise<AuditLog[]>;
}
