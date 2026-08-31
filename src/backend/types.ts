/**
 * 儲存層介面
 * ---------------------------------------------------------------------------
 * UI 只透過 dbService 的門面呼叫這裡定義的介面，不直接碰任何 Firestore API。
 * 這是「名冊自主託管計畫」的第一步：把實作換成 Google 試算表時，
 * 只要提供另一個 LtcpBackend 實作，App.tsx 幾乎不用改。
 *
 * 目前唯一的實作是 firestoreBackend。
 */

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
  createOrg(email: string, orgName: string, role: UserRole): Promise<void>;
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

  // ── 稽核日誌 ──────────────────────────────────────
  writeAuditLog(action: string, targetOrgId: string, details: string): Promise<void>;
  getAuditLogs(): Promise<AuditLog[]>;
}
