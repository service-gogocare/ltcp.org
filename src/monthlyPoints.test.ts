import { describe, it, expect } from 'vitest';
import {
  attributePointsToMonths,
  buildPointsDataFromMonths,
  groupMonthlyRecordsByCard,
  ATTRIBUTE_BUCKETS,
  CATEGORY_BUCKETS,
  CARD_YEAR_OUT_OF_RANGE,
  MONTH_UNASSIGNED,
  type MonthlyAttribution,
  type MonthlyPointRecord,
  type CategoryBucket,
} from './monthlyPoints';
import {
  parseExcelToPointsData,
  calculatePoints,
  calculateExpiryDate,
  round2,
  type AttributeBucket,
} from './calculator';

/** 一列衛福部匯出 Excel 的課程明細，只覆寫測試關心的欄位 */
function courseRow(o: {
  status?: string;
  method?: string;
  attr?: string;
  cat?: string;
  points?: number | string;
  date?: string;
}) {
  return {
    '人員姓名': '測試員',
    '身分證字號/\n統一證號': 'A123456789',
    '認可狀態': o.status ?? '符合',
    '課程日期': o.date ?? '112/09/20',
    '實施方式': o.method ?? '01-1 實體課程',
    '課程屬性': o.attr ?? '專業課程',
    '課程類別': o.cat ?? '',
    '積分': o.points ?? 1,
  };
}

/** 把所有月份列在某一欄上加總 */
function total(result: MonthlyAttribution, key: AttributeBucket | CategoryBucket): number {
  return round2(result.rows.reduce((sum, r) => (
    sum + (key in r.buckets
      ? r.buckets[key as AttributeBucket]
      : r.categories[key as CategoryBucket])
  ), 0));
}

const EFF = '112/09/15';
const EXP = calculateExpiryDate(EFF); // 118/09/14

/**
 * 涵蓋各種邊界的一份明細，多個測試共用。
 * 證書年度第 1 年為 112/09/15 ~ 113/09/14，第 2 年自 113/09/15 起。
 */
function fixtureRows() {
  return [
    // 第 1 年，正常
    courseRow({ date: '112/09/20', attr: '專業課程', method: '01-1 實體課程', points: 3.5 }),
    // 生效日之前 → 效期外
    courseRow({ date: '112/09/10', attr: '專業課程', method: '01-1 實體課程', points: 2 }),
    // 第 1 年最後一天（邊界當天）
    courseRow({ date: '113/09/14', attr: '專業品質', method: '01-2 非同步網路課程', points: 1.5 }),
    // 第 2 年第一天（邊界當天）—— 與上一列同為曆月 113/09，必須拆成兩列
    courseRow({ date: '113/09/15', attr: '專業倫理', method: '01-1 實體課程', points: 2.5 }),
    // 同月三筆小數，驗證月內加總與總分的修約一致
    courseRow({ date: '114/03/01', attr: '專業法規', method: '01-2 非同步網路課程', points: 0.33 }),
    courseRow({ date: '114/03/15', attr: '專業法規', method: '01-2 非同步網路課程', points: 0.33 }),
    courseRow({ date: '114/03/20', attr: '專業法規', method: '01-2 非同步網路課程', points: 0.34 }),
    // 核心類別：同一筆分數同時進屬性桶與核心桶
    courseRow({ date: '115/01/10', attr: '專業課程', cat: '消防安全', points: 1 }),
    // 舊制文化（合併類別），屬性為品質、網路
    courseRow({ date: '115/01/11', attr: '專業品質', cat: '原住民族與多元族群文化敏感度及能力', method: '01-2 非同步網路課程', points: 1.2 }),
    // 新制文化兩科
    courseRow({ date: '115/02/05', attr: '專業課程', cat: '原住民族文化', points: 1 }),
    courseRow({ date: '115/02/06', attr: '專業課程', cat: '多元族群文化', points: 1 }),
    // 日期無法解析
    courseRow({ date: '待補', attr: '專業課程', points: 2 }),
    // 屬性對不到四個桶，但類別仍是核心科目
    courseRow({ date: '115/03/01', attr: '其他', cat: '緊急應變', points: 2 }),
    // 不採計的兩種列
    courseRow({ date: '115/03/02', status: '審核中', points: 3 }),
    courseRow({ date: '115/03/03', points: 0 }),
    courseRow({ date: '115/03/04', points: 'N/A' }),
  ];
}

describe('月份合計必須等於 parseExcelToPointsData', () => {
  // 這是整個設計最重要的不變式。做不到的症狀是「總分 128、月份合計 121」，
  // 而且沒有任何錯誤訊息 —— 兩邊各寫一份分類邏輯就會這樣。
  const rows = fixtureRows();
  const monthly = attributePointsToMonths(rows, EFF, EXP);
  const direct = parseExcelToPointsData(rows, EFF, EXP);

  it.each([...ATTRIBUTE_BUCKETS])('屬性桶 %s 逐欄相等', (key) => {
    expect(total(monthly, key)).toBe(round2(direct[key]));
  });

  it.each([...CATEGORY_BUCKETS])('類別桶 %s 逐欄相等', (key) => {
    expect(total(monthly, key)).toBe(round2(direct[key]));
  });

  it('效期外與無法解析日期的積分都還在，沒有被丟掉', () => {
    // 2（效期外）+ 2（無法解析）都要出現在月份列裡，否則合計會少 4 分
    expect(monthly.outOfRangePoints).toBe(2);
    expect(monthly.unassignedPoints).toBe(2);
    expect(total(monthly, 'professionalPhysical')).toBe(round2(direct.professionalPhysical));
  });

  it('三筆小數在同一個月加總後與總分的修約一致', () => {
    const march = monthly.rows.find(r => r.month === '114/03');
    expect(march?.buckets.regulationsOnline).toBe(1);
    expect(direct.regulationsOnline).toBe(1);
  });
});

describe('證書年度歸屬', () => {
  it('課程日期落在年度邊界當天，算在該年度內', () => {
    const result = attributePointsToMonths([
      courseRow({ date: '112/09/15', points: 1 }), // 第 1 年第一天
      courseRow({ date: '113/09/14', points: 1 }), // 第 1 年最後一天
      courseRow({ date: '113/09/15', points: 1 }), // 第 2 年第一天
    ], EFF, EXP);

    const years = result.rows.map(r => r.cardYearIndex);
    expect(years).toEqual([1, 1, 2]);
  });

  it('同一曆月橫跨年度邊界時拆成兩列', () => {
    const result = attributePointsToMonths([
      courseRow({ date: '113/09/14', attr: '專業課程', points: 2 }),
      courseRow({ date: '113/09/15', attr: '專業課程', points: 3 }),
    ], EFF, EXP);

    const september = result.rows.filter(r => r.month === '113/09');
    expect(september).toHaveLength(2);
    expect(september[0].cardYearIndex).toBe(1);
    expect(september[0].buckets.professionalPhysical).toBe(2);
    expect(september[1].cardYearIndex).toBe(2);
    expect(september[1].buckets.professionalPhysical).toBe(3);
  });

  it('課程日期在效期外仍保留曆月，只是不屬於任何年度', () => {
    const result = attributePointsToMonths([
      courseRow({ date: '112/08/01', attr: '專業課程', points: 4 }),
    ], EFF, EXP);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].month).toBe('112/08');
    expect(result.rows[0].cardYearIndex).toBe(CARD_YEAR_OUT_OF_RANGE);
    expect(result.rows[0].buckets.professionalPhysical).toBe(4);
    expect(result.outOfRangePoints).toBe(4);
  });

  it('課程日期無法解析時歸到無月份的列，積分不消失', () => {
    const result = attributePointsToMonths([
      courseRow({ date: '', attr: '專業課程', points: 1.5 }),
      courseRow({ date: '不詳', attr: '專業課程', points: 2.5 }),
    ], EFF, EXP);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].month).toBe(MONTH_UNASSIGNED);
    expect(result.rows[0].cardYearIndex).toBe(CARD_YEAR_OUT_OF_RANGE);
    expect(result.rows[0].buckets.professionalPhysical).toBe(4);
    expect(result.unassignedPoints).toBe(4);
  });

  it('生效日空白（待補人員）不擲錯，積分完整保留待日後歸位', () => {
    const result = attributePointsToMonths([
      courseRow({ date: '114/03/01', attr: '專業課程', points: 3 }),
    ], '', '');

    expect(result.hasCardWindow).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].month).toBe('114/03');
    expect(result.rows[0].cardYearIndex).toBe(CARD_YEAR_OUT_OF_RANGE);
    expect(result.rows[0].buckets.professionalPhysical).toBe(3);
  });

  it('起訖日正常時 hasCardWindow 為真', () => {
    expect(attributePointsToMonths([courseRow({})], EFF, EXP).hasCardWindow).toBe(true);
  });
});

describe('不採計與未歸類的積分都要說得出去向', () => {
  it('認可狀態非「符合」計入 skippedNotApproved', () => {
    const result = attributePointsToMonths([
      courseRow({ status: '審核中', points: 3 }),
      courseRow({ status: '不符合', points: 3 }),
      courseRow({ status: '符合', points: 3 }),
    ], EFF, EXP);

    expect(result.skippedNotApproved).toBe(2);
    expect(total(result, 'professionalPhysical')).toBe(3);
  });

  it('積分非數字或不大於 0 的列，記下它在明細中的位置', () => {
    const result = attributePointsToMonths([
      courseRow({ points: 1 }),
      courseRow({ points: 0 }),
      courseRow({ points: 'N/A' }),
      courseRow({ points: -2 }),
    ], EFF, EXP);

    expect(result.invalidPointsRows).toEqual([1, 2, 3]);
  });

  it('課程屬性對不到桶的積分不進總分，但核心類別照樣計入', () => {
    const result = attributePointsToMonths([
      courseRow({ date: '114/03/01', attr: '', cat: '消防安全', points: 2 }),
    ], EFF, EXP);

    expect(result.unattributedPoints).toBe(2);
    expect(total(result, 'professionalPhysical')).toBe(0);
    // 屬性欄空白不該讓這門課從四大核心裡消失
    expect(total(result, 'fireSafety')).toBe(2);
  });
});

describe('舊制文化的屬性拆解', () => {
  it('記錄舊制文化落在哪個屬性桶，供 2 分上限超額扣除', () => {
    const result = attributePointsToMonths([
      courseRow({
        date: '113/01/10', attr: '專業品質', method: '01-2 非同步網路課程',
        cat: '原住民族與多元族群文化敏感度及能力', points: 1.5,
      }),
      courseRow({
        date: '113/01/20', attr: '專業課程', method: '01-1 實體課程',
        cat: '原住民族與多元族群文化敏感度及能力', points: 1.2,
      }),
    ], EFF, EXP);

    const row = result.rows[0];
    expect(row.categories.culturalOld).toBe(2.7);
    expect(row.culturalOldByBucket.qualityOnline).toBe(1.5);
    expect(row.culturalOldByBucket.professionalPhysical).toBe(1.2);
    // 舊制文化的積分同時也在屬性桶裡 —— 那正是 2 分上限要回頭扣除的地方
    expect(row.buckets.qualityOnline).toBe(1.5);
    expect(row.buckets.professionalPhysical).toBe(1.2);
  });

  it('新制文化不進舊制拆解', () => {
    const result = attributePointsToMonths([
      courseRow({ date: '113/07/10', attr: '專業課程', cat: '原住民族文化', points: 1 }),
    ], EFF, EXP);

    const row = result.rows[0];
    expect(row.categories.culturalNewIndigenous).toBe(1);
    expect(row.categories.culturalOld).toBe(0);
    expect(row.culturalOldByBucket.professionalPhysical).toBe(0);
  });
});

describe('列的產生與排序', () => {
  it('沒有課程明細時回傳空列，不擲錯', () => {
    const result = attributePointsToMonths([], EFF, EXP);
    expect(result.rows).toEqual([]);
    expect(result.hasCardWindow).toBe(true);
  });

  it('Excel 內重複的列不去重，兩筆都算', () => {
    const dup = courseRow({ date: '114/05/01', attr: '專業課程', points: 2 });
    const result = attributePointsToMonths([dup, { ...dup }], EFF, EXP);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].buckets.professionalPhysical).toBe(4);
  });

  it('依曆月排序，無法歸月的列排最後', () => {
    const result = attributePointsToMonths([
      courseRow({ date: '114/05/01', points: 1 }),
      courseRow({ date: '不詳', points: 1 }),
      courseRow({ date: '113/02/01', points: 1 }),
      courseRow({ date: '114/01/01', points: 1 }),
    ], EFF, EXP);

    expect(result.rows.map(r => r.month)).toEqual([
      '113/02', '114/01', '114/05', MONTH_UNASSIGNED,
    ]);
  });

  it('民國 99 年以前的曆月不會因字串比大小而排錯', () => {
    // 字典序會把 '100/01' 排在 '99/12' 前面 —— 這裡必須用數值比較
    const result = attributePointsToMonths([
      courseRow({ date: '100/01/05', points: 1 }),
      courseRow({ date: '99/12/05', points: 1 }),
    ], '', '');

    expect(result.rows.map(r => r.month)).toEqual(['99/12', '100/01']);
  });
});


// ── 從月份列反推回 PointsData（階段 E）────────────────────────────

/**
 * 基準日固定在 115/01/01。
 * 證書年度：第 1 年 112/09/15~113/09/14（不受新制規範，起日早於 113/06/03）、
 * 第 2 年 113/09/15~114/09/14（受規範且**已結束**）、第 3 年 114/09/15~ 進行中。
 */
const ASOF = new Date(2026, 0, 1);
const CARD_ID = 'A123456789_照顧服務人員';
const CARD = { cardId: CARD_ID, name: '王小明', effectiveDate: EFF, expiryDate: EXP };

/** 專門觸發 README 記載的兩個缺陷：舊制文化超上限、新制文化逐年檢核 */
function defectRows() {
  return [
    courseRow({ date: '112/10/01', attr: '專業課程', method: '01-1 實體課程', points: 10 }),
    // 舊制文化合計 3.5 分，超出 2 分上限 1.5 分。網路那筆要先被扣。
    courseRow({
      date: '113/03/05', attr: '專業品質', method: '01-2 非同步網路課程',
      cat: '原住民族與多元族群文化敏感度及能力', points: 2,
    }),
    courseRow({
      date: '113/04/10', attr: '專業課程', method: '01-1 實體課程',
      cat: '原住民族與多元族群文化敏感度及能力', points: 1.5,
    }),
    // 第 2 年只有一般課程，沒有新制文化 —— 該年度已結束，逐年檢核要判定未達標
    courseRow({ date: '113/12/01', attr: '專業倫理', method: '01-1 實體課程', points: 3 }),
    // 第 3 年（進行中）兩科都有
    courseRow({ date: '114/10/20', attr: '專業課程', cat: '原住民族文化', points: 1 }),
    courseRow({ date: '114/10/21', attr: '專業課程', cat: '多元族群文化', points: 1 }),
    courseRow({ date: '114/11/05', attr: '專業課程', cat: '消防安全', points: 2 }),
  ];
}

function toRecords(attribution: MonthlyAttribution, eff = EFF): MonthlyPointRecord[] {
  return attribution.rows.map((row) => ({
    cardId: CARD_ID, name: '王小明', analyzedEffectiveDate: eff, row,
  }));
}

describe('雲端載入的結果必須與直接分析 Excel 一致', () => {
  const rows = defectRows();
  const direct = calculatePoints(parseExcelToPointsData(rows, EFF, EXP), [], ASOF);
  const { pointsData, effectiveDateChanged } = buildPointsDataFromMonths(
    toRecords(attributePointsToMonths(rows, EFF, EXP)), CARD,
  );
  const viaMonths = calculatePoints(pointsData, [], ASOF);

  it('統計結果每一個欄位都相同', () => {
    // 這一條斷了就代表「剛跑完分析」與「從雲端載入」會對同一個人給出
    // 不同的數字，而使用者沒有任何辦法知道該信哪一個。
    expect(viaMonths).toEqual(direct);
  });

  it('舊制文化的 2 分上限扣得掉了（README 缺陷一消失）', () => {
    expect(viaMonths.isCulturalOldCapApplied).toBe(true);
    expect(viaMonths.culturalOldExcluded).toBe(1.5);
    // 超額 1.5 分從網路那筆扣：專業品質-網路 2 → 0.5，實體那筆不動
    expect(viaMonths.qualityEthicsRegulationsSum).toBe(direct.qualityEthicsRegulationsSum);
  });

  it('新制文化逐年檢核算得出來（README 缺陷二消失）', () => {
    expect(viaMonths.isCulturalYearlyMet).not.toBeNull();
    // 第 2 年已結束且受規範，卻沒有新制文化課程
    expect(viaMonths.isCulturalYearlyMet).toBe(false);

    const y2 = viaMonths.culturalYearWindows.find((w) => w.index === 2);
    expect(y2?.requiresNewRule).toBe(true);
    expect(y2?.status).toBe('past');
    expect(y2?.isMet).toBe(false);

    const y3 = viaMonths.culturalYearWindows.find((w) => w.index === 3);
    expect(y3?.indigenous).toBe(1);
    expect(y3?.multicultural).toBe(1);
    expect(y3?.isMet).toBe(true);
  });

  it('四大核心算得出來', () => {
    expect(viaMonths.coreCoursesSum).toBe(direct.coreCoursesSum);
    expect(pointsData.fireSafety).toBe(2);
  });

  it('生效日沒變時不會誤報', () => {
    expect(effectiveDateChanged).toBe(false);
  });
});

describe('月份列的順序不影響結果', () => {
  it('把 Excel 的列倒過來，兩條路徑的結果都不變', () => {
    // 舊制文化超額要從哪個桶扣，以前取決於列順序 —— 而 professionalOnline
    // 與 qualityOnline 落在不同的總和，所以順序會改變總分。
    const rows = defectRows();
    const reversed = [...rows].reverse();

    expect(calculatePoints(parseExcelToPointsData(reversed, EFF, EXP), [], ASOF))
      .toEqual(calculatePoints(parseExcelToPointsData(rows, EFF, EXP), [], ASOF));

    const fromReversed = buildPointsDataFromMonths(
      toRecords(attributePointsToMonths(reversed, EFF, EXP)), CARD,
    ).pointsData;
    const fromOriginal = buildPointsDataFromMonths(
      toRecords(attributePointsToMonths(rows, EFF, EXP)), CARD,
    ).pointsData;

    expect(calculatePoints(fromReversed, [], ASOF)).toEqual(calculatePoints(fromOriginal, [], ASOF));
  });
});

describe('沒有月份資料時的行為', () => {
  it('一列都沒有時維持「無明細」語意，不會把人判成逐年未達標', () => {
    // 空物件會變成「查過了、每年都 0 分」，於是已結束的受規範年度全被判未達標；
    // 但事實只是這個人還沒存過分析結果。
    const { pointsData } = buildPointsDataFromMonths([], CARD);
    expect(pointsData.culturalNewByYear).toBeUndefined();
    expect(pointsData.culturalOldRecords).toBeUndefined();

    const results = calculatePoints(pointsData, [], ASOF);
    expect(results.isCulturalYearlyMet).toBeNull();
  });

  it('有列但都是 0 分時，逐年檢核照常進行', () => {
    const { pointsData } = buildPointsDataFromMonths(
      toRecords(attributePointsToMonths([courseRow({ date: '113/12/01', points: 1 })], EFF, EXP)),
      CARD,
    );
    expect(calculatePoints(pointsData, [], ASOF).isCulturalYearlyMet).toBe(false);
  });
});

describe('生效日變更的偵測', () => {
  it('名冊上的生效日與分析當下不同時要報出來', () => {
    const records = toRecords(attributePointsToMonths(defectRows(), EFF, EXP), '112/09/15');
    const result = buildPointsDataFromMonths(records, { ...CARD, effectiveDate: '113/01/01' });

    // 曆月跨年度時怎麼拆兩列由課程日期決定，而明細已經丟掉了 ——
    // 生效日一改，年度邊界跟著移動，已存的列無法重算
    expect(result.effectiveDateChanged).toBe(true);
    expect(result.analyzedEffectiveDate).toBe('112/09/15');
  });

  it('月報上沒記生效日時不當成變更', () => {
    const records = toRecords(attributePointsToMonths(defectRows(), EFF, EXP), '');
    expect(buildPointsDataFromMonths(records, CARD).effectiveDateChanged).toBe(false);
  });
});

describe('groupMonthlyRecordsByCard', () => {
  it('依 cardId 分組，同一人的兩種職業類別分開', () => {
    const attribution = attributePointsToMonths(defectRows(), EFF, EXP);
    const mixed: MonthlyPointRecord[] = [
      ...attribution.rows.map((row) => ({
        cardId: 'A123456789_照顧服務人員', name: '王小明', analyzedEffectiveDate: EFF, row,
      })),
      ...attribution.rows.map((row) => ({
        cardId: 'A123456789_居家服務督導員', name: '王小明', analyzedEffectiveDate: EFF, row,
      })),
    ];

    const grouped = groupMonthlyRecordsByCard(mixed);
    expect([...grouped.keys()]).toEqual([
      'A123456789_照顧服務人員', 'A123456789_居家服務督導員',
    ]);
    expect(grouped.get('A123456789_照顧服務人員')).toHaveLength(attribution.rows.length);
  });
});
