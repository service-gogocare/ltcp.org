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
  getAllOrganizations,
  getStudentCardsByOrg,
  type UserSession 
} from './dbService';
import { 
  calculatePoints, 
  buildCsvRow, 
  parseExcelToPointsData, 
  extractCourseDate, 
  calculateExpiryDate, 
  calculateEffectiveDate,
  rocStrToDate,
  dateToRocStr,
  type Course
} from './calculator';
import { getFirebaseStatus } from './firebase';

interface StudentRow {
  selected: boolean;
  id: string;
  name: string;
  nationality: string;
  role: string;
  earliestDate: string;
  effectiveDate: string;
  expiryDate: string;
  rows: any[]; // Course rows
}

interface LogLine {
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
  time: string;
}

export default function App() {
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

  // Data States
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastReport, setLastReport] = useState<any[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);

  // Initialize Session on Load
  useEffect(() => {
    const session = getCurrentSession();
    if (session) {
      setUserSession(session);
    }
  }, []);

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

  // Fetch admin orgs
  useEffect(() => {
    if (userSession && userSession.role === 'admin') {
      getAllOrganizations().then(orgs => {
        setOrganizations(orgs);
        if (orgs.length > 0) {
          setSelectedOrgId(orgs[0].orgId);
        }
      }).catch(err => {
        addLog(`❌ 無法讀取機構列表: ${err.message}`, 'error');
      });
    }
  }, [userSession]);

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
    setLastReport(null);
    setOrganizations([]);
    setSelectedOrgId('');
    setLogs([]);
  };

  // File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
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
        const headers = rawJson[2] as string[];
        const rows = rawJson.slice(3).map(row => {
          const obj: any = {};
          headers.forEach((h, i) => {
            if (h) obj[h.trim()] = row[i];
          });
          return obj;
        });

        addLog(`成功載入 Excel，共讀取到 ${rows.length} 筆課程明細`);
        processExcelRows(rows);
      } catch (err: any) {
        addLog(`❌ 讀取 Excel 失敗: ${err.message}`, 'error');
        alert("讀取 Excel 檔案錯誤: " + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };

  const processExcelRows = async (rows: any[]) => {
    const sample = rows[0] || {};
    const columns = Object.keys(sample);
    const nameCol = columns.find(c => c.includes('人員姓名') || c.includes('姓名')) || '人員姓名';
    const idCol = columns.find(c => c.includes('身分證') || c.includes('ID')) || '身分證字號/\n統一證號';
    const roleCol = columns.find(c => c.includes('職業類別') || c.includes('職登類別')) || '職業類別\n職業狀態(個案管理員)';
    const nationalityCol = columns.find(c => c.includes('國籍')) || '國籍';
    const courseDateCol = columns.find(c => c.includes('課程日期') || c.includes('日期')) || '課程日期';

    // Group by ID
    const groups: { [id: string]: any[] } = {};
    rows.forEach(r => {
      const id = String(r[idCol] || "").trim();
      const name = String(r[nameCol] || "").trim();
      if (id && name) {
        if (!groups[id]) groups[id] = [];
        groups[id].push(r);
      }
    });

    const parsedStudents: StudentRow[] = [];
    addLog(`🔍 開始從資料庫檢索學員小卡起訖日...`);

    const orgId = userSession?.role === 'admin' ? selectedOrgId : (userSession?.orgId || 'org_default');

    for (const [pid, groupRows] of Object.entries(groups)) {
      const name = String(groupRows[0][nameCol] || "").trim();
      const role = String(groupRows[0][roleCol] || "").trim();
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

      // Query database for existing card dates, fallback to earliest date
      let effStr = earliestStr || dateToRocStr(new Date());
      let expStr = calculateExpiryDate(effStr);

      try {
        const dbCard = await getStudentCard(orgId, pid);
        if (dbCard && dbCard.effectiveDate) {
          effStr = dbCard.effectiveDate;
          expStr = dbCard.expiryDate || calculateExpiryDate(effStr);
          addLog(`   💾 找到學員小卡歷史設定: ${name} (${pid}) -> 生效日期:${effStr}`);
        }
      } catch (e) {
        console.error("DB Query error", e);
      }

      parsedStudents.push({
        selected: true,
        id: pid,
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
    addLog(`✓ 載入完成，共列出 ${parsedStudents.length} 位人員，已完成歷史日期自動回填`);
  };

  // Admin action: Load student cards of selected organization
  const handleLoadOrgCards = async () => {
    if (!selectedOrgId) {
      alert("請選擇機構！");
      return;
    }
    
    const orgNameSelected = organizations.find(o => o.orgId === selectedOrgId)?.name || selectedOrgId;
    addLog(`🔍 開始載入選定機構 [${orgNameSelected}] 的歷史小卡資料...`);
    
    try {
      const cards = await getStudentCardsByOrg(selectedOrgId);
      const parsed: StudentRow[] = Object.entries(cards).map(([id, card]) => ({
        selected: true,
        id,
        name: card.name,
        nationality: '臺灣',
        role: '學員',
        earliestDate: card.effectiveDate,
        effectiveDate: card.effectiveDate,
        expiryDate: card.expiryDate,
        rows: [] // Loaded from DB, no course details direct upload
      }));
      
      setStudents(parsed);
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
    setStudents(prev => prev.map(s => {
      if (s.id !== id) return s;
      
      const newRow = { ...s, [field]: value };
      
      // Auto-calculate Expiry if effectiveDate changes
      if (field === 'effectiveDate') {
        const isValid = rocStrToDate(value) !== null;
        if (isValid) {
          newRow.expiryDate = calculateExpiryDate(value);
        }
      }
      // Auto-calculate Effective Date if expiryDate changes
      if (field === 'expiryDate') {
        const isValid = rocStrToDate(value) !== null;
        if (isValid) {
          newRow.effectiveDate = calculateEffectiveDate(value);
        }
      }
      return newRow;
    }));
  };

  // Save Settings to database
  const handleSaveToCloud = async () => {
    if (students.length === 0) {
      alert("沒有可保存的資料！");
      return;
    }

    const orgId = userSession?.role === 'admin' ? selectedOrgId : (userSession?.orgId || 'org_default');
    addLog(`💾 開始保存學員設定至資料庫...`);
    let count = 0;

    try {
      for (const student of students) {
        if (!rocStrToDate(student.effectiveDate) || !rocStrToDate(student.expiryDate)) {
          throw new Error(`學員 ${student.name} (${student.id}) 的日期格式有誤，無法保存！`);
        }
        await saveStudentCard(orgId, student.id, {
          effectiveDate: student.effectiveDate,
          expiryDate: student.expiryDate,
          name: student.name
        });
        count++;
      }
      addLog(`🎉 成功保存共 ${count} 筆學員日期至資料庫，下次操作將會自動回填！`, 'success');
      alert(`已成功儲存共 ${count} 筆設定到資料庫！`);
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
      '原住民族與多元族群文化(舊)', '原住民族文化(新)', '多元族群文化(新)',
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
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h2 className="text-glow" style={{ fontSize: '28px', color: '#9333ea', margin: '0 0 8px' }}>長照積分管理系統</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>v5.0 雲端整合版</p>
          </div>

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
                    style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '12.5px', padding: 0, textDecoration: 'underline', cursor: 'pointer' }}
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
                  style={{ background: 'none', color: '#6366f1', textDecoration: 'underline', padding: '0 4px', fontSize: '13.5px' }}
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
                style={{ background: 'none', color: '#6366f1', textDecoration: 'underline', padding: '0 4px', fontSize: '13.5px' }}
                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              >
                {authMode === 'login' ? '註冊新帳號' : '切換至登入'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Dashboard View
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h2 className="text-glow" style={{ margin: 0, fontSize: '20px', color: '#9333ea' }}>長照積分查詢系統</h2>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>v5.0 Web 版</span>
          {firebaseStatus.isMock ? (
            <span className="badge badge-mock">本地 Mock 模式</span>
          ) : (
            <span className="badge badge-firebase">雲端 Firebase 連線中</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '14.5px', fontWeight: 550 }}>
            🏢 {userSession.name} ({userSession.email})
          </span>
          <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={handleLogout}>
            安全登出
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="app-container">
        <div className="app-grid">
          {/* Left Panel: Excel Loader and Table */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Super Admin Control Section */}
            {userSession.role === 'admin' && (
              <div style={{
                border: '1px solid rgba(147, 51, 234, 0.3)',
                background: 'rgba(147, 51, 234, 0.05)',
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '10px'
              }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#a855f7', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  👑 超級管理員控制面板
                </h4>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>選擇管理機構：</span>
                  <select 
                    value={selectedOrgId} 
                    onChange={e => {
                      setSelectedOrgId(e.target.value);
                      setStudents([]);
                    }}
                    style={{
                      flexGrow: 1,
                      background: 'rgba(30, 27, 75, 0.7)',
                      color: 'var(--text-primary)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      padding: '6px 10px',
                      fontSize: '14px',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {organizations.length === 0 ? (
                      <option value="">載入機構中...</option>
                    ) : (
                      organizations.map(org => (
                        <option key={org.orgId} value={org.orgId}>{org.name}</option>
                      ))
                    )}
                  </select>
                  <button 
                    className="btn btn-secondary" 
                    style={{ padding: '6px 12px', fontSize: '13px' }}
                    onClick={handleLoadOrgCards}
                    disabled={!selectedOrgId}
                  >
                    📂 載入機構小卡
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>📂 載入衛福部匯出名冊 Excel</h3>
              {students.length > 0 && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12.5px' }} onClick={() => handleToggleSelectAll(true)}>全選</button>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '12.5px' }} onClick={() => handleToggleSelectAll(false)}>取消全選</button>
                </div>
              )}
            </div>

            {students.length === 0 ? (
              <label className="uploader-card">
                <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} style={{ display: 'none' }} />
                <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>📤</span>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>選擇或拖曳 Excel 檔案上傳</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>支援衛福部機構人員教育訓練積分名冊 Excel</span>
              </label>
            ) : (
              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px', textAlign: 'center' }}>選取</th>
                      <th>姓名</th>
                      <th style={{ width: '70px' }}>國籍</th>
                      <th>身分證號</th>
                      <th>職業類別</th>
                      <th style={{ textAlign: 'center' }}>生效日期</th>
                      <th style={{ textAlign: 'center' }}>小卡到期日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => {
                      const isEffValid = rocStrToDate(student.effectiveDate) !== null;
                      const isExpValid = rocStrToDate(student.expiryDate) !== null;
                      
                      return (
                        <tr key={student.id} style={{ opacity: student.selected ? 1 : 0.45 }}>
                          <td style={{ textAlign: 'center' }}>
                            <label className="checkbox-container">
                              <input 
                                type="checkbox" 
                                checked={student.selected} 
                                onChange={e => {
                                  setStudents(prev => prev.map(s => s.id === student.id ? { ...s, selected: e.target.checked } : s));
                                }}
                              />
                              <span className="checkmark"></span>
                            </label>
                          </td>
                          <td style={{ fontWeight: 600 }}>{student.name}</td>
                          <td>{student.nationality}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{student.id}</td>
                          <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                            {student.role.length > 10 ? student.role.substring(0, 10) + '..' : student.role}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <input 
                              type="text" 
                              className={`table-input ${!isEffValid ? 'invalid' : ''}`}
                              value={student.effectiveDate}
                              onChange={e => handleDateChange(student.id, 'effectiveDate', e.target.value)}
                              placeholder="112/09/01"
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <input 
                              type="text" 
                              className={`table-input ${!isExpValid ? 'invalid' : ''}`}
                              value={student.expiryDate}
                              onChange={e => handleDateChange(student.id, 'expiryDate', e.target.value)}
                              placeholder="118/08/31"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {students.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <label className="btn btn-secondary" style={{ cursor: 'pointer', fontSize: '13px' }}>
                  重新上傳其他 Excel
                  <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>
              </div>
            )}
          </div>

          {/* Right Panel: Control panel and Logs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Control card */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>⚡ 統計分析控制台</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <button 
                  className="btn btn-primary" 
                  onClick={handleRunAnalysis}
                  disabled={isProcessing || students.length === 0}
                >
                  {isProcessing ? '🔄 統計處理中...' : '🚀 開始統計分析'}
                </button>
                
                <button 
                  className="btn btn-accent" 
                  onClick={handleSaveToCloud}
                  disabled={isProcessing || students.length === 0}
                >
                  💾 儲存設定到雲端
                </button>
              </div>

              {lastReport && (
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', border: '1px solid rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.05)' }}
                  onClick={() => downloadReportExcel(lastReport, '長照積分統計報告.xlsx')}
                >
                  📥 下載上一次統計的 Excel
                </button>
              )}
            </div>

            {/* Log Console card */}
            <div className="glass-panel" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>📟 執行日誌</h3>
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
      </div>
    </div>
  );
}
