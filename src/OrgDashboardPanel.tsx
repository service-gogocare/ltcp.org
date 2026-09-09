/**
 * 機構儀表板
 * ---------------------------------------------------------------------------
 * 與「人員積分審視」的分工要清楚，否則兩個畫面會慢慢長成同一個東西：
 *
 *   - 人員積分審視：**一次看一個人**。合規判定、逐月曲線、他該補什麼。
 *   - 這裡：**機構層級的決策**。掃視全員、排換證時程、決定這個月開哪門課。
 *
 * 所以這裡刻意不放個別的曲線圖與逐年檢核細節 —— 要看那些就點名字跳過去，
 * 由 onInspect 接手。重複呈現的話使用者不知道該相信哪一邊，而且兩邊會漂移。
 *
 * 純呈現：props 進 JSX 出，不 import dbService、不做 async。所有聚合都在
 * orgDashboard.ts（有 24 個測試），這裡只把結果攤成 DOM。
 */
import { useState } from 'react';
import { TOTAL_POINTS_REQUIRED } from './calculator';
import { RISK_ORDER, type ReviewRow } from './monthlyReview';
import { RISK_META } from './riskDisplay';
import { maskStudentId } from './studentFields';
import type { RecommendedCourseGroup } from './recommendedCourses';
import {
  summariseOrg,
  buildExpirySchedule,
  collectExceptions,
  shortfallLabels,
  sortOverview,
  type OverviewSortKey,
} from './orgDashboard';

/** 一次最多列幾門推薦課程。全部展開通常是幾十門，掃視反而困難 */
const COURSE_PREVIEW = 8;

function Panel({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '17px' }}>{title}</h3>
        {hint && (
          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.7 }}>
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/** 一組人名，超過門檻就折起來。到期時程與例外清單共用 */
function NameList({ rows, onInspect }: { rows: ReviewRow[]; onInspect: (cardId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 12;
  const shown = expanded ? rows : rows.slice(0, LIMIT);

  if (rows.length === 0) {
    return <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>—</span>;
  }

  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'baseline' }}>
      {shown.map((row) => (
        <button
          key={row.cardId}
          type="button"
          className="ext-link"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '13px' }}
          onClick={() => onInspect(row.cardId)}
          title={`看 ${row.name} 的明細`}
        >
          {row.name}
        </button>
      ))}
      {rows.length > LIMIT && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '1px 8px', fontSize: '11.5px', minHeight: '22px' }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : `還有 ${rows.length - LIMIT} 位`}
        </button>
      )}
    </span>
  );
}

export function OrgDashboard({
  rows, courseGroups, hasUnsaved, asOf, onInspect,
}: {
  rows: ReviewRow[];
  /** 依人數排序的推薦課程，來自 groupRecommendedCourses */
  courseGroups: RecommendedCourseGroup[];
  /** 目前顯示的內容含尚未儲存到雲端的分析結果 */
  hasUnsaved: boolean;
  asOf: Date;
  /** 點人名跳到「人員積分審視」並選中他 */
  onInspect: (cardId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<OverviewSortKey>('risk');

  if (rows.length === 0) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '15px', marginBottom: '8px' }}>這份名冊還沒有可以統計的人員。</div>
        <div style={{ fontSize: '13px', lineHeight: 1.8 }}>
          先在「📋 人員名冊管理」載入或建立人員，儀表板就會顯示全機構的積分狀況。
        </div>
      </div>
    );
  }

  const summary = summariseOrg(rows);
  const schedule = buildExpirySchedule(rows);
  const exceptions = collectExceptions(rows);
  const sorted = sortOverview(rows, sortKey, RISK_ORDER);
  const courses = courseGroups.slice(0, COURSE_PREVIEW);

  const sortButton = (key: OverviewSortKey, label: string) => (
    <button
      type="button"
      className="btn btn-secondary"
      style={{
        padding: '2px 10px', fontSize: '12px', minHeight: '26px',
        ...(sortKey === key ? { borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 650 } : {}),
      }}
      onClick={() => setSortKey(key)}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {hasUnsaved && (
        <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(180, 83, 9, 0.08)', border: '1px solid var(--accent-red)', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
          ● 以下含本次分析尚未儲存到雲端的結果。重新整理頁面就會消失，記得按「儲存積分到雲端」。
        </div>
      )}

      {/* ── 總覽數字 ───────────────────────────────────────── */}
      <div className="bento-grid" style={{ marginBottom: 0, gap: '12px' }}>
        <div className="bento-card" style={{ padding: '16px 18px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>名冊人數</span>
          <span className="bento-card-val" style={{ fontSize: '28px' }}>{summary.total}</span>
        </div>
        <div className="bento-card" style={{ padding: '16px 18px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>換證條件全部達標</span>
          <span className="bento-card-val" style={{ fontSize: '28px', color: 'var(--accent-green)' }}>
            {summary.met}
            <span style={{ fontSize: '15px', fontFamily: 'var(--sans)', color: 'var(--text-muted)' }}> / {summary.total}</span>
          </span>
        </div>
        <div className="bento-card" style={{ padding: '16px 18px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>需要處理</span>
          <span className="bento-card-val" style={{ fontSize: '28px', color: summary.todo > 0 ? 'var(--destructive)' : 'var(--accent-green)' }}>
            {summary.todo}
          </span>
        </div>
        <div className="bento-card" style={{ padding: '16px 18px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            全機構進度
            <span title="總實得 ÷ 總應達。不是每個人的百分比再平均 —— 那會讓剛入職、應達只有幾分的人把整體拉高。">
              {' '}ⓘ
            </span>
          </span>
          <span className="bento-card-val" style={{ fontSize: '28px' }}>
            {summary.progressPercent === null ? '—' : `${summary.progressPercent}%`}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {summary.progressPercent === null
              ? '沒有人算得出應達進度'
              : `實得 ${summary.earnedSum} / 應達 ${summary.expectedSum} 分`}
          </span>
        </div>
      </div>

      {/* ── 最多人需要的課程 ───────────────────────────────── */}
      <Panel
        title="最多人需要的課程"
        hint={
          '依「開這門課能幫到幾個人」排序 —— 那是開班決策真正要的數字。'
          + '「字號審核期間」取自課程目錄，是該課程認可字號的有效期間。'
        }
      >
        {courses.length === 0 ? (
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.8 }}>
            目前沒有可推薦的課程。可能是所有人都已達標，或課程目錄還沒載入完成
            —— 課程目錄是登入後從 Google Sheet 抓的。
          </span>
        ) : (
          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>課程名稱</th>
                  <th style={{ width: '150px' }}>積分</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>人數</th>
                  <th style={{ width: '130px' }}>字號審核期間</th>
                  <th>上課名單</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((group) => (
                  <tr key={group.url}>
                    <td>
                      {group.url ? (
                        <a href={group.url} target="_blank" rel="noopener noreferrer" className="ext-link">
                          {group.name} ↗
                        </a>
                      ) : group.name}
                    </td>
                    <td style={{ fontSize: '12.5px' }}>{group.creditsLabel}</td>
                    <td style={{ textAlign: 'center', fontWeight: 650 }}>{group.students.length}</td>
                    <td style={{ fontSize: '12.5px' }}>{group.date || '—'}</td>
                    <td style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                      {group.students.join('、')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {courseGroups.length > COURSE_PREVIEW && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            另有 {courseGroups.length - COURSE_PREVIEW} 門課程未列出。完整清單在試算表的「推薦課程彙總」分頁。
          </span>
        )}
      </Panel>

      {/* ── 到期時程 ───────────────────────────────────────── */}
      <Panel title="換證時程" hint={`依小卡到期日分組，基準日 ${asOf.toLocaleDateString('zh-TW')}。點人名可看該員明細。`}>
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th style={{ width: '190px' }}>期間</th>
                <th style={{ width: '70px', textAlign: 'center' }}>人數</th>
                <th>人員</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((bucket) => (
                <tr key={bucket.key}>
                  <td style={{ fontWeight: bucket.rows.length > 0 ? 600 : 400, color: bucket.rows.length === 0 ? 'var(--text-muted)' : undefined }}>
                    {bucket.label}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 650, color: bucket.key === 'expired' && bucket.rows.length > 0 ? 'var(--destructive)' : undefined }}>
                    {bucket.rows.length}
                  </td>
                  <td><NameList rows={bucket.rows} onInspect={onInspect} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── 需要處理的例外 ─────────────────────────────────── */}
      <Panel
        title="需要處理的例外"
        hint="三類的處置完全不同，所以分開列。同一個人可能同時出現在兩類。"
      >
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th style={{ width: '190px' }}>狀況</th>
                <th style={{ width: '70px', textAlign: 'center' }}>人數</th>
                <th style={{ width: '230px' }}>該做什麼</th>
                <th>人員</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>小卡起訖日待補</td>
                <td style={{ textAlign: 'center', fontWeight: 650, color: exceptions.pendingDates.length > 0 ? 'var(--accent-red)' : undefined }}>
                  {exceptions.pendingDates.length}
                </td>
                <td style={{ fontSize: '12.5px' }}>到「人員名冊管理」補起訖日並儲存。沒有效期什麼都算不出來。</td>
                <td><NameList rows={exceptions.pendingDates} onInspect={onInspect} /></td>
              </tr>
              <tr>
                <td>尚未統計</td>
                <td style={{ textAlign: 'center', fontWeight: 650, color: exceptions.notAnalysed.length > 0 ? 'var(--accent-red)' : undefined }}>
                  {exceptions.notAnalysed.length}
                </td>
                <td style={{ fontSize: '12.5px' }}>到「人員積分審視」上傳積分名冊並執行統計分析。不是沒上課，是沒資料。</td>
                <td><NameList rows={exceptions.notAnalysed} onInspect={onInspect} /></td>
              </tr>
              <tr>
                <td>需重新計算</td>
                <td style={{ textAlign: 'center', fontWeight: 650, color: exceptions.needsRecompute.length > 0 ? 'var(--accent-red)' : undefined }}>
                  {exceptions.needsRecompute.length}
                </td>
                <td style={{ fontSize: '12.5px' }}>名冊的生效日改過，但積分是舊基準算的 —— 重新上傳 Excel 再統計一次。</td>
                <td><NameList rows={exceptions.needsRecompute} onInspect={onInspect} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── 全機構一覽表 ───────────────────────────────────── */}
      <Panel title={`全機構一覽（${rows.length} 人）`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>排序：</span>
          {sortButton('risk', '危險度')}
          {sortButton('expiry', '到期日')}
          {sortButton('earned', '實得（低→高）')}
          {sortButton('name', '姓名')}
        </div>
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th style={{ width: '130px' }}>職業類別</th>
                <th style={{ width: '150px' }}>小卡到期</th>
                <th style={{ width: '110px', textAlign: 'right' }}>實得 / {TOTAL_POINTS_REQUIRED}</th>
                <th style={{ width: '80px', textAlign: 'right' }}>應達</th>
                <th style={{ width: '110px' }}>狀態</th>
                <th>還缺什麼</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const meta = RISK_META[row.risk];
                const labels = shortfallLabels(row);
                const behind = row.progress !== null && row.results.totalPoints < row.progress.expectedPoints;
                return (
                  <tr key={row.cardId}>
                    <td>
                      <button
                        type="button"
                        className="ext-link"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '13.5px', fontWeight: 600 }}
                        onClick={() => onInspect(row.cardId)}
                        title={`看 ${row.name} 的明細（${maskStudentId(row.studentId)}）`}
                      >
                        {row.name}
                      </button>
                    </td>
                    <td style={{ fontSize: '12.5px' }}>{row.role}</td>
                    <td style={{ fontSize: '12.5px' }}>
                      {row.expiryDate || '待補'}
                      {row.daysToExpiry !== null && (
                        <span style={{ color: row.daysToExpiry < 0 ? 'var(--destructive)' : 'var(--text-muted)' }}>
                          {row.daysToExpiry >= 0 ? `（剩 ${row.daysToExpiry} 天）` : `（過期 ${-row.daysToExpiry} 天）`}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: behind ? 'var(--accent-red)' : undefined }}>
                      {row.results.totalPoints}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>
                      {row.progress === null ? '—' : row.progress.expectedPoints}
                    </td>
                    <td>
                      <span className="review-risk-chip" style={{ background: meta.color }}>{meta.label}</span>
                    </td>
                    <td style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                      {labels.length === 0 ? '—' : labels.join('・')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          「應達」是依經過天數攤平的管理進度，<b>不是法規要求</b> ——
          換證法規只要求六年內累計 {TOTAL_POINTS_REQUIRED} 分。實得低於應達只是提醒，不代表不合格。
        </span>
      </Panel>
    </div>
  );
}
