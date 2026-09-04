import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  loginUser, 
  registerUser, 
  logoutUser, 
  getCurrentSession, 
  saveStudentCard, 
  sendPasswordReset,
  getAllAccounts,
  isRealOrganization,
  getStudentCardsByOrg,
  getAuditLogs,
  updateOrgStatus,
  deleteOrganizationCascade,
  deleteStudentCard,
  saveStudentCards,
  deleteStudentCards,
  adminCreateOrg,
  writeAuditLog,
  loginWithGoogle,
  getAuthMode,
  getBackendStatus,
  getOrgUrl,
  getListDiagnostics,
  getListDiagnosis,
  getUnrecognisedSpreadsheets,
  claimRosterFile,
  pickRoster,
  getMonthlyReport,
  saveMonthlyReport,
  saveSummaryReport,
  saveTrendReport,
  getMonthlyIssues,
  type UserSession,
  type CardRecord,
  type RosterListDiagnosis,
  type UnrecognisedSpreadsheet,
} from './dbService';
import { 
  calculatePoints, 
  buildCsvRow, 
  parseExcelToPointsData, 
  extractCourseDate,
  findExportDate, 
  calculateExpiryDate, 
  rocStrToDate,
  dateToRocStr,
  normalizeDateToRocStr,
  type Course
} from './calculator';
import { StudentTable, BatchEditBar } from './StudentTable';
import { SiteFooter, LegalModal, type LegalDocKey } from './SiteFooter';
import { MOHW_LTCPAP_URL, MANUAL_URL } from './externalLinks';
import {
  ReviewSummaryBar,
  ReviewPersonList,
  ReviewPersonDetail,
  ReviewEmptyState,
} from './MonthlyReviewPanel';
import { buildMonthlyReview, buildSummaryRow, buildTrendTable, type RiskLevel } from './monthlyReview';
import {
  attributePointsToMonths,
  uploadThroughMonth,
  replaceMonthlyRecords,
  type MonthlyPointRecord,
} from './monthlyPoints';
import {
  ROLE_OPTIONS,
  NATIONALITY_OPTIONS,
  normalizeRole,
  type EditableField,
  type StudentRow,
} from './studentFields';
import {
  applyFieldChange,
  applyDateChange,
  buildSavePlan,
  buildDeletePlan,
  composeCardId,
  splitCardId,
  describeDeletePlan,
  needsTypedConfirm,
  describeTypedConfirm,
  isTypedConfirmValid,
} from './cardPlan';
import { parseRosterImport, buildRosterTemplate } from './rosterImport';


/**
 * 後端用哪一種登入方式，由 VITE_BACKEND 決定，執行期間不會變。
 * 注意不要跟元件內的 authMode 狀態（login/register/forgot）搞混。
 */
const BACKEND_AUTH_MODE = getAuthMode();

/**
 * 這一位能不能做積分分析。兩個條件都要成立：
 *
 * 1. **有課程明細** —— 積分是從衛福部 Excel 的課程列算出來的，名冊本身不含。
 * 2. **有小卡起訖日** —— 沒有效期就切不出證書年度，算出來的每一列都會是
 *    「效期外」。那種資料看起來像真的卻是錯的，使用者要等到樞紐分析不出來
 *    才會發現，所以寧可不算也不要寫進去。
 */
function canAnalyseStudent(s: StudentRow): boolean {
  return s.rows.length > 0
    && rocStrToDate(s.effectiveDate) !== null
    && rocStrToDate(s.expiryDate) !== null;
}

/** 等待名冊建立完成後才能繼續的匯入內容 */
/**
 * 全畫面忙碌遮罩。
 *
 * 儲存到雲端會連打好幾支 Google API（人員、積分月報、總表、累計走勢、重讀），
 * 期間畫面完全沒有變化 —— 使用者唯一的線索是右側日誌在動，而那要他先知道
 * 去看那裡。遮罩同時擋掉操作：這段期間再按一次儲存會送出第二批寫入。
 */
interface BusyState {
  text: string;
  /** 第二行說明。寫入雲端與本機運算該講的話不一樣，所以由呼叫端給 */
  hint: string;
}

function BusyOverlay({ busy }: { busy: BusyState }) {
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-card">
        <div className="busy-spinner" />
        <div className="busy-text">{busy.text}</div>
        <div className="busy-hint">{busy.hint}</div>
      </div>
    </div>
  );
}

const BUSY_HINT_CLOUD = '正在寫入雲端，請不要關閉或重新整理頁面。詳細進度可看右側的執行日誌。';
const BUSY_HINT_LOCAL = '這一步在本機計算，不會動到雲端資料。人數多時需要幾秒。';

/**
 * 名冊的動作列（手動新增／儲存到雲端）。
 *
 * 表格上下各放一份：只改了前兩列就得捲到最底下才存得到，是把使用者退回去
 * 找按鈕，而名冊有四十幾列時那段距離不短。抽成元件而不是把 JSX 複製兩份 ——
 * 複製的那份遲早會漏掉某次修改（例如少了 disabled 條件而讓空表格也能按存）。
 */
function RosterActionBar({ onAdd, onSave, saveDisabled, dirty }: {
  onAdd: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  dirty: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center' }}>
      <button className="btn btn-primary" onClick={onAdd} type="button">
        ➕ 手動新增學員
      </button>
      <button
        className="btn btn-accent"
        onClick={onSave}
        disabled={saveDisabled}
        type="button"
        title={dirty ? '表格上有尚未寫回雲端的變更' : undefined}
      >
        <Icons.Save /> 儲存人員資料到雲端{dirty ? ' ●' : ''}
      </button>
    </div>
  );
}

interface PendingImport {
  /** 衛福部 Excel 的資料列，鍵是中文標題 */
  rows: Record<string, unknown>[];
  nameCol: string;
  idCol: string;
  roleCol: string;
  // 刻意沒有 nationalityCol：國籍一律以名冊為準，積分 Excel 的國籍欄不採用
  courseDateCol: string;
  /** 檔案表頭的匯出日期（民國字串）；讀不到時為空字串 */
  exportDate: string;
}

/**
 * 匯入名冊時發現還沒有名冊可寫，暫存已經解析好的人員，等名冊建好接續。
 * 存解析後的結果而不是原始檔案 —— 解析是純本機運算，先做完才知道值不值得建名冊。
 */
interface PendingRosterImport {
  fileName: string;
  entries: [string, CardRecord][];
  /** 解析時的問題數，只用來在匯入完成的提示裡指向執行日誌 */
  issueCount: number;
}

interface LogLine {
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
  time: string;
}

const Icons = {
  Sun: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
  ),
  Moon: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  ),
  Building: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/></svg>
  ),
  FolderOpen: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>
  ),
  UploadCloud: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9M9 15l3-3 3 3"/></svg>
  ),
  Save: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
  ),
  Play: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><polygon points="6 3 20 12 6 21 6 3"/></svg>
  ),
  Download: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
  ),
  Terminal: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
  ),
  Crown: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M2 4 5 12h14l3-8-7 4-3-6-3 6-7-4z"/><path d="M5 20h14a2 2 0 0 0 2-2v-2H3v2a2 2 0 0 0 2 2z"/></svg>
  ),
  ShieldCheck: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
  ),
  Lock: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  ),
  Mail: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
  ),
  User: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  ),
  LogOut: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
  ),
  Settings: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  )
};

export default function App() {
  // Theme State
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('ltcp_theme');
    return (saved as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ltcp_theme', theme);
  }, [theme]);

  // Authentication State
  const [userSession, setUserSession] = useState<UserSession | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  
  // App States
  const [backendStatus] = useState(getBackendStatus());
  
  // Admin State
  // canEdit 一併帶著：試算表模式下唯讀與否來自 Drive 的實際權限，只留 orgId/name 會丟掉這個資訊
  const [organizations, setOrganizations] = useState<{ orgId: string; name: string; canEdit: boolean }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  
  // NEW: Admin Panel & Bento Grid States
  const [adminTab, setAdminTab] = useState<'dashboard' | 'institutions' | 'staff' | 'logs'>('dashboard');
  const [organizationsInfo, setOrganizationsInfo] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState({
    totalOrgs: 0,
    totalCards: 0,
    expiredCount: 0,
    expiring30: 0,
    expiring60: 0,
    expiring90: 0,
    validCount: 0,
    expiringList: [] as any[]
  });

  // NEW: Modals and Inputs
  const [showAddOrgModal, setShowAddOrgModal] = useState(false);
  const [newOrgEmail, setNewOrgEmail] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgRole, setNewOrgRole] = useState<'user' | 'auditor'>('user');

  const [showCreateRosterModal, setShowCreateRosterModal] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [pendingRosterImport, setPendingRosterImport] = useState<PendingRosterImport | null>(null);

  // 檔案在雲端硬碟卻列不出來時的自救資訊。**不放在開關後面** ——
  // 有東西要講的時候就自己出現，沒有的時候整塊不存在，使用者不必先想到要去按它。
  const [rosterDiagnosis, setRosterDiagnosis] = useState<RosterListDiagnosis | null>(null);
  const [unrecognisedRosters, setUnrecognisedRosters] = useState<UnrecognisedSpreadsheet[]>([]);
  const [newRosterName, setNewRosterName] = useState('');

  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentNationality, setNewStudentNationality] = useState('臺灣');
  const [newStudentRole, setNewStudentRole] = useState('照顧服務人員');
  const [newStudentEffDate, setNewStudentEffDate] = useState('');

  // NEW: Smart Excel Column Mapper States
  const [showMapperModal, setShowMapperModal] = useState(false);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [pendingExcelRows, setPendingExcelRows] = useState<any[]>([]);
  const [columnMapping, setColumnMapping] = useState({
    name: '',
    id: '',
    role: '',
    nationality: '',
    date: ''
  });

  // Data States
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  /** 有值時顯示全畫面遮罩。存文字而不是布林，才能讓每個操作說自己在做什麼 */
  const [busy, setBusy] = useState<BusyState | null>(null);
  /** 目前開著的法務條文視窗 */
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);
  const [lastReport, setLastReport] = useState<any[] | null>(null);

  /** 主畫面分頁。名冊維護與每月審視是兩件事，擠在同一個版面誰都看不清楚 */
  const [mainTab, setMainTab] = useState<'roster' | 'review'>('roster');

  // 積分審視的左欄選取與徽章篩選。
  // 兩者都不用 useEffect 同步 —— 篩掉目前選取的人時直接退回篩選後的第一位，
  // 由下面的衍生值決定，狀態就不會有「指向已經不在清單裡的人」這種中間態。
  const [reviewFilter, setReviewFilter] = useState<RiskLevel | null>(null);
  const [reviewCardId, setReviewCardId] = useState<string | null>(null);
  /** 積分月報上已經存進雲端的內容 */
  const [cloudMonthly, setCloudMonthly] = useState<MonthlyPointRecord[]>([]);
  /**
   * 本次分析算出、**尚未儲存**的月報。
   * 帶著取代範圍與取代對象一起存，因為儲存時與畫面預覽時要套用同一套規則。
   */
  const [pendingMonthly, setPendingMonthly] = useState<{
    records: MonthlyPointRecord[];
    /** 取代到這個曆月（含）為止，取自檔案表頭的匯出日期 */
    throughMonth: string;
    touchedCardIds: string[];
  } | null>(null);
  /**
   * 最近一次上傳的 Excel 表頭上的匯出日期。
   *
   * 存在這裡而不是跟著 students 走，是因為它是**整份檔案**的屬性而不是某個人的。
   * 統計分析時要靠它決定積分月報要取代到哪個月為止。
   */
  const [importExportDate, setImportExportDate] = useState('');
  // 表格中是否有尚未寫入雲端的變更（Excel 匯入結果、手動改過的生效日／到期日）
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);

  // Initialize Session on Load
  useEffect(() => {
    const session = getCurrentSession();
    if (session) {
      setUserSession(session);
    }
  }, []);

  // 有未儲存的變更時，攔下重新整理／關閉頁籤。
  // 只在 dirty 時掛上監聽器，避免平常也讓瀏覽器顯示離開確認。
  // 註：現代瀏覽器只會顯示自己的通用文字，無法自訂訊息內容。
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // 舊版瀏覽器仍需設定此值才會跳出確認
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Fetch courses on mount
  useEffect(() => {
    const fetchCourses = async () => {
      addLog("🌐 正在從 Google Sheet 抓取最新課程清單...");
      try {
        const url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQrhEmVBEEIZu172SGx2ZdQjxzP9IMXAlGGdPLCY2_-NjXFoHKX5d28pI6b8zZ6xzXslwDtokoPxuX2/pub?gid=214077526&single=true&output=csv";
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP 錯誤! 狀態碼: ${response.status}`);
        }
        const csvText = await response.text();
        
        // Parse CSV using XLSX
        const workbook = XLSX.read(csvText, { type: 'string' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet) as any[];
        
        const parsedCourses: Course[] = rawRows.map((row: any) => {
          const url = String(row['連結'] || '').trim();
          const name = String(row['課程名稱'] || '').trim();
          const type = String(row['課程類型'] || '').trim();
          const pts = parseFloat(row['課程積分']);
          const tagsStr = String(row['積分標籤'] || '');
          const tags = tagsStr ? tagsStr.split(/[、,]/).map(t => t.trim()) : [];
          const date = String(row['上課期間'] || '').trim();
          
          return {
            url,
            name,
            type,
            points: isNaN(pts) ? 0 : pts,
            tags,
            date
          };
        }).filter(c => c.name && c.url);
        
        setCourses(parsedCourses);
        addLog(`✓ 成功加載 ${parsedCourses.length} 門最新推薦課程`, 'success');
      } catch (err: any) {
        console.error("Fetch courses error", err);
        addLog(`⚠️ 無法加載課程清單: ${err.message}，將無法提供推薦課程。`, 'warning');
      }
    };
    
    fetchCourses();
  }, []);

  // NEW: Admin Dashboard Stats Calculation
  const fetchAdminStats = async (orgs: any[]) => {
    try {
      let totalCards = 0;
      let expiredCount = 0;
      let expiring30 = 0;
      let expiring60 = 0;
      let expiring90 = 0;
      let validCount = 0;
      const expiringList: any[] = [];
      const now = new Date();

      for (const org of orgs) {
        const cards = await getStudentCardsByOrg(org.orgId);
        Object.entries(cards).forEach(([id, card]) => {
          totalCards++;
          const expDate = rocStrToDate(card.expiryDate);
          if (expDate) {
            const diffTime = expDate.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            const cardWithOrg = {
              studentId: id,
              name: card.name,
              expiryDate: card.expiryDate,
              orgName: org.name,
              orgId: org.orgId,
              daysLeft: diffDays
            };

            if (diffDays < 0) {
              expiredCount++;
              expiringList.push(cardWithOrg);
            } else if (diffDays <= 30) {
              expiring30++;
              expiringList.push(cardWithOrg);
            } else if (diffDays <= 60) {
              expiring60++;
              expiringList.push(cardWithOrg);
            } else if (diffDays <= 90) {
              expiring90++;
              expiringList.push(cardWithOrg);
            } else {
              validCount++;
            }
          } else {
            validCount++;
          }
        });
      }

      expiringList.sort((a, b) => a.daysLeft - b.daysLeft);

      setStats({
        totalOrgs: orgs.length,
        totalCards,
        expiredCount,
        expiring30,
        expiring60,
        expiring90,
        validCount,
        expiringList
      });
    } catch (e) {
      console.error("Fetch admin stats error", e);
    }
  };

  /**
   * 載入使用者有權限的名冊試算表。
   * 這是試算表模式下「機構清單」的來源；Firestore 模式走 loadAdminData()，
   * 而那個只對管理者與稽查員執行，一般機構帳號不會經過這裡。
   */
  const loadRosterList = async (
    /**
     * 讀完清單後要切到哪一份名冊。
     * 建立／指認／Picker 那幾條路徑剛拿到新的 ID，讓它們傳進來，
     * 就不必在每個呼叫點各自重複一遍「切換要連帶做的四件事」。
     */
    preferOrgId?: string,
  ) => {
    try {
      addLog('🔍 正在讀取你的 Google 雲端硬碟中的名冊…');
      const rosters = await getAllAccounts();
      setOrganizations(rosters.map(r => ({ orgId: r.orgId, name: r.name, canEdit: r.canEdit })));
      setUnrecognisedRosters(getUnrecognisedSpreadsheets());

      // 把查詢過程攤出來。找不到名冊的原因可能是授權、標記或 API 錯誤，
      // 只說「找不到」等於把問題藏起來。
      for (const line of getListDiagnostics()) {
        addLog(`   ${line}`, line.includes('讀不到') ? 'warning' : 'info');
      }

      // 光給數字（「帶標記 0、選過 0」）等於要使用者自己知道 drive.file 的三層規則。
      // diagnoseRosterList 把同一組數字翻成「最可能的原因」與「下一步」。
      const diagnosis = getListDiagnosis();
      setRosterDiagnosis(diagnosis);
      if (diagnosis) {
        addLog(`   ${diagnosis.summary}`);
        if (diagnosis.cause) addLog(`   ${diagnosis.cause}`, diagnosis.level);
        if (diagnosis.action) addLog(`   → ${diagnosis.action}`, diagnosis.level);
      }

      if (rosters.length === 0) {
        addLog('⚠️ 找不到任何名冊。可以按「＋ 建立名冊」建一份，或用「機構名冊沒出現？」把既有的檔案選回來。', 'warning');
        return;
      }
      addLog(`✓ 找到 ${rosters.length} 份名冊`, 'success');

      // 目前選的那份還在清單裡就不動它，避免重新整理清單把使用者踢回第一份
      const target = preferOrgId
        || (!selectedOrgId || !rosters.some(r => r.orgId === selectedOrgId) ? rosters[0].orgId : '');
      if (target) await switchToRoster(target);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`❌ 讀取名冊清單失敗: ${message}`, 'error');
      alert(`讀取名冊清單失敗：${message}`);
    }
  };

  const loadAdminData = async () => {
    try {
      // 帳號列表含稽查員，讓它們可以被檢視／停用／刪除；
      // 機構下拉選單與到期統計只算真實機構（稽查員沒有學員小卡）。
      const accounts = await getAllAccounts();
      const orgs = accounts.filter(isRealOrganization);

      setOrganizationsInfo(accounts);
      setOrganizations(orgs.map(o => ({ orgId: o.orgId, name: o.name, canEdit: o.canEdit })));

      if (orgs.length > 0 && !selectedOrgId) {
        setSelectedOrgId(orgs[0].orgId);
      }

      await fetchAdminStats(orgs);
      
      if (userSession?.role !== 'auditor') {
        const logs = await getAuditLogs();
        setAuditLogs(logs);
      }
    } catch (err: any) {
      console.error("Failed to load admin data", err);
    }
  };

  // 登入後載入清單：試算表模式讀 Drive 上的名冊，Firestore 模式讀管理面板資料
  useEffect(() => {
    if (!userSession) return;
    if (BACKEND_AUTH_MODE === 'google') {
      loadRosterList();
      return;
    }
    const isAuthorized = userSession.role === 'admin' || userSession.role === 'super_admin' || userSession.role === 'auditor';
    if (isAuthorized) {
      loadAdminData();
    }
  }, [userSession, adminTab]);

  /**
   * 會丟掉表格上未儲存變更的操作，一律先問過。
   * 回傳 false 代表使用者選擇取消，**呼叫端必須整個中止**。
   *
   * 集中成一個函式而不是各處自己寫 window.confirm：會丟掉表格的路徑有八條，
   * 散著寫必定漏掉幾條，而漏掉的症狀是使用者改了一整批資料、按個按鈕就沒了。
   *
   * 沒有變更時直接放行，所以呼叫端可以無條件呼叫，不必自己先判斷。
   */
  const confirmDiscardChanges = (whatHappens: string): boolean => {
    if (!hasUnsavedChanges || students.length === 0) return true;
    return window.confirm(
      `表格上有尚未儲存至雲端的變更。\n${whatHappens}，且無法復原。\n\n確定要繼續嗎？`,
    );
  };

  /**
   * 收掉忙碌遮罩，並等瀏覽器真的把畫面重繪完再往下走。
   *
   * 為什麼要等：alert() 是同步阻塞的，緊接在 setBusy(null) 之後呼叫時 React
   * 還來不及重繪，使用者會看到彈窗後面仍然糊著一片。
   * 要兩層 requestAnimationFrame —— 第一層在繪製**前**觸發，第二層才是繪製之後。
   */
  const clearBusyAndPaint = async () => {
    setBusy(null);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  };

  const addLog = (text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', clearFirst = false) => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    const newLine: LogLine = { text, type, time: timeStr };
    if (clearFirst) {
      setLogs([newLine]);
    } else {
      setLogs(prev => [...prev, newLine]);
    }
    
    // Auto scroll console
    setTimeout(() => {
      const consoleElem = document.getElementById('terminal-console');
      if (consoleElem) {
        consoleElem.scrollTop = consoleElem.scrollHeight;
      }
    }, 50);
  };

  // Auth Handlers
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (authMode === 'login') {
        const session = await loginUser(email, password);
        setUserSession(session);
        addLog(`🔓 成功登入：${session.name} [${session.role === 'admin' ? '超級管理員' : '一般用戶'}]`, 'success', true);
      } else {
        if (!orgName) {
          alert('請輸入單位機構名稱');
          return;
        }
        const session = await registerUser(email, password, orgName);
        setUserSession(session);
        addLog(`🆕 成功註冊並登入：${session.name}`, 'success', true);
      }
    } catch (err: any) {
      alert(err.message);
      addLog(`❌ 認證失敗: ${err.message}`, 'error');
    }
  };

  /** 試算表模式的登入：只取得 Google 授權，名冊清單登入後才載入 */
  const handleGoogleLogin = async () => {
    setIsProcessing(true);
    try {
      const session = await loginWithGoogle();
      setUserSession(session);
      addLog(`🔓 已以 Google 帳號登入：${session.name}（${session.email}）`, 'success', true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(message);
      addLog(`❌ Google 登入失敗: ${message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };


  /**
   * 開啟 Google 檔案選擇器，讓使用者選一份本程式沒建過的試算表。
   *
   * drive.file 範圍下，沒有經過這一步的檔案本程式讀不到，即使在雲端硬碟看得見。
   * 別人分享的名冊、以及換裝置後失去本機記錄的名冊，都只能靠它回來 ——
   * 所以按鈕雖然從工具列撤掉了，這條路必須在救援面板裡留著。
   */
  const handlePickRoster = async () => {
    if (!confirmDiscardChanges('選取另一份名冊會直接丟棄這些變更')) return;
    setIsProcessing(true);
    try {
      const picked = await pickRoster();
      if (!picked) {
        addLog('已取消選擇名冊。');
        return;
      }
      addLog(`✓ 已授權存取「${picked.name}」`, 'success');
      await loadRosterList(picked.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`❌ 開啟名冊失敗: ${message}`, 'error');
      alert(`開啟名冊失敗：${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 指認一份「讀得到但未被認出」的試算表是名冊。
   * 後端會先驗結構再補標記，所以指認錯的檔案會被擋下來而不是留下壞掉的名冊。
   */
  const handleClaimRoster = async (fileId: string, fileName: string) => {
    if (!confirmDiscardChanges('指認後會切換過去，這些變更會直接丟棄')) return;
    setIsProcessing(true);
    try {
      const info = await claimRosterFile(fileId);
      addLog(
        `✓ 已指認「${info.name || fileName}」為名冊`
        + (info.canEdit ? '，並補上名冊標記，之後會固定出現在清單裡。' : '（沒有編輯權，只能記在這台裝置）。'),
        'success',
      );
      await loadRosterList(fileId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`❌ 指認失敗: ${message}`, 'error');
      alert(`這份試算表不能當作名冊：\n\n${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  /** 建立一份新的空白名冊試算表，建好後直接切換過去 */
  const handleCreateRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newRosterName.trim();
    if (!name) {
      alert('請輸入名冊名稱。');
      return;
    }
    // 問在建檔之前：建完才問，使用者取消的話雲端硬碟已經多出一份空名冊
    if (!confirmDiscardChanges('建好後會切換到新名冊，目前的變更會直接丟棄')) return;
    setIsProcessing(true);
    setBusy({ text: '名冊建立中，請稍待片刻…', hint: BUSY_HINT_CLOUD });
    try {
      // email 與 role 在試算表模式用不到，存取權限由 Drive 的分享設定決定
      const newOrgId = await adminCreateOrg('', name, 'user');
      addLog(`✓ 已在你的 Google 雲端硬碟建立名冊「${name}」`, 'success');
      setShowCreateRosterModal(false);
      // 走 switchToRoster 才會一併清掉上一份名冊的月報 ——
      // 原本沒清，新建的名冊會顯示前一份的積分
      await loadRosterList(newOrgId);

      // 若是匯入流程中途要求建立的，建好就接續匯入。
      // 兩種暫存都讀不到 state 剛設的 selectedOrgId（要等下一次 render 才生效），
      // 所以把 newOrgId 直接傳下去。

      // 人員名冊排在積分 Excel 之前：processExcelRows 會拿名冊回填小卡起訖日，
      // 順序顛倒的話這批人在自己被建立之前就先被判成「名冊上沒有」而被略過。
      if (pendingRosterImport) {
        const pending = pendingRosterImport;
        setPendingRosterImport(null);
        addLog(`↩ 接續匯入 ${pending.entries.length} 位人員（${pending.fileName}）…`);
        await writeRosterCards(newOrgId, pending.entries, pending.issueCount);
      }

      if (pendingImport) {
        const pending = pendingImport;
        setPendingImport(null);
        addLog(`↩ 接續匯入 ${pending.rows.length} 筆課程明細…`);
        await processExcelRows(
          pending.rows, pending.nameCol, pending.idCol,
          pending.roleCol, pending.courseDateCol,
          newOrgId,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`❌ 建立名冊失敗: ${message}`, 'error');
      await clearBusyAndPaint();
      alert(`建立名冊失敗：${message}`);
    } finally {
      setBusy(null);
      setIsProcessing(false);
    }
  };

  /** 下載空白的名冊匯入範本（標題列＋說明列） */
  const handleDownloadRosterTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(buildRosterTemplate());
    XLSX.utils.book_append_sheet(wb, ws, '人員名冊');
    const filename = '長照人員名冊匯入範本.xlsx';
    XLSX.writeFile(wb, filename);
    addLog(`⬇ 已下載：${filename}。填好之後用「匯入名冊」上傳。`, 'success');
  };

  /**
   * 把解析好的人員寫進名冊試算表。
   * 「已經有名冊」與「匯入途中才剛建好名冊」兩條路徑共用，
   * 抽出來是為了不留兩份會各自漂移的寫入邏輯。
   */
  const writeRosterCards = async (
    orgId: string,
    entries: [string, CardRecord][],
    issueCount: number,
  ) => {
    await saveStudentCards(orgId, entries.map(([cardId, record]) => ({ cardId, record })));
    addLog(`🎉 已匯入 ${entries.length} 位人員至名冊。`, 'success');
    await handleLoadOrgCards(orgId);
    await clearBusyAndPaint();
    alert(
      `已匯入 ${entries.length} 位人員。`
      + (issueCount > 0 ? `\n\n有 ${issueCount} 個問題請看執行日誌。` : '')
    );
  };

  /**
   * 匯入名冊：把整批人員寫進名冊試算表。
   *
   * 這是人員名單的唯一批次建立途徑 —— 積分 Excel 不含小卡起訖日，
   * 靠它建人只會產生一批算不出證書年度的人員。
   *
   * 還沒有名冊時**不**把使用者退回去按「建立名冊」：先把檔案解析完
   * （純本機運算，失敗也不會白建一份空名冊），確定真的有人員可匯入，
   * 才跳出命名視窗，建好之後接續匯入。多一顆要按的按鈕不會讓流程更清楚。
   */
  const handleRosterImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';   // 同一個檔案要能重選
    // 匯入完會重新載入整張表，表格上改到一半的東西會被蓋掉
    if (!confirmDiscardChanges('匯入後會重新載入名冊，這些變更會被蓋掉')) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      setIsProcessing(true);
      setBusy({ text: '名冊匯入中，請稍待片刻…', hint: BUSY_HINT_CLOUD });
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const values = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });

        addLog(`🔍 讀取名冊匯入檔，共 ${Math.max(0, values.length - 1)} 列…`);
        const { cards, issues } = parseRosterImport(values);

        for (const issue of issues) {
          addLog(`   ${issue.kind === 'unknownRole' ? 'ℹ️' : '⚠️'} ${issue.message}`,
            issue.kind === 'unknownRole' ? 'info' : 'warning');
        }

        const entries: [string, CardRecord][] = Object.entries(cards);
        if (entries.length === 0) {
          addLog('❌ 沒有任何可匯入的人員。', 'error');
          alert(
            '沒有任何可匯入的人員。\n\n'
            + (issues.length > 0
              ? '請看執行日誌裡列出的問題。最常見的是小卡起訖日空白 —— 那是必填。'
              : '請確認檔案的第一列是欄位標題，且至少有身分證號、姓名、職業類別三欄。')
          );
          return;
        }

        // 沒有名冊可寫時直接接手命名流程，不把使用者踢回去按另一顆按鈕。
        // 解析已經過了，所以跳到這裡代表「檔案沒問題，只差一份名冊」。
        const orgId = resolveWorkingOrgId();
        if (!orgId) {
          setPendingRosterImport({ fileName: file.name, entries, issueCount: issues.length });
          setNewRosterName('');
          setShowCreateRosterModal(true);
          addLog(
            `ℹ️ 檔案解析完成，但還沒有名冊可以寫入。請為名冊命名 —— `
            + `建好之後會自動匯入這 ${entries.length} 位人員。`,
          );
          return;
        }

        await writeRosterCards(orgId, entries, issues.length);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addLog(`❌ 匯入名冊失敗: ${message}`, 'error');
        await clearBusyAndPaint();
        alert(`匯入名冊失敗：${message}`);
      } finally {
        setBusy(null);
        setIsProcessing(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await sendPasswordReset(email);
      alert("重設密碼信件已寄出，請至信箱收取！");
      addLog(`✉️ 已寄出密碼重設信件至: ${email}`, 'success');
      setAuthMode('login');
    } catch (err: any) {
      alert("發送重設信件失敗: " + err.message);
      addLog(`❌ 重設密碼失敗: ${err.message}`, 'error');
    }
  };

  const handleLogout = async () => {
    if (!confirmDiscardChanges('登出會丟棄這些變更')) return;
    await logoutUser();
    setUserSession(null);
    setStudents([]);
    setHasUnsavedChanges(false);
    setLastReport(null);
    setOrganizations([]);
    setSelectedOrgId('');
    setLogs([]);
  };

  // NEW: Create Org Handler
  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgEmail || !newOrgName) {
      alert("請填寫所有欄位！");
      return;
    }
    try {
      await adminCreateOrg(newOrgEmail, newOrgName, newOrgRole);
      alert(`成功建立機構：${newOrgName} (權限: ${newOrgRole})`);
      setShowAddOrgModal(false);
      setNewOrgEmail('');
      setNewOrgName('');
      loadAdminData();
    } catch (err: any) {
      alert("建立機構失敗: " + err.message);
    }
  };

  // NEW: Toggle Status Handler
  const handleToggleOrgStatus = async (orgId: string, currentStatus: string) => {
    try {
      const nextStatus = currentStatus === 'active' ? 'disabled' : 'active';
      await updateOrgStatus(orgId, nextStatus);
      loadAdminData();
    } catch (err: any) {
      alert("更新狀態失敗: " + err.message);
    }
  };

  // NEW: Delete Org Cascade Handler
  const handleDeleteOrgCascade = async (orgId: string, orgName: string) => {
    if (!window.confirm(`確定要徹底刪除機構「${orgName}」嗎？\n此動作將連帶刪除該機構旗下所有學員小卡資料，且無法復原！`)) {
      return;
    }
    try {
      await deleteOrganizationCascade(orgId);
      alert("機構及旗下人員小卡已徹底刪除。");
      loadAdminData();
    } catch (err: any) {
      alert("刪除機構失敗: " + err.message);
    }
  };

  /**
   * 目前要操作哪個機構：管理者／稽查員用下拉選的機構，機構帳號一律是自己的 orgId。
   * 舊寫法在取不到時會退回 'org_default'，那會把資料寫進一個共用機構；
   * 這裡回傳空字串，由呼叫端擋下來。
   */
  const resolveWorkingOrgId = (): string => {
    // 試算表模式沒有「所屬機構」，操作對象就是使用者選的那份名冊
    if (BACKEND_AUTH_MODE === 'google') return selectedOrgId;
    const role = userSession?.role;
    if (role === 'admin' || role === 'super_admin' || role === 'auditor') return selectedOrgId;
    return userSession?.orgId || '';
  };

  // NEW: Manual Add Student Card Handler
  const handleManualAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const orgId = resolveWorkingOrgId();
    
    if (!orgId) {
      alert("請先選擇機構！");
      return;
    }
    if (!newStudentId || !newStudentName || !newStudentEffDate) {
      alert("請填寫必要欄位！");
      return;
    }
    // 接受 1140831、114/8/31、2025-08-31 等寫法，統一成 114/08/31 才寫入。
    // 少了這一步，無法解析的日期會讓到期日算成空白（試算表上就是一格空的）。
    const effDate = normalizeDateToRocStr(newStudentEffDate);
    const expDate = calculateExpiryDate(effDate);
    if (!expDate) {
      alert(`小卡生效日期「${newStudentEffDate}」無法解析。請用民國年格式，例如 114/08/31。`);
      return;
    }

    try {
      const compositeId = newStudentId + "_" + newStudentRole;
      await saveStudentCard(orgId, compositeId, {
        name: newStudentName,
        effectiveDate: effDate,
        expiryDate: expDate,
        role: newStudentRole,
        nationality: newStudentNationality
      });
      alert(`學員「${newStudentName}」小卡已新增/更新！`);
      setShowAddStudentModal(false);
      setNewStudentId('');
      setNewStudentName('');
      setNewStudentEffDate('');
      
      // 只把這一筆併進表格，不重新載入整份清單。
      // 舊版會從雲端重抓後整批覆蓋 students，導致表格裡其他「尚未儲存」的
      // 生效日／到期日修改被靜默丟棄。
      // 這筆本身已經寫入雲端，所以 hasUnsavedChanges 保持原狀：
      // 原本乾淨就還是乾淨，原本有未儲存的編輯就仍然是未儲存。
      setStudents(prev => {
        const idx = prev.findIndex(row => row.id === compositeId);

        if (idx === -1) {
          const added: StudentRow = {
            selected: true,
            id: compositeId,
            originalId: compositeId,   // 上面已經寫進雲端了
            studentId: newStudentId,
            name: newStudentName,
            nationality: newStudentNationality,
            role: newStudentRole,
            earliestDate: effDate,
            effectiveDate: effDate,
            expiryDate: expDate,
            rows: []
          };
          return [...prev, added];
        }

        // 同一位人員（同身分證＋同職類）已在表格中：只覆寫這次填寫的欄位，
        // 保留 Excel 匯入帶進來的課程明細 rows、最早課程日期與勾選狀態，
        // 否則該員會無法再進行積分統計。
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          originalId: compositeId,   // 剛剛已寫進雲端
          name: newStudentName,
          nationality: newStudentNationality,
          role: newStudentRole,
          effectiveDate: effDate,
          expiryDate: expDate
        };
        return next;
      });
    } catch (err: any) {
      alert("新增學員失敗: " + err.message);
    }
  };


  // NEW: Delete Student Card Handler
  const handleDeleteStudent = async (rowId: string, studentName: string) => {
    const orgId = resolveWorkingOrgId();
    if (!orgId) {
      alert("找不到要操作的機構！");
      return;
    }

    const row = students.find(s => s.id === rowId);
    if (!window.confirm(`確定要刪除學員「${studentName}」(${row?.studentId || rowId}) 的小卡歷史設定嗎？`)) {
      return;
    }

    try {
      // 要刪的是雲端那份文件（originalId），不是表格上可能已被改過職類的 id。
      // 沒有 originalId 表示這列還沒寫進雲端，只要從表格移除。
      if (row?.originalId) {
        await deleteStudentCard(orgId, row.originalId);
        alert("學員小卡已刪除。");
      }
      setStudents(prev => prev.filter(s => s.id !== rowId));
      if (userSession?.role === 'admin' || userSession?.role === 'super_admin') loadAdminData();
    } catch (err: any) {
      alert("刪除失敗: " + err.message);
    }
  };

  // NEW: Send Mock Expiration Email
  const handleSendMockEmail = async (orgName: string, orgId: string, studentName: string, daysLeft: number) => {
    const orgInfo = organizationsInfo.find(o => o.orgId === orgId);
    const email = orgInfo?.email || "org_contact@example.com";
    
    try {
      await writeAuditLog(
        "發送過期警告郵件", 
        orgId, 
        `寄送提醒信給機構窗口 (${email})，通知學員 [${studentName}] 證書剩餘 ${daysLeft} 天即將到期。`
      );
      alert(`[郵件模擬發送成功]\n已向機構【${orgName}】之信箱 ${email} 寄發通知信！\n學員：${studentName}\n狀態：即將於 ${daysLeft} 天後到期。\n\n(此操作已成功記錄於系統稽核日誌)`);
      loadAdminData();
    } catch (e: any) {
      alert("郵件發送失敗: " + e.message);
    }
  };

  // NEW: Column Mapper Apply Handler
  const handleApplyColumnMapping = () => {
    const { name, id, role, date } = columnMapping;
    // 國籍不再是必填：它已改為一律取自名冊，要求對應一個會被丟掉的欄位
    // 只會讓沒有國籍欄的 Excel 卡在這裡進不去
    if (!name || !id || !role || !date) {
      alert("請為姓名、身分證號、職業類別與課程日期選擇對應的 Excel 標頭！");
      return;
    }

    localStorage.setItem('ltcp_saved_mapping', JSON.stringify(columnMapping));
    setShowMapperModal(false);

    addLog(`✓ 套用欄位對應設定，開始解析 ${pendingExcelRows.length} 筆課程資料`);
    // 匯出日期在 handleFileUpload 解析檔案時就抓好了，欄位對照器不改它
    startImport({
      rows: pendingExcelRows, nameCol: name, idCol: id, roleCol: role,
      courseDateCol: date, exportDate: importExportDate,
    });
  };

  /**
   * 匯入的統一入口：先確認有名冊可寫，再開始解析。
   *
   * 沒有名冊時暫存待匯入的內容並請使用者命名建立，建好後接續匯入。
   * 檢查放在這裡而不是 processExcelRows 內，是因為那時檔案已經整份讀完、
   * 欄位也對應完了，才告訴使用者「請先選擇名冊」等於白做一輪。
   */
  const startImport = (pending: PendingImport) => {
    if (!resolveWorkingOrgId()) {
      setPendingImport(pending);
      setNewRosterName('');
      setShowCreateRosterModal(true);
      addLog('尚未選擇名冊。請先為這批人員命名建立一份名冊，建立後會自動繼續匯入。', 'warning');
      return;
    }
    processExcelRows(
      pending.rows, pending.nameCol, pending.idCol,
      pending.roleCol, pending.courseDateCol,
    );
  };

  // File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 管理員是代機構上傳，必須先選定機構：
    // processExcelRows / handleSaveToCloud 都用 selectedOrgId 決定寫到哪個機構底下，
    // 沒選就會寫到空的 orgId 路徑。
    const isActingAsAdmin = userSession?.role === 'admin' || userSession?.role === 'super_admin';
    if (isActingAsAdmin && !selectedOrgId) {
      alert('請先在上方「選擇管理單位」選定機構，再上傳 Excel 名冊。');
      e.target.value = '';
      return;
    }

    // 上傳會用 Excel 的內容重建整張表，名冊分頁上改到一半的東西會不見
    if (!confirmDiscardChanges('上傳積分名冊會重建整張表格，這些變更會不見')) {
      e.target.value = '';
      return;
    }

    addLog(`載入 Excel 檔案: ${file.name}`);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (rawJson.length < 3) {
          throw new Error("Excel 檔案行數不足，無法定位資料（預期第 3 行為標頭）");
        }
        
        // Header row is index 2 (row 3)
        const headers = (rawJson[2] as string[]).map(h => String(h || '').trim());
        const rows = rawJson.slice(3).map(row => {
          const obj: any = {};
          headers.forEach((h, i) => {
            if (h) obj[h] = row[i];
          });
          return obj;
        });

        // Detect standard headers
        const nameCol = headers.find(h => h.includes('人員姓名') || h.includes('姓名'));
        const idCol = headers.find(h => h.includes('身分證') || h.includes('ID'));
        const roleCol = headers.find(h => h.includes('職業類別') || h.includes('職登類別') || h.includes('類別'));
        const nationalityCol = headers.find(h => h.includes('國籍'));
        const courseDateCol = headers.find(h => h.includes('課程日期') || h.includes('日期') || h.includes('期間'));

        // 匯出日期決定積分月報要取代到哪個月為止。抓不到不是致命的
        // （會退回檔案裡最晚的課程月），但必須讓使用者看見用的是哪一個。
        const exportDate = findExportDate(rawJson.slice(0, 3));
        setImportExportDate(exportDate);
        addLog(exportDate
          ? `檔案匯出日期：${exportDate}，積分月報會取代到 ${exportDate.slice(0, exportDate.lastIndexOf('/'))} 為止。`
          : '⚠️ 表頭讀不到匯出日期，取代範圍會退回「檔案裡最晚的課程月」。'
            + '若最後一個月的課全部被撤銷，那個月的舊資料會清不掉。');

        // 國籍不列入判定：它已改為一律取自名冊，缺這一欄不影響匯入
        if (nameCol && idCol && roleCol && courseDateCol) {
          addLog(`成功載入 Excel，共讀取到 ${rows.length} 筆課程明細`);
          startImport({ rows, nameCol, idCol, roleCol, courseDateCol, exportDate });
        } else {
          addLog(`⚠️ 偵測到非標準欄位標頭，開啟智慧欄位對照器...`, 'warning');
          setExcelHeaders(headers);
          setPendingExcelRows(rows);
          
          const mapping = {
            name: nameCol || headers.find(h => h.includes('名')) || '',
            id: idCol || headers.find(h => h.includes('證') || h.includes('ID')) || '',
            role: roleCol || headers.find(h => h.includes('類') || h.includes('職')) || '',
            nationality: nationalityCol || headers.find(h => h.includes('國')) || '',
            date: courseDateCol || headers.find(h => h.includes('日') || h.includes('期')) || ''
          };
          
          // Load remembered mapping if exists
          const savedMapping = localStorage.getItem('ltcp_saved_mapping');
          if (savedMapping) {
            try {
              const parsed = JSON.parse(savedMapping);
              if (headers.includes(parsed.name)) mapping.name = parsed.name;
              if (headers.includes(parsed.id)) mapping.id = parsed.id;
              if (headers.includes(parsed.role)) mapping.role = parsed.role;
              if (headers.includes(parsed.nationality)) mapping.nationality = parsed.nationality;
              if (headers.includes(parsed.date)) mapping.date = parsed.date;
            } catch (e) {
              console.error(e);
            }
          }
          
          setColumnMapping(mapping);
          setShowMapperModal(true);
        }
      } catch (err: any) {
        addLog(`❌ 讀取 Excel 失敗: ${err.message}`, 'error');
        alert("讀取 Excel 檔案錯誤: " + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };

  const processExcelRows = async (
    rows: any[],
    nameCol: string,
    idCol: string,
    roleCol: string,
    courseDateCol: string,
    /** 剛建立名冊後接續匯入時用。selectedOrgId 的 state 更新要等下一次 render，不能靠它 */
    orgIdOverride?: string,
  ) => {
    // Group by ID + Role composite key
    const groups: { [compositeKey: string]: any[] } = {};
    rows.forEach(r => {
      const id = String(r[idCol] || "").trim();
      const name = String(r[nameCol] || "").trim();
      const rawRole = String(r[roleCol] || "").trim();
      const normalizedRole = normalizeRole(rawRole);
      if (id && name) {
        const compositeKey = id + "_" + normalizedRole;
        if (!groups[compositeKey]) groups[compositeKey] = [];
        groups[compositeKey].push(r);
      }
    });

    const orgId = orgIdOverride || resolveWorkingOrgId();
    if (!orgId) {
      alert('請先選擇要匯入到哪一份名冊。');
      addLog('❌ 尚未選擇名冊，取消匯入。', 'error');
      return;
    }

    // 名冊是「機構有哪些人、他們的小卡效期是什麼」的權威來源。
    // 積分 Excel 只負責帶課程明細進來，**不再新增人員** ——
    // 衛福部的積分名冊不含小卡起訖日，靠它建人只會產生一批沒有效期的人員，
    // 而沒有效期就算不出證書年度，那些「效期外」的列看起來像真資料卻是錯的。
    addLog('🔍 讀取名冊，準備把課程明細對應到既有人員…');
    const cards = await getStudentCardsByOrg(orgId);
    const cardIds = Object.keys(cards);
    if (cardIds.length === 0) {
      alert(
        '這份名冊還沒有任何人員，無法對應課程明細。\n\n'
        + '請先到「📋 人員名冊管理」建立人員（可下載名冊範本批次匯入），並填好小卡起訖日。'
      );
      addLog('❌ 名冊是空的，取消匯入。請先建立人員名單。', 'error');
      return;
    }

    // 用「身分證號＋正規化職類」對應，而不是文件 ID ——
    // 舊制文件的 ID 只有身分證號，靠 ID 比對會對不到
    const rosterByKey = new Map<string, { cardId: string; card: CardRecord }>();
    for (const cardId of cardIds) {
      const card = cards[cardId];
      const { studentId } = splitCardId(cardId);
      rosterByKey.set(composeCardId(studentId, normalizeRole(card.role || '')), { cardId, card });
    }

    const parsedStudents: StudentRow[] = [];
    /** 這次上傳有、但名冊上沒有的人。不新增，只點名 */
    const notInRoster: string[] = [];

    // 先點出「Excel 有、名冊沒有」的人。不新增他們，但一定要講出來 ——
    // 靜默略過的話，使用者會以為那些人已經算過了
    for (const [compositeKey, groupRows] of Object.entries(groups)) {
      if (rosterByKey.has(compositeKey)) continue;
      const name = String(groupRows[0][nameCol] || '').trim();
      const { studentId, role } = splitCardId(compositeKey);
      notInRoster.push(`${name}（${studentId}／${role}）`);
    }

    /** 該員在這次 Excel 裡最早的課程日期，只供參考顯示，不再拿來當生效日 */
    const earliestOf = (groupRows: Record<string, unknown>[]): string => {
      let earliestDt: Date | null = null;
      groupRows.forEach(row => {
        const dtStr = extractCourseDate(row[courseDateCol]);
        const dt = dtStr ? rocStrToDate(dtStr) : null;
        if (dt && (!earliestDt || dt < earliestDt)) earliestDt = dt;
      });
      return earliestDt ? dateToRocStr(earliestDt) : '';
    };

    // 表格列出**整份名冊**，不是只列 Excel 裡有的人 ——
    // 這樣「這次沒有課程明細的人」也看得見，不會被誤以為已經算過
    let matchedCount = 0;
    for (const [key, { cardId, card }] of rosterByKey) {
      const groupRows = groups[key] ?? [];
      if (groupRows.length > 0) matchedCount++;
      const { studentId } = splitCardId(cardId);
      parsedStudents.push({
        selected: groupRows.length > 0,
        id: composeCardId(studentId, normalizeRole(card.role || '')),
        originalId: cardId,
        studentId,
        name: card.name,
        nationality: card.nationality || '臺灣',
        role: normalizeRole(card.role || ''),
        earliestDate: earliestOf(groupRows),
        // 起訖日一律以名冊為準。Excel 不含這個資訊，也不該影響它
        effectiveDate: card.effectiveDate,
        expiryDate: card.expiryDate,
        rows: groupRows,
      });
    }
    parsedStudents.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

    setStudents(parsedStudents);
    // Excel 只帶課程明細進來，名冊內容一個字都沒改，所以不是「未儲存的變更」
    setHasUnsavedChanges(false);

    addLog(
      `✓ 對應完成：名冊 ${parsedStudents.length} 位，其中 ${matchedCount} 位在這次 Excel 裡有課程明細。`,
      'success',
    );

    if (parsedStudents.length > matchedCount) {
      addLog(
        `ℹ️ 有 ${parsedStudents.length - matchedCount} 位在這次 Excel 裡沒有課程明細，`
        + `他們的積分不會被更新（不是歸零，是這次沒有資料）。`,
      );
    }

    // Excel 有、名冊沒有的人要點名。不新增他們是刻意的：
    // 積分名冊不含小卡起訖日，靠它建人只會產生一批算不出證書年度的人員。
    if (notInRoster.length > 0) {
      addLog(
        `⚠️ 這次 Excel 裡有 ${notInRoster.length} 位不在名冊上，已略過：`
        + `${notInRoster.slice(0, 8).join('、')}`
        + `${notInRoster.length > 8 ? ` 等 ${notInRoster.length} 位` : ''}。`
        + `請先到「📋 人員名冊管理」新增這些人員並填好小卡起訖日，再重新上傳這份 Excel。`,
        'warning',
      );
      alert(
        `這次 Excel 裡有 ${notInRoster.length} 位不在名冊上，已略過：\n\n`
        + notInRoster.slice(0, 10).join('\n')
        + (notInRoster.length > 10 ? `\n…等共 ${notInRoster.length} 位` : '')
        + '\n\n人員名單只在「人員名冊管理」維護。請先新增這些人員並填好小卡起訖日，再重新上傳。'
      );
    }

    // 名冊裡起訖日空白的人算不出證書年度，會被分析略過。
    // 四十幾列的表格裡使用者不會逐列去看哪幾格是空的，所以要講出數字與姓名。
    const pending = parsedStudents.filter(st => st.rows.length > 0 && !canAnalyseStudent(st));
    if (pending.length > 0) {
      addLog(
        `⚠️ 有 ${pending.length} 位雖然有課程明細，但小卡起訖日是空白的，分析會略過他們：`
        + `${pending.slice(0, 8).map(p => p.name).join('、')}`
        + `${pending.length > 8 ? ` 等 ${pending.length} 位` : ''}。`
        + `請到「📋 人員名冊管理」補上起訖日（填生效日會自動算出到期日）。`,
        'warning',
      );
    }
  };

  // Admin action: Load student cards of selected organization
  const handleLoadOrgCards = async (
    /** 剛匯入名冊後重新載入時用，避免依賴尚未 render 的 selectedOrgId */
    orgIdOverride?: string,
  ) => {
    // 機構帳號沒有下拉選單，載入的一律是自己機構的資料
    const targetOrgId = orgIdOverride || resolveWorkingOrgId();
    if (!targetOrgId) {
      alert("請選擇機構！");
      return;
    }

    // 剛匯入完是我們自己觸發的重新載入，呼叫端已經問過了，不必再問一次
    if (!orgIdOverride && !confirmDiscardChanges('重新載入會直接丟棄這些變更')) return;

    const orgNameSelected = organizations.find(o => o.orgId === targetOrgId)?.name || targetOrgId;
    addLog(`🔍 開始載入 [${orgNameSelected}] 的歷史小卡資料...`);

    try {
      const cards = await getStudentCardsByOrg(targetOrgId);
      const parsed: StudentRow[] = Object.entries(cards).map(([id, card]) => ({
        selected: true,
        id,
        originalId: id,          // 雲端現有的文件 ID，改職類後要靠它刪掉舊文件
        studentId: id.split("_")[0],
        name: card.name,
        nationality: card.nationality || '臺灣',
        role: card.role || '照顧服務人員',
        earliestDate: card.effectiveDate,
        effectiveDate: card.effectiveDate,
        expiryDate: card.expiryDate,
        rows: [] // Loaded from DB, no course details direct upload
      }));
      
      setStudents(parsed);
      setHasUnsavedChanges(false);
      addLog(`✓ 成功載入 ${parsed.length} 筆小卡資料`);
      if (parsed.length === 0) {
        addLog('⚠️ 這份名冊目前沒有任何人員。請用「下載名冊範本」填好起訖日後「匯入名冊」建立。', 'warning');
      }

      // 積分月報與小卡一起載入。讀不到不該讓整趟載入失敗（小卡資料是好的），
      // 但也絕不能靜默 —— 使用者會以為「每月審視是空的」代表大家都沒修課。
      try {
        const monthly = await getMonthlyReport(targetOrgId);
        setCloudMonthly(monthly);
        setPendingMonthly(null);
        addLog(`📅 積分月報載入 ${monthly.length} 列。`);
        getMonthlyIssues(targetOrgId).forEach(issue => addLog(`   ⚠️ ${issue.message}`, 'warning'));
      } catch (err) {
        // 與 backend 一致：catch 拿到的不保證是 Error
        const message = err instanceof Error ? err.message : String(err);
        setCloudMonthly([]);
        addLog(`❌ 積分月報讀取失敗：${message}。每月審視會顯示成沒有歷年紀錄。`, 'error');
      }
    } catch (err: any) {
      alert("載入小卡資料失敗: " + err.message);
      addLog(`❌ 載入失敗: ${err.message}`, 'error');
    }
  };

  /**
   * 切換到某一份名冊：換選取、丟掉上一份的表格與月報，並直接把人員載進來。
   *
   * 集中成一個函式是刻意的 —— 換名冊要連帶處理四件事，散在各個呼叫點遲早會漏掉
   * 其中一件（月報就漏過：留著會讓下一份名冊顯示別人的積分）。
   *
   * 「載入」本身也放在這裡：找到名冊之後還要再按一顆按鈕才看得到名單，
   * 是把使用者退回去按另一顆按鈕，而那顆按鈕在 99% 的情況下只有一個答案。
   *
   * **它不會過問未儲存的變更**，直接丟掉。要問的是使用者按下的那顆按鈕
   * （用 confirmDiscardChanges），因為只有在那裡才問得出「按下去會發生什麼」，
   * 也才來得及在動到雲端之前中止。
   *
   * 寫成 function 宣告而不是 const 箭頭函式：loadRosterList 在它上面就要呼叫它，
   * 而這個元件裡的處理函式本來就互相引用、排不出無環的順序。function 會提升，
   * react-hooks/immutability 才不會抓「在宣告之前使用」。
   */
  async function switchToRoster(orgId: string) {
    setSelectedOrgId(orgId);
    setStudents([]);
    setHasUnsavedChanges(false);
    setCloudMonthly([]);
    setPendingMonthly(null);
    await handleLoadOrgCards(orgId);
  }

  // Date edits on the client side
  const handleDateChange = (id: string, field: 'effectiveDate' | 'expiryDate', value: string) => {
    setHasUnsavedChanges(true);
    setStudents(prev => prev.map(s => (s.id === id ? applyDateChange(s, field, value) : s)));
  };

  /** 勾選單列（勾選同時決定要做積分分析與批次操作的對象） */
  const handleToggleRow = (id: string, checked: boolean) => {
    setStudents(prev => prev.map(s => (s.id === id ? { ...s, selected: checked } : s)));
  };

  /** 編輯姓名／國籍／職業類別（換 key 的處理在 applyFieldChange 裡） */
  const handleFieldChange = (id: string, field: EditableField, value: string) => {
    setHasUnsavedChanges(true);
    setStudents(prev => prev.map(s => (s.id === id ? applyFieldChange(s, field, value) : s)));
  };

  /** 批次刪除已勾選的列：已在雲端的要一併刪除文件，只存在表格裡的直接移除 */
  const handleBatchDelete = async () => {
    const plan = buildDeletePlan(students);
    const total = plan.inCloud.length + plan.localOnlyRowIds.length;
    if (total === 0) return;

    const orgId = resolveWorkingOrgId();
    if (!orgId) {
      alert("找不到要操作的機構！");
      return;
    }
    if (!window.confirm(describeDeletePlan(plan))) return;

    // 大量刪除再擋一層。上面那個確認視窗只要按一下確定就過了，
    // 而名冊載入時每一列預設都是勾選的 —— 那一下就足以清掉整份名冊。
    if (needsTypedConfirm(total, students.length)) {
      const typed = window.prompt(describeTypedConfirm(total, students.length), '');
      if (!isTypedConfirmValid(typed, total)) {
        addLog(`已取消刪除：需要輸入筆數 ${total} 才會執行。`, 'warning');
        return;
      }
    }

    addLog(`🗑 開始批次刪除 ${total} 筆人員資料...`);
    try {
      // 批次刪除是一次呼叫，因此是全成功或全失敗；失敗時整批留在表格上，
      // 不會出現「一半刪掉一半還在」的中間狀態
      await deleteStudentCards(orgId, plan.inCloud.map(c => c.docId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`❌ 刪除失敗：${message}`, 'error');
      alert(`刪除失敗，資料仍保留在表格中：\n${message}`);
      return;
    }

    setStudents(prev => prev.filter(s => !s.selected));
    addLog(`✓ 已刪除 ${total} 筆（雲端 ${plan.inCloud.length} 筆）`, 'success');
    if (userSession?.role === 'admin' || userSession?.role === 'super_admin') loadAdminData();
  };

  // Save Settings to database
  const handleSaveToCloud = async () => {
    const orgId = resolveWorkingOrgId();
    if (!orgId) {
      alert("找不到要操作的機構！");
      return;
    }

    // 驗證與「要寫哪些、要刪哪些」的判斷都在 cardPlan.buildSavePlan（有單元測試覆蓋）
    const result = buildSavePlan(students);
    if (!result.ok) {
      alert(result.message);
      if (result.code !== 'empty') addLog(`❌ 無法保存：${result.message}`, 'error');
      return;
    }
    const { writes, rekeys, pendingDates } = result.plan;

    addLog(`💾 開始保存學員設定至資料庫...`);
    const count = writes.length;

    // 掛在驗證之後：驗證不過就直接 alert 返回，先閃一下遮罩只是雜訊
    setBusy({
      text: pendingMonthly ? '積分資料儲存中，請稍待片刻…' : '人員資料儲存中，請稍待片刻…',
      hint: BUSY_HINT_CLOUD,
    });

    try {
      // 用批次介面而不是逐筆迴圈：Sheets API 逐筆呼叫等於逐筆 HTTP 往返，
      // 四十幾人就足以撞到每分鐘配額
      await saveStudentCards(orgId, writes.map(w => ({ cardId: w.docId, record: w.record })));
      // 職業類別被改過的：先寫入新 key（上一行）再刪舊 key，
      // 順序反過來的話中途失敗就會整筆資料消失。
      if (rekeys.length > 0) {
        await deleteStudentCards(orgId, rekeys.map(r => r.from));
        for (const rekey of rekeys) {
          addLog(`   🔀 ${rekey.name}：${rekey.from} → ${rekey.to}`);
        }
      }
      // 寫入成功後 originalId 就等於現在的 id，否則再按一次儲存會去刪一份已經不存在的文件
      setStudents(prev => prev.map(st => ({ ...st, originalId: st.id })));
      setHasUnsavedChanges(false);

      // 積分月報獨立處理錯誤：人員資料已經存成功了，
      // 用同一個 catch 會把它報成「保存資料失敗」，那是謊話。
      if (pendingMonthly) {
        if (BACKEND_AUTH_MODE !== 'google') {
          addLog('ℹ️ 目前是 Firebase 雲端模式，沒有積分月報可寫入；分析結果只留在畫面上。', 'warning');
        } else {
          // 哪一步失敗要講對。三步共用一個訊息的話，總表寫壞了會報成
          // 「積分月報寫入失敗」—— 那是謊話，會讓人去查錯的地方
          let step = '積分月報';
          try {
            await saveMonthlyReport(
              orgId, pendingMonthly.records, pendingMonthly.throughMonth, pendingMonthly.touchedCardIds,
            );
            addLog(`📅 積分月報已更新，寫入 ${pendingMonthly.records.length} 列。`, 'success');

            // 積分總表是從月報重算出來的快照。用「剛寫進去的那一份」重算，
            // 不能等 setCloudMonthly 的 state 更新 —— 那是非同步的，
            // 這一輪讀到的還是舊值，總表就會少掉這次的分析。
            const merged = replaceMonthlyRecords(
              cloudMonthly, pendingMonthly.records,
              pendingMonthly.throughMonth, pendingMonthly.touchedCardIds,
            );
            // 表上依身分證號排序而不是危險度：這兩張表是拿來逐筆核對的，
            // 順序要穩定且找得到人。危險度排序留在「人員積分審視」畫面上
            const savedRows = buildMonthlyReview(
              students.map(st => ({
                cardId: st.id, name: st.name, nationality: st.nationality,
                effectiveDate: st.effectiveDate, expiryDate: st.expiryDate,
              })),
              merged,
            )
              .slice()
              .sort((a, b) => a.cardId.localeCompare(b.cardId));

            step = '積分總表';
            await saveSummaryReport(orgId, savedRows.map(buildSummaryRow));
            addLog(`📊 積分總表已更新，共 ${savedRows.length} 位人員。`, 'success');

            // 累計走勢分頁：每人一格的 SPARKLINE 加一張全機構平均折線圖，
            // 讓使用者開試算表就看到圖，不必開網頁
            step = '累計走勢';
            const trend = buildTrendTable(savedRows);
            if (trend.points.length > 0) {
              await saveTrendReport(orgId, trend);
              addLog(
                `📈 累計走勢已更新：${trend.people.length} 位人員，`
                + `可用試算表上的下拉選單切換人員與證書年度。`,
                'success',
              );
            } else {
              addLog('ℹ️ 沒有人的小卡起訖日算得出證書期間，累計走勢分頁略過。', 'warning');
            }

            step = '重新載入積分月報';
            // 重讀而不是沿用剛寫出去的內容：這樣畫面上的就是試算表上真正有的東西
            setCloudMonthly(await getMonthlyReport(orgId));
            setPendingMonthly(null);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            addLog(`❌ 人員資料已儲存，但「${step}」失敗：${message}`, 'error');
            await clearBusyAndPaint();
            alert(
              `人員資料已儲存成功，但「${step}」失敗：\n${message}\n\n`
              + '分析結果還在畫面上，可以再按一次儲存重試。',
            );
          }
        }
      }
      const rekeyNote = rekeys.length > 0 ? `，其中 ${rekeys.length} 筆因職業類別變更而搬移了文件` : '';
      addLog(`🎉 成功保存共 ${count} 筆學員資料至資料庫${rekeyNote}，下次操作將會自動回填！`, 'success');
      if (pendingDates.length > 0) {
        addLog(
          `⚠️ 其中 ${pendingDates.length} 位的小卡起訖日仍為空白：`
          + `${pendingDates.slice(0, 5).map(p => p.name).join('、')}`
          + `${pendingDates.length > 5 ? ` 等 ${pendingDates.length} 位` : ''}。`
          + `未填起訖日的人員無法計算積分年度。`,
          'warning',
        );
      }
      await clearBusyAndPaint();
      alert(
        `已成功儲存共 ${count} 筆設定到資料庫！${rekeyNote}`
        + (pendingDates.length > 0 ? `\n\n注意：其中 ${pendingDates.length} 位的小卡起訖日仍為空白，未填無法計算積分年度。` : '')
      );
      if (userSession?.role === 'admin' || userSession?.role === 'super_admin') loadAdminData();
    } catch (err: any) {
      addLog(`❌ 保存資料失敗: ${err.message}`, 'error');
      await clearBusyAndPaint();
      alert(err.message);
    } finally {
      // 一定要在 finally：中途任何一步擲錯而遮罩留著，畫面就永遠鎖住了
      setBusy(null);
    }
  };

  /** 下載上一次分析的結果。檔名帶時間戳，連跑多次才不會互相覆蓋。 */
  const handleDownloadReport = () => {
    if (!lastReport) return;
    const timestamp = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '');
    const filename = `長照積分統計分析_${timestamp}.xlsx`;
    downloadReportExcel(lastReport, filename);
    addLog(`⬇ 已下載：${filename}`, 'success');
  };

  // Run Calculations
  const handleRunAnalysis = () => {
    if (selectedStudents.length === 0) {
      alert("請至少勾選一名人員進行分析！");
      return;
    }
    if (!canRunAnalysis) {
      alert(
        '勾選的人員都無法分析。\n\n'
        + '要能分析，一位人員需要同時具備：\n'
        + '  1. 課程明細 —— 上傳衛福部匯出的「機構人員教育訓練積分名冊」Excel\n'
        + '  2. 小卡起訖日 —— 在「📋 人員名冊管理」填寫\n\n'
        + '缺任一項都算不出證書年度。'
      );
      addLog('⚠️ 勾選的人員都無法分析（缺課程明細或缺小卡起訖日），已取消統計分析。', 'warning');
      return;
    }

    // 無法分析的人**整個略過**，不是算成 0 也不是算成「效期外」。
    // 沒有起訖日就切不出證書年度，硬算出來的每一列都會是「效期外」——
    // 那種資料看起來像真的卻是錯的，寫進試算表之後使用者要等到
    // 樞紐分析不出來才會發現。
    const skipped = selectedStudents.filter(s => !canAnalyseStudent(s));
    if (skipped.length > 0) {
      const noRows = skipped.filter(s => s.rows.length === 0);
      const noDates = skipped.filter(s => s.rows.length > 0);
      if (noRows.length > 0) {
        addLog(`ℹ️ 略過 ${noRows.length} 位：這次 Excel 裡沒有他們的課程明細。`);
      }
      if (noDates.length > 0) {
        addLog(
          `⚠️ 略過 ${noDates.length} 位：小卡起訖日空白，算不出證書年度 ——`
          + `${noDates.slice(0, 8).map(s => s.name).join('、')}`
          + `${noDates.length > 8 ? ` 等 ${noDates.length} 位` : ''}。`
          + `請到「📋 人員名冊管理」補上起訖日後重新分析。`,
          'warning',
        );
      }
    }

    setIsProcessing(true);
    addLog("--- 開始進行積分統計分析 ---");
    
    // 只跑得分析的人。無法分析者已在上面點名，不進迴圈
    const targets = selectedStudents.filter(canAnalyseStudent);
    const resultsList: any[] = [];
    const monthlyList: MonthlyPointRecord[] = [];
    let currentIndex = 0;

    setBusy({ text: `統計分析中… 0 / ${targets.length}`, hint: BUSY_HINT_LOCAL });

    const interval = setInterval(() => {
      // 整個 tick 包起來：這個迴圈原本沒有任何錯誤處理，某一位的資料讓它擲錯
      // 的話 setInterval 會繼續每 tick 擲一次，而現在畫面上還蓋著遮罩 ——
      // 那就從「跑很久」變成「永遠鎖死」。
      try {
        if (currentIndex >= targets.length) {
          clearInterval(interval);
          setIsProcessing(false);
          setBusy(null);
          setLastReport(resultsList);

          // 取代到**匯出月**為止，而不是「檔案裡有課的那些月」。
          // 衛福部每次匯出都是生平全紀錄，所以匯出日以前的每個月它都是權威的；
          // 用有課的月份定範圍的話，整個月的課都被撤銷時那個月就清不掉。
          const withDetails = targets;
          const throughMonth = uploadThroughMonth(withDetails.flatMap(st => st.rows), importExportDate);
          setPendingMonthly({
            records: monthlyList,
            throughMonth,
            touchedCardIds: withDetails.map(st => st.id),
          });

          addLog(`🎉 全部任務處理完畢。共完成 ${resultsList.length} 筆人員分析。`, 'success');
          addLog(
            `📅 已算出 ${monthlyList.length} 列月份積分，涉及 ${withDetails.length} 位人員。`
            + (throughMonth
              ? `儲存時會取代這些人 ${throughMonth} 以前的所有月份。`
              : '⚠️ 判斷不出匯出月，儲存時只會清掉「無法歸月」的列。'),
          );
          // 不自動下載：使用者按「開始統計分析」是想看結果，不一定是要一個檔案。
          // 而且瀏覽器可能靜默擋掉自動觸發的下載，程式無從得知成功與否。
          addLog(`需要存檔請按「下載本次分析結果 (Excel)」。`);
          return;
        }

        const student = targets[currentIndex];
        setBusy({
          text: `統計分析中… ${currentIndex + 1} / ${targets.length}（${student.name}）`,
          hint: BUSY_HINT_LOCAL,
        });
        addLog(`👤 [${currentIndex + 1}/${targets.length}] 正在統計: ${student.name} (${student.id})...`);

        // Execute local calculation
        const pointsData = parseExcelToPointsData(student.rows, student.effectiveDate, student.expiryDate);
        const results = calculatePoints(pointsData, courses);
      
        // 把每門課的積分歸屬到月份。明細只存在於這一刻，歸屬完就丟掉，
        // 之後從雲端載入也能算出逐年檢核與四大核心。
        const attribution = attributePointsToMonths(student.rows, student.effectiveDate, student.expiryDate);
        monthlyList.push(...attribution.rows.map(row => ({
          cardId: student.id,
          name: student.name,
          analyzedEffectiveDate: student.effectiveDate,
          row,
        })));
        // 沒有進到月份列的積分要說得出去向，靜默丟掉會讓合計莫名變少
        if (attribution.skippedNotApproved > 0) {
          addLog(`   ℹ️ ${student.name}：${attribution.skippedNotApproved} 筆課程的認可狀態不是「符合」，未列入計算。`);
        }
        if (attribution.invalidPointsRows.length > 0) {
          addLog(`   ⚠️ ${student.name}：${attribution.invalidPointsRows.length} 筆課程的積分不是大於 0 的數字，未列入計算。`, 'warning');
        }
        if (attribution.unassignedPoints > 0) {
          addLog(`   ⚠️ ${student.name}：${attribution.unassignedPoints} 分的課程日期無法解析，已歸入「無法歸月」。`, 'warning');
        }
        if (attribution.outOfRangePoints > 0) {
          addLog(`   ℹ️ ${student.name}：${attribution.outOfRangePoints} 分的課程日期在小卡效期外。`);
        }
        if (attribution.unattributedPoints > 0) {
          addLog(`   ⚠️ ${student.name}：${attribution.unattributedPoints} 分的課程屬性無法辨識，不計入 120 分總分。`, 'warning');
        }
        if (!attribution.hasCardWindow) {
          addLog(`   ⚠️ ${student.name}：小卡起訖日待補，積分暫時無法歸入證書年度。`, 'warning');
        }

        const csvRow = buildCsvRow(student.id, pointsData, results);
        csvRow['姓名'] = student.name;
        csvRow['國籍'] = student.nationality;
        csvRow['職業類別'] = student.role;
        csvRow['_recommendedCoursesList'] = results.recommendedCoursesList;

        resultsList.push(csvRow);
        addLog(`   ✓ 統計完成: 總積分 ${results.totalPoints} (${results.attentionNotes})`);

        currentIndex++;
      } catch (err) {
        // 停掉迴圈並收掉遮罩，然後把是哪一位出事講出來 ——
        // 只寫 console 的話使用者只會看到畫面一直糊著
        clearInterval(interval);
        setIsProcessing(false);
        setBusy(null);
        const who = targets[currentIndex]?.name ?? `第 ${currentIndex + 1} 位`;
        const message = err instanceof Error ? err.message : String(err);
        addLog(`❌ 統計分析中止於「${who}」：${message}`, 'error');
        alert(`統計分析中止於「${who}」：
${message}

已完成的 ${resultsList.length} 筆結果沒有寫入雲端。`);
      }
    }, 40); // 40ms simulation pause for premium smooth visual effect
  };

  const downloadReportExcel = (data: any[], filename: string) => {
    const columnOrder = [
      '身分證號', '國籍', '姓名', '職業類別',
      '專業課程_實體', '專業課程_網路', '專業課程_總計',
      '專業品質_實體', '專業品質_網路', '專業倫理_實體', '專業倫理_網路',
      '專業法規_實體', '專業法規_網路', '品質倫理法規_總計',
      '消防安全', '緊急應變', '感染管制', '性別敏感度', '四大核心_總計',
      '原住民族與多元族群文化(舊)', '舊制文化超上限未採計',
      '原住民族文化(新)', '多元族群文化(新)', '新制文化逐年檢核',
      '實體課程(raw total)', '網路課程(raw total)', '最終總計',
      '小卡到期日', '注意', '推薦課程'
    ];

    if (data.length === 0) return;

    // 1. Group the recommended courses from the analyzed data
    const courseGroups: {
      [url: string]: {
        url: string;
        date: string;
        name: string;
        creditsStr: string;
        students: string[];
        points: number;
      }
    } = {};

    data.forEach(row => {
      const studentName = row['姓名'];
      const recList = (row['_recommendedCoursesList'] as Course[]) || [];
      
      recList.forEach(course => {
        if (!courseGroups[course.url]) {
          const tags = course.tags || [];
          const primary = tags.find(t => t.includes('專業品質') || t.includes('專業倫理') || t.includes('專業法規') || t.includes('專業課程')) || '';
          const secondary = tags.find(t => t.includes('消防安全') || t.includes('緊急應變') || t.includes('感染管制') || t.includes('感染管控') || t.includes('性別敏感度') || t.includes('原住民族') || t.includes('多元族群')) || '';
          
          let label = primary || (tags[0] || '專業課程');
          if (secondary) {
            label += `(${secondary})`;
          }
          
          const ptsStr = `${label}${course.points}點`;

          courseGroups[course.url] = {
            url: course.url,
            date: course.date || '',
            name: course.name,
            creditsStr: ptsStr,
            students: [],
            points: course.points
          };
        }
        
        if (!courseGroups[course.url].students.includes(studentName)) {
          courseGroups[course.url].students.push(studentName);
        }
      });
    });

    const sheet2Rows = Object.values(courseGroups).map(group => ({
      '日期': group.date,
      '課程名稱': group.name,
      '課程積分數': group.creditsStr,
      '上課名單': group.students.join('\n'),
      '總點數': Number((group.points * group.students.length).toFixed(2)),
      '人數': group.students.length,
      '課程連結': group.url
    }));

    // 2. Prepare Sheet 1 rows in order
    const sheet1Rows = data.map(row => {
      const obj: any = {};
      columnOrder.forEach(col => {
        obj[col] = row[col] ?? '';
      });
      return obj;
    });

    // 3. Generate XLSX file using SheetJS
    const wb = XLSX.utils.book_new();

    // Sheet 1
    const ws1 = XLSX.utils.json_to_sheet(sheet1Rows);
    XLSX.utils.book_append_sheet(wb, ws1, "長照積分統計分析");

    // Sheet 2
    const ws2 = XLSX.utils.json_to_sheet(sheet2Rows);
    XLSX.utils.book_append_sheet(wb, ws2, "推薦課程彙總");

    // Export to user
    XLSX.writeFile(wb, filename);
  };

  // Toggle checks helper
  const handleToggleSelectAll = (checked: boolean) => {
    setStudents(prev => prev.map(s => ({ ...s, selected: checked })));
  };

  // ── 每月審視的衍生資料 ───────────────────────────────────────
  // 位置有意義：**必須排在下面那個提前 return 之前**。
  // 放在後面的話，未登入與已登入兩種 render 的 hook 數量不一樣，React 會錯亂。
  /**
   * 每月審視要看的資料：雲端已存的月報，疊上本次還沒儲存的分析結果。
   *
   * 疊法與寫進試算表的取代規則共用 replaceMonthlyRecords ——
   * 兩邊各寫一套的話，畫面顯示的「儲存後會變成什麼」會跟實際寫進去的不一樣，
   * 而使用者要到下次重新載入才會發現。
   */
  const reviewAsOf = useMemo(() => new Date(), []);
  const reviewRows = useMemo(() => {
    const records = pendingMonthly
      ? replaceMonthlyRecords(
        cloudMonthly, pendingMonthly.records, pendingMonthly.throughMonth, pendingMonthly.touchedCardIds,
      )
      : cloudMonthly;
    // 以名冊為準而不是以月報為準：一列積分都沒有的人正是最該被看見的
    return buildMonthlyReview(
      students.map(st => ({
        cardId: st.id, name: st.name, nationality: st.nationality,
        effectiveDate: st.effectiveDate, expiryDate: st.expiryDate,
      })),
      records,
      reviewAsOf,
    );
  }, [students, cloudMonthly, pendingMonthly, reviewAsOf]);

  /** 分頁標籤上的待辦人數（ok 以外的都算） */
  const reviewTodoCount = reviewRows.filter(r => r.risk !== 'ok').length;

  const filteredReviewRows = reviewFilter === null
    ? reviewRows
    : reviewRows.filter(r => r.risk === reviewFilter);

  // 選取的人不在篩選結果裡（換了篩選、或重跑分析後那個人消失了）就退回第一位。
  // 用衍生值而不是 useEffect：effect 會先 render 一次空白畫面再補上。
  const activeReviewRow =
    filteredReviewRows.find(r => r.cardId === reviewCardId) ?? filteredReviewRows[0] ?? null;

  // Authentication View
  if (!userSession) {
    return (
      <>
      <div className="auth-container">
        <div className="glass-panel auth-card">
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <h2 className="text-glow" style={{ fontSize: '24px', color: 'var(--primary)', margin: '0 0 8px' }}>長照機構人員積分分析管理系統</h2>
            {backendStatus.error && (
              <div style={{ marginTop: '10px' }}>
                <span className="badge badge-mock" style={{ fontSize: '12px', padding: '4px 10px' }}>
                  後端未就緒
                </span>
              </div>
            )}
          </div>

          {backendStatus.error && (
            <div
              role="alert"
              style={{
                marginBottom: '20px',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1px solid var(--destructive)',
                color: 'var(--destructive)',
                fontSize: '13px',
                lineHeight: 1.6,
                textAlign: 'left'
              }}
            >
              <strong style={{ display: 'block', marginBottom: '4px' }}>無法連線至系統後端</strong>
              {backendStatus.error}
            </div>
          )}

          {BACKEND_AUTH_MODE === 'google' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', lineHeight: 1.7, margin: 0 }}>
                名冊資料存放在你自己的 Google 雲端硬碟，本系統不會保存任何人員個資。
                登入後即可讀取你有權限的名冊。
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={isProcessing}
                onClick={handleGoogleLogin}
              >
                {isProcessing ? '登入中…' : '使用 Google 登入'}
              </button>
            </div>
          ) : authMode !== 'forgot' ? (
            <form onSubmit={handleAuth}>
              <div className="form-group">
                <label className="form-label">電子信箱</label>
                <input 
                  type="email" 
                  className="input-field" 
                  placeholder="email@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>密碼</span>
                  <button 
                    type="button"
                    className="btn" 
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '12.5px', padding: 0, textDecoration: 'underline', cursor: 'pointer', minHeight: 'unset' }}
                    onClick={() => setAuthMode('forgot')}
                  >
                    忘記密碼？
                  </button>
                </label>
                <input 
                  type="password" 
                  className="input-field" 
                  placeholder="密碼"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>

              {authMode === 'register' && (
                <div className="form-group">
                  <label className="form-label">長照機構 / 單位名稱</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="如：童庭居家照顧機構"
                    value={orgName}
                    onChange={e => setOrgName(e.target.value)}
                    required
                  />
                </div>
              )}

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
                {authMode === 'login' ? '登入系統' : '註冊帳號'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword}>
              <div className="form-group">
                <label className="form-label">電子信箱</label>
                <input 
                  type="email" 
                  className="input-field" 
                  placeholder="請輸入註冊時的電子信箱"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
                傳送重設密碼信件
              </button>

              <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <button 
                  type="button"
                  className="btn" 
                  style={{ background: 'none', color: 'var(--primary)', textDecoration: 'underline', padding: '0 4px', fontSize: '13.5px', minHeight: 'unset' }}
                  onClick={() => setAuthMode('login')}
                >
                  返回登入
                </button>
              </div>
            </form>
          )}

          {BACKEND_AUTH_MODE === 'password' && authMode !== 'forgot' && (
            <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13.5px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {authMode === 'login' ? '還沒有帳號嗎？' : '已經有帳號了？'}
              </span>
              <button 
                className="btn" 
                style={{ background: 'none', color: 'var(--primary)', textDecoration: 'underline', padding: '0 4px', fontSize: '13.5px', minHeight: 'unset' }}
                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              >
                {authMode === 'login' ? '註冊新帳號' : '切換至登入'}
              </button>
            </div>
          )}

        </div>
      </div>
      <SiteFooter onOpenLegal={setLegalDoc} />
      {legalDoc && <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />}
      </>
    );
  }

  // Check if current user is admin/super_admin/auditor
  const isAdminRole = userSession && (userSession.role === 'admin' || userSession.role === 'super_admin' || userSession.role === 'auditor');

  // 目前選定名冊的檢視網址；Firestore 模式沒有這個概念，回傳 null 就不顯示連結
  const selectedRosterUrl = selectedOrgId ? getOrgUrl(selectedOrgId) : null;

  // 新增學員時依生效日即時算出的到期日；算不出來代表輸入的日期無法解析
  const newStudentExpiryPreview = calculateExpiryDate(normalizeDateToRocStr(newStudentEffDate));

  /**
   * 這份名冊目前是不是唯讀。唯讀狀態只有這一個來源，所有寫入入口都看它。
   *
   * 試算表模式取自 Drive 的 capabilities.canEdit —— 被分享為「檢視者」的人
   * 拿到 false，介面就整個轉唯讀，不必等寫入被 Google 拒絕才知道不能改。
   * Firestore 模式沿用原本的稽查員角色判斷。
   */
  const selectedRoster = organizations.find(o => o.orgId === selectedOrgId);
  const isReadOnly = BACKEND_AUTH_MODE === 'google'
    ? !(selectedRoster?.canEdit ?? false)
    : userSession.role === 'auditor';

  /**
   * 已經**確認**是唯讀：名冊在清單裡查得到，而且 Drive 說不能編輯。
   *
   * 與 isReadOnly 的差別只在「還不知道」的時候。名冊清單尚未載入完成時
   * selectedRoster 是 undefined，isReadOnly 保守地落在 true —— 擋住寫入是對的，
   * 但那時候還沒有任何根據說使用者是檢視者。
   *
   * 所以：**擋寫入看 isReadOnly，寫給人看的說明看這一個**。
   * 混用的話，載入中的瞬間會對編輯者謊稱他只有檢視權限。
   */
  const isConfirmedReadOnly = BACKEND_AUTH_MODE === 'google'
    ? selectedRoster !== undefined && !selectedRoster.canEdit
    : isReadOnly;

  /**
   * 有多少勾選的人員帶著課程明細。
   *
   * 積分是從 student.rows（衛福部 Excel 的課程明細）算出來的。名冊只存小卡
   * 資料 —— 姓名、職類、起訖日 —— 不含任何上課紀錄，所以「從名冊載入」之後
   * 直接統計，每一項積分都會是 0。那不是計算錯誤，是根本沒有資料可算。
   */
  const selectedStudents = students.filter(s => s.selected);
  const analysableCount = selectedStudents.filter(canAnalyseStudent).length;
  const canRunAnalysis = analysableCount > 0;

  // Dashboard View (Conditional Rendering)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h2 className="text-glow" style={{ margin: 0, fontSize: '20px', color: 'var(--primary)' }}>長照機構人員積分分析管理系統</h2>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>v5.0 Web 版</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '14.5px', fontWeight: 550, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {isAdminRole ? <Icons.Crown /> : <Icons.Building />} {userSession.name} ({userSession.email})
            <span className="badge" style={{ fontSize: '11px', background: 'rgba(8, 145, 178, 0.1)', color: 'var(--primary)', border: '1px solid var(--panel-border)', padding: '2px 6px', borderRadius: '4px' }}>
              {userSession.role === 'admin' || userSession.role === 'super_admin' ? '超級管理員' : userSession.role === 'auditor' ? '區域稽查員' : '一般機構'}
            </span>
          </span>
          <button 
            className="theme-toggle-btn"
            onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? '切換至暗色模式' : '切換至亮色模式'}
            type="button"
          >
            {theme === 'light' ? <Icons.Moon /> : <Icons.Sun />}
          </button>
          <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '13px', minHeight: '36px' }} onClick={handleLogout}>
            <Icons.LogOut /> 安全登出
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="app-container">
        {isAdminRole ? (
          // ==========================================
          // ADMIN PANEL VIEW
          // ==========================================
          <div>
            {/* Admin Tabs */}
            <div className="admin-nav-bar">
              <button 
                className={`admin-nav-btn ${adminTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setAdminTab('dashboard')}
              >
                📊 系統儀表板
              </button>
              <button 
                className={`admin-nav-btn ${adminTab === 'institutions' ? 'active' : ''}`}
                onClick={() => setAdminTab('institutions')}
              >
                🏢 機構管理
              </button>
              <button 
                className={`admin-nav-btn ${adminTab === 'staff' ? 'active' : ''}`}
                onClick={() => setAdminTab('staff')}
              >
                👥 學員與小卡管理
              </button>
              {userSession.role !== 'auditor' && (
                <button 
                  className={`admin-nav-btn ${adminTab === 'logs' ? 'active' : ''}`}
                  onClick={() => setAdminTab('logs')}
                >
                  🔒 系統稽核日誌
                </button>
              )}
            </div>

            {/* TAB CONTENT: DASHBOARD */}
            {adminTab === 'dashboard' && (
              <div>
                <div className="bento-grid">
                  <div className="bento-card">
                    <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>總註冊長照機構</span>
                    <div className="bento-card-val">{stats.totalOrgs}</div>
                  </div>
                  <div className="bento-card">
                    <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>列管小卡學員總數</span>
                    <div className="bento-card-val">{stats.totalCards}</div>
                  </div>
                  <div className="bento-card">
                    <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>已過期學員數</span>
                    <div className="bento-card-val" style={{ color: 'var(--destructive)' }}>{stats.expiredCount}</div>
                  </div>
                  <div className="bento-card">
                    <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>證照即將到期 (90天內)</span>
                    <div className="bento-card-val" style={{ color: 'var(--accent-red)' }}>
                      {stats.expiring30 + stats.expiring60 + stats.expiring90}
                    </div>
                  </div>
                </div>

                {/* Progress bar visual */}
                {stats.totalCards > 0 && (
                  <div className="glass-panel" style={{ marginBottom: '24px' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>證照有效狀態比例分析</h3>
                    {(() => {
                      const valPct = (stats.validCount / stats.totalCards) * 100;
                      const warnPct = ((stats.expiring30 + stats.expiring60 + stats.expiring90) / stats.totalCards) * 100;
                      const errPct = (stats.expiredCount / stats.totalCards) * 100;
                      return (
                        <div>
                          <div className="progress-stacked-bar">
                            <div className="progress-segment progress-segment-val" style={{ width: `${valPct}%` }} title={`有效: ${valPct.toFixed(1)}%`} />
                            <div className="progress-segment progress-segment-warn" style={{ width: `${warnPct}%` }} title={`即將過期: ${warnPct.toFixed(1)}%`} />
                            <div className="progress-segment progress-segment-err" style={{ width: `${errPct}%` }} title={`已過期: ${errPct.toFixed(1)}%`} />
                          </div>
                          <div style={{ display: 'flex', gap: '24px', fontSize: '13.5px', marginTop: '12px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '12px', height: '12px', background: 'var(--accent-green)', borderRadius: '3px' }}></span>
                              正常有效: {stats.validCount} 人 ({valPct.toFixed(1)}%)
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '12px', height: '12px', background: 'var(--accent-red)', borderRadius: '3px' }}></span>
                              即將到期: {stats.expiring30 + stats.expiring60 + stats.expiring90} 人 ({warnPct.toFixed(1)}%)
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '12px', height: '12px', background: 'var(--destructive)', borderRadius: '3px' }}></span>
                              已過期: {stats.expiredCount} 人 ({errPct.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Expiration List */}
                <div className="glass-panel">
                  <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    ⚠️ 證照到期預警清單 (過期或 90 天內到期)
                  </h3>
                  {stats.expiringList.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '12px 0' }}>目前無過期或即將過期之從業學員。</div>
                  ) : (
                    <div className="table-container">
                      <table className="custom-table">
                        <thead>
                          <tr>
                            <th>隸屬機構</th>
                            <th>學員姓名</th>
                            <th>身分證號</th>
                            <th>小卡到期日</th>
                            <th style={{ textAlign: 'center' }}>狀態</th>
                            {userSession.role !== 'auditor' && <th style={{ textAlign: 'center' }}>操作</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {stats.expiringList.map((item, idx) => {
                            const isExpired = item.daysLeft < 0;
                            return (
                              <tr key={idx}>
                                <td style={{ fontWeight: 550 }}>{item.orgName}</td>
                                <td>{item.name}</td>
                                <td style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>{item.studentId}</td>
                                <td style={{ fontFamily: 'var(--mono)' }}>{item.expiryDate}</td>
                                <td style={{ textAlign: 'center' }}>
                                  {isExpired ? (
                                    <span className="badge" style={{ background: 'rgba(220, 38, 38, 0.1)', color: 'var(--destructive)', border: '1px solid rgba(220, 38, 38, 0.2)' }}>已過期 ({Math.abs(item.daysLeft)} 天)</span>
                                  ) : (
                                    <span className="badge badge-mock">剩餘 {item.daysLeft} 天</span>
                                  )}
                                </td>
                                {userSession.role !== 'auditor' && (
                                  <td style={{ textAlign: 'center' }}>
                                    <button 
                                      className="btn btn-secondary"
                                      style={{ padding: '4px 10px', fontSize: '12px', minHeight: '30px' }}
                                      onClick={() => handleSendMockEmail(item.orgName, item.orgId, item.name, item.daysLeft)}
                                    >
                                      ✉️ 發送郵件提醒
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: INSTITUTIONS */}
            {adminTab === 'institutions' && (
              <div className="glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, fontSize: '18px' }}>🏢 帳號與機構列表</h3>
                  {userSession.role !== 'auditor' && (
                    <button className="btn btn-primary" onClick={() => setShowAddOrgModal(true)}>
                      ➕ 新增機構帳號
                    </button>
                  )}
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="搜尋機構名稱或 Email..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{ maxWidth: '360px' }}
                  />
                </div>

                <div className="table-container">
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th>機構 ID</th>
                        <th>單位機構名稱</th>
                        <th>電子郵件 (帳號)</th>
                        <th>權限角色</th>
                        <th style={{ textAlign: 'center' }}>啟用狀態</th>
                        {userSession.role !== 'auditor' && <th style={{ textAlign: 'center' }}>操作</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {organizationsInfo
                        .filter(org => org.name.toLowerCase().includes(searchQuery.toLowerCase()) || org.email.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map((org) => (
                          <tr key={org.orgId}>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>{org.orgId}</td>
                            <td style={{ fontWeight: 600 }}>{org.name}</td>
                            <td style={{ fontSize: '13.5px' }}>{org.email}</td>
                            <td>
                              <span className="badge badge-firebase">
                                {org.role === 'admin' || org.role === 'super_admin' ? '系統管理者' : org.role === 'auditor' ? '區域稽核員' : '一般機構'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <label className="switch-container">
                                <input 
                                  type="checkbox" 
                                  className="switch-input"
                                  checked={org.status === 'active'}
                                  disabled={userSession.role === 'auditor' || org.orgId === 'org_default'}
                                  onChange={() => handleToggleOrgStatus(org.orgId, org.status)}
                                />
                                <span className="switch-slider"></span>
                              </label>
                            </td>
                            {userSession.role !== 'auditor' && (
                              <td style={{ textAlign: 'center' }}>
                                <button 
                                  className="btn" 
                                  style={{ color: 'var(--destructive)', background: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.15)', padding: '4px 10px', fontSize: '12px', minHeight: '30px' }}
                                  onClick={() => handleDeleteOrgCascade(org.orgId, org.name)}
                                  disabled={org.orgId === 'org_default'}
                                >
                                  級聯刪除
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB CONTENT: STAFF MANAGEMENT */}
            {adminTab === 'staff' && (
              <div className="glass-panel">
                <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>👥 機構學員小卡管理</h3>
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', marginBottom: '20px', background: 'rgba(8, 145, 178, 0.03)', padding: '16px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                  <span style={{ fontSize: '14px', fontWeight: 550 }}>選擇管理單位：</span>
                  <select 
                    value={selectedOrgId} 
                    onChange={e => {
                      const nextOrgId = e.target.value;
                      if (nextOrgId === selectedOrgId) return;
                      if (hasUnsavedChanges && students.length > 0) {
                        const ok = window.confirm(
                          `目前表格中有 ${students.length} 筆尚未儲存至雲端的變更。`
                          + `\n切換機構會直接丟棄這些變更，且無法復原。`
                          + `\n\n確定要切換嗎？`
                        );
                        // 取消時不更新 selectedOrgId，受控的 select 會自動回到原本選項
                        if (!ok) return;
                      }
                      setSelectedOrgId(nextOrgId);
                      setStudents([]);
                      setHasUnsavedChanges(false);
                    }}
                    className="input-field"
                    style={{ maxWidth: '300px', margin: 0 }}
                  >
                    {organizations.map(org => (
                      <option key={org.orgId} value={org.orgId}>{org.name}</option>
                    ))}
                  </select>
                  
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleLoadOrgCards()}
                    disabled={!selectedOrgId}
                  >
                    <Icons.FolderOpen /> 載入機構小卡
                  </button>

                  {userSession.role !== 'auditor' && (
                    <label
                      className="btn btn-secondary"
                      style={{
                        cursor: selectedOrgId ? 'pointer' : 'not-allowed',
                        opacity: selectedOrgId ? 1 : 0.5,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                      title={selectedOrgId ? '為所選機構上傳衛福部匯出名冊' : '請先選擇管理單位'}
                    >
                      📤 上傳 Excel 名冊
                      <input
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={handleFileUpload}
                        disabled={!selectedOrgId}
                        style={{ display: 'none' }}
                      />
                    </label>
                  )}

                  {userSession.role !== 'auditor' && (
                    <button 
                      className="btn btn-primary" 
                      onClick={() => setShowAddStudentModal(true)}
                      disabled={!selectedOrgId}
                      style={{ marginLeft: 'auto' }}
                    >
                      ➕ 手動新增學員
                    </button>
                  )}
                </div>

                {students.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '36px 0' }}>
                    請先選擇管理單位，再點「載入機構小卡」查看既有資料，或「上傳 Excel 名冊」匯入新名單。
                    <br />
                    匯入後仍需按「儲存修改至雲端」才會寫入資料庫。
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontSize: '14px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                        共載入 {students.length} 筆從小卡歷史資料
                        {hasUnsavedChanges && (
                          <span style={{ color: 'var(--accent-red)', fontWeight: 600, fontStyle: 'normal' }}>
                            ● 有未儲存的變更
                          </span>
                        )}
                      </span>
                      {userSession.role !== 'auditor' && (
                        <button className="btn btn-accent" onClick={handleSaveToCloud}>
                          <Icons.Save /> 儲存修改至雲端
                        </button>
                      )}
                    </div>

                    {userSession.role !== 'auditor' && (
                      <BatchEditBar
                        selectedCount={students.filter(s => s.selected).length}
                        totalCount={students.length}
                        onToggleAll={handleToggleSelectAll}
                        onBatchDelete={handleBatchDelete}
                      />
                    )}

                    <StudentTable
                      students={students}
                      readOnly={isReadOnly}
                      onToggleRow={handleToggleRow}
                      onFieldChange={handleFieldChange}
                      onDateChange={handleDateChange}
                      onDeleteRow={handleDeleteStudent}
                    />
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: AUDIT LOGS */}
            {adminTab === 'logs' && userSession.role !== 'auditor' && (
              <div className="glass-panel">
                <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>🔒 系統操作稽核日誌 (Audit Trail)</h3>
                
                <div style={{ marginBottom: '20px' }}>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="篩選操作動作、人員或詳情..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{ maxWidth: '360px' }}
                  />
                </div>

                <div className="timeline-list">
                  {auditLogs
                    .filter(log => log.action.toLowerCase().includes(searchQuery.toLowerCase()) || log.operatorEmail.toLowerCase().includes(searchQuery.toLowerCase()) || log.details.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((log) => (
                      <div className="timeline-item" key={log.id}>
                        <div className="timeline-time">{new Date(log.timestamp).toLocaleString('zh-TW')}</div>
                        <div className="timeline-title">
                          {log.action} 
                          <span style={{ color: 'var(--text-muted)', fontSize: '13px', marginLeft: '10px', fontWeight: 'normal' }}>
                            操作者: {log.operatorEmail}
                          </span>
                        </div>
                        <div className="timeline-desc">{log.details}</div>
                      </div>
                    ))}
                  {auditLogs.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '12px 0' }}>目前無系統操作紀錄。</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          // ==========================================
          // ORDINARY USER (ORGANIZATION) VIEW
          // ==========================================
          <div>
            {/* 沿用 admin-nav-bar 的樣式另做一組：現有那組包在 isAdminRole 裡，
                而試算表模式的 role 恆為 'user'，所以它從來不會出現。 */}
            <div className="admin-nav-bar">
              <button
                className={`admin-nav-btn ${mainTab === 'roster' ? 'active' : ''}`}
                onClick={() => setMainTab('roster')}
                type="button"
              >
                📋 人員名冊管理
                {hasUnsavedChanges && students.length > 0 && (
                  <span
                    className="review-risk-chip"
                    style={{ background: 'var(--accent-red)' }}
                    title="名冊有尚未儲存至雲端的變更。切分頁不會弄丟它們，但重新載入、換名冊或上傳 Excel 會。"
                  >
                    未儲存
                  </span>
                )}
              </button>
              <button
                className={`admin-nav-btn ${mainTab === 'review' ? 'active' : ''}`}
                onClick={() => setMainTab('review')}
                type="button"
              >
                📊 人員積分審視
                {pendingMonthly && (
                  <span
                    className="review-risk-chip"
                    style={{ background: 'var(--accent-red)' }}
                    title="本次分析的結果還沒寫回雲端。重新整理頁面就會消失。"
                  >
                    未儲存
                  </span>
                )}
                {reviewTodoCount > 0 && (
                  <span className="review-risk-chip" style={{ background: 'var(--primary)' }}>
                    {reviewTodoCount}
                  </span>
                )}
              </button>
            </div>

            {/* 名冊選擇與唯讀提示對兩個分頁都適用，所以提到分頁列下方共用，
                不要在兩邊各放一份。 */}
            {/* 試算表模式：一個人可能有多份名冊（自己的、別人分享的），要能切換 */}
              {BACKEND_AUTH_MODE === 'google' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', background: 'rgba(8, 145, 178, 0.03)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                  <span style={{ fontSize: '14px', fontWeight: 550 }}>機構名冊：</span>
                  <select
                    className="input-field"
                    style={{ margin: 0, maxWidth: '320px' }}
                    value={selectedOrgId}
                    onChange={e => {
                      // students.length 是表格總列數，不是「改過幾筆」——
                      // 原本的訊息把它講成筆數，是錯的
                      if (!confirmDiscardChanges('切換名冊會直接丟棄這些變更')) return;
                      switchToRoster(e.target.value);
                    }}
                  >
                    {organizations.length === 0 && <option value="">（找不到名冊）</option>}
                    {organizations.map(org => (
                      <option key={org.orgId} value={org.orgId}>{org.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '12.5px', minHeight: '32px' }}
                    onClick={() => loadRosterList()}
                    type="button"
                    title="重新向 Google 雲端硬碟查一次。在 Drive 直接改過檔名、或清單載入失敗時用得到。"
                  >
                    重新整理清單
                  </button>
                  {selectedRosterUrl && (
                    <a
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '12.5px', minHeight: '32px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                      href={selectedRosterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在新分頁開啟這份試算表，可直接核對資料是否寫入"
                    >
                      在 Google 試算表開啟 ↗
                    </a>
                  )}
                  {/* 「＋ 建立名冊」不放這裡：它與「匯入名冊」是同一條動線的前後兩步，
                      放在下方人員名冊的工具列彼此相鄰。這一列只負責「切到哪一份名冊」。 */}
                  {/* 這顆按鈕直接開 Picker，不先展開一層面板再放一顆按鈕 ——
                      「名冊沒出現」這個問題的答案就是「選一次那個檔案」，
                      中間那一層只是把同一件事拆成兩下。 */}
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '12.5px', minHeight: '32px' }}
                    onClick={handlePickRoster}
                    disabled={isProcessing}
                    type="button"
                    title="從 Google 雲端硬碟選取檔案。drive.file 範圍下，本程式沒建過的檔案（別人分享給你的、或換過裝置的）必須由你親自選一次才授權得到。"
                  >
                    機構名冊沒出現？
                  </button>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    資料存放於你的 Google 雲端硬碟
                  </span>

                  {/* 成因說明與指認清單。flexBasis 100% 讓它在 flexWrap 的父層自己佔一整列。
                      **有東西要講才出現**，不掛在開關後面 —— 使用者不會先想到去按一顆
                      按鈕才知道自己的名冊為什麼不見了。 */}
                  {(rosterDiagnosis?.cause || unrecognisedRosters.length > 0) && (
                    <div style={{ flexBasis: '100%', marginTop: '2px', padding: '12px 14px', borderRadius: '8px', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {rosterDiagnosis?.cause && (
                        <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.8, color: 'var(--text-secondary)' }}>
                          {rosterDiagnosis.cause}
                          {rosterDiagnosis.action && <><br /><b>{rosterDiagnosis.action}</b></>}
                        </p>
                      )}

                      {unrecognisedRosters.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 550 }}>
                            本程式讀得到、但未被認出是名冊的試算表（{unrecognisedRosters.length} 份）：
                          </span>
                          {unrecognisedRosters.map(f => (
                            <div key={f.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '13px' }}>{f.name}</span>
                              <a
                                href={`https://docs.google.com/spreadsheets/d/${f.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: '12.5px' }}
                              >
                                先開起來看看 ↗
                              </a>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '2px 10px', fontSize: '12.5px', minHeight: '28px' }}
                                onClick={() => handleClaimRoster(f.id, f.name)}
                                disabled={isProcessing}
                                type="button"
                                title="確認結構正確後補上名冊標記，之後就會固定出現在清單裡"
                              >
                                這是我的名冊
                              </button>
                              {!f.canEdit && (
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                  （唯讀，指認只會記在這台裝置）
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                    </div>
                  )}
                </div>
              )}

              {/* 唯讀提示要在**上傳之前**就出現，而且要講清楚天花板在哪。
                  上傳、分析、下載報表整條路都只讀不寫（寫入只發生在 handleSaveToCloud，
                  那裡已經擋了 isReadOnly），所以檢視者該被允許上傳 —— 擋掉的話，
                  這段文字自己承諾的「可以統計」就兌現不了。
                  該避免的是讓人做完整趟才發現存不回去，用說明解決，不是用封鎖。 */}
              {isConfirmedReadOnly && (
                <div style={{ padding: '10px 12px', marginBottom: '12px', borderRadius: '8px', background: 'rgba(180, 83, 9, 0.08)', border: '1px solid var(--accent-red)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  這份名冊分享給你的權限是「檢視者」。你仍然可以上傳 Excel、執行統計分析並下載報表，
                  但<b>表格上的修改與分析結果都存不回雲端</b>。需要寫入請向名冊擁有者索取編輯權限。
                </div>
              )}

            {/* 積分更新工具列與摘要列是整頁層級的東西（動作影響所有人、
                徽章統計所有人），所以留在三欄版面之上，不塞進某一欄裡。 */}
            {mainTab === 'review' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
                      <Icons.Settings /> 積分更新
                    </h3>

                    {/* 上傳按鈕、檔案的來源系統、以及怎麼匯出的手冊放成一組 ——
                        這三件事是同一條動線：先去衛福部匯出、不會匯出就看手冊、
                        然後回來上傳。分散在畫面各處使用者得自己拼起來。

                        上傳只影響記憶體裡的表格，是檢視者跑統計的唯一途徑，所以唯讀也給按。 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                        <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <Icons.UploadCloud /> 上傳機構人員教育訓練積分名冊
                          <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} style={{ display: 'none' }} />
                        </label>
                        {/* 用文字連結而不是按鈕：它是「去哪裡拿檔案」的指路，
                            做成按鈕會和旁邊真正的動作搶注意力 */}
                        <a
                          className="ext-link"
                          href={MOHW_LTCPAP_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="到衛福部長照機構人力系統匯出積分名冊（另開分頁）"
                        >
                          衛福部長照機構人力系統 ↗
                        </a>
                      </div>
                      <a
                        className="ext-link"
                        href={MANUAL_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="OG100 匯出機構人員教育訓練積分名冊的操作手冊（另開分頁）"
                      >
                        使用教學（PDF）↗
                      </a>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={handleRunAnalysis}
                      disabled={isProcessing || students.length === 0 || !canRunAnalysis}
                      title={!canRunAnalysis && students.length > 0
                        ? '需要先上傳衛福部匯出的積分名冊 Excel，名冊本身不含課程明細'
                        : undefined}
                      type="button"
                    >
                      {isProcessing ? '🔄 統計處理中...' : <><Icons.Play /> 開始統計分析</>}
                    </button>

                    <button
                      className="btn btn-accent"
                      onClick={handleSaveToCloud}
                      disabled={isProcessing || students.length === 0 || isReadOnly}
                      type="button"
                    >
                      <Icons.Save /> 儲存積分到雲端{pendingMonthly ? ' ●' : ''}
                    </button>

                    {lastReport && (
                      <button
                        className="btn btn-secondary"
                        onClick={handleDownloadReport}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        type="button"
                      >
                        <Icons.Download /> 下載本次分析結果 (Excel)
                      </button>
                    )}
                  </div>

                  {/* 按鈕停用卻不說原因等於把問題藏起來 */}
                  {students.length > 0 && !canRunAnalysis && (
                    <p style={{ fontSize: '12.5px', lineHeight: 1.7, margin: 0, padding: '10px 12px', borderRadius: '8px', background: 'rgba(180, 83, 9, 0.08)', border: '1px solid var(--accent-red)', color: 'var(--text-secondary)' }}>
                      目前的資料沒有課程明細，無法計算積分。名冊只存小卡資料（姓名、職業類別、起訖日），
                      不含上課紀錄。要統計積分請上傳衛福部匯出的
                      <b>機構人員教育訓練積分名冊 Excel</b>。
                    </p>
                  )}
                </div>

                {reviewRows.length > 0 && (
                  <ReviewSummaryBar
                    rows={reviewRows}
                    hasUnsaved={!!pendingMonthly}
                    asOf={reviewAsOf}
                    riskFilter={reviewFilter}
                    onRiskFilter={setReviewFilter}
                  />
                )}
              </div>
            )}

            {/* 三欄（積分審視：名單／資料卡／日誌）或兩欄（名冊管理：名冊／日誌）。
                日誌只寫一份、放在最後一格 —— 兩個分頁各放一份會變成兩個要同步的地方。 */}
            <div className={`workspace ${mainTab === 'review' && reviewRows.length > 0 ? 'workspace-review' : 'workspace-roster'}`}>
            {mainTab === 'review' ? (
              reviewRows.length === 0 ? (
                <ReviewEmptyState />
              ) : (
                <>
                  <ReviewPersonList
                    rows={filteredReviewRows}
                    activeCardId={activeReviewRow?.cardId ?? null}
                    onSelect={setReviewCardId}
                  />
                  <ReviewPersonDetail row={activeReviewRow} />
                </>
              )
            ) : (
              // ── 名冊管理：只做人員資料的增刪改查，積分相關一律不在這裡 ──
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
                  <Icons.FolderOpen /> 機構人員名冊
                </h3>
                {/* 選到名冊時已經自動載入過，所以這顆的用途只剩「再讀一次」——
                    別人可能直接在 Google 試算表上改過內容，那是程式看不到的。 */}
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '12.5px', minHeight: '32px' }}
                  onClick={() => handleLoadOrgCards()}
                  type="button"
                  title="重新從試算表讀一次。有人直接在 Google 試算表上改過資料時用得到。"
                >
                  <Icons.FolderOpen /> 重新載入人員
                </button>

                {/* 人員名單只從這裡進來。積分 Excel 不含小卡起訖日，
                    不能拿它建人 —— 那會產生一批算不出證書年度的人員。

                    下載範本不設任何條件：它是純本機下載、不碰雲端，
                    而且「一份名冊都還沒有」正是最需要它的時候。 */}
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '12.5px', minHeight: '32px' }}
                  onClick={handleDownloadRosterTemplate}
                  type="button"
                  title="下載空白的名冊匯入範本，填好起訖日後再上傳"
                >
                  <Icons.Download /> 下載名冊範本
                </button>

                {/* 建立名冊與匯入名冊相鄰：先有名冊才寫得進人員，是連續的兩步。
                    不設任何條件 —— 一份名冊都還沒有時，這是唯一的出路。 */}
                {BACKEND_AUTH_MODE === 'google' && (
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '12.5px', minHeight: '32px' }}
                    onClick={() => { setNewRosterName(''); setShowCreateRosterModal(true); }}
                    type="button"
                    title="在你的 Google 雲端硬碟建立一份新的名冊試算表"
                  >
                    ＋ 建立名冊
                  </button>
                )}

                {/* 用 isConfirmedReadOnly 而不是 isReadOnly：後者在名冊清單還沒
                    載入完成時保守地為 true，會把建立類的按鈕藏在空狀態下 ——
                    那正是使用者最需要它們的時候。沒有名冊時會直接跳出建立名冊視窗。 */}
                {!isConfirmedReadOnly && (
                  <label
                    className="btn btn-primary"
                    style={{ padding: '4px 10px', fontSize: '12.5px', minHeight: '32px', cursor: 'pointer' }}
                    title="上傳填好的名冊範本，批次建立或更新人員"
                  >
                    <Icons.UploadCloud /> 匯入名冊
                    <input
                      type="file"
                      accept=".xlsx, .xls"
                      onChange={handleRosterImport}
                      disabled={isProcessing}
                      style={{ display: 'none' }}
                    />
                  </label>
                )}
              </div>

  

                {students.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 20px', lineHeight: 2, fontSize: '13.5px' }}>
                    這份名冊目前沒有任何人員。<br />
                    要建立人員：<b>下載名冊範本</b> → 填好資料（含小卡起訖日）→ <b>匯入名冊</b>，
                    或用「➕ 手動新增學員」逐筆建立。<br />
                    還沒有名冊也可以直接按<b>匯入名冊</b> —— 會先請你為名冊命名，再自動匯入。
                    <br />
                    {/* 這個限制一定要講清楚，否則使用者會拿積分 Excel 來試然後不懂為什麼沒人 */}
                    <span style={{ fontStyle: 'italic' }}>
                      衛福部的積分 Excel 只用來計算積分，不會新增人員 ——
                      它不含長照小卡起訖日，沒有效期就算不出證書年度。
                    </span>
                  </div>
                ) : (
                  <div>
                    {!isConfirmedReadOnly && (
                      <div style={{ marginBottom: '12px' }}>
                        <RosterActionBar
                          onAdd={() => setShowAddStudentModal(true)}
                          onSave={handleSaveToCloud}
                          saveDisabled={isProcessing || students.length === 0}
                          dirty={hasUnsavedChanges}
                        />
                      </div>
                    )}
                    {!isReadOnly && (
                      <BatchEditBar
                        selectedCount={students.filter(s => s.selected).length}
                        totalCount={students.length}
                        onToggleAll={handleToggleSelectAll}
                        onBatchDelete={handleBatchDelete}
                      />
                    )}
                    <StudentTable
                      students={students}
                      readOnly={isReadOnly}
                      dimUnselected
                      onToggleRow={handleToggleRow}
                      onFieldChange={handleFieldChange}
                      onDateChange={handleDateChange}
                      onDeleteRow={handleDeleteStudent}
                    />
                  </div>
                )}

                {/* 同樣用 isConfirmedReadOnly：一份名冊都沒有時 isReadOnly 是 true，
                    會連「手動新增學員」都藏掉，而那是空狀態下的另一條建立途徑 */}
                {!isConfirmedReadOnly && (
                  <RosterActionBar
                    onAdd={() => setShowAddStudentModal(true)}
                    onSave={handleSaveToCloud}
                    saveDisabled={isProcessing || students.length === 0}
                    dirty={hasUnsavedChanges}
                  />
                )}
              </div>
            )}

            {/* 執行日誌：兩個分頁共用，改放右側常駐欄。
                原本在主內容下方，資料卡一長就得捲到最底才看得到 ——
                而它正是「剛才那步到底做了什麼」的唯一說明。 */}
            <div className="glass-panel workspace-side workspace-log" style={{ gap: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icons.Terminal /> 執行日誌
              </h3>
              <div id="terminal-console" className="terminal-console" style={{ minHeight: '220px', maxHeight: 'calc(100vh - 160px)' }}>
                {logs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>等待操作...</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`terminal-line ${log.type}`}>
                      <span style={{ color: 'var(--text-muted)', marginRight: '8px' }}>[{log.time}]</span>
                      {log.text}
                    </div>
                  ))
                )}
              </div>
            </div>
            </div>
          </div>
        )}
      </div>

      {/* ==========================================
          MODALS & DIALOGS
          ========================================== */}

      {/* MODAL: ADD INSTITUTION */}
      {showAddOrgModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--primary)' }}>🏢 新增機構 / 單位帳號</h3>
            <form onSubmit={handleCreateOrg}>
              <div className="form-group">
                <label className="form-label">單位名稱</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="例如: 童庭居家照顧機構" 
                  value={newOrgName}
                  onChange={e => setNewOrgName(e.target.value)}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">登入電子信箱 (Email)</label>
                <input 
                  type="email" 
                  className="input-field" 
                  placeholder="org@example.com" 
                  value={newOrgEmail}
                  onChange={e => setNewOrgEmail(e.target.value)}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">角色權限</label>
                <select 
                  className="input-field" 
                  value={newOrgRole}
                  onChange={e => setNewOrgRole(e.target.value as any)}
                >
                  <option value="user">一般長照機構 (org_admin)</option>
                  <option value="auditor">區域稽查審計員 (auditor)</option>
                </select>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
                * 建檔後請提醒使用者收信進行初次密碼重設。
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddOrgModal(false)}>取消</button>
                <button type="submit" className="btn btn-primary">確定新增</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD STUDENT */}
      {showCreateRosterModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--primary)' }}>📗 建立名冊</h3>
            {pendingRosterImport && (
              <p style={{ fontSize: '13px', lineHeight: 1.7, margin: '0 0 16px 0', padding: '10px 12px', borderRadius: '8px', background: 'rgba(8, 145, 178, 0.06)', border: '1px solid var(--panel-border)', color: 'var(--text-secondary)' }}>
                你上傳的名冊檔（{pendingRosterImport.fileName}）解析出 <b>{pendingRosterImport.entries.length}</b> 位人員，
                但還沒有可以寫入的名冊。為它命名建立一份後，會自動接續匯入。
              </p>
            )}
            {pendingImport && (
              <p style={{ fontSize: '13px', lineHeight: 1.7, margin: '0 0 16px 0', padding: '10px 12px', borderRadius: '8px', background: 'rgba(8, 145, 178, 0.06)', border: '1px solid var(--panel-border)', color: 'var(--text-secondary)' }}>
                你上傳的 Excel 有 <b>{pendingImport.rows.length}</b> 筆課程明細，但還沒有可以寫入的名冊。
                為它命名建立一份後，會自動接續匯入。
              </p>
            )}
            <form onSubmit={handleCreateRoster}>
              <div className="form-group">
                <label className="form-label">名冊名稱</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="例如：童庭基金會人員名冊"
                  value={newRosterName}
                  onChange={e => setNewRosterName(e.target.value)}
                  autoFocus
                />
              </div>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 16px 0' }}>
                系統會在<b>你自己的 Google 雲端硬碟</b>建立一份同名試算表，欄位結構會自動設定好。
                要讓其他人也能查看或編輯，請到 Google 雲端硬碟用一般的分享功能授權 ——
                給「檢視者」就是唯讀，給「編輯者」才能修改。
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                {/* 取消時一定要清掉暫存，否則下次建立名冊會意外觸發這次的匯入 */}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowCreateRosterModal(false);
                    if (pendingRosterImport) {
                      setPendingRosterImport(null);
                      addLog('已取消建立名冊，這次的人員匯入也一併取消。', 'warning');
                    }
                    if (pendingImport) {
                      setPendingImport(null);
                      addLog('已取消建立名冊，這次的 Excel 匯入也一併取消。', 'warning');
                    }
                  }}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={isProcessing}>
                  {isProcessing ? '建立中…' : '建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddStudentModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--primary)' }}>👤 手動新增學員小卡</h3>
            <form onSubmit={handleManualAddStudent}>
              <div className="form-group">
                <label className="form-label">身分證字號 / 統一證號</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="例如: A123456789" 
                  value={newStudentId}
                  onChange={e => setNewStudentId(e.target.value.toUpperCase().trim())}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">學員姓名</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="王小明" 
                  value={newStudentName}
                  onChange={e => setNewStudentName(e.target.value.trim())}
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">國籍</label>
                <select 
                  className="input-field"
                  value={newStudentNationality}
                  onChange={e => setNewStudentNationality(e.target.value)}
                >
                  {NATIONALITY_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">職業類別</label>
                <select
                  className="input-field"
                  value={newStudentRole}
                  onChange={e => setNewStudentRole(e.target.value)}
                >
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">小卡生效日期</label>
                <input
                  type="text"
                  className={`input-field ${newStudentEffDate && !newStudentExpiryPreview ? 'invalid' : ''}`}
                  placeholder="例如: 112/09/01"
                  value={newStudentEffDate}
                  onChange={e => setNewStudentEffDate(e.target.value.trim())}
                  required
                />
                {/* 到期日由生效日推算（+6 年 -1 天），不讓使用者填，
                    但要在存檔前就看得到算出來的結果 */}
                <p style={{ fontSize: '13px', margin: '8px 0 0', color: newStudentExpiryPreview ? 'var(--text-secondary)' : 'var(--destructive)' }}>
                  {!newStudentEffDate
                    ? '小卡到期日會依生效日自動計算（＋6 年 −1 天）。'
                    : newStudentExpiryPreview
                      ? `小卡到期日：${newStudentExpiryPreview}（自動計算）`
                      : '無法解析這個日期。可輸入 114/08/31、1140831 或 2025-08-31。'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddStudentModal(false)}>取消</button>
                <button type="submit" className="btn btn-primary">儲存小卡</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: SMART EXCEL COLUMN MAPPER */}
      {showMapperModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <h3 style={{ margin: '0 0 8px 0', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🧭 智慧 Excel 欄位對照器
            </h3>
            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: '0 0 20px 0' }}>
              偵測到此 Excel 檔案標頭與系統預期欄位不同。請手動為下欄指定正確的對照欄位名稱，以便系統正確讀取資料：
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: '12px' }}>
                <label style={{ fontWeight: 550, fontSize: '14px' }}>學員姓名：</label>
                <select 
                  className="input-field" 
                  value={columnMapping.name}
                  onChange={e => setColumnMapping(prev => ({ ...prev, name: e.target.value }))}
                  style={{ margin: 0 }}
                >
                  <option value="">-- 請選擇 Excel 欄位 --</option>
                  {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: '12px' }}>
                <label style={{ fontWeight: 550, fontSize: '14px' }}>身分證字號：</label>
                <select 
                  className="input-field" 
                  value={columnMapping.id}
                  onChange={e => setColumnMapping(prev => ({ ...prev, id: e.target.value }))}
                  style={{ margin: 0 }}
                >
                  <option value="">-- 請選擇 Excel 欄位 --</option>
                  {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: '12px' }}>
                <label style={{ fontWeight: 550, fontSize: '14px' }}>職業類別：</label>
                <select 
                  className="input-field" 
                  value={columnMapping.role}
                  onChange={e => setColumnMapping(prev => ({ ...prev, role: e.target.value }))}
                  style={{ margin: 0 }}
                >
                  <option value="">-- 請選擇 Excel 欄位 --</option>
                  {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: '12px' }}>
                <label style={{ fontWeight: 550, fontSize: '14px' }}>國籍：</label>
                <select 
                  className="input-field" 
                  value={columnMapping.nationality}
                  onChange={e => setColumnMapping(prev => ({ ...prev, nationality: e.target.value }))}
                  style={{ margin: 0 }}
                >
                  <option value="">-- 請選擇 Excel 欄位 --</option>
                  {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: '12px' }}>
                <label style={{ fontWeight: 550, fontSize: '14px' }}>課程/上課日期：</label>
                <select 
                  className="input-field" 
                  value={columnMapping.date}
                  onChange={e => setColumnMapping(prev => ({ ...prev, date: e.target.value }))}
                  style={{ margin: 0 }}
                >
                  <option value="">-- 請選擇 Excel 欄位 --</option>
                  {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => {
                  setShowMapperModal(false);
                  addLog("❌ 智慧欄位對照已取消", 'warning');
                }}
              >
                取消上傳
              </button>
              <button type="button" className="btn btn-primary" onClick={handleApplyColumnMapping}>
                套用並解析資料
              </button>
            </div>
          </div>
        </div>
      )}

      {busy && <BusyOverlay busy={busy} />}

      {legalDoc && <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />}

      {/* 頁尾放在 app-container 之外：它是整個網站層級的東西，
          不該跟著工作區的欄寬走 */}
      <SiteFooter onOpenLegal={setLegalDoc} />
    </div>
  );
}
