import { describe, it, expect } from 'vitest';
import {
  calculatePoints,
  parseExcelToPointsData,
  calculateExpiryDate,
  calculateEffectiveDate,
  rocStrToDate,
  dateToRocStr,
  normalizeDateToRocStr,
  extractCourseDate,
  buildCsvRow,
  TOTAL_POINTS_REQUIRED,
  QER_REQUIRED,
  QER_CAP,
  ONLINE_CAP_OLD,
  ONLINE_CAP_MID,
  ONLINE_CAP_NEW,
  CORE_COURSES_REQUIRED,
  CULTURAL_OLD_CAP,
  type PointsData,
  type Course,
} from './calculator';

/** 產生一份全 0 的 PointsData，只覆寫測試關心的欄位 */
function pd(overrides: Partial<PointsData> = {}): PointsData {
  return {
    id: 'A123456789',
    name: '測試員',
    birthday: '',
    cardExpiryDate: '',
    effectiveDate: '',
    earliestCourseDate: '',
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
    culturalNewMulticultural: 0,
    ...overrides,
  };
}

/** 一份完全符合換證要求的資料，用來當基準線 */
function compliant(overrides: Partial<PointsData> = {}): PointsData {
  return pd({
    effectiveDate: '113/01/01',
    professionalPhysical: 100,
    qualityPhysical: 24,
    fireSafety: 3,
    emergencyResponse: 3,
    infectionControl: 2,
    genderSensitivity: 2,
    culturalNewIndigenous: 1,
    culturalNewMulticultural: 1,
    ...overrides,
  });
}

/** 產生一列衛福部匯出格式的課程資料 */
function row(o: {
  status?: string;
  method?: string;
  attr?: string;
  cat?: string;
  points?: number | string;
  date?: string;
  name?: string;
  id?: string;
}) {
  return {
    '人員姓名': o.name ?? '測試員',
    '身分證字號/\n統一證號': o.id ?? 'A123456789',
    '認可狀態': o.status ?? '符合',
    '課程日期': o.date ?? '112/09/01',
    '實施方式': o.method ?? '01-1 實體課程',
    '課程屬性': o.attr ?? '專業課程',
    '課程類別': o.cat ?? '',
    '積分': o.points ?? 1,
  };
}

describe('法規常數', () => {
  it('與換證辦法一致', () => {
    expect(TOTAL_POINTS_REQUIRED).toBe(120);
    expect(QER_REQUIRED).toBe(24);
    expect(QER_CAP).toBe(36);
    expect(ONLINE_CAP_OLD).toBe(60);
    expect(ONLINE_CAP_MID).toBe(40);
    expect(ONLINE_CAP_NEW).toBe(80);
    expect(CORE_COURSES_REQUIRED).toBe(10);
    expect(CULTURAL_OLD_CAP).toBe(2);
  });
});

describe('民國年日期轉換', () => {
  it('民國轉西元', () => {
    const d = rocStrToDate('112/09/01');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2023);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(1);
  });

  it('西元轉民國字串', () => {
    expect(dateToRocStr(new Date(2023, 8, 1))).toBe('112/09/01');
    expect(dateToRocStr(new Date(2029, 7, 31))).toBe('118/08/31');
  });

  it('格式錯誤回傳 null', () => {
    expect(rocStrToDate('')).toBeNull();
    expect(rocStrToDate('112/09')).toBeNull();
  });
});

describe('小卡效期雙向推算', () => {
  it('生效日加 6 年減 1 天等於到期日', () => {
    expect(calculateExpiryDate('112/09/01')).toBe('118/08/31');
  });

  it('到期日加 1 天減 6 年等於生效日', () => {
    expect(calculateEffectiveDate('118/08/31')).toBe('112/09/01');
  });

  it.each([
    '100/01/01',
    '105/06/15',
    '112/09/01',
    '112/12/31',
    '115/07/01',
    '120/03/10',
  ])('%s 可雙向來回還原', (eff) => {
    expect(calculateEffectiveDate(calculateExpiryDate(eff))).toBe(eff);
  });

  it('跨年月底不會位移', () => {
    expect(calculateExpiryDate('112/12/31')).toBe('118/12/30');
  });

  it('空字串或格式錯誤回傳空字串', () => {
    expect(calculateExpiryDate('')).toBe('');
    expect(calculateEffectiveDate('bad')).toBe('');
  });

  // 已知限制：2/29 生效的小卡無法雙向還原。
  // 105/02/29 加 6 年落在不存在的 111/02/29，JS Date 溢位到 03/01，
  // 減 1 天得到 111/02/28；再反推就變成 105/03/01，與原本差一天。
  it('閏日生效日反推會位移一天（已知限制）', () => {
    const expiry = calculateExpiryDate('105/02/29');
    expect(expiry).toBe('111/02/28');
    expect(calculateEffectiveDate(expiry)).toBe('105/03/01');
  });
});

describe('線上課程採計上限依生效日三段切換', () => {
  const cap = (effectiveDate: string) => calculatePoints(pd({ effectiveDate })).onlineCap;

  it('生效日在 112/10/12 前含當日上限 60', () => {
    expect(cap('112/10/11')).toBe(ONLINE_CAP_OLD);
    expect(cap('112/10/12')).toBe(ONLINE_CAP_OLD);
    expect(cap('100/01/01')).toBe(ONLINE_CAP_OLD);
  });

  it('112/10/12 之後至 115/06/30 含當日上限 40', () => {
    expect(cap('112/10/13')).toBe(ONLINE_CAP_MID);
    expect(cap('113/01/01')).toBe(ONLINE_CAP_MID);
    expect(cap('115/06/30')).toBe(ONLINE_CAP_MID);
  });

  it('115/07/01 起含當日上限 80', () => {
    expect(cap('115/07/01')).toBe(ONLINE_CAP_NEW);
    expect(cap('115/07/02')).toBe(ONLINE_CAP_NEW);
    expect(cap('120/01/01')).toBe(ONLINE_CAP_NEW);
  });

  // 風險點：沒有生效日就完全不套用線上上限，總分會被高估
  it('沒有生效日則不套用任何上限', () => {
    const r = calculatePoints(pd({ effectiveDate: '', professionalOnline: 200 }));
    expect(r.onlineCap).toBeNull();
    expect(r.onlineOverflow).toBe(0);
    expect(r.totalPoints).toBe(200);
  });

  it('超過上限的線上積分會從總分扣掉', () => {
    const base = { professionalPhysical: 100, professionalOnline: 60 };

    const mid = calculatePoints(pd({ ...base, effectiveDate: '113/01/01' }));
    expect(mid.onlinePointsCounted).toBe(40);
    expect(mid.onlineOverflow).toBe(20);
    expect(mid.totalPoints).toBe(140);

    const old = calculatePoints(pd({ ...base, effectiveDate: '112/09/01' }));
    expect(old.onlineOverflow).toBe(0);
    expect(old.totalPoints).toBe(160);

    const neu = calculatePoints(pd({ ...base, effectiveDate: '115/08/01' }));
    expect(neu.onlineOverflow).toBe(0);
    expect(neu.totalPoints).toBe(160);
  });
});

describe('專業品質倫理法規下限 24 採計上限 36', () => {
  it('未達 24 分不通過並列出尚缺分數', () => {
    const r = calculatePoints(pd({ qualityPhysical: 10, ethicsPhysical: 13 }));
    expect(r.qualityEthicsRegulationsSum).toBe(23);
    expect(r.isQualityEthicsRegulationsSumMet).toBe(false);
    expect(r.attentionNotes).toContain('專業品質/倫理/法規積分不足');
    expect(r.attentionNotes).toContain('尚缺 1.00 分');
  });

  it('剛好 24 分即通過', () => {
    const r = calculatePoints(pd({ qualityPhysical: 24 }));
    expect(r.isQualityEthicsRegulationsSumMet).toBe(true);
    expect(r.attentionNotes).not.toContain('專業品質/倫理/法規積分不足');
  });

  it('三類實體與網路一起加總', () => {
    const r = calculatePoints(
      pd({
        qualityPhysical: 5,
        qualityOnline: 1,
        ethicsPhysical: 5,
        ethicsOnline: 1,
        regulationsPhysical: 5,
        regulationsOnline: 1,
      })
    );
    expect(r.qualityEthicsRegulationsSum).toBe(18);
  });

  it('超過 36 分只採計 36 但原始加總仍完整回報', () => {
    const r = calculatePoints(pd({ qualityPhysical: 20, qualityOnline: 30 }));
    expect(r.qualityEthicsRegulationsSum).toBe(50);
    expect(r.cappedQualityEthicsRegulationsSum).toBe(QER_CAP);
  });

  // 鎖住「超額優先從網路課程扣」的行為：網路課程另外還受線上上限限制，
  // 先扣網路對學員比較有利。若改成優先扣實體，本例總分只剩 16。
  it('QER 超額優先從網路部分扣除', () => {
    const r = calculatePoints(
      pd({
        effectiveDate: '113/01/01',
        qualityPhysical: 20,
        qualityOnline: 60,
        professionalOnline: 50,
      })
    );
    expect(r.cappedQualityEthicsRegulationsSum).toBe(36);
    expect(r.onlinePointsCounted).toBe(40);
    expect(r.onlineOverflow).toBe(26);
    expect(r.totalPoints).toBe(60);
  });
});

describe('四大核心課程各科至少 1 分且合計至少 10 分', () => {
  it('四科齊備且合計達標', () => {
    const r = calculatePoints(
      pd({ fireSafety: 3, emergencyResponse: 3, infectionControl: 2, genderSensitivity: 2 })
    );
    expect(r.coreCoursesSum).toBe(10);
    expect(r.areAllCoreCoursesTaken).toBe(true);
    expect(r.isCoreCoursesSumMet).toBe(true);
  });

  it('缺一科就不算齊備並在提示中點名該科', () => {
    const r = calculatePoints(
      pd({ fireSafety: 5, emergencyResponse: 5, infectionControl: 5, genderSensitivity: 0 })
    );
    expect(r.areAllCoreCoursesTaken).toBe(false);
    expect(r.attentionNotes).toContain('性別敏感度');
    expect(r.attentionNotes).toContain('核心課程');
  });

  it('四科都有但合計不足 10 分', () => {
    const r = calculatePoints(
      pd({ fireSafety: 2, emergencyResponse: 2, infectionControl: 2, genderSensitivity: 2 })
    );
    expect(r.coreCoursesSum).toBe(8);
    expect(r.areAllCoreCoursesTaken).toBe(true);
    expect(r.isCoreCoursesSumMet).toBe(false);
    expect(r.attentionNotes).toContain('四大核心課程總積分不足');
    expect(r.attentionNotes).toContain('尚缺 2.00 分');
  });

  it('核心課程積分不會重複計入總分', () => {
    const r = calculatePoints(compliant());
    expect(r.totalPoints).toBe(124);
  });
});

describe('多元與原住民族文化課程', () => {
  it('舊制文化敏感度課程採計上限 2 分', () => {
    expect(calculatePoints(pd({ culturalOld: 5 })).culturalOldCapped).toBe(CULTURAL_OLD_CAP);
    expect(calculatePoints(pd({ culturalOld: 1 })).culturalOldCapped).toBe(1);
  });

  it('新制缺原住民族文化會提示', () => {
    const r = calculatePoints(pd({ culturalNewIndigenous: 0, culturalNewMulticultural: 1 }));
    expect(r.attentionNotes).toContain('原住民族文化');
  });

  it('新制缺多元族群文化會提示', () => {
    const r = calculatePoints(pd({ culturalNewIndigenous: 1, culturalNewMulticultural: 0 }));
    expect(r.attentionNotes).toContain('多元族群文化');
  });

  it('兩者齊備則不提示', () => {
    const r = calculatePoints(pd({ culturalNewIndigenous: 1, culturalNewMulticultural: 1 }));
    expect(r.attentionNotes).not.toContain('原住民族文化');
    expect(r.attentionNotes).not.toContain('多元族群文化');
    expect(r.culturalNewTotal).toBe(2);
  });
});

describe('換證總分 120', () => {
  it('剛好 120 分通過', () => {
    const r = calculatePoints(pd({ professionalPhysical: 96, qualityPhysical: 24 }));
    expect(r.totalPoints).toBe(120);
    expect(r.isTotalPointsMet).toBe(true);
  });

  it('差 0.01 分不通過並算出尚缺分數', () => {
    const r = calculatePoints(pd({ professionalPhysical: 95.99, qualityPhysical: 24 }));
    expect(r.totalPoints).toBe(119.99);
    expect(r.isTotalPointsMet).toBe(false);
    expect(r.attentionNotes).toContain('尚缺 0.01 分');
  });

  it('全數符合時只回報通過訊息', () => {
    const r = calculatePoints(compliant());
    expect(r.attentionNotes).toBe('✓ 符合換證基本要求');
  });
});

describe('Excel 解析實施方式判定實體或線上', () => {
  const parse = (rows: object[]) => parseExcelToPointsData(rows, '113/01/01', '119/12/31');

  it('01-1 實體課程算實體', () => {
    const d = parse([row({ method: '01-1 實體課程', attr: '專業課程', points: 3 })]);
    expect(d.professionalPhysical).toBe(3);
    expect(d.professionalOnline).toBe(0);
  });

  it('01-2 數位課程算線上', () => {
    const d = parse([row({ method: '01-2 數位學習課程', attr: '專業課程', points: 3 })]);
    expect(d.professionalOnline).toBe(3);
    expect(d.professionalPhysical).toBe(0);
  });

  it('01-3 視訊課程歸類為實體', () => {
    const d = parse([row({ method: '01-3 視訊課程', attr: '專業課程', points: 3 })]);
    expect(d.professionalPhysical).toBe(3);
    expect(d.professionalOnline).toBe(0);
  });

  it('未編碼的網路非同步算線上網路同步算實體', () => {
    expect(parse([row({ method: '網路非同步課程', points: 2 })]).professionalOnline).toBe(2);
    expect(parse([row({ method: '網路同步課程', points: 2 })]).professionalPhysical).toBe(2);
  });
});

describe('Excel 解析篩選與分類', () => {
  const parse = (rows: object[]) => parseExcelToPointsData(rows, '113/01/01', '119/12/31');

  it('認可狀態非符合的列不採計', () => {
    const d = parse([
      row({ status: '符合', points: 5 }),
      row({ status: '不符合', points: 100 }),
      row({ status: '審核中', points: 100 }),
    ]);
    expect(d.professionalPhysical).toBe(5);
  });

  it('積分為 0 負數或非數字的列不採計', () => {
    const d = parse([
      row({ points: 0 }),
      row({ points: -5 }),
      row({ points: '' }),
      row({ points: 'N/A' }),
      row({ points: 4 }),
    ]);
    expect(d.professionalPhysical).toBe(4);
  });

  it('課程屬性分流到品質倫理法規專業', () => {
    const d = parse([
      row({ attr: '專業品質', points: 1 }),
      row({ attr: '專業倫理', points: 2 }),
      row({ attr: '專業法規', points: 3 }),
      row({ attr: '專業課程', points: 4 }),
    ]);
    expect(d.qualityPhysical).toBe(1);
    expect(d.ethicsPhysical).toBe(2);
    expect(d.regulationsPhysical).toBe(3);
    expect(d.professionalPhysical).toBe(4);
  });

  it('課程類別累計到四大核心', () => {
    const d = parse([
      row({ cat: '消防安全', points: 1 }),
      row({ cat: '緊急應變', points: 2 }),
      row({ cat: '感染管制', points: 3 }),
      row({ cat: '性別敏感度', points: 4 }),
    ]);
    expect(d.fireSafety).toBe(1);
    expect(d.emergencyResponse).toBe(2);
    expect(d.infectionControl).toBe(3);
    expect(d.genderSensitivity).toBe(4);
  });

  it('文化課程區分舊制合併類別與新制兩類', () => {
    const d = parse([
      row({ cat: '原住民族與多元族群文化', points: 5 }),
      row({ cat: '原住民族文化', points: 2 }),
      row({ cat: '多元族群文化', points: 3 }),
    ]);
    expect(d.culturalOld).toBe(5);
    expect(d.culturalNewIndigenous).toBe(2);
    expect(d.culturalNewMulticultural).toBe(3);
  });

  it('同一列同時計入屬性與類別但不重複計分', () => {
    const d = parse([row({ attr: '專業課程', cat: '消防安全', points: 3 })]);
    expect(d.professionalPhysical).toBe(3);
    expect(d.fireSafety).toBe(3);
    expect(calculatePoints(d).totalPoints).toBe(3);
  });

  it('取最早的課程日期', () => {
    const d = parse([
      row({ date: '112/11/05', points: 1 }),
      row({ date: '112/03/20', points: 1 }),
      row({ date: '113/01/09', points: 1 }),
    ]);
    expect(d.earliestCourseDate).toBe('112/03/20');
  });

  it('帶入姓名身分證與小卡日期', () => {
    const d = parse([row({ name: '王小明', id: 'B234567890', points: 1 })]);
    expect(d.name).toBe('王小明');
    expect(d.id).toBe('B234567890');
    expect(d.effectiveDate).toBe('113/01/01');
    expect(d.cardExpiryDate).toBe('119/12/31');
  });

  it('沒有資料列時回傳全 0', () => {
    const d = parseExcelToPointsData([], '113/01/01', '119/12/31');
    expect(d.professionalPhysical).toBe(0);
    expect(d.earliestCourseDate).toBe('');
  });
});

describe('日期格式正規化', () => {
  it('各種來源格式都轉成民國字串', () => {
    expect(normalizeDateToRocStr('112/09/01')).toBe('112/09/01');
    expect(normalizeDateToRocStr('2023/09/01')).toBe('112/09/01');
    expect(normalizeDateToRocStr('2023-09-01')).toBe('112/09/01');
    expect(normalizeDateToRocStr('20230901')).toBe('112/09/01');
    expect(normalizeDateToRocStr(new Date(2023, 8, 1))).toBe('112/09/01');
  });

  it('空值與佔位字串回傳空字串', () => {
    expect(normalizeDateToRocStr('')).toBe('');
    expect(normalizeDateToRocStr('0')).toBe('');
    expect(normalizeDateToRocStr('nan')).toBe('');
    expect(normalizeDateToRocStr('None')).toBe('');
    expect(normalizeDateToRocStr(null)).toBe('');
  });

  it('課程期間取起始日', () => {
    expect(extractCourseDate('112/09/01~112/09/02')).toBe('112/09/01');
    expect(extractCourseDate('112/09/01 09:00')).toBe('112/09/01');
  });

  // 已知缺陷：extractCourseDate 以 [~-] 切字串，
  // 會把 ISO 日期的連字號誤判成期間分隔符，只留下年份
  it('ISO 連字號日期會被誤切（已知缺陷）', () => {
    expect(extractCourseDate('2023-09-01')).toBe('2023');
  });
});

describe('推薦課程', () => {
  const courses: Course[] = [
    { url: 'u-fire-online', name: '消防安全概論', type: '網路課程', points: 2, tags: ['消防安全'] },
    { url: 'u-fire-live', name: '消防安全實作', type: '實體課程', points: 2, tags: ['消防安全'] },
    { url: 'u-qer', name: '專業倫理研討', type: '網路課程', points: 3, tags: ['專業倫理'] },
    { url: 'u-zero', name: '零積分課程', type: '網路課程', points: 0, tags: ['消防安全'] },
    { url: 'u-summary', name: '課程總表', type: '網路課程', points: 5, tags: ['消防安全'] },
  ];

  it('缺四大核心某科時推薦該科並優先網路課程', () => {
    const r = calculatePoints(compliant({ fireSafety: 0 }), courses);
    expect(r.recommendedCourses).toContain('缺消防安全');
    expect(r.recommendedCoursesList.map((c) => c.url)).toContain('u-fire-online');
    expect(r.recommendedCoursesList.map((c) => c.url)).not.toContain('u-fire-live');
  });

  it('QER 不足時推薦專業品質倫理法規課程', () => {
    const r = calculatePoints(compliant({ qualityPhysical: 0 }), courses);
    expect(r.recommendedCourses).toContain('專業品質/倫理/法規');
    expect(r.recommendedCoursesList.map((c) => c.url)).toContain('u-qer');
  });

  it('排除 0 積分課程與總表', () => {
    const r = calculatePoints(compliant({ fireSafety: 0 }), courses);
    const urls = r.recommendedCoursesList.map((c) => c.url);
    expect(urls).not.toContain('u-zero');
    expect(urls).not.toContain('u-summary');
  });

  it('完全符合要求時不推薦課程', () => {
    const r = calculatePoints(compliant(), courses);
    expect(r.recommendedCourses).toBe('');
    expect(r.recommendedCoursesList).toHaveLength(0);
  });

  it('沒有課程清單時不會出錯', () => {
    const r = calculatePoints(compliant({ fireSafety: 0 }), []);
    expect(r.recommendedCourses).toBe('');
  });
});

describe('報表列組裝', () => {
  it('欄位與計算結果一致', () => {
    const data = compliant();
    const results = calculatePoints(data);
    const csv = buildCsvRow('A123456789_照顧服務人員', data, results);

    expect(csv['身分證號']).toBe('A123456789_照顧服務人員');
    expect(csv['最終總計']).toBe(results.totalPoints);
    expect(csv['品質倫理法規_總計']).toBe(results.cappedQualityEthicsRegulationsSum);
    expect(csv['四大核心_總計']).toBe(results.coreCoursesSum);
    expect(csv['原住民族與多元族群文化(舊)']).toBe(results.culturalOldCapped);
    expect(csv['注意']).toBe(results.attentionNotes);
  });

  it('實體與網路原始總計分開回報', () => {
    const data = pd({
      professionalPhysical: 10,
      qualityPhysical: 5,
      professionalOnline: 20,
      ethicsOnline: 5,
    });
    const csv = buildCsvRow('X', data, calculatePoints(data));
    expect(csv['實體課程(raw total)']).toBe(15);
    expect(csv['網路課程(raw total)']).toBe(25);
  });
});
