/**
 * 機構儀表板的聚合邏輯（純函式）
 * ---------------------------------------------------------------------------
 * 「人員積分審視」是**一次看一個人**的鑽取工具：點誰就看誰的合規判定與曲線。
 * 儀表板是另一種需求 —— 負責人要掃視、排程、決定這個月開哪門課，
 * 那些問題的答案都不在單一個人的卡片上。
 *
 * 所以這裡不重算任何積分，只把既有的 ReviewRow[] 聚合成機構層級的答案。
 * 判定一律沿用 CalculationResults 上的旗標（isTotalPointsMet 等），
 * 不自己再寫一套門檻 —— 兩套門檻遲早會對不上，而症狀是同一個人在兩個畫面
 * 一個顯示達標、一個顯示未達標。
 */

import type { ReviewRow } from './monthlyReview';
import { TOTAL_POINTS_REQUIRED } from './calculator';

/** 到期時程的分組。天數門檻用「還剩幾天」而不是月份，因為換證是按日算的 */
export type ExpiryBucketKey = 'expired' | 'within90' | 'within180' | 'within365' | 'later' | 'unknown';

export const EXPIRY_BUCKET_ORDER: ExpiryBucketKey[] = [
  'expired', 'within90', 'within180', 'within365', 'later', 'unknown',
];

export const EXPIRY_BUCKET_LABEL: Record<ExpiryBucketKey, string> = {
  expired: '已過期',
  within90: '3 個月內到期',
  within180: '6 個月內到期',
  within365: '1 年內到期',
  later: '1 年以上',
  unknown: '無法判定（起訖日待補）',
};

export interface ExpiryBucket {
  key: ExpiryBucketKey;
  label: string;
  rows: ReviewRow[];
}

export interface OrgSummary {
  /** 名冊總人數 */
  total: number;
  /** 換證條件全部滿足的人數 */
  met: number;
  /** 需要處理的人數（risk 不是 ok） */
  todo: number;
  /**
   * 全機構的進度百分比 = 總實得 ÷ 總應達。
   *
   * 用總和相除而不是「每個人的百分比再平均」：後者會讓一個剛入職、應達只有
   * 3 分而實得 3 分的人貢獻 100%，把整體拉高到看不出問題。
   * 沒有任何人算得出應達進度時為 null —— 不要顯示 0%，那讀起來像「全機構掛零」。
   */
  progressPercent: number | null;
  /** 總實得與總應達，讓畫面能寫出「1,204 / 2,880 分」而不只是百分比 */
  earnedSum: number;
  expectedSum: number;
  /** 還沒統計過的人數（名冊上有，但一列積分紀錄都沒有） */
  notAnalysed: number;
}

/** 換證條件是否全部滿足。null（無法逐年檢核）一律不算達標 —— 我們不知道 */
export function isFullyMet(row: ReviewRow): boolean {
  const r = row.results;
  return r.isTotalPointsMet
    && r.isQualityEthicsRegulationsSumMet
    && r.isCoreCoursesSumMet
    && r.areAllCoreCoursesTaken
    && r.isCulturalYearlyMet === true;
}

export function summariseOrg(rows: ReviewRow[]): OrgSummary {
  let earnedSum = 0;
  let expectedSum = 0;
  let met = 0;
  let todo = 0;
  let notAnalysed = 0;

  for (const row of rows) {
    if (isFullyMet(row)) met++;
    if (row.risk !== 'ok') todo++;
    if (row.recordCount === 0) notAnalysed++;

    // 起訖日算不出來的人不進分母也不進分子：他的應達進度是未知，
    // 硬算成 0 會把全機構的百分比往下拉，而那個數字沒有意義
    if (row.progress) {
      earnedSum += row.results.totalPoints;
      expectedSum += row.progress.expectedPoints;
    }
  }

  return {
    total: rows.length,
    met,
    todo,
    notAnalysed,
    earnedSum: round2(earnedSum),
    expectedSum: round2(expectedSum),
    progressPercent: expectedSum > 0 ? Math.round((earnedSum / expectedSum) * 100) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 依到期遠近分組，每組內越快到期的排前面。
 *
 * 空的分組**保留**在結果裡（rows 為空陣列），由畫面決定要不要顯示 ——
 * 「3 個月內到期：0 人」本身就是負責人想確認的事，
 * 直接濾掉的話畫面上看不出那是 0 還是這個分組不存在。
 */
export function buildExpirySchedule(rows: ReviewRow[]): ExpiryBucket[] {
  const byKey = new Map<ExpiryBucketKey, ReviewRow[]>(
    EXPIRY_BUCKET_ORDER.map((k) => [k, []]),
  );

  for (const row of rows) {
    byKey.get(expiryBucketOf(row))!.push(row);
  }

  for (const list of byKey.values()) {
    list.sort((a, b) => {
      const aDays = a.daysToExpiry ?? Number.POSITIVE_INFINITY;
      const bDays = b.daysToExpiry ?? Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
  }

  return EXPIRY_BUCKET_ORDER.map((key) => ({
    key,
    label: EXPIRY_BUCKET_LABEL[key],
    rows: byKey.get(key)!,
  }));
}

export function expiryBucketOf(row: ReviewRow): ExpiryBucketKey {
  const days = row.daysToExpiry;
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= 90) return 'within90';
  if (days <= 180) return 'within180';
  if (days <= 365) return 'within365';
  return 'later';
}

export interface OrgExceptions {
  /** 小卡起訖日空白 —— 什麼都算不出來，要先去名冊補 */
  pendingDates: ReviewRow[];
  /** 從來沒被統計過 —— 要去跑一次分析，不是去排課 */
  notAnalysed: ReviewRow[];
  /** 名冊的生效日與分析當下不一致 —— 逐年檢核的結果不可信，要重新上傳 Excel */
  needsRecompute: ReviewRow[];
}

/**
 * 需要人去處理的例外。
 *
 * 三類的處置完全不同，所以刻意分開而不是合成一個「有問題的人」清單：
 * 待補起訖日要去名冊填、尚未統計要去跑分析、需重新計算要重新上傳 Excel。
 * 混在一起的話使用者得自己一個一個點開才知道該做什麼。
 *
 * 同一個人可能同時落在兩類（例如起訖日待補又從沒統計過），這是刻意的 ——
 * 這裡不是分桶統計，而是三張待辦清單。
 */
export function collectExceptions(rows: ReviewRow[]): OrgExceptions {
  const byName = (a: ReviewRow, b: ReviewRow) => a.name.localeCompare(b.name, 'zh-Hant');
  return {
    pendingDates: rows.filter((r) => r.progress === null).sort(byName),
    notAnalysed: rows.filter((r) => r.recordCount === 0).sort(byName),
    needsRecompute: rows.filter((r) => r.effectiveDateChanged).sort(byName),
  };
}

/** 一覽表上「還缺什麼」那一欄的內容。空陣列代表這個人沒有待辦 */
export function shortfallLabels(row: ReviewRow): string[] {
  const labels: string[] = [];

  if (row.progress === null) {
    // 起訖日待補時其他判定都不可信，只講這一件事
    return ['小卡起訖日待補'];
  }
  if (row.recordCount === 0) return ['尚未統計'];

  if (row.totalShortfall > 0) labels.push(`總分缺 ${row.totalShortfall}`);
  if (row.culturalOverdue.length > 0) labels.push(`文化逾期 ${row.culturalOverdue.length} 年`);
  if (row.culturalPending.length > 0) labels.push('本年度文化待補');
  if (row.missingCoreSubjects.length > 0) labels.push(`缺核心：${row.missingCoreSubjects.join('、')}`);
  else if (row.coreShortfall > 0) labels.push(`核心缺 ${row.coreShortfall} 分`);
  if (!row.results.isQualityEthicsRegulationsSumMet) labels.push('QER 未達 24 分');
  if (row.qerOverflow > 0) labels.push(`QER 超上限 ${row.qerOverflow} 分`);

  return labels;
}

/** 一覽表預設排序：與人員積分審視一致（最危險的人在前），使用者的心智模型才不會斷 */
export type OverviewSortKey = 'risk' | 'expiry' | 'earned' | 'name';

export function sortOverview(rows: ReviewRow[], key: OverviewSortKey, riskOrder: string[]): ReviewRow[] {
  const copy = [...rows];
  switch (key) {
    case 'expiry':
      return copy.sort((a, b) =>
        (a.daysToExpiry ?? Number.POSITIVE_INFINITY) - (b.daysToExpiry ?? Number.POSITIVE_INFINITY));
    case 'earned':
      // 低分在前：掃視的目的是找出誰落後，不是表揚前幾名
      return copy.sort((a, b) => a.results.totalPoints - b.results.totalPoints);
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    default:
      return copy.sort((a, b) => riskOrder.indexOf(a.risk) - riskOrder.indexOf(b.risk));
  }
}

export { TOTAL_POINTS_REQUIRED };
