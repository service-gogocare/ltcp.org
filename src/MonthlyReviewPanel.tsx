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
import { useState } from 'react';
import { TOTAL_POINTS_REQUIRED as TOTAL_TARGET } from './calculator';
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
 * 逐月累計曲線。
 *
 * 形式選的是 **emphasis**：一條實得累計用主色，應達進度用灰色虛線當背景參照 ——
 * 它們不是兩條對等的序列。這與整個檔案的前提一致：落後進度只是提醒，
 * 把兩條線畫成一樣重會讓合法的人看起來像不及格。
 *
 * 為什麼是累計而不是每月增量：使用者要的是「這個人到現在累積多少」，
 * 而每月獨立的柱狀圖回答不了那個問題。累計值不是把月份相加 ——
 * 採計上限是對整個週期套用的，見 cumulativeSeries。
 *
 * 起訖日算不出來時整張圖不畫：畫一條 0 的線會被讀成「他一分都沒修」。
 */
function CumulativeChart({ row }: { row: ReviewRow }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = row.cumulative;

  if (!row.progress || series.length === 0) {
    return (
      <div className="review-progress-note">
        小卡起訖日未填，無法計算週期進度與累計曲線。
      </div>
    );
  }

  const W = 720;
  const H = 96;
  const PAD = { l: 10, r: 46, t: 10, b: 18 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const yMax = Math.max(TOTAL_TARGET, ...series.map(pt => pt.total));
  const x = (i: number) => PAD.l + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const y = (v: number) => PAD.t + plotH - (v / yMax) * plotH;

  const line = (pick: (pt: typeof series[number]) => number) =>
    series.map((pt, i) => `${x(i).toFixed(1)},${y(pick(pt)).toFixed(1)}`).join(' ');

  const earnedPath = line(pt => pt.total);
  const expectedPath = line(pt => pt.expected);
  const areaPath = `${PAD.l},${y(0)} ${earnedPath} ${x(series.length - 1)},${y(0)}`;

  const last = series[series.length - 1];
  const at = hover !== null ? series[hover] : null;

  // 兩條線收斂時端點標籤會疊在一起。規範說不要用「上下擠開」解決 ——
  // 那會讓標籤脫離它的線、讀起來像雜訊。這裡改成只留主色線的標籤，
  // 應達那條靠下面說明文字裡的虛線圖例辨識。
  const labelsWouldCollide = Math.abs(y(last.total) - y(last.expected)) < 12;

  const pickNearest = (evt: React.PointerEvent<SVGSVGElement>) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const ratio = ((evt.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((ratio - PAD.l) / plotW) * (series.length - 1));
    setHover(Math.min(series.length - 1, Math.max(0, i)));
  };

  // 鍵盤要看得到跟滑鼠一樣的讀數，否則游標讀數就變成唯一取得途徑
  const onKeyDown = (evt: React.KeyboardEvent<SVGSVGElement>) => {
    if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
    evt.preventDefault();
    const base = hover ?? series.length - 1;
    const next = evt.key === 'ArrowLeft' ? base - 1 : base + 1;
    setHover(Math.min(series.length - 1, Math.max(0, next)));
  };

  // 讀數框貼齊邊緣時不要溢出容器
  const hoverPct = hover !== null ? (x(hover) / W) * 100 : 0;
  const tipShift = hoverPct > 78 ? 'translateX(-100%)' : hoverPct < 22 ? 'translateX(0)' : 'translateX(-50%)';

  return (
    <div className="review-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="review-chart-svg"
        role="img"
        aria-label={`${row.name} 的累計積分曲線：目前 ${last.total} 分，應達 ${last.expected} 分`}
        onPointerMove={pickNearest}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
      >
        {/* 120 分目標線。最淡的一條 —— 它是刻度不是警示 */}
        <line
          x1={PAD.l} x2={PAD.l + plotW} y1={y(TOTAL_TARGET)} y2={y(TOTAL_TARGET)}
          className="review-chart-target" vectorEffect="non-scaling-stroke"
        />
        <text x={PAD.l + plotW + 4} y={y(TOTAL_TARGET) + 3} className="review-chart-tick">120</text>

        <polygon points={areaPath} className="review-chart-area" />

        {/* 應達進度：灰虛線，背景參照。管理基準，不是合規線 */}
        <polyline points={expectedPath} className="review-chart-pace" vectorEffect="non-scaling-stroke" />
        {!labelsWouldCollide && (
          <text x={PAD.l + plotW + 4} y={y(last.expected) + 3} className="review-chart-label">應達</text>
        )}

        {/* 實得累計：唯一一條主色線 */}
        <polyline points={earnedPath} className="review-chart-earned" vectorEffect="non-scaling-stroke" />
        <circle cx={x(series.length - 1)} cy={y(last.total)} r={4} className="review-chart-dot" />
        <text x={PAD.l + plotW + 4} y={y(last.total) + 3} className="review-chart-label">實得</text>

        {at && hover !== null && (
          <line
            x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH}
            className="review-chart-crosshair" vectorEffect="non-scaling-stroke"
          />
        )}

        <text x={PAD.l} y={H - 5} className="review-chart-tick">{series[0].month}</text>
        <text x={PAD.l + plotW} y={H - 5} textAnchor="end" className="review-chart-tick">{last.month}</text>
      </svg>

      {/* 游標讀數只是加分，不是取得數字的唯一途徑 —— 下面那行字一直都在 */}
      {at && hover !== null && (
        <div
          className="review-chart-tip"
          style={{ left: `${hoverPct}%`, transform: tipShift }}
        >
          <div className="review-chart-tip-month">{at.month}</div>
          <div><b>{at.total}</b> 實得</div>
          <div className="review-chart-tip-pace"><b>{at.expected}</b> 應達</div>
        </div>
      )}

      {/* 數字一直在這裡，游標讀數只是加分。應達那條線的虛線圖例也放這裡 ——
          收斂時圖上的端點標籤會被拿掉，識別就靠這個 */}
      <div className="review-progress-note">
        實得 <b>{last.total}</b> / 120 分 ・
        <svg width="16" height="8" className="review-chart-key" aria-hidden="true">
          <line x1="0" y1="4" x2="16" y2="4" className="review-chart-pace" vectorEffect="non-scaling-stroke" />
        </svg>
        依經過天數攤平的應達進度 {last.expected} 分
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

      <CumulativeChart row={row} />

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

/**
 * 名冊還沒有東西可以審視時的說明。
 * 抽出來是因為它現在要放進版面的「中間欄」，而不是佔滿整個畫面。
 */
export function ReviewEmptyState() {
  return (
    <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: '15px', marginBottom: '8px' }}>這份名冊還沒有可以審視的人員。</div>
      <div style={{ fontSize: '13px', lineHeight: 1.8 }}>
        先在「人員名冊管理」載入或建立人員，上傳衛福部匯出的機構人員教育訓練積分名冊、
        執行統計分析後儲存到雲端，這裡就會顯示每個人該補什麼課。
      </div>
    </div>
  );
}

/**
 * 摘要列：人數、基準日、風險徽章。
 *
 * **徽章同時是篩選器。** 使用者看到「已逾期 31」之後的下一個念頭一定是
 * 「那是哪 31 個人」，讓他自己去清單裡一個個找，等於把工作丟回去。
 *
 * 徽章上的數字一律取自**全部**人員（rows 傳的是未篩選的那份），
 * 否則按下篩選之後其他組的數字會歸零，看起來像資料不見了。
 */
export function ReviewSummaryBar({
  rows, hasUnsaved, asOf, riskFilter, onRiskFilter,
}: {
  /** 全部人員，不是篩選後的 */
  rows: ReviewRow[];
  hasUnsaved: boolean;
  asOf: Date;
  riskFilter: RiskLevel | null;
  onRiskFilter: (risk: RiskLevel | null) => void;
}) {
  const counts = summariseRisk(rows);

  return (
    <div className="glass-panel" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          共 {rows.length} 人 ・ 基準日 {asOf.toLocaleDateString('zh-TW')}
        </span>
        {RISK_ORDER.filter((r) => counts[r] > 0).map((r) => {
          const on = riskFilter === r;
          return (
            <button
              key={r}
              type="button"
              className="review-risk-chip review-risk-filter"
              style={{
                background: on ? RISK_META[r].color : 'transparent',
                color: on ? '#ffffff' : RISK_META[r].color,
                borderColor: RISK_META[r].color,
              }}
              title={`${RISK_META[r].hint}。${on ? '再按一次取消篩選' : '按一下只看這一組'}`}
              onClick={() => onRiskFilter(on ? null : r)}
            >
              {RISK_META[r].label} {counts[r]}
            </button>
          );
        })}
        {riskFilter !== null && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '2px 10px', fontSize: '12px', minHeight: '26px' }}
            onClick={() => onRiskFilter(null)}
          >
            顯示全部
          </button>
        )}
      </div>
      {hasUnsaved && (
        <div style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--accent-red)' }}>
          ● 以下含本次分析尚未儲存到雲端的結果。重新整理頁面就會消失，記得按「儲存積分到雲端」。
        </div>
      )}
      <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.7 }}>
        排序依「最危險的人」而不是總分最低 —— 總分可以在最後一年突擊補課，
        新制文化過了年度就補不回來。
      </div>
    </div>
  );
}

/**
 * 左側的已分析人員清單。
 *
 * 存在的理由：一張資料卡含合規徽章與一整張累計曲線，高度接近一個畫面，
 * 四十幾個人疊起來要捲很久才找得到某一個人。清單一列一個人，
 * 掃一眼就看得完，也讓「先看已逾期那組」變成兩下就到得了的動作。
 */
export function ReviewPersonList({
  rows, activeCardId, onSelect,
}: {
  /** 已套用篩選的人員 */
  rows: ReviewRow[];
  activeCardId: string | null;
  onSelect: (cardId: string) => void;
}) {
  return (
    <div className="glass-panel review-list workspace-side">
      {rows.length === 0 ? (
        <div style={{ padding: '16px 10px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.8 }}>
          這個篩選條件下沒有人員。按上方的「顯示全部」回到完整清單。
        </div>
      ) : rows.map((row) => {
        const meta = RISK_META[row.risk];
        const active = row.cardId === activeCardId;
        return (
          <button
            key={row.cardId}
            type="button"
            className={`review-list-item${active ? ' active' : ''}`}
            style={{ borderLeftColor: meta.color }}
            onClick={() => onSelect(row.cardId)}
            title={`${row.name}（${row.studentId}）・${meta.label}`}
          >
            <span className="review-list-name">{row.name}</span>
            <span className="review-list-meta">
              {meta.label}
              {row.daysToExpiry !== null && row.daysToExpiry < 0 && `・過期 ${-row.daysToExpiry} 天`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 中間欄：目前選到的那一位的資料卡 */
export function ReviewPersonDetail({ row }: { row: ReviewRow | null }) {
  if (!row) {
    return (
      <div className="glass-panel" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13.5px' }}>
        在左側清單選一位人員，這裡會顯示他的合規判定與累計曲線。
      </div>
    );
  }
  return <PersonCard row={row} />;
}
