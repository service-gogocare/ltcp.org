/**
 * 每月審視：把積分月報變成「這個月誰該去修什麼課」（純函式，不碰時間以外的東西）
 * ---------------------------------------------------------------------------
 * 這裡最重要的一件事是**把兩種紅字分開**：
 *
 *   - **合規判定**：法規真的沒過。新制文化某個證書年度已結束卻沒補，
 *     那是不合格而且**補不回來**。
 *   - **進度基準**：120 分 ÷ 六年攤平出來的「應達進度」。落後只是提醒 ——
 *     換證法規沒有逐年總分要求，機構評鑑也沒有（2026-09-03 確認）。
 *     把它畫得跟合規判定一樣，會讓完全合法的人看起來像不及格。
 *
 * 排序也是同一件事的延伸：**危險不等於總分最低**。總分可以在最後一年突擊補課，
 * 新制文化過期不行。所以逾期未補的人排在總分更低但還來得及的人前面。
 */
import {
  CORE_COURSES_REQUIRED,
  CORE_INDIVIDUAL_MINIMUM,
  QER_CAP,
  TOTAL_POINTS_REQUIRED,
  calculatePoints,
  rocStrToDate,
  round2,
  type CalculationResults,
  type CoreCategory,
  type CulturalYearWindow,
} from './calculator';
import {
  buildPointsDataFromMonths,
  groupMonthlyRecordsByCard,
  type CardIdentity,
  type MonthlyPointRecord,
} from './monthlyPoints';
import { splitCardId } from './cardPlan';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 四大核心的欄位與顯示名稱 */
export const CORE_SUBJECTS: { key: CoreCategory; label: string }[] = [
  { key: 'fireSafety', label: '消防安全' },
  { key: 'emergencyResponse', label: '緊急應變' },
  { key: 'infectionControl', label: '感染管制' },
  { key: 'genderSensitivity', label: '性別敏感度' },
];

/**
 * 危險等級，由高到低。**這個順序就是排序順序。**
 *
 * - `overdue`  新制文化有已結束的年度沒補。真的不合格，而且補不回來。
 * - `unknown`  小卡起訖日待補，什麼都算不出來。管理者要先去把日期填上。
 * - `urgent`   一年內到期但還沒達標。還來得及，但要立刻排課。
 * - `pending`  本年度的新制文化還沒補。年度結束前補完就沒事。
 * - `behind`   落後攤平進度。**只是提醒，不是不合格。**
 * - `ok`       目前沒有需要處理的事。
 */
export type RiskLevel = 'overdue' | 'unknown' | 'urgent' | 'pending' | 'behind' | 'ok';

export const RISK_ORDER: RiskLevel[] = ['overdue', 'unknown', 'urgent', 'pending', 'behind', 'ok'];

/** 一年內到期就視為緊迫：排課、上課、登錄都需要時間 */
export const URGENT_DAYS = 365;

export interface CycleProgress {
  /** 證書週期總天數 */
  totalDays: number;
  /** 已經過的天數（夾在 0 與 totalDays 之間） */
  elapsedDays: number;
  /** 已過比例，0~1 */
  elapsedRatio: number;
  /**
   * 依經過天數攤平的應達積分。
   * **這是管理基準不是合規線** —— 不用「每年 20、每月 1.67」的固定格線，
   * 因為最後一年不滿年時格線會偏高，會把完全合法的人顯示成未達標。
   */
  expectedPoints: number;
}

export interface ReviewRow {
  cardId: string;
  studentId: string;
  name: string;
  role: string;
  effectiveDate: string;
  expiryDate: string;

  /** 完整的統計結果，畫面要看細項時直接用 */
  results: CalculationResults;

  /** 起訖日無法解析時為 null —— 不要畫一條假的進度條 */
  progress: CycleProgress | null;
  /** 距離小卡到期還有幾天；起訖日無法解析時為 null。負數代表已過期 */
  daysToExpiry: number | null;

  // ── 每月要盯的五件事 ──────────────────────────────
  /** 1a. 已結束卻沒補的受規範年度。**補不回來** */
  culturalOverdue: CulturalYearWindow[];
  /** 1b. 進行中且尚未補齊的年度。年度結束前還來得及 */
  culturalPending: CulturalYearWindow[];
  /** 1c. 能不能做逐年檢核。false 代表沒有資料可判，不等於沒問題 */
  culturalCheckable: boolean;
  /** 2a. 四大核心中還沒修到 1 分的科目 */
  missingCoreSubjects: string[];
  /** 2b. 四大核心總分還差多少（要求 10 分） */
  coreShortfall: number;
  /** 3. QER 超出 36 分上限的部分 —— 這些分數等於白修 */
  qerOverflow: number;
  /** 4. 網路積分距上限還剩多少；沒有上限（生效日無法解析）時為 null */
  onlineRemaining: number | null;
  /** 5. 總分還差多少 */
  totalShortfall: number;

  /**
   * 名冊上的生效日與分析當下不一致 —— 逐年檢核的結果不可信。
   * 曆月跨年度時怎麼拆兩列由課程日期決定，而明細已經丟掉了。
   */
  effectiveDateChanged: boolean;
  /** 分析當下用的生效日，讓訊息講得出差在哪 */
  analyzedEffectiveDate: string;

  risk: RiskLevel;
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((midnight(to).getTime() - midnight(from).getTime()) / MS_PER_DAY);
}

/**
 * 證書週期的時間進度。起訖日無法解析時回傳 null。
 *
 * `asOf` 會正規化到當天午夜，與 buildCardYears 的處理一致 ——
 * 不正規化的話同一天的不同時刻會算出不同的天數。
 */
export function cycleProgress(
  effectiveDate: string,
  expiryDate: string,
  asOf: Date = new Date(),
): CycleProgress | null {
  const eff = rocStrToDate(effectiveDate);
  const exp = rocStrToDate(expiryDate);
  if (!eff || !exp || exp < eff) return null;

  // 含頭含尾：生效日當天就算第 1 天
  const totalDays = daysBetween(eff, exp) + 1;
  const raw = daysBetween(eff, asOf) + 1;
  const elapsedDays = Math.min(Math.max(raw, 0), totalDays);
  const elapsedRatio = elapsedDays / totalDays;

  return {
    totalDays,
    elapsedDays,
    elapsedRatio,
    expectedPoints: round2(TOTAL_POINTS_REQUIRED * elapsedRatio),
  };
}

/** 依五項監控的結果判定危險等級。順序即 RISK_ORDER */
function assessRisk(row: Omit<ReviewRow, 'risk'>): RiskLevel {
  // 補不回來的排最前面，即使這個人總分很高
  if (row.culturalOverdue.length > 0) return 'overdue';
  // 算不出來要看得見。管理者得先去把起訖日補上，否則這個人永遠不會被檢查到
  if (!row.progress) return 'unknown';
  if (row.daysToExpiry !== null && row.daysToExpiry <= URGENT_DAYS && !row.results.isTotalPointsMet) {
    return 'urgent';
  }
  if (row.culturalPending.length > 0) return 'pending';
  if (row.results.totalPoints < row.progress.expectedPoints) return 'behind';
  return 'ok';
}

/** 一位人員的審視結果 */
export function buildReviewRow(
  card: CardIdentity,
  records: MonthlyPointRecord[],
  asOf: Date = new Date(),
): ReviewRow {
  const { pointsData, effectiveDateChanged, analyzedEffectiveDate } =
    buildPointsDataFromMonths(records, card);
  const results = calculatePoints(pointsData, [], asOf);

  // 無法逐年檢核時，受規範年度一律當成「沒有可回報的缺失」。
  // 這一步不能省：沒有資料時 windows 仍然會被建出來、而且每年都是 0 分，
  // 直接讀的話每個已結束的年度都會長得像「沒補」—— 但事實是我們無從得知。
  // 把無從得知報成不合格，比漏報更糟：使用者會去追一個不存在的問題。
  const culturalCheckable = results.isCulturalYearlyMet !== null;
  const regulated = culturalCheckable
    ? results.culturalYearWindows.filter((w) => w.requiresNewRule)
    : [];
  const progress = cycleProgress(card.effectiveDate, card.expiryDate, asOf);
  const exp = rocStrToDate(card.expiryDate);

  const partial: Omit<ReviewRow, 'risk'> = {
    cardId: card.cardId,
    studentId: splitCardId(card.cardId).studentId,
    name: card.name,
    role: splitCardId(card.cardId).role,
    effectiveDate: card.effectiveDate,
    expiryDate: card.expiryDate,
    results,
    progress,
    daysToExpiry: exp ? daysBetween(asOf, exp) : null,

    culturalOverdue: regulated.filter((w) => w.status === 'past' && !w.isMet),
    culturalPending: regulated.filter((w) => w.status === 'current' && !w.isMet),
    culturalCheckable,
    missingCoreSubjects: CORE_SUBJECTS
      .filter(({ key }) => (pointsData[key] || 0) < CORE_INDIVIDUAL_MINIMUM)
      .map(({ label }) => label),
    coreShortfall: round2(Math.max(0, CORE_COURSES_REQUIRED - results.coreCoursesSum)),
    qerOverflow: round2(Math.max(0, results.qualityEthicsRegulationsSum - QER_CAP)),
    onlineRemaining: results.onlineCap === null
      ? null
      : round2(Math.max(0, results.onlineCap - results.onlinePointsCounted)),
    totalShortfall: round2(Math.max(0, TOTAL_POINTS_REQUIRED - results.totalPoints)),
    effectiveDateChanged,
    analyzedEffectiveDate,
  };

  return { ...partial, risk: assessRisk(partial) };
}

/**
 * 整份名冊的每月審視，最危險的排最前面。
 *
 * **以名冊為準而不是以月報為準**：一列積分都沒有的人正是最該被看見的，
 * 只走月報的話他們會整個消失。
 */
export function buildMonthlyReview(
  cards: CardIdentity[],
  records: MonthlyPointRecord[],
  asOf: Date = new Date(),
): ReviewRow[] {
  const byCard = groupMonthlyRecordsByCard(records);
  const rows = cards.map((card) => buildReviewRow(card, byCard.get(card.cardId) ?? [], asOf));

  return rows.sort((a, b) => {
    const byRisk = RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk);
    if (byRisk !== 0) return byRisk;
    // 同等級內越快到期越前面；算不出到期日的排最後（它們已經在 unknown 組裡）
    const aDays = a.daysToExpiry ?? Number.POSITIVE_INFINITY;
    const bDays = b.daysToExpiry ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
    return a.results.totalPoints - b.results.totalPoints;
  });
}

/** 各危險等級各有幾人，供畫面上的摘要列使用 */
export function summariseRisk(rows: ReviewRow[]): Record<RiskLevel, number> {
  const counts = Object.fromEntries(RISK_ORDER.map((r) => [r, 0])) as Record<RiskLevel, number>;
  rows.forEach((r) => { counts[r.risk]++; });
  return counts;
}
