import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  loginUser, 
  registerUser, 
  logoutUser, 
  getCurrentSession, 
  getStudentCard, 
  saveStudentCard, 
  sendPasswordReset,
  getAllAccounts,
  isRealOrganization,
  getStudentCardsByOrg,
  getAuditLogs,
  updateOrgStatus,
  deleteOrganizationCascade,
  deleteStudentCard,
  adminCreateOrg,
  writeAuditLog,
  type UserSession 
} from './dbService';
import { 
  calculatePoints, 
  buildCsvRow, 
  parseExcelToPointsData, 
  extractCourseDate, 
  calculateExpiryDate, 
  rocStrToDate,
  dateToRocStr,
  type Course
} from './calculator';
import { getFirebaseStatus } from './firebase';
import { StudentTable, BatchEditBar } from './StudentTable';
import {
  ROLE_OPTIONS,
  NATIONALITY_OPTIONS,
  type EditableField,
  type StudentRow,
} from './studentFields';
import {
  applyFieldChange,
  applyDateChange,
  applyToSelected,
  buildSavePlan,
  buildDeletePlan,
  describeDeletePlan,
} from './cardPlan';

export function normalizeRole(roleStr: string): string {
  const s = String(roleStr || '').trim();
  if (s.includes('居家服務督導') || s.includes('居家督導') || s.includes('居督')) {
    return '居家服務督導員';
  }
  if (s.includes('照顧服務') || s.includes('照服')) {
    return '照顧服務人員';
  }
  if (s.includes('個案管理') || s.includes('個管')) {
    return '個案管理人員';
  }
  if (s.includes('照顧管理') || s.includes('照管')) {
    return '照顧管理人員';
  }
  if (s.includes('專業服務') || s.includes('社工') || s.includes('護理') || s.includes('醫師') || s.includes('治療師') || s.includes('物理治療') || s.includes('職能治療')) {
    return '專業服務人員';
  }
  return '照顧服務人員'; // fallback
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
  const [firebaseStatus] = useState(getFirebaseStatus());
  
  // Admin State
  const [organizations, setOrganizations] = useState<{ orgId: string; name: string }[]>([]);
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
  const [lastReport, setLastReport] = useState<any[] | null>(null);
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

  const loadAdminData = async () => {
    try {
      // 帳號列表含稽查員，讓它們可以被檢視／停用／刪除；
      // 機構下拉選單與到期統計只算真實機構（稽查員沒有學員小卡）。
      const accounts = await getAllAccounts();
      const orgs = accounts.filter(isRealOrganization);

      setOrganizationsInfo(accounts);
      setOrganizations(orgs.map(o => ({ orgId: o.orgId, name: o.name })));

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

  // Fetch admin data on session load or admin tab switch
  useEffect(() => {
    const isAuthorized = userSession && (userSession.role === 'admin' || userSession.role === 'super_admin' || userSession.role === 'auditor');
    if (isAuthorized) {
      loadAdminData();
    }
  }, [userSession, adminTab]);

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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await sendPasswordReset(email);
      if (res.isMock) {
        alert(`[Mock 模式提示]\n已成功模擬寄送重設郵件！\n\n重設連結為：\n${res.link}\n\n(在真實 Firebase 模式下，使用者將會在信箱收到真正的密碼重設信件)`);
      } else {
        alert("重設密碼信件已寄出，請至信箱收取！");
      }
      addLog(`✉️ 已寄出密碼重設信件至: ${email}`, 'success');
      setAuthMode('login');
    } catch (err: any) {
      alert("發送重設信件失敗: " + err.message);
      addLog(`❌ 重設密碼失敗: ${err.message}`, 'error');
    }
  };

  const handleLogout = async () => {
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

  // NEW: Manual Add Student Card Handler
  const handleManualAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const orgId = userSession?.role === 'admin' || userSession?.role === 'super_admin' ? selectedOrgId : (userSession?.orgId || 'org_default');
    
    if (!orgId) {
      alert("請先選擇機構！");
      return;
    }
    if (!newStudentId || !newStudentName || !newStudentEffDate) {
      alert("請填寫必要欄位！");
      return;
    }

    try {
      const compositeId = newStudentId + "_" + newStudentRole;
      const expDate = calculateExpiryDate(newStudentEffDate);
      await saveStudentCard(orgId, compositeId, {
        name: newStudentName,
        effectiveDate: newStudentEffDate,
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
            earliestDate: newStudentEffDate,
            effectiveDate: newStudentEffDate,
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
          effectiveDate: newStudentEffDate,
          expiryDate: expDate
        };
        return next;
      });
    } catch (err: any) {
      alert("新增學員失敗: " + err.message);
    }
  };

  /**
   * 目前要操作哪個機構：管理者／稽查員用下拉選的機構，機構帳號一律是自己的 orgId。
   * 舊寫法在取不到時會退回 'org_default'，那會把資料寫進一個共用機構；
   * 這裡回傳空字串，由呼叫端擋下來。
   */
  const resolveWorkingOrgId = (): string => {
    const role = userSession?.role;
    if (role === 'admin' || role === 'super_admin' || role === 'auditor') return selectedOrgId;
    return userSession?.orgId || '';
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
    const { name, id, role, nationality, date } = columnMapping;
    if (!name || !id || !role || !nationality || !date) {
      alert("請為所有欄位選擇對應的 Excel 標頭！");
      return;
    }

    localStorage.setItem('ltcp_saved_mapping', JSON.stringify(columnMapping));
    setShowMapperModal(false);

    addLog(`✓ 套用欄位對應設定，開始解析 ${pendingExcelRows.length} 筆課程資料`);
    processExcelRows(pendingExcelRows, name, id, role, nationality, date);
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

        if (nameCol && idCol && roleCol && nationalityCol && courseDateCol) {
          addLog(`成功載入 Excel，共讀取到 ${rows.length} 筆課程明細`);
          processExcelRows(rows, nameCol, idCol, roleCol, nationalityCol, courseDateCol);
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
    nationalityCol: string, 
    courseDateCol: string
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

    const parsedStudents: StudentRow[] = [];
    addLog(`🔍 開始從資料庫檢索學員小卡起訖日...`);

    const orgId = userSession?.role === 'admin' || userSession?.role === 'super_admin' ? selectedOrgId : (userSession?.orgId || 'org_default');

    for (const [compositeKey, groupRows] of Object.entries(groups)) {
      const parts = compositeKey.split("_");
      const pid = parts[0];
      const role = parts[1];
      const name = String(groupRows[0][nameCol] || "").trim();
      const nationality = String(groupRows[0][nationalityCol] || "臺灣").trim();

      // Find earliest course date
      let earliestDt: Date | null = null;
      groupRows.forEach(row => {
        const rawDate = row[courseDateCol];
        if (rawDate) {
          const dtStr = extractCourseDate(rawDate);
          if (dtStr) {
            const dt = rocStrToDate(dtStr);
            if (dt) {
              if (!earliestDt || dt < earliestDt) earliestDt = dt;
            }
          }
        }
      });
      const earliestStr = earliestDt ? dateToRocStr(earliestDt) : "";

      // Query database using compositeKey
      let effStr = earliestStr || dateToRocStr(new Date());
      let expStr = calculateExpiryDate(effStr);
      let existingDocId: string | undefined;

      try {
        const dbCard = await getStudentCard(orgId, compositeKey);
        if (dbCard && dbCard.effectiveDate) {
          effStr = dbCard.effectiveDate;
          expStr = dbCard.expiryDate || calculateExpiryDate(effStr);
          existingDocId = compositeKey;
          addLog(`   💾 找到學員小卡歷史設定: ${name} (${pid} - ${role}) -> 生效日期:${effStr}`);
        } else {
          // 複合鍵查不到時再試舊制文件 ID（只有身分證號，3e2c752 之前的寫法）。
          // 少了這段回退，換 key 後每個人都會被當成新學員，生效日就被
          // 「最早課程日期」重新發明一次 —— 童庭 41 筆錯誤日期就是這樣來的。
          const legacyCard = await getStudentCard(orgId, pid);
          if (legacyCard && legacyCard.effectiveDate) {
            effStr = legacyCard.effectiveDate;
            expStr = legacyCard.expiryDate || calculateExpiryDate(effStr);
            existingDocId = pid;
            addLog(`   💾 找到舊制小卡設定: ${name} (${pid}) -> 生效日期:${effStr}（儲存時會搬到 ${compositeKey}）`, 'warning');
          }
        }
      } catch (e) {
        console.error("DB Query error", e);
      }

      parsedStudents.push({
        selected: true,
        id: compositeKey,
        originalId: existingDocId,
        studentId: pid,
        name,
        nationality,
        role,
        earliestDate: earliestStr,
        effectiveDate: effStr,
        expiryDate: expStr,
        rows: groupRows
      });
    }

    setStudents(parsedStudents);
    setHasUnsavedChanges(true);
    addLog(`✓ 載入完成，共列出 ${parsedStudents.length} 位人員，已完成歷史日期自動回填`);
  };

  // Admin action: Load student cards of selected organization
  const handleLoadOrgCards = async () => {
    // 機構帳號沒有下拉選單，載入的一律是自己機構的資料
    const targetOrgId = resolveWorkingOrgId();
    if (!targetOrgId) {
      alert("請選擇機構！");
      return;
    }

    if (hasUnsavedChanges && students.length > 0) {
      const ok = window.confirm(
        `目前表格中有 ${students.length} 筆尚未儲存至雲端的變更。`
        + `\n重新載入會直接丟棄這些變更，且無法復原。\n\n確定要載入嗎？`
      );
      if (!ok) return;
    }

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
        addLog(`⚠️ 此機構目前尚無任何儲存的小卡資料，請上傳 Excel 新增之。`, 'warning');
      }
    } catch (err: any) {
      alert("載入小卡資料失敗: " + err.message);
      addLog(`❌ 載入失敗: ${err.message}`, 'error');
    }
  };

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

  /** 對已勾選的列套用同一個姓名／國籍／職業類別 */
  const handleBatchField = (field: EditableField, value: string) => {
    const count = students.filter(s => s.selected).length;
    if (count === 0) return;
    setHasUnsavedChanges(true);
    setStudents(prev => applyToSelected(prev, s => applyFieldChange(s, field, value)));
    const label = field === 'role' ? '職業類別' : field === 'nationality' ? '國籍' : '姓名';
    addLog(`✏️ 已對 ${count} 筆套用${label}：${value}（尚未儲存至雲端）`, 'info');
  };

  /** 對已勾選的列套用同一個生效日或到期日，另一個日期依 6 年規則自動換算 */
  const handleBatchDate = (field: 'effectiveDate' | 'expiryDate', value: string) => {
    const count = students.filter(s => s.selected).length;
    if (count === 0) return;
    setHasUnsavedChanges(true);
    setStudents(prev => applyToSelected(prev, s => applyDateChange(s, field, value)));
    addLog(`📅 已對 ${count} 筆套用${field === 'effectiveDate' ? '生效日' : '到期日'} ${value}（另一個日期自動換算，尚未儲存至雲端）`, 'info');
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

    addLog(`🗑 開始批次刪除 ${total} 筆人員資料...`);
    // 用列 ID 記錄失敗者，不要用姓名比對 —— 同名或姓名互為前綴時會判錯
    const failedRowIds = new Set<string>();
    const failedMessages: string[] = [];
    for (const target of plan.inCloud) {
      try {
        await deleteStudentCard(orgId, target.docId);
      } catch (err) {
        failedRowIds.add(target.rowId);
        failedMessages.push(`${target.name}（${err instanceof Error ? err.message : String(err)}）`);
      }
    }

    // 雲端刪除失敗的列要留在表格上，否則使用者會以為已經刪掉了
    setStudents(prev => prev.filter(s => !s.selected || failedRowIds.has(s.id)));

    if (failedMessages.length > 0) {
      addLog(`❌ 有 ${failedMessages.length} 筆刪除失敗：${failedMessages.join('、')}`, 'error');
      alert(`有 ${failedMessages.length} 筆刪除失敗，仍留在表格中：\n${failedMessages.join('\n')}`);
    } else {
      addLog(`✓ 已刪除 ${total} 筆（雲端 ${plan.inCloud.length} 筆）`, 'success');
    }
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
    const { writes, rekeys } = result.plan;

    addLog(`💾 開始保存學員設定至資料庫...`);
    let count = 0;

    try {
      for (const write of writes) {
        await saveStudentCard(orgId, write.docId, write.record);
        count++;
      }
      // 職業類別被改過的：先寫入新 key（上面那圈）再刪舊 key，
      // 順序反過來的話中途失敗就會整筆資料消失。
      for (const rekey of rekeys) {
        await deleteStudentCard(orgId, rekey.from);
        addLog(`   🔀 ${rekey.name}：${rekey.from} → ${rekey.to}`);
      }
      // 寫入成功後 originalId 就等於現在的 id，否則再按一次儲存會去刪一份已經不存在的文件
      setStudents(prev => prev.map(s => ({ ...s, originalId: s.id })));
      setHasUnsavedChanges(false);
      const rekeyNote = rekeys.length > 0 ? `，其中 ${rekeys.length} 筆因職業類別變更而搬移了文件` : '';
      addLog(`🎉 成功保存共 ${count} 筆學員資料至資料庫${rekeyNote}，下次操作將會自動回填！`, 'success');
      alert(`已成功儲存共 ${count} 筆設定到資料庫！${rekeyNote}`);
      if (userSession?.role === 'admin' || userSession?.role === 'super_admin') loadAdminData();
    } catch (err: any) {
      alert(err.message);
      addLog(`❌ 保存資料失敗: ${err.message}`, 'error');
    }
  };

  // Run Calculations
  const handleRunAnalysis = () => {
    const selectedStudents = students.filter(s => s.selected);
    if (selectedStudents.length === 0) {
      alert("請至少勾選一名人員進行分析！");
      return;
    }

    setIsProcessing(true);
    addLog("--- 開始進行積分統計分析 ---");
    
    const resultsList: any[] = [];
    let currentIndex = 0;

    const interval = setInterval(() => {
      if (currentIndex >= selectedStudents.length) {
        clearInterval(interval);
        setIsProcessing(false);
        setLastReport(resultsList);
        addLog(`🎉 全部任務處理完畢。共完成 ${resultsList.length} 筆人員分析。`, 'success');
        
        // Trigger Excel download
        const timestamp = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '');
        downloadReportExcel(resultsList, `長照積分統計分析_${timestamp}.xlsx`);
        return;
      }

      const student = selectedStudents[currentIndex];
      addLog(`👤 [${currentIndex + 1}/${selectedStudents.length}] 正在統計: ${student.name} (${student.id})...`);

      // Execute local calculation
      const pointsData = parseExcelToPointsData(student.rows, student.effectiveDate, student.expiryDate);
      const results = calculatePoints(pointsData, courses);
      
      const csvRow = buildCsvRow(student.id, pointsData, results);
      csvRow['姓名'] = student.name;
      csvRow['國籍'] = student.nationality;
      csvRow['職業類別'] = student.role;
      csvRow['_recommendedCoursesList'] = results.recommendedCoursesList;

      resultsList.push(csvRow);
      addLog(`   ✓ 統計完成: 總積分 ${results.totalPoints} (${results.attentionNotes})`);

      currentIndex++;
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

  // Authentication View
  if (!userSession) {
    return (
      <div className="auth-container">
        <div className="glass-panel auth-card">
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <h2 className="text-glow" style={{ fontSize: '28px', color: 'var(--primary)', margin: '0 0 8px' }}>長照積分管理系統</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              v5.0 {firebaseStatus.isMock ? '本地測試版' : '雲端整合版'}
            </p>
            <div style={{ marginTop: '10px' }}>
              {firebaseStatus.fatalError ? (
                <span className="badge badge-mock" style={{ fontSize: '12px', padding: '4px 10px' }}>
                  後端未就緒
                </span>
              ) : firebaseStatus.isMock ? (
                <span className="badge badge-mock" style={{ fontSize: '12px', padding: '4px 10px' }}>
                  目前：本地 Mock 模式
                </span>
              ) : (
                <span className="badge badge-firebase" style={{ fontSize: '12px', padding: '4px 10px' }}>
                  目前：Firebase 雲端模式
                </span>
              )}
            </div>
          </div>

          {firebaseStatus.fatalError && (
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
              {firebaseStatus.fatalError}
            </div>
          )}

          {authMode !== 'forgot' ? (
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

          {authMode !== 'forgot' && (
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

          {/* Mode Switch Toggle：僅開發環境可見，正式站不提供切換到 Mock 的入口 */}
          {import.meta.env.DEV && (
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--panel-border)', textAlign: 'center', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>測試或正式切換？</span>
              <button
                type="button"
                className="btn"
                style={{ background: 'none', color: 'var(--primary)', textDecoration: 'underline', padding: '0 4px', fontSize: '13px', minHeight: 'unset' }}
                onClick={() => {
                  const current = localStorage.getItem("ltcp_force_mock") === "true";
                  localStorage.setItem("ltcp_force_mock", current ? "false" : "true");
                  window.location.reload();
                }}
              >
                {firebaseStatus.isMock ? "切換至 Firebase 雲端模式" : "切換至本地 Mock 測試模式"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Check if current user is admin/super_admin/auditor
  const isAdminRole = userSession && (userSession.role === 'admin' || userSession.role === 'super_admin' || userSession.role === 'auditor');

  // Dashboard View (Conditional Rendering)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h2 className="text-glow" style={{ margin: 0, fontSize: '20px', color: 'var(--primary)' }}>長照積分查詢系統</h2>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>v5.0 Web 版</span>
          {firebaseStatus.isMock ? (
            <span className="badge badge-mock">本地 Mock 模式</span>
          ) : (
            <span className="badge badge-firebase">雲端 Firebase 連線中</span>
          )}
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
                    onClick={handleLoadOrgCards}
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
                        onBatchField={handleBatchField}
                        onBatchDate={handleBatchDate}
                        onBatchDelete={handleBatchDelete}
                      />
                    )}

                    <StudentTable
                      students={students}
                      readOnly={userSession.role === 'auditor'}
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
          <div className="app-grid">
            {/* Left Panel: Excel Loader and Table */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icons.FolderOpen /> 機構人員名冊
                </h3>
                {/* 不必先上傳 Excel 也能維護既有人員資料 */}
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '12.5px', minHeight: '32px' }}
                  onClick={handleLoadOrgCards}
                  type="button"
                >
                  <Icons.FolderOpen /> 載入本機構已建人員
                </button>
              </div>

              {students.length === 0 ? (
                <label className="uploader-card">
                  <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} style={{ display: 'none' }} />
                  <Icons.UploadCloud />
                  <span style={{ fontWeight: 600, display: 'block', margin: '4px 0 2px' }}>選擇或拖曳 Excel 檔案上傳</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>支援衛福部機構人員教育訓練積分名冊 Excel</span>
                </label>
              ) : (
                <div>
                  <BatchEditBar
                    selectedCount={students.filter(s => s.selected).length}
                    totalCount={students.length}
                    onToggleAll={handleToggleSelectAll}
                    onBatchField={handleBatchField}
                    onBatchDate={handleBatchDate}
                    onBatchDelete={handleBatchDelete}
                  />
                  <StudentTable
                    students={students}
                    readOnly={false}
                    dimUnselected
                    onToggleRow={handleToggleRow}
                    onFieldChange={handleFieldChange}
                    onDateChange={handleDateChange}
                    onDeleteRow={handleDeleteStudent}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                {students.length > 0 && (
                  <label className="btn btn-secondary" style={{ cursor: 'pointer', fontSize: '13px' }}>
                    重新上傳其他 Excel
                    <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                )}
                <button className="btn btn-primary" onClick={() => setShowAddStudentModal(true)}>
                  ➕ 手動新增學員
                </button>
              </div>
            </div>

            {/* Right Panel: Control panel and Logs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Control card */}
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icons.Settings /> 統計分析控制台
                </h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={handleRunAnalysis}
                    disabled={isProcessing || students.length === 0}
                    type="button"
                  >
                    {isProcessing ? '🔄 統計處理中...' : <><Icons.Play /> 開始統計分析</>}
                  </button>
                  
                  <button 
                    className="btn btn-accent" 
                    onClick={handleSaveToCloud}
                    disabled={isProcessing || students.length === 0}
                    type="button"
                  >
                    <Icons.Save /> 儲存設定到雲端{hasUnsavedChanges ? ' ●' : ''}
                  </button>
                </div>

                {lastReport && (
                  <button 
                    className="btn btn-secondary" 
                    style={{ width: '100%', border: '1px solid var(--panel-border)', background: 'rgba(8, 145, 178, 0.05)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    onClick={() => downloadReportExcel(lastReport, '長照積分統計報告.xlsx')}
                    type="button"
                  >
                    <Icons.Download /> 下載本次分析結果 (Excel)
                  </button>
                )}
              </div>

              {/* Log Console card */}
              <div className="glass-panel" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icons.Terminal /> 執行日誌
                </h3>
                <div id="terminal-console" className="terminal-console" style={{ flexGrow: 1, minHeight: '260px' }}>
                  {logs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>等待上傳名冊名單並開始分析...</div>
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
                * 本地測試預設密碼為 <b>password</b>。真實雲端環境建檔後，請提醒使用者收信進行初次密碼重設。
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
                  className="input-field" 
                  placeholder="例如: 112/09/01" 
                  value={newStudentEffDate}
                  onChange={e => setNewStudentEffDate(e.target.value.trim())}
                  required 
                />
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
    </div>
  );
}
