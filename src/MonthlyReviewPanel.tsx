/**
 * 每月審視畫面
 * ---------------------------------------------------------------------------
 * 版面上最重要的一件事：**合規判定與進度基準長得完全不一樣**。
 *
 *   - 合規判定用實心徽章、明確寫出「補不回來」或「還來得及」，放在最上面。
 *   - 進度只是一條灰底細線加一個應達刻度，字級小、顏色淡，
 *     而且旁邊直接寫著「管理進度，非法規要求」。
 *
 * 把兩者畫成一樣，會讓一個完全合法、只是進度落後的人看起來像不及格 ——
 * 而換證法規根本沒有逐年總分要求。
 */
import type { ReviewRow, RiskLevel } from './monthlyReview';
import { RISK_ORDER, summariseRisk } from './monthlyReview';

const RISK_META: Record<RiskLevel, { label: string; hint: string; color: string }> = {
  overdue: { label: '已逾期', hint: '新制文化有已結束的年度沒補，補不回來', color: 'var(--destructive)' },
  unknown: { label: '無法評估', hint: '小卡起訖日待補，什麼都算不出來', color: 'var(--text-muted)' },
  urgent: { label: '一年內到期', hint: '快到期又還沒達標，要立刻排課', color: 'var(--destructive)' },
  pending: { label: '本年度待補', hint: '本年度的新制文化還沒補，年度結束前補完就沒事', color: 'var(--accent-red)' },
  behind: { label: '進度落後', hint: '低於依天數攤平的應達進度。提醒而已，不是不合格', color: 'var(--primary)' },
  ok: { label: '無待辦', hint: '目前沒有需要處理的事', color: 'var(--accent-green)' },
};

function ComplianceBadge({ tone, children }: { tone: 'fatal' | 'warn' | 'info'; children: React.ReactNode }) {
  const color = tone === 'fatal' ? 'var(--destructive)'
    : tone === 'warn' ? 'var(--accent-red)'
      : 'var(--text-muted)';
  return (
    <span className="review-badge" style={{ borderColor: color, color }}>
      {tone === 'fatal' ? '⛔' : tone === 'warn' ? '⚠' : 'ℹ'} {children}
    </span>
  );
}

/**
 * 進度條。刻意畫得「不像警示」：灰底、細、無圖示，並標明它不是法規要求。
 * 起訖日算不出來時整條不畫 —— 畫一條 0% 的線會被讀成「他一分都沒修」。
 */
function ProgressBar({ row }: { row: ReviewRow }) {
  if (!row.progress) {
    return (
      <div className="review-progress-note">
        小卡起訖日未填，無法計算週期進度。
      </div>
    );
  }
  const { expectedPoints, elapsedRatio } = row.progress;
  const earned = row.results.totalPoints;
  const earnedPct = Math.min(100, (earned / 120) * 100);
  const expectedPct = Math.min(100, elapsedRatio * 100);

  return (
    <div>
      <div className="review-progress-track">
        <div className="review-progress-fill" style={{ width: `${earnedPct}%` }} />
        <div className="review-progress-marker" style={{ left: `${expectedPct}%` }} />
      </div>
      <div className="review-progress-note">
        實得 <b>{earned}</b> / 120 分 ・ 依經過天數攤平的應達進度 {expectedPoints} 分
        （已過 {row.progress.elapsedDays} / {row.progress.totalDays} 天）
        <span style={{ marginLeft: 6, fontStyle: 'italic' }}>
          — 管理進度，非法規要求
        </span>
      </div>
    </div>
  );
}

function PersonCard({ row }: { row: ReviewRow }) {
  const meta = RISK_META[row.risk];

  return (
    <div className="review-person" style={{ borderLeftColor: meta.color }}>
      <div className="review-person-head">
        <span style={{ fontWeight: 650, fontSize: '15px' }}>{row.name}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '12.5px' }}>
          {row.role} ・ {row.studentId}
        </span>
        <span className="review-risk-chip" style={{ background: meta.color }}>{meta.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: '12.5px', color: 'var(--text-muted)' }}>
          {row.expiryDate
            ? <>到期 {row.expiryDate}{row.daysToExpiry !== null && <>（{row.daysToExpiry >= 0 ? `剩 ${row.daysToExpiry} 天` : `已過期 ${-row.daysToExpiry} 天`}）</>}</>
            : '到期日待補'}
        </span>
      </div>

      {/* 合規判定：真的沒過的事，放最上面、用實心徽章 */}
      <div className="review-badges">
        {row.effectiveDateChanged && (
          <ComplianceBadge tone="warn">
            生效日已從 {row.analyzedEffectiveDate} 改為 {row.effectiveDate}，
            逐年檢核需重新上傳 Excel
          </ComplianceBadge>
        )}
        {row.culturalOverdue.map((w) => (
          <ComplianceBadge key={w.index} tone="fatal">
            第 {w.index} 年（{w.start}~{w.end}）新制文化未補齊
            {w.indigenous < 1 && '・缺原住民族'}
            {w.multicultural < 1 && '・缺多元族群'}
            ，年度已結束<b>補不回來</b>
          </ComplianceBadge>
        ))}
        {row.culturalPending.map((w) => (
          <ComplianceBadge key={w.index} tone="warn">
            第 {w.index} 年（本年度，至 {w.end}）新制文化待補
            {w.indigenous < 1 && '・缺原住民族'}
            {w.multicultural < 1 && '・缺多元族群'}
          </ComplianceBadge>
        ))}
        {!row.culturalCheckable && (
          <ComplianceBadge tone="info">
            沒有積分月報資料，新制文化<b>無法逐年檢核</b>（不等於沒問題）
          </ComplianceBadge>
        )}
        {row.missingCoreSubjects.length > 0 && (
          <ComplianceBadge tone="warn">
            四大核心尚缺：{row.missingCoreSubjects.join('、')}
          </ComplianceBadge>
        )}
        {row.coreShortfall > 0 && row.missingCoreSubjects.length === 0 && (
          <ComplianceBadge tone="warn">四大核心總分尚缺 {row.coreShortfall} 分</ComplianceBadge>
        )}
        {row.qerOverflow > 0 && (
          <ComplianceBadge tone="info">
            專業品質／倫理／法規已超出 36 分上限 {row.qerOverflow} 分 —— 再修同類等於白修
          </ComplianceBadge>
        )}
      </div>

      <ProgressBar row={row} />

      <div className="review-metrics">
        <span>總分尚缺 <b>{row.totalShortfall}</b> 分</span>
        <span>
          網路積分
          {row.onlineRemaining === null
            ? '：無法判定上限'
            : <>距上限還可再修 <b>{row.onlineRemaining}</b> 分</>}
        </span>
        <span>四大核心 <b>{row.results.coreCoursesSum}</b> / 10 分</span>
      </div>
    </div>
  );
}

export default function MonthlyReviewPanel({
  rows,
  hasUnsaved,
  asOf,
}: {
  rows: ReviewRow[];
  /** 目前顯示的內容含尚未儲存到雲端的分析結果 */
  hasUnsaved: boolean;
  asOf: Date;
}) {
  if (rows.length === 0) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '15px', marginBottom: '8px' }}>這份名冊還沒有可以審視的人員。</div>
        <div style={{ fontSize: '13px', lineHeight: 1.8 }}>
          先在「名冊管理」載入或建立人員，上傳衛福部匯出的積分名冊 Excel、
          執行統計分析後儲存到雲端，這裡就會顯示每個人該補什麼課。
        </div>
      </div>
    );
  }

  const counts = summariseRisk(rows);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="glass-panel" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            共 {rows.length} 人 ・ 基準日 {asOf.toLocaleDateString('zh-TW')}
          </span>
          {RISK_ORDER.filter((r) => counts[r] > 0).map((r) => (
            <span key={r} className="review-risk-chip" style={{ background: RISK_META[r].color }} title={RISK_META[r].hint}>
              {RISK_META[r].label} {counts[r]}
            </span>
          ))}
        </div>
        {hasUnsaved && (
          <div style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--accent-red)' }}>
            ● 以下含本次分析尚未儲存到雲端的結果。重新整理頁面就會消失，記得按「儲存設定到雲端」。
          </div>
        )}
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          排序依「最危險的人」而不是總分最低 —— 總分可以在最後一年突擊補課，
          新制文化過了年度就補不回來。
        </div>
      </div>

      {rows.map((row) => <PersonCard key={row.cardId} row={row} />)}
    </div>
  );
}
