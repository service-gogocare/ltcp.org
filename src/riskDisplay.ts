/**
 * 風險等級的顯示文字與顏色
 * ---------------------------------------------------------------------------
 * 「人員積分審視」與「機構儀表板」都要把同一個等級畫成徽章。各寫一份的話
 * 兩個畫面會對同一個等級給出不同的字或顏色，而使用者會以為那是兩種狀態。
 *
 * 放獨立檔案而不是從 MonthlyReviewPanel.tsx 匯出：那個檔案匯出元件，
 * 混進非元件的常數會讓 React Fast Refresh 對整個檔案失效
 * （eslint 的 react-refresh/only-export-components 就是在講這件事）。
 *
 * 等級的定義與排序在 monthlyReview.ts —— 這裡只管「畫成什麼樣子」。
 */

import type { RiskLevel } from './monthlyReview';

export const RISK_META: Record<RiskLevel, { label: string; hint: string; color: string }> = {
  overdue: { label: '已逾期', hint: '新制文化有已結束的年度沒補，補不回來', color: 'var(--destructive)' },
  unknown: { label: '無法評估', hint: '小卡起訖日待補，什麼都算不出來', color: 'var(--text-muted)' },
  urgent: { label: '一年內到期', hint: '快到期又還沒達標，要立刻排課', color: 'var(--destructive)' },
  pending: { label: '本年度待補', hint: '本年度的新制文化還沒補，年度結束前補完就沒事', color: 'var(--accent-red)' },
  behind: { label: '進度落後', hint: '低於依天數攤平的應達進度。提醒而已，不是不合格', color: 'var(--primary)' },
  ok: { label: '無待辦', hint: '目前沒有需要處理的事', color: 'var(--accent-green)' },
};
