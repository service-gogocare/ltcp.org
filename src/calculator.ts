export interface PointsData {
  id: string;
  name: string;
  birthday: string;
  cardExpiryDate: string;
  effectiveDate: string;
  earliestCourseDate: string;

  professionalPhysical: number;
  professionalOnline: number;

  qualityPhysical: number;
  qualityOnline: number;

  ethicsPhysical: number;
  ethicsOnline: number;

  regulationsPhysical: number;
  regulationsOnline: number;

  fireSafety: number;
  emergencyResponse: number;
  infectionControl: number;
  genderSensitivity: number;

  culturalOld: number;
  culturalNewIndigenous: number;
  culturalNewMulticultural: number;

  /**
   * 舊制文化課程的逐筆紀錄（含屬性與實體/網路），由 Excel 解析時填入。
   * 套用 2 分認列上限時需要它才能從正確的屬性桶扣除超額。
   * 從雲端小卡載入時為 undefined，屆時無法自動扣除，會在提示中標明。
   */
  culturalOldRecords?: CulturalOldRecord[];

  /**
   * 新制文化課程的逐筆紀錄（含課程日期），由 Excel 解析時填入。
   * 從雲端小卡載入的資料沒有課程明細，此欄會是 undefined，
   * 屆時退回「整個週期至少 1 分」的彙總檢核。
   */
  culturalNewRecords?: CulturalNewRecord[];
}

/** 屬性桶的鍵名，對應 PointsData 中八個計入總分的欄位 */
export type AttributeBucket =
  | 'professionalPhysical' | 'professionalOnline'
  | 'qualityPhysical' | 'qualityOnline'
  | 'ethicsPhysical' | 'ethicsOnline'
  | 'regulationsPhysical' | 'regulationsOnline';

/**
 * 舊制（113/06/02 前）「原住民族與多元族群文化」課程的逐筆紀錄。
 * 需要記錄它原本落在哪個屬性桶，才能在套用 2 分認列上限時知道要從哪裡扣除。
 */
export interface CulturalOldRecord {
  attr: 'professional' | 'quality' | 'ethics' | 'regulations';
  isPhysical: boolean;
  points: number;
}

/** 新制文化課程的逐筆紀錄，用於證書年度的逐年檢核 */
export interface CulturalNewRecord {
  /** 課程日期（民國字串，如 113/07/15） */
  date: string;
  kind: 'indigenous' | 'multicultural';
  points: number;
}

/** 一個證書年度的新制文化課程檢核結果 */
export interface CulturalYearWindow {
  /** 第幾個證書年度，從 1 起算 */
  index: number;
  /** 年度起日（民國字串） */
  start: string;
  /** 年度訖日（民國字串） */
  end: string;
  /** 此年度是否受新制逐年規定規範 */
  requiresNewRule: boolean;
  /**
   * 相對於評估基準日的時間狀態。
   * 只有 past（已結束）的年度才可能真的「未達標」；
   * current 是進行中、尚有時間補課；future 還沒開始，不該列為缺失。
   */
  status: 'past' | 'current' | 'future';
  indigenous: number;
  multicultural: number;
  /** 兩科是否都已達每年最低要求；不受規範者一律為 true */
  isMet: boolean;
}

export interface Course {
  url: string;
  name: string;
  type: string;
  points: number;
  tags: string[];
  date?: string;
}

export interface CalculationResults {
  professionalSum: number;
  qualityEthicsRegulationsSum: number;
  isQualityEthicsRegulationsSumMet: boolean;
  cappedQualityEthicsRegulationsSum: number;

  totalOnlineSum: number;
  onlineCap: number | null;
  onlinePointsCounted: number;
  onlineOverflow: number;

  totalPoints: number;
  isTotalPointsMet: boolean;

  coreCoursesSum: number;
  isCoreCoursesSumMet: boolean;
  areAllCoreCoursesTaken: boolean;

  /** 舊制文化課程實際採計的分數，最多 2 分 */
  culturalOldCapped: number;
  /** 因超過 2 分認列上限而未計入總分的舊制文化積分 */
  culturalOldExcluded: number;
  /** 2 分上限是否成功套用；無課程明細時為 false，代表總分可能高估 */
  isCulturalOldCapApplied: boolean;
  culturalNewTotal: number;

  /** 各證書年度的新制文化課程檢核；無法計算年度時為空陣列 */
  culturalYearWindows: CulturalYearWindow[];
  /** 是否所有受新制規範的年度都達標；無法逐年檢核時為 null */
  isCulturalYearlyMet: boolean | null;

  attentionNotes: string;
  recommendedCourses: string;
  recommendedCoursesList: Course[];
}

// Rules Constants
export const TOTAL_POINTS_REQUIRED = 120;
export const QER_REQUIRED = 24;
export const QER_CAP = 36;
export const ONLINE_CAP_OLD = 60;
export const ONLINE_CAP_MID = 40;
export const ONLINE_CAP_NEW = 80;
export const ONLINE_CAP_CUTOFF_DATE = new Date(2023, 9, 12); // Month is 0-indexed in JS (9 = Oct)
export const ONLINE_CAP_NEW_EFFECTIVE_DATE = new Date(2026, 6, 1); // 115/07/01 (Month 6 is July)
export const CORE_COURSES_REQUIRED = 10;
export const CORE_INDIVIDUAL_MINIMUM = 1;
export const CULTURAL_OLD_CAP = 2;
/** 新制文化課程上路日：民國 113/06/03（西元 2024/6/3） */
export const CULTURAL_NEW_EFFECTIVE_DATE = new Date(2024, 5, 3);
/** 新制規定：受規範的每個證書年度，原住民族文化與多元族群文化各需 1 分 */
export const CULTURAL_NEW_YEARLY_MINIMUM = 1;
export const SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL = true;

/**
 * 修約至兩位小數。
 * 必要原因：來源積分本身都是兩位小數，但 JS 二進位浮點數在「相加」時會產生誤差
 * （例如 5.68 + 0.6 === 6.279999999999999），若不修約會原樣寫進 Excel 報表。
 */
function round2(num: number): number {
  return Number(num.toFixed(2));
}

// Date Helpers
export function rocStrToDate(rocStr: string): Date | null {
  if (!rocStr) return null;
  try {
    const parts = rocStr.split('/');
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0]) + 1911;
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    return new Date(year, month, day);
  } catch (e) {
    return null;
  }
}

export function dateToRocStr(date: Date): string {
  const year = date.getFullYear() - 1911;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export function calculateExpiryDate(effectiveDateStr: string): string {
  const dt = rocStrToDate(effectiveDateStr);
  if (!dt) return "";
  try {
    // Add 6 years
    const year = dt.getFullYear() + 6;
    const month = dt.getMonth();
    const day = dt.getDate();
    
    // Construct target date
    const targetDt = new Date(year, month, day);
    // Subtract 1 day
    targetDt.setDate(targetDt.getDate() - 1);
    return dateToRocStr(targetDt);
  } catch (e) {
    return "";
  }
}

export function calculateEffectiveDate(expiryDateStr: string): string {
  const dt = rocStrToDate(expiryDateStr);
  if (!dt) return "";
  try {
    // Add 1 day
    const targetDt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    targetDt.setDate(targetDt.getDate() + 1);
    // Subtract 6 years
    const year = targetDt.getFullYear() - 6;
    const month = targetDt.getMonth();
    const day = targetDt.getDate();
    
    const effDt = new Date(year, month, day);
    return dateToRocStr(effDt);
  } catch (e) {
    return "";
  }
}

/**
 * 套用舊制文化課程的 2 分認列上限。
 *
 * 法規：113/06/02 前的「原住民族與多元族群文化敏感度及能力」為合併類別，
 * **最多認列 2 分，超過部分不予採計**。
 *
 * 這些積分是透過「課程屬性」計入 120 分總分的，所以要把超額從它原本落入的
 * 屬性桶扣除，不能只從最終總分減掉 —— 否則會與 QER 36 分上限重複扣除，
 * 也會讓 QER 24 分下限的判定失準。
 *
 * 扣除順序為「先扣網路、後扣實體」，與 QER 超額的處理一致，對學員較有利
 * （網路積分另外還受線上採計上限限制，先扣網路造成的淨損失較小）。
 */
function applyCulturalOldCap(pointsData: PointsData): {
  buckets: Record<AttributeBucket, number>;
  excluded: number;
  applied: boolean;
} {
  const buckets: Record<AttributeBucket, number> = {
    professionalPhysical: pointsData.professionalPhysical || 0,
    professionalOnline: pointsData.professionalOnline || 0,
    qualityPhysical: pointsData.qualityPhysical || 0,
    qualityOnline: pointsData.qualityOnline || 0,
    ethicsPhysical: pointsData.ethicsPhysical || 0,
    ethicsOnline: pointsData.ethicsOnline || 0,
    regulationsPhysical: pointsData.regulationsPhysical || 0,
    regulationsOnline: pointsData.regulationsOnline || 0,
  };

  const excess = round2(Math.max(0, (pointsData.culturalOld || 0) - CULTURAL_OLD_CAP));
  if (excess <= 0) return { buckets, excluded: 0, applied: true };

  const records = pointsData.culturalOldRecords;
  if (!records || records.length === 0) {
    // 有超額但不知道要從哪個桶扣，只能誠實回報無法套用
    return { buckets, excluded: 0, applied: false };
  }

  // 網路優先（isPhysical=false 排前面）
  const sorted = [...records].sort((a, b) => Number(a.isPhysical) - Number(b.isPhysical));
  let remaining = excess;
  for (const rec of sorted) {
    if (remaining <= 0) break;
    const key = `${rec.attr}${rec.isPhysical ? 'Physical' : 'Online'}` as AttributeBucket;
    const take = Math.min(remaining, rec.points, buckets[key]);
    if (take <= 0) continue;
    buckets[key] = round2(buckets[key] - take);
    remaining = round2(remaining - take);
  }

  return { buckets, excluded: round2(excess - Math.max(0, remaining)), applied: true };
}

/**
 * 依生效日與到期日切出各個「證書年度」，並標記哪些年度受新制文化課程逐年規定規範。
 *
 * 年度切法：第 i 個年度為 [生效日 + (i-1) 年, 生效日 + i 年 - 1 天]，
 * 最後一個年度的訖日以到期日為界。
 *
 * 受規範的判定採寬鬆解讀：**年度起日** 在新制上路日（113/06/03）當天或之後才要求。
 * 跨過上路日的那個年度不追溯要求，因為該年度開始時規定還沒生效。
 * 若要改為嚴格解讀（年度只要與上路日重疊就要求），把下面的比較改成用 endDt 判斷即可。
 *
 * `asOf` 為評估基準日（預設今天），用來標記各年度是已結束、進行中或還沒開始。
 * 測試請傳入固定日期，否則結果會隨真實時間變動。
 */
export function buildCulturalYearWindows(
  effectiveDateStr: string,
  expiryDateStr: string,
  records: CulturalNewRecord[] = [],
  asOf: Date = new Date()
): CulturalYearWindow[] {
  const effDt = rocStrToDate(effectiveDateStr);
  const expDt = rocStrToDate(expiryDateStr);
  if (!effDt || !expDt || expDt < effDt) return [];

  const windows: CulturalYearWindow[] = [];
  for (let i = 1; i <= 12; i++) {
    const startDt = new Date(effDt.getFullYear() + (i - 1), effDt.getMonth(), effDt.getDate());
    if (startDt > expDt) break;

    let endDt = new Date(effDt.getFullYear() + i, effDt.getMonth(), effDt.getDate());
    endDt.setDate(endDt.getDate() - 1);
    if (endDt > expDt) endDt = expDt;

    const requiresNewRule = startDt >= CULTURAL_NEW_EFFECTIVE_DATE;
    const status: 'past' | 'current' | 'future' =
      endDt < asOf ? 'past' : startDt > asOf ? 'future' : 'current';

    let indigenous = 0;
    let multicultural = 0;
    for (const rec of records) {
      const d = rocStrToDate(rec.date);
      if (!d || d < startDt || d > endDt) continue;
      if (rec.kind === 'indigenous') indigenous += rec.points;
      else multicultural += rec.points;
    }
    indigenous = round2(indigenous);
    multicultural = round2(multicultural);

    windows.push({
      index: i,
      start: dateToRocStr(startDt),
      end: dateToRocStr(endDt),
      requiresNewRule,
      status,
      indigenous,
      multicultural,
      isMet: !requiresNewRule
        || (indigenous >= CULTURAL_NEW_YEARLY_MINIMUM && multicultural >= CULTURAL_NEW_YEARLY_MINIMUM)
    });
  }

  return windows;
}

export function normalizeDateToRocStr(dateInput: any): string {
  if (!dateInput) return "";
  if (dateInput instanceof Date) {
    const year = dateInput.getFullYear() - 1911;
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const day = String(dateInput.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  const dateStr = String(dateInput).trim();
  if (!dateStr || dateStr === '0' || dateStr === 'nan' || dateStr === 'NaT' || dateStr === 'None') {
    return "";
  }

  // Excel serial date (e.g. "44927.0")
  if (dateStr.includes('.') && /^\d+(\.\d+)?$/.test(dateStr)) {
    try {
      const floatVal = parseFloat(dateStr);
      const baseDate = new Date(1900, 0, 1);
      baseDate.setDate(baseDate.getDate() + floatVal - 2); // Excel bug correction
      const year = baseDate.getFullYear() - 1911;
      const month = String(baseDate.getMonth() + 1).padStart(2, '0');
      const day = String(baseDate.getDate()).padStart(2, '0');
      return `${year}/${month}/${day}`;
    } catch (e) {}
  }

  // Slash separated
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      try {
        let year = parseInt(parts[0]);
        const month = String(parseInt(parts[1])).padStart(2, '0');
        const day = String(parseInt(parts[2])).padStart(2, '0');
        if (year > 1911) {
          year -= 1911;
        }
        return `${year}/${month}/${day}`;
      } catch (e) {}
    }
  }

  // Hyphen separated
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length >= 3) {
      try {
        let year = parseInt(parts[0]);
        const month = String(parseInt(parts[1])).padStart(2, '0');
        const day = String(parseInt(parts[2])).padStart(2, '0');
        if (year > 1911) {
          year -= 1911;
        }
        return `${year}/${month}/${day}`;
      } catch (e) {}
    }
  }

  // YYYYMMDD
  if (dateStr.length === 8 && /^\d+$/.test(dateStr)) {
    try {
      let year = parseInt(dateStr.substring(0, 4));
      const month = String(parseInt(dateStr.substring(4, 6))).padStart(2, '0');
      const day = String(parseInt(dateStr.substring(6, 8))).padStart(2, '0');
      if (year > 1911) {
        year -= 1911;
      }
      return `${year}/${month}/${day}`;
    } catch (e) {}
  }

  return dateStr;
}

export function extractCourseDate(courseDateVal: any): string {
  if (!courseDateVal) return "";
  if (courseDateVal instanceof Date) {
    return normalizeDateToRocStr(courseDateVal);
  }
  const valStr = String(courseDateVal).trim();
  const parts = valStr.split(/[~-]/);
  const startPart = parts[0].trim();
  const datePart = startPart.split(' ')[0];
  return normalizeDateToRocStr(datePart);
}

function matchesCategory(course: Course, category: string): boolean {
  const tagsStr = course.tags.join('、');
  const name = course.name;
  
  if (category === '消防安全') {
    return tagsStr.includes('消防安全') || name.includes('消防安全');
  }
  if (category === '緊急應變') {
    return tagsStr.includes('緊急應變') || name.includes('緊急應變');
  }
  if (category === '感染管制') {
    return tagsStr.includes('感染管制') || tagsStr.includes('感染管控') || name.includes('感染管制') || name.includes('感染管控');
  }
  if (category === '性別敏感度') {
    return tagsStr.includes('性別敏感度') || name.includes('性別敏感度');
  }
  if (category === '原住民族文化') {
    return tagsStr.includes('原住民族') || name.includes('原住民族') || tagsStr.includes('原住民') || name.includes('原住民');
  }
  if (category === '多元族群文化') {
    return tagsStr.includes('多元族群') || name.includes('多元族群');
  }
  if (category === '專業品質/倫理/法規') {
    return tagsStr.includes('專業品質') || tagsStr.includes('專業倫理') || tagsStr.includes('專業法規') ||
           name.includes('專業品質') || name.includes('專業倫理') || name.includes('專業法規');
  }
  if (category === '四大核心總積分') {
    return tagsStr.includes('消防安全') || tagsStr.includes('緊急應變') || tagsStr.includes('感染管制') || tagsStr.includes('感染管控') || tagsStr.includes('性別敏感度') ||
           name.includes('消防安全') || name.includes('緊急應變') || name.includes('感染管制') || name.includes('感染管控') || name.includes('性別敏感度');
  }
  if (category === '專業課程') {
    return tagsStr.includes('專業課程') || name.includes('專業課程') || tagsStr.includes('專業品質') || tagsStr.includes('專業倫理') || tagsStr.includes('專業法規');
  }
  return false;
}

export function recommendCourses(
  pointsData: PointsData, 
  results: Omit<CalculationResults, 'recommendedCourses' | 'recommendedCoursesList'>, 
  courses: Course[]
): { recommendedCourses: string; recommendedCoursesList: Course[] } {
  const missingCategories: string[] = [];
  
  if ((pointsData.fireSafety || 0) < CORE_INDIVIDUAL_MINIMUM) {
    missingCategories.push('消防安全');
  }
  if ((pointsData.emergencyResponse || 0) < CORE_INDIVIDUAL_MINIMUM) {
    missingCategories.push('緊急應變');
  }
  if ((pointsData.infectionControl || 0) < CORE_INDIVIDUAL_MINIMUM) {
    missingCategories.push('感染管制');
  }
  if ((pointsData.genderSensitivity || 0) < CORE_INDIVIDUAL_MINIMUM) {
    missingCategories.push('性別敏感度');
  }
  
  if (results.areAllCoreCoursesTaken && !results.isCoreCoursesSumMet) {
    missingCategories.push('四大核心總積分');
  }
  
  if ((pointsData.culturalNewIndigenous || 0) < CORE_INDIVIDUAL_MINIMUM) {
    missingCategories.push('原住民族文化');
  }
  if ((pointsData.culturalNewMulticultural || 0) < CORE_INDIVIDUAL_MINIMUM) {
    missingCategories.push('多元族群文化');
  }
  
  if (!results.isQualityEthicsRegulationsSumMet) {
    missingCategories.push('專業品質/倫理/法規');
  }
  
  if (!results.isTotalPointsMet && missingCategories.length === 0) {
    missingCategories.push('專業課程');
  }
  
  const recommendations: string[] = [];
  const recommendedCoursesList: Course[] = [];
  const validCourses = courses.filter(c => c.points > 0 && !c.name.includes('總表'));
  
  for (const cat of missingCategories) {
    const matchingCourses = validCourses.filter(c => matchesCategory(c, cat));
    if (matchingCourses.length === 0) continue;
    
    const sorted = [...matchingCourses].sort((a, b) => {
      const isAOnline = a.type === '網路課程';
      const isBOnline = b.type === '網路課程';
      if (isAOnline && !isBOnline) return -1;
      if (!isAOnline && isBOnline) return 1;
      return 0;
    });
    
    const bestCourse = sorted[0];
    if (bestCourse) {
      const ptsStr = bestCourse.points ? `${bestCourse.points}分` : '無積分';
      recommendations.push(`【缺${cat}】${bestCourse.name} (${ptsStr}) - ${bestCourse.url}`);
      if (!recommendedCoursesList.some(c => c.url === bestCourse.url)) {
        recommendedCoursesList.push(bestCourse);
      }
    }
  }
  
  return {
    recommendedCourses: recommendations.length > 0 ? recommendations.join('\n') : '',
    recommendedCoursesList
  };
}

// Points Calculator logic
export function calculatePoints(
  pointsData: PointsData,
  courses: Course[] = [],
  asOf: Date = new Date()
): CalculationResults {
  // 先套用舊制文化課程的 2 分認列上限，後續一律以扣除後的桶計算。
  // 必須放在最前面：超額的分數本來就不該計入總分，也不該計入 QER 24 分下限。
  const {
    buckets,
    excluded: culturalOldExcluded,
    applied: isCulturalOldCapApplied,
  } = applyCulturalOldCap(pointsData);

  const professionalPhysical = buckets.professionalPhysical;
  const professionalOnline = buckets.professionalOnline;

  const qerPhysical = buckets.qualityPhysical +
                       buckets.ethicsPhysical +
                       buckets.regulationsPhysical;

  const qerOnline = buckets.qualityOnline +
                     buckets.ethicsOnline +
                     buckets.regulationsOnline;

  // 全部經過 round2：來源積分雖然都是兩位小數，但相加會產生浮點誤差
  // （5.68 + 0.6 === 6.279999999999999），未修約會原樣寫進 Excel 報表。
  const totalOnlineSum = round2(professionalOnline + qerOnline);
  const qualityEthicsRegulationsSum = round2(qerPhysical + qerOnline);

  const professionalSum = round2(professionalPhysical + professionalOnline);
  const isQualityEthicsRegulationsSumMet = qualityEthicsRegulationsSum >= QER_REQUIRED;

  // QER limit calculation (capped at 36)
  const qerOverflow = Math.max(0, qualityEthicsRegulationsSum - QER_CAP);
  const qerOnlineContribution = Math.max(0, qerOnline - qerOverflow);
  const qerPhysicalContribution = Math.max(0, qerPhysical - Math.max(0, qerOverflow - qerOnline));
  const cappedQualityEthicsRegulationsSum = round2(qerOnlineContribution + qerPhysicalContribution);

  // Online limit calculation (60, 40, or 80 depending on effectiveDate)
  const totalPointsBeforeOnlineCap = professionalSum + cappedQualityEthicsRegulationsSum;
  const totalOnlineContribution = professionalOnline + qerOnlineContribution;

  let onlineCap: number | null = null;
  if (pointsData.effectiveDate) {
    const effectiveDt = rocStrToDate(pointsData.effectiveDate);
    if (effectiveDt) {
      if (effectiveDt <= ONLINE_CAP_CUTOFF_DATE) {
        onlineCap = ONLINE_CAP_OLD;
      } else if (effectiveDt >= ONLINE_CAP_NEW_EFFECTIVE_DATE) {
        onlineCap = ONLINE_CAP_NEW;
      } else {
        onlineCap = ONLINE_CAP_MID;
      }
    }
  }

  const onlinePointsCounted = round2(onlineCap !== null ? Math.min(totalOnlineContribution, onlineCap) : totalOnlineContribution);
  const onlineOverflow = round2(totalOnlineContribution - onlinePointsCounted);

  const totalPoints = round2(totalPointsBeforeOnlineCap - onlineOverflow);
  const isTotalPointsMet = totalPoints >= TOTAL_POINTS_REQUIRED;

  // Core courses
  const coreCoursesSum = Number(((pointsData.fireSafety || 0) +
                          (pointsData.emergencyResponse || 0) +
                          (pointsData.infectionControl || 0) +
                          (pointsData.genderSensitivity || 0)).toFixed(2));

  const isCoreCoursesSumMet = coreCoursesSum >= CORE_COURSES_REQUIRED;
  const areAllCoreCoursesTaken = 
    (pointsData.fireSafety || 0) >= CORE_INDIVIDUAL_MINIMUM &&
    (pointsData.emergencyResponse || 0) >= CORE_INDIVIDUAL_MINIMUM &&
    (pointsData.infectionControl || 0) >= CORE_INDIVIDUAL_MINIMUM &&
    (pointsData.genderSensitivity || 0) >= CORE_INDIVIDUAL_MINIMUM;

  // Cultural courses
  const culturalOldCapped = round2(Math.min(pointsData.culturalOld || 0, CULTURAL_OLD_CAP));
  const culturalNewTotal = round2((pointsData.culturalNewIndigenous || 0) +
                            (pointsData.culturalNewMulticultural || 0));

  // 新制文化課程逐年檢核。需要生效日、到期日與逐筆課程日期才能進行；
  // 從雲端小卡載入（無課程明細）時 windows 為空，退回下方的彙總檢核。
  const culturalYearWindows = buildCulturalYearWindows(
    pointsData.effectiveDate,
    pointsData.cardExpiryDate,
    pointsData.culturalNewRecords || [],
    asOf
  );
  const regulatedWindows = culturalYearWindows.filter(w => w.requiresNewRule);
  // 只有「已結束」的年度才算得上未達標：進行中還能補課，未開始的年度更不該列為缺失。
  const closedRegulated = regulatedWindows.filter(w => w.status === 'past');
  const ongoingShort = regulatedWindows.filter(w => w.status === 'current' && !w.isMet);
  const canCheckYearly = culturalYearWindows.length > 0 && (pointsData.culturalNewRecords !== undefined);
  const isCulturalYearlyMet = canCheckYearly ? closedRegulated.every(w => w.isMet) : null;

  // Generate warning notes
  const notes: string[] = [];
  if (!isTotalPointsMet) {
    const needed = (TOTAL_POINTS_REQUIRED - totalPoints).toFixed(2);
    notes.push(`總積分不足，尚缺 ${needed} 分。`);
  }
  if (!isQualityEthicsRegulationsSumMet) {
    const needed = (QER_REQUIRED - qualityEthicsRegulationsSum).toFixed(2);
    notes.push(` 專業品質/倫理/法規積分不足，尚缺 ${needed} 分 (要求至少 ${QER_REQUIRED} 分)。`);
  }
  if (!areAllCoreCoursesTaken) {
    const missing: string[] = [];
    if ((pointsData.fireSafety || 0) < CORE_INDIVIDUAL_MINIMUM) missing.push('消防安全');
    if ((pointsData.emergencyResponse || 0) < CORE_INDIVIDUAL_MINIMUM) missing.push('緊急應變');
    if ((pointsData.infectionControl || 0) < CORE_INDIVIDUAL_MINIMUM) missing.push('感染管制');
    if ((pointsData.genderSensitivity || 0) < CORE_INDIVIDUAL_MINIMUM) missing.push('性別敏感度');
    if (missing.length > 0) {
      notes.push(` 核心課程 '${missing.join('、')}' 積分不足 (各需至少 ${CORE_INDIVIDUAL_MINIMUM} 分)。`);
    }
  } else if (!isCoreCoursesSumMet) {
    const needed = (CORE_COURSES_REQUIRED - coreCoursesSum).toFixed(2);
    notes.push(` 四大核心課程總積分不足，尚缺 ${needed} 分 (要求至少 ${CORE_COURSES_REQUIRED} 分)。`);
  }

  // 舊制文化課程：113/06/02 前為合併類別，最多認列 2 分。
  if (!isCulturalOldCapApplied) {
    const over = round2((pointsData.culturalOld || 0) - CULTURAL_OLD_CAP);
    notes.push(` 舊制文化課程超出認列上限 ${over.toFixed(2)} 分，但此筆無課程明細無法自動扣除，總分可能高估。`);
  } else if (culturalOldExcluded > 0) {
    notes.push(` 舊制文化課程僅採計 ${CULTURAL_OLD_CAP} 分，超出的 ${culturalOldExcluded.toFixed(2)} 分未計入總分。`);
  }

  // 新制文化課程：113/06/03 起為「逐年」規定，每個證書年度各需 1 分。
  // 有課程明細時逐年檢核；沒有明細（例如從雲端小卡載入）時退回整個週期的彙總檢核，
  // 並明確標示無法逐年驗證，避免誤以為已通過。
  if (canCheckYearly) {
    const describe = (w: CulturalYearWindow) => {
      const lack: string[] = [];
      if (w.indigenous < CULTURAL_NEW_YEARLY_MINIMUM) lack.push('原住民族文化');
      if (w.multicultural < CULTURAL_NEW_YEARLY_MINIMUM) lack.push('多元族群文化');
      return `第${w.index}年(${w.start}~${w.end})缺${lack.join('、')}`;
    };
    const missed = closedRegulated.filter(w => !w.isMet);
    if (missed.length > 0) {
      notes.push(` 新制文化課程逐年規定未達標：${missed.map(describe).join('；')}。(113/06/03 起每年度各需 ${CULTURAL_NEW_YEARLY_MINIMUM} 分，已結束年度無法補回)`);
    }
    if (ongoingShort.length > 0) {
      notes.push(` 本年度尚未完成：${ongoingShort.map(describe).join('；')}，請於年度結束前補課。`);
    }
  } else {
    if ((pointsData.culturalNewIndigenous || 0) < CORE_INDIVIDUAL_MINIMUM) {
      notes.push(` 缺『原住民族文化』課程 (需 ${CORE_INDIVIDUAL_MINIMUM} 分)。`);
    }
    if ((pointsData.culturalNewMulticultural || 0) < CORE_INDIVIDUAL_MINIMUM) {
      notes.push(` 缺『多元族群文化』課程 (需 ${CORE_INDIVIDUAL_MINIMUM} 分)。`);
    }
    if (culturalYearWindows.some(w => w.requiresNewRule)) {
      notes.push(` 註：新制文化課程為逐年規定，此筆無課程明細，無法逐年驗證，請自行確認。`);
    }
  }

  const attentionNotes = notes.length === 0 ? '✓ 符合換證基本要求' : notes.join('').trim();

  const partialResults = {
    professionalSum,
    qualityEthicsRegulationsSum,
    isQualityEthicsRegulationsSumMet,
    cappedQualityEthicsRegulationsSum,
    totalOnlineSum,
    onlineCap,
    onlinePointsCounted,
    onlineOverflow,
    totalPoints,
    isTotalPointsMet,
    coreCoursesSum,
    isCoreCoursesSumMet,
    areAllCoreCoursesTaken,
    culturalOldCapped,
    culturalOldExcluded,
    isCulturalOldCapApplied,
    culturalNewTotal,
    culturalYearWindows,
    isCulturalYearlyMet,
    attentionNotes
  };

  const { recommendedCourses, recommendedCoursesList } = recommendCourses(pointsData, partialResults, courses);

  return {
    ...partialResults,
    recommendedCourses,
    recommendedCoursesList
  };
}

// Parser from raw excel rows group to PointsData
export function parseExcelToPointsData(personRows: any[], effectiveDate: string, expiryDate: string): PointsData {
  const d: PointsData = {
    id: "",
    name: "",
    birthday: "",
    cardExpiryDate: expiryDate,
    effectiveDate: effectiveDate,
    earliestCourseDate: "",
    professionalPhysical: 0,
    professionalOnline: 0,
    qualityPhysical: 0,
    qualityOnline: 0,
    ethicsPhysical: 0,
    ethicsOnline: 0,
    regulationsPhysical: 0,
    regulationsOnline: 0,
    fireSafety: 0,
    emergencyResponse: 0,
    infectionControl: 0,
    genderSensitivity: 0,
    culturalOld: 0,
    culturalNewIndigenous: 0,
    culturalNewMulticultural: 0
  };

  // 有課程明細才建立逐筆紀錄。從雲端小卡載入時 personRows 為空，
  // 保持 undefined 讓 calculatePoints 知道「無法逐年檢核」而非「逐年都沒上課」。
  if (personRows.length === 0) return d;
  d.culturalOldRecords = [];
  d.culturalNewRecords = [];

  // Resolve headers based on fuzzy match
  const sample = personRows[0];
  const columns = Object.keys(sample);
  
  const nameCol = columns.find(c => c.includes('人員姓名') || c.includes('姓名')) || '人員姓名';
  const idCol = columns.find(c => c.includes('身分證') || c.includes('ID')) || '身分證字號/\n統一證號';
  const statusCol = columns.find(c => c.includes('認可狀態') || c.includes('認可')) || '認可狀態';
  const courseDateCol = columns.find(c => c.includes('課程日期') || c.includes('日期')) || '課程日期';
  const methodCol = columns.find(c => c.includes('實施方式')) || '實施方式';
  const attrCol = columns.find(c => c.includes('課程屬性') || c.includes('屬性')) || '課程屬性';
  const catCol = columns.find(c => c.includes('課程類別') && !c.includes('職業')) || '課程類別';
  const pointsCol = columns.find(c => c === '積分' || (c.includes('積分') && !c.includes('累積'))) || '積分';

  d.name = String(sample[nameCol] || "").trim();
  d.id = String(sample[idCol] || "").trim();

  // Find earliest course date
  let earliestDt: Date | null = null;
  personRows.forEach(row => {
    const rawDate = row[courseDateCol];
    if (rawDate) {
      const dtStr = extractCourseDate(rawDate);
      if (dtStr) {
        const dt = rocStrToDate(dtStr);
        if (dt) {
          if (!earliestDt || dt < earliestDt) {
            earliestDt = dt;
          }
        }
      }
    }
  });
  d.earliestCourseDate = earliestDt ? dateToRocStr(earliestDt) : "";

  // Parse valid rows
  const validRows = personRows.filter(row => String(row[statusCol]).trim() === '符合');

  validRows.forEach(row => {
    let pts = parseFloat(row[pointsCol]);
    if (isNaN(pts) || pts <= 0) return;

    const methodStr = String(row[methodCol] || "").trim();
    const attrStr = String(row[attrCol] || "").trim();
    const catStr = String(row[catCol] || "").trim();

    // Determine physical vs online
    let isPhysical = true;
    if (methodStr.includes('01-2')) {
      isPhysical = false;
    } else if (methodStr.includes('01-3')) {
      isPhysical = SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL;
    } else if (methodStr.includes('01-1')) {
      isPhysical = true;
    } else {
      if (methodStr.includes('網路') || methodStr.includes('線上')) {
        // 注意：字串 '非同步' 本身就包含 '同步'，必須先判斷非同步，
        // 否則非同步（自學型）線上課程會被誤判為實體課程而規避線上採計上限。
        if (methodStr.includes('非同步')) {
          isPhysical = false;
        } else if (methodStr.includes('同步')) {
          isPhysical = SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL;
        } else {
          isPhysical = false;
        }
      } else {
        isPhysical = true;
      }
    }

    // Accumulate attributes
    // attrKey 記錄這一列落入哪個屬性桶，舊制文化課程套用 2 分上限時要靠它回頭扣除
    let attrKey: CulturalOldRecord['attr'] | null = null;
    if (attrStr.includes('品質')) {
      attrKey = 'quality';
      if (isPhysical) d.qualityPhysical += pts;
      else d.qualityOnline += pts;
    } else if (attrStr.includes('倫理')) {
      attrKey = 'ethics';
      if (isPhysical) d.ethicsPhysical += pts;
      else d.ethicsOnline += pts;
    } else if (attrStr.includes('法規')) {
      attrKey = 'regulations';
      if (isPhysical) d.regulationsPhysical += pts;
      else d.regulationsOnline += pts;
    } else if (attrStr.includes('專業')) {
      attrKey = 'professional';
      if (isPhysical) d.professionalPhysical += pts;
      else d.professionalOnline += pts;
    }

    // Core categories
    if (catStr.includes('消防')) d.fireSafety += pts;
    else if (catStr.includes('緊急')) d.emergencyResponse += pts;
    else if (catStr.includes('感染')) d.infectionControl += pts;
    else if (catStr.includes('性別')) d.genderSensitivity += pts;

    // Cultural categories
    // 舊制是把兩族群併在一個類別，新制拆成兩科，所以合併字串要先比對。
    if (catStr.includes('原住民族與多元族群文化')) {
      d.culturalOld += pts;
      if (attrKey) {
        d.culturalOldRecords?.push({ attr: attrKey, isPhysical, points: pts });
      }
    } else if (catStr.includes('原住民族')) {
      d.culturalNewIndigenous += pts;
      d.culturalNewRecords?.push({ date: extractCourseDate(row[courseDateCol]), kind: 'indigenous', points: pts });
    } else if (catStr.includes('多元族群')) {
      d.culturalNewMulticultural += pts;
      d.culturalNewRecords?.push({ date: extractCourseDate(row[courseDateCol]), kind: 'multicultural', points: pts });
    }
  });

  // Round values
  const round2 = (num: number) => Number(num.toFixed(2));
  d.professionalPhysical = round2(d.professionalPhysical);
  d.professionalOnline = round2(d.professionalOnline);
  d.qualityPhysical = round2(d.qualityPhysical);
  d.qualityOnline = round2(d.qualityOnline);
  d.ethicsPhysical = round2(d.ethicsPhysical);
  d.ethicsOnline = round2(d.ethicsOnline);
  d.regulationsPhysical = round2(d.regulationsPhysical);
  d.regulationsOnline = round2(d.regulationsOnline);
  d.fireSafety = round2(d.fireSafety);
  d.emergencyResponse = round2(d.emergencyResponse);
  d.infectionControl = round2(d.infectionControl);
  d.genderSensitivity = round2(d.genderSensitivity);
  d.culturalOld = round2(d.culturalOld);
  d.culturalNewIndigenous = round2(d.culturalNewIndigenous);
  d.culturalNewMulticultural = round2(d.culturalNewMulticultural);

  return d;
}

/** 把逐年檢核結果壓成一格可讀的報表文字 */
function summariseCulturalYearly(results: CalculationResults): string {
  if (results.isCulturalYearlyMet === null) {
    return '無課程明細，無法逐年驗證';
  }
  const regulated = results.culturalYearWindows.filter(w => w.requiresNewRule);
  if (regulated.length === 0) {
    return '不適用（證書年度均在 113/06/03 前）';
  }

  const lackOf = (w: CulturalYearWindow) => {
    const lack: string[] = [];
    if (w.indigenous < CULTURAL_NEW_YEARLY_MINIMUM) lack.push('原住民族');
    if (w.multicultural < CULTURAL_NEW_YEARLY_MINIMUM) lack.push('多元族群');
    return `第${w.index}年(${w.start}~${w.end})缺${lack.join('、')}`;
  };

  const closed = regulated.filter(w => w.status === 'past');
  const missed = closed.filter(w => !w.isMet);
  const ongoing = regulated.filter(w => w.status === 'current' && !w.isMet);

  const parts: string[] = [];
  if (missed.length > 0) parts.push(`已逾期未達標：${missed.map(lackOf).join('；')}`);
  if (ongoing.length > 0) parts.push(`本年度待補：${ongoing.map(lackOf).join('；')}`);
  if (parts.length === 0) {
    return closed.length > 0
      ? `✓ 已結束的 ${closed.length} 個受規範年度均達標`
      : '✓ 尚無已結束的受規範年度';
  }
  return parts.join('｜');
}

// Prepare CSV row
export function buildCsvRow(studentId: string, pointsData: PointsData, results: CalculationResults): any {
  // 這三個是在報表層相加的，同樣需要修約，否則會把浮點誤差寫進 Excel
  const profTotal = round2(pointsData.professionalPhysical + pointsData.professionalOnline);
  const rawPhysicalTotal = round2(pointsData.professionalPhysical + pointsData.qualityPhysical + pointsData.ethicsPhysical + pointsData.regulationsPhysical);
  const rawOnlineTotal = round2(pointsData.professionalOnline + pointsData.qualityOnline + pointsData.ethicsOnline + pointsData.regulationsOnline);

  return {
    '身分證號': studentId,
    '專業課程_實體': pointsData.professionalPhysical,
    '專業課程_網路': pointsData.professionalOnline,
    '專業課程_總計': profTotal,
    '專業品質_實體': pointsData.qualityPhysical,
    '專業品質_網路': pointsData.qualityOnline,
    '專業倫理_實體': pointsData.ethicsPhysical,
    '專業倫理_網路': pointsData.ethicsOnline,
    '專業法規_實體': pointsData.regulationsPhysical,
    '專業法規_網路': pointsData.regulationsOnline,
    '品質倫理法規_總計': results.cappedQualityEthicsRegulationsSum,
    '消防安全': pointsData.fireSafety,
    '緊急應變': pointsData.emergencyResponse,
    '感染管制': pointsData.infectionControl,
    '性別敏感度': pointsData.genderSensitivity,
    '四大核心_總計': results.coreCoursesSum,
    '原住民族與多元族群文化(舊)': results.culturalOldCapped,
    '舊制文化超上限未採計': results.isCulturalOldCapApplied
      ? results.culturalOldExcluded
      : '無明細無法扣除',
    '原住民族文化(新)': pointsData.culturalNewIndigenous,
    '多元族群文化(新)': pointsData.culturalNewMulticultural,
    '新制文化逐年檢核': summariseCulturalYearly(results),
    '實體課程(raw total)': rawPhysicalTotal,
    '網路課程(raw total)': rawOnlineTotal,
    '最終總計': results.totalPoints,
    '小卡到期日': pointsData.cardExpiryDate,
    '注意': results.attentionNotes,
    '推薦課程': results.recommendedCourses
  };
}
