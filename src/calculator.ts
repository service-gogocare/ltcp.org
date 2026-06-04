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

  culturalOldCapped: number;
  culturalNewTotal: number;

  attentionNotes: string;
  recommendedCourses: string;
  recommendedCoursesList: Course[];
}

// Rules Constants
export const TOTAL_POINTS_REQUIRED = 120;
export const QER_REQUIRED = 24;
export const QER_CAP = 36;
export const ONLINE_CAP_OLD = 60;
export const ONLINE_CAP_NEW = 40;
export const ONLINE_CAP_CUTOFF_DATE = new Date(2023, 9, 12); // Month is 0-indexed in JS (9 = Oct)
export const CORE_COURSES_REQUIRED = 10;
export const CORE_INDIVIDUAL_MINIMUM = 1;
export const CULTURAL_OLD_CAP = 2;
export const SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL = true;

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
export function calculatePoints(pointsData: PointsData, courses: Course[] = []): CalculationResults {
  const professionalPhysical = pointsData.professionalPhysical || 0;
  const professionalOnline = pointsData.professionalOnline || 0;

  const qerPhysical = (pointsData.qualityPhysical || 0) +
                       (pointsData.ethicsPhysical || 0) +
                       (pointsData.regulationsPhysical || 0);

  const qerOnline = (pointsData.qualityOnline || 0) +
                     (pointsData.ethicsOnline || 0) +
                     (pointsData.regulationsOnline || 0);

  const totalOnlineSum = professionalOnline + qerOnline;
  const qualityEthicsRegulationsSum = qerPhysical + qerOnline;

  const professionalSum = professionalPhysical + professionalOnline;
  const isQualityEthicsRegulationsSumMet = qualityEthicsRegulationsSum >= QER_REQUIRED;

  // QER limit calculation (capped at 36)
  const qerOverflow = Math.max(0, qualityEthicsRegulationsSum - QER_CAP);
  const qerOnlineContribution = Math.max(0, qerOnline - qerOverflow);
  const qerPhysicalContribution = Math.max(0, qerPhysical - Math.max(0, qerOverflow - qerOnline));
  const cappedQualityEthicsRegulationsSum = qerOnlineContribution + qerPhysicalContribution;

  // Online limit calculation (40 or 60 depending on effectiveDate)
  const totalPointsBeforeOnlineCap = professionalSum + cappedQualityEthicsRegulationsSum;
  const totalOnlineContribution = professionalOnline + qerOnlineContribution;

  let onlineCap: number | null = null;
  if (pointsData.effectiveDate) {
    const effectiveDt = rocStrToDate(pointsData.effectiveDate);
    if (effectiveDt) {
      onlineCap = effectiveDt <= ONLINE_CAP_CUTOFF_DATE ? ONLINE_CAP_OLD : ONLINE_CAP_NEW;
    }
  }

  const onlinePointsCounted = onlineCap !== null ? Math.min(totalOnlineContribution, onlineCap) : totalOnlineContribution;
  const onlineOverflow = totalOnlineContribution - onlinePointsCounted;

  const totalPoints = Number((totalPointsBeforeOnlineCap - onlineOverflow).toFixed(2));
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
  const culturalOldCapped = Number(Math.min(pointsData.culturalOld || 0, CULTURAL_OLD_CAP).toFixed(2));
  const culturalNewTotal = Number(((pointsData.culturalNewIndigenous || 0) +
                            (pointsData.culturalNewMulticultural || 0)).toFixed(2));

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

  if ((pointsData.culturalNewIndigenous || 0) < CORE_INDIVIDUAL_MINIMUM) {
    notes.push(` 缺『原住民族文化』課程 (需 ${CORE_INDIVIDUAL_MINIMUM} 分)。`);
  }
  if ((pointsData.culturalNewMulticultural || 0) < CORE_INDIVIDUAL_MINIMUM) {
    notes.push(` 缺『多元族群文化』課程 (需 ${CORE_INDIVIDUAL_MINIMUM} 分)。`);
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
    culturalNewTotal,
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

  if (personRows.length === 0) return d;

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
        if (methodStr.includes('同步')) {
          isPhysical = SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL;
        } else {
          isPhysical = false;
        }
      } else {
        isPhysical = true;
      }
    }

    // Accumulate attributes
    if (attrStr.includes('品質')) {
      if (isPhysical) d.qualityPhysical += pts;
      else d.qualityOnline += pts;
    } else if (attrStr.includes('倫理')) {
      if (isPhysical) d.ethicsPhysical += pts;
      else d.ethicsOnline += pts;
    } else if (attrStr.includes('法規')) {
      if (isPhysical) d.regulationsPhysical += pts;
      else d.regulationsOnline += pts;
    } else if (attrStr.includes('專業')) {
      if (isPhysical) d.professionalPhysical += pts;
      else d.professionalOnline += pts;
    }

    // Core categories
    if (catStr.includes('消防')) d.fireSafety += pts;
    else if (catStr.includes('緊急')) d.emergencyResponse += pts;
    else if (catStr.includes('感染')) d.infectionControl += pts;
    else if (catStr.includes('性別')) d.genderSensitivity += pts;

    // Cultural categories
    if (catStr.includes('原住民族與多元族群文化')) {
      d.culturalOld += pts;
    } else if (catStr.includes('原住民族')) {
      d.culturalNewIndigenous += pts;
    } else if (catStr.includes('多元族群')) {
      d.culturalNewMulticultural += pts;
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

// Prepare CSV row
export function buildCsvRow(studentId: string, pointsData: PointsData, results: CalculationResults): any {
  const profTotal = pointsData.professionalPhysical + pointsData.professionalOnline;
  const rawPhysicalTotal = pointsData.professionalPhysical + pointsData.qualityPhysical + pointsData.ethicsPhysical + pointsData.regulationsPhysical;
  const rawOnlineTotal = pointsData.professionalOnline + pointsData.qualityOnline + pointsData.ethicsOnline + pointsData.regulationsOnline;

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
    '原住民族文化(新)': pointsData.culturalNewIndigenous,
    '多元族群文化(新)': pointsData.culturalNewMulticultural,
    '實體課程(raw total)': rawPhysicalTotal,
    '網路課程(raw total)': rawOnlineTotal,
    '最終總計': results.totalPoints,
    '小卡到期日': pointsData.cardExpiryDate,
    '注意': results.attentionNotes,
    '推薦課程': results.recommendedCourses
  };
}
