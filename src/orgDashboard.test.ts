import { describe, it, expect } from 'vitest';
import {
  summariseOrg,
  buildExpirySchedule,
  expiryBucketOf,
  collectExceptions,
  shortfallLabels,
  isFullyMet,
  sortOverview,
  EXPIRY_BUCKET_ORDER,
} from './orgDashboard';
import { RISK_ORDER, type ReviewRow } from './monthlyReview';
import type { CalculationResults } from './calculator';

/** 只有這些測試在意的欄位是真的，其餘給無害的預設值 */
function row(
  over: Omit<Partial<ReviewRow>, 'results'> & { results?: Partial<CalculationResults> } = {},
): ReviewRow {
  const { results: resultsOver, ...rest } = over;
  const results = {
    professionalSum: 0, qualityEthicsRegulationsSum: 0,
    isQualityEthicsRegulationsSumMet: false, cappedQualityEthicsRegulationsSum: 0,
    totalOnlineSum: 0, onlineCap: null, onlinePointsCounted: 0, onlineOverflow: 0,
    totalPoints: 0, isTotalPointsMet: false,
    coreCoursesSum: 0, isCoreCoursesSumMet: false, areAllCoreCoursesTaken: false,
    culturalOldCapped: 0, culturalOldExcluded: 0, isCulturalOldCapApplied: false,
    culturalNewTotal: 0, culturalYearWindows: [], isCulturalYearlyMet: null,
    attentionNotes: '', recommendedCourses: '', recommendedCoursesList: [],
    ...resultsOver,
  } as CalculationResults;

  return {
    cardId: 'A1_照顧服務人員', studentId: 'A1', name: '甲', role: '照顧服務人員',
    nationality: '臺灣', effectiveDate: '112/09/15', expiryDate: '118/09/14',
    pointsData: {} as ReviewRow['pointsData'],
    results,
    progress: { totalDays: 2192, elapsedDays: 1096, elapsedRatio: 0.5, expectedPoints: 60 },
    daysToExpiry: 1000,
    culturalOverdue: [], culturalPending: [], culturalCheckable: true,
    missingCoreSubjects: [], coreShortfall: 0, qerOverflow: 0,
    onlineRemaining: null, totalShortfall: 0,
    effectiveDateChanged: false, analyzedEffectiveDate: '112/09/15',
    cumulative: [], recordCount: 5,
    risk: 'ok',
    ...rest,
  };
}

const allMet = {
  isTotalPointsMet: true, isQualityEthicsRegulationsSumMet: true,
  isCoreCoursesSumMet: true, areAllCoreCoursesTaken: true, isCulturalYearlyMet: true,
};

describe('isFullyMet', () => {
  it('五個條件都成立才算達標', () => {
    expect(isFullyMet(row({ results: allMet }))).toBe(true);
  });

  it('少一個條件就不算', () => {
    expect(isFullyMet(row({ results: { ...allMet, isCoreCoursesSumMet: false } }))).toBe(false);
  });

  it('無法逐年檢核（null）不算達標 —— 我們不知道，不能當成沒問題', () => {
    expect(isFullyMet(row({ results: { ...allMet, isCulturalYearlyMet: null } }))).toBe(false);
  });
});

describe('summariseOrg', () => {
  it('進度用總和相除，不是每個人的百分比再平均', () => {
    // 剛入職的人應達 3 分、實得 3 分是 100%，但他不該把全機構拉到高分。
    // 總和相除：(3 + 30) / (3 + 120) = 27%
    const s = summariseOrg([
      row({ results: { totalPoints: 3 }, progress: { totalDays: 2192, elapsedDays: 55, elapsedRatio: 0.025, expectedPoints: 3 } }),
      row({ results: { totalPoints: 30 }, progress: { totalDays: 2192, elapsedDays: 2192, elapsedRatio: 1, expectedPoints: 120 } }),
    ]);
    expect(s.earnedSum).toBe(33);
    expect(s.expectedSum).toBe(123);
    expect(s.progressPercent).toBe(27);
  });

  it('起訖日算不出來的人不進分子也不進分母', () => {
    const s = summariseOrg([
      row({ results: { totalPoints: 60 } }),                    // 應達 60
      row({ progress: null, results: { totalPoints: 999 } }),    // 完全不計入
    ]);
    expect(s.earnedSum).toBe(60);
    expect(s.expectedSum).toBe(60);
    expect(s.progressPercent).toBe(100);
  });

  it('沒有人算得出應達時回傳 null 而不是 0%', () => {
    // 0% 讀起來像「全機構掛零」，而事實是「還算不出來」
    expect(summariseOrg([row({ progress: null })]).progressPercent).toBeNull();
  });

  it('分別數出達標、待處理、尚未統計的人數', () => {
    const s = summariseOrg([
      row({ results: allMet, risk: 'ok' }),
      row({ risk: 'overdue' }),
      row({ risk: 'unknown', recordCount: 0 }),
    ]);
    expect(s).toMatchObject({ total: 3, met: 1, todo: 2, notAnalysed: 1 });
  });

  it('空名冊不會擲錯', () => {
    expect(summariseOrg([])).toMatchObject({ total: 0, met: 0, progressPercent: null });
  });
});

describe('expiryBucketOf', () => {
  it('依剩餘天數分組', () => {
    expect(expiryBucketOf(row({ daysToExpiry: -1 }))).toBe('expired');
    expect(expiryBucketOf(row({ daysToExpiry: 0 }))).toBe('within90');
    expect(expiryBucketOf(row({ daysToExpiry: 90 }))).toBe('within90');
    expect(expiryBucketOf(row({ daysToExpiry: 91 }))).toBe('within180');
    expect(expiryBucketOf(row({ daysToExpiry: 365 }))).toBe('within365');
    expect(expiryBucketOf(row({ daysToExpiry: 366 }))).toBe('later');
  });

  it('到期日算不出來歸入 unknown，不要塞進「1 年以上」', () => {
    // 塞進 later 的話它看起來像「還很久，不用管」—— 而事實是資料缺了
    expect(expiryBucketOf(row({ daysToExpiry: null }))).toBe('unknown');
  });
});

describe('buildExpirySchedule', () => {
  it('保留空的分組，「3 個月內 0 人」本身就是要確認的事', () => {
    const buckets = buildExpirySchedule([row({ daysToExpiry: 1000 })]);
    expect(buckets.map(b => b.key)).toEqual(EXPIRY_BUCKET_ORDER);
    expect(buckets.find(b => b.key === 'within90')!.rows).toEqual([]);
  });

  it('每組內越快到期的排前面', () => {
    const buckets = buildExpirySchedule([
      row({ name: '晚', daysToExpiry: 80 }),
      row({ name: '早', daysToExpiry: 10 }),
    ]);
    expect(buckets.find(b => b.key === 'within90')!.rows.map(r => r.name)).toEqual(['早', '晚']);
  });
});

describe('collectExceptions', () => {
  it('三類分開，因為處置完全不同', () => {
    const e = collectExceptions([
      row({ name: '待補', progress: null }),
      row({ name: '沒統計', recordCount: 0 }),
      row({ name: '要重算', effectiveDateChanged: true }),
      row({ name: '正常' }),
    ]);
    expect(e.pendingDates.map(r => r.name)).toEqual(['待補']);
    expect(e.notAnalysed.map(r => r.name)).toEqual(['沒統計']);
    expect(e.needsRecompute.map(r => r.name)).toEqual(['要重算']);
  });

  it('同一個人可以同時出現在兩類 —— 這是三張待辦清單，不是分桶', () => {
    const e = collectExceptions([row({ name: '甲', progress: null, recordCount: 0 })]);
    expect(e.pendingDates).toHaveLength(1);
    expect(e.notAnalysed).toHaveLength(1);
  });
});

describe('shortfallLabels', () => {
  it('起訖日待補時只講這一件事，其他判定都不可信', () => {
    expect(shortfallLabels(row({ progress: null, totalShortfall: 120 }))).toEqual(['小卡起訖日待補']);
  });

  it('尚未統計時只講這一件事', () => {
    expect(shortfallLabels(row({ recordCount: 0, totalShortfall: 120 }))).toEqual(['尚未統計']);
  });

  it('沒有待辦時回傳空陣列', () => {
    expect(shortfallLabels(row({ results: allMet }))).toEqual([]);
  });

  it('列出各項缺口', () => {
    const labels = shortfallLabels(row({
      totalShortfall: 40,
      missingCoreSubjects: ['消防安全'],
      culturalOverdue: [{ index: 2 }] as ReviewRow['culturalOverdue'],
      qerOverflow: 5,
      results: { isQualityEthicsRegulationsSumMet: true },
    }));
    expect(labels).toContain('總分缺 40');
    expect(labels).toContain('文化逾期 1 年');
    expect(labels).toContain('缺核心：消防安全');
    expect(labels).toContain('QER 超上限 5 分');
  });

  it('缺科目時不再重複講「核心缺幾分」', () => {
    // 兩句講同一件事，而「缺哪一科」比「缺幾分」更可行動
    const labels = shortfallLabels(row({
      missingCoreSubjects: ['消防安全'], coreShortfall: 9,
      results: { isQualityEthicsRegulationsSumMet: true },
    }));
    expect(labels.filter(l => l.includes('核心'))).toHaveLength(1);
  });
});

describe('sortOverview', () => {
  const rows = [
    row({ name: '乙', daysToExpiry: 500, results: { totalPoints: 10 }, risk: 'ok' }),
    row({ name: '甲', daysToExpiry: 100, results: { totalPoints: 90 }, risk: 'overdue' }),
  ];

  it('預設依危險度，與人員積分審視一致', () => {
    expect(sortOverview(rows, 'risk', RISK_ORDER).map(r => r.name)).toEqual(['甲', '乙']);
  });

  it('依到期日：越快到期越前面', () => {
    expect(sortOverview(rows, 'expiry', RISK_ORDER).map(r => r.name)).toEqual(['甲', '乙']);
  });

  it('依實得：低分在前，掃視是為了找出誰落後', () => {
    expect(sortOverview(rows, 'earned', RISK_ORDER).map(r => r.name)).toEqual(['乙', '甲']);
  });

  it('不改動傳進來的陣列', () => {
    const original = [...rows];
    sortOverview(rows, 'name', RISK_ORDER);
    expect(rows).toEqual(original);
  });

  it('到期日算不出來的排最後，不要因為 null 被當成 0 而排到最前面', () => {
    const withNull = [...rows, row({ name: '待補', daysToExpiry: null })];
    expect(sortOverview(withNull, 'expiry', RISK_ORDER).at(-1)!.name).toBe('待補');
  });
});
