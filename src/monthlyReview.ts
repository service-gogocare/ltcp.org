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
  buildCsvRow,
  calculatePoints,
  rocStrToDate,
  round2,
  type CalculationResults,
  type CoreCategory,
  type CulturalYearWindow,
  type PointsData,
} from './calculator';
import {
  buildPointsDataFromMonths,
  groupMonthlyRecordsByCard,
  monthSortKey,
  MONTH_UNASSIGNED,
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
  nationality: string;
  effectiveDate: string;
  expiryDate: string;

  /** 從月份列反推出來的積分。積分總表要用，畫面也省一次重算 */
  pointsData: PointsData;
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

  /** 逐月累計曲線，供畫面畫圖；起訖日算不出來時為空陣列 */
  cumulative: CumulativePoint[];

  risk: RiskLevel;
}

/** 累計曲線上的一個點 */
export interface CumulativePoint {
  /** 曆月，民國 `114/03` */
  month: string;
  /**
   * 到這個月為止、**套用所有採計上限之後**的總分。
   *
   * 不是每月增量的單純相加：QER 36、線上 60/40/80、舊制文化 2 分都是對整個
   * 6 年週期的累計值判定的，所以每一個月都要拿「到該月為止的所有紀錄」
   * 重跑一次 calculatePoints。相加的話，超過上限的月份會讓曲線一路虛高，
   * 而最後一點會對不上報表上的最終總計。
   */
  total: number;
  /** 該月月底時、依經過天數攤平的應達進度 */
  expected: number;
}

/** monthSortKey 的反函式 */
function monthFromKey(key: number): string {
  const year = Math.floor((key - 1) / 12);
  const mon = key - year * 12;
  return `${year}/${String(mon).padStart(2, '0')}`;
}

/** 民國 `114/03` 這個月的最後一天 */
function lastDayOf(month: string): Date {
  const [year, mon] = month.split('/').map(Number);
  return new Date(year + 1911 + (mon === 12 ? 1 : 0), mon === 12 ? 0 : mon, 0);
}

/**
 * 逐月累計曲線：從生效月畫到「到期月與本月之中較早的那個」。
 *
 * **最後一點必定等於報表上的最終總計** —— 這是這個函式唯一難做對的地方，
 * 也是它的驗收條件。為此，沒有月份可放的紀錄（課程日期無法解析、
 * 或日期早於生效日而落在效期外）會在曲線起點就先計入，
 * 否則那些積分會從曲線上消失、最後一點就對不上報表。
 */
export function cumulativeSeries(
  card: CardIdentity,
  records: MonthlyPointRecord[],
  asOf: Date = new Date(),
): CumulativePoint[] {
  const eff = rocStrToDate(card.effectiveDate);
  const exp = rocStrToDate(card.expiryDate);
  if (!eff || !exp || exp < eff) return [];

  const startKey = monthSortKey(dateToRocMonth(eff));
  const endKey = Math.min(monthSortKey(dateToRocMonth(exp)), monthSortKey(dateToRocMonth(asOf)));
  if (endKey < startKey) return [];

  // 沒有位置可放的紀錄：無法歸月的，以及早於生效月的（效期外）。
  // 放在曲線起點，這樣最後一點才對得上最終總計。
  const seeded: MonthlyPointRecord[] = [];
  const byMonth = new Map<number, MonthlyPointRecord[]>();
  for (const record of records) {
    const month = record.row.month;
    const key = month === MONTH_UNASSIGNED ? NaN : monthSortKey(month);
    if (isNaN(key) || key < startKey) {
      seeded.push(record);
      continue;
    }
    // 晚於曲線終點的（例如重傳較新的匯出檔後才切回舊基準日）併到最後一點
    const slot = Math.min(key, endKey);
    const list = byMonth.get(slot);
    if (list) list.push(record);
    else byMonth.set(slot, [record]);
  }

  const points: CumulativePoint[] = [];
  const accumulated: MonthlyPointRecord[] = [...seeded];
  for (let key = startKey; key <= endKey; key++) {
    const month = monthFromKey(key);
    accumulated.push(...(byMonth.get(key) ?? []));

    const { pointsData } = buildPointsDataFromMonths(accumulated, card);
    const results = calculatePoints(pointsData, [], asOf);
    const monthEnd = lastDayOf(month);

    points.push({
      month,
      total: results.totalPoints,
      expected: cycleProgress(card.effectiveDate, card.expiryDate, monthEnd)?.expectedPoints ?? 0,
    });
  }

  return points;
}

/** Date → 民國 `114/03` */
function dateToRocMonth(d: Date): string {
  return `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, '0')}`;
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
    nationality: card.nationality || '',
    effectiveDate: card.effectiveDate,
    expiryDate: card.expiryDate,
    pointsData,
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
    cumulative: cumulativeSeries(card, records, asOf),
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

/**
 * 一位人員在「積分總表」上的一列。
 *
 * 內容完全沿用 buildCsvRow —— 那就是「下載本次分析結果」那個 Excel 的每一列，
 * 所以試算表上看到的與下載回去的是同一組數字。另外補上名冊才有的三欄
 * （姓名、國籍、職業類別），它們不在 PointsData 裡。
 *
 * 這張表是**衍生的**：每次儲存都從積分月報重算一次，不是獨立維護的資料。
 * 所以它不可能與月報不一致，也沒有「保留舊列」的語意。
 */
export function buildSummaryRow(row: ReviewRow): Record<string, string | number> {
  const csv = buildCsvRow(row.studentId, row.pointsData, row.results);
  return {
    ...csv,
    '姓名': row.name,
    '國籍': row.nationality,
    '職業類別': row.role,
  };
}

// ── 試算表用的走勢表 ────────────────────────────────────────────

export interface TrendRow {
  cardId: string;
  studentId: string;
  role: string;
  name: string;
  /** 目前的累計實得 */
  current: number;
  /** 目前的應達進度 */
  expected: number;
  /**
   * 對齊 `months` 的累計值。該人員的證書期間之外為 null。
   *
   * 為什麼是 null 而不是 0：生效日之前他還沒被認證，畫成 0 會看起來像
   * 「那段時間都沒修課」；到期日之後那張小卡已經不存在了。
   * 寫進試算表時 null 會變成空白儲存格，SPARKLINE 會直接跳過。
   */
  totals: (number | null)[];
}

export interface TrendTable {
  /** 全機構共用的曆月軸：最早的生效月 ~ 最晚的資料月 */
  months: string[];
  rows: TrendRow[];
  /** 全機構平均實得，對齊 months；該月沒有任何人在證書期間內時為 null */
  averageTotals: (number | null)[];
  /** 全機構平均應達，同上 */
  averageExpected: (number | null)[];
}

/**
 * 把每個人的累計曲線攤成一張「人 × 曆月」的表，供 Google 試算表畫圖。
 *
 * 需要共用的月份軸：每個人的生效日不同，各自的曲線起點也不同，
 * 但試算表的圖表要求所有序列共用同一條 X 軸。對不齊的話，
 * 同一欄會是不同人的不同月份 —— 圖會完全錯掉而且看不出來。
 *
 * 平均只對「該月確實在證書期間內」的人取平均。把期間外的人當 0 拉進去平均，
 * 會讓剛入職的人把整個機構的平均往下拖，看起來像大家都落後。
 */
export function buildTrendTable(rows: ReviewRow[]): TrendTable {
  const keys = new Set<number>();
  rows.forEach((row) => row.cumulative.forEach((pt) => keys.add(monthSortKey(pt.month))));
  const sortedKeys = [...keys].sort((a, b) => a - b);
  const months = sortedKeys.map((k) => {
    const year = Math.floor((k - 1) / 12);
    return `${year}/${String(k - year * 12).padStart(2, '0')}`;
  });

  const trendRows: TrendRow[] = rows.map((row) => {
    const byMonth = new Map(row.cumulative.map((pt) => [pt.month, pt]));
    return {
      cardId: row.cardId,
      studentId: row.studentId,
      role: row.role,
      name: row.name,
      current: row.results.totalPoints,
      expected: row.progress?.expectedPoints ?? 0,
      totals: months.map((m) => byMonth.get(m)?.total ?? null),
    };
  });

  const averageTotals: (number | null)[] = [];
  const averageExpected: (number | null)[] = [];
  months.forEach((month, i) => {
    let sumTotal = 0;
    let sumExpected = 0;
    let count = 0;
    for (const row of rows) {
      const pt = row.cumulative.find((c) => c.month === month);
      if (!pt) continue;
      sumTotal += pt.total;
      sumExpected += pt.expected;
      count++;
    }
    averageTotals[i] = count === 0 ? null : round2(sumTotal / count);
    averageExpected[i] = count === 0 ? null : round2(sumExpected / count);
  });

  return { months, rows: trendRows, averageTotals, averageExpected };
}
