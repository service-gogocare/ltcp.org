import { describe, it, expect } from 'vitest';
import {
  buildMonthlyReview,
  buildReviewRow,
  buildSummaryRow,
  buildTrendTable,
  cumulativeSeries,
  cycleProgress,
  summariseRisk,
  RISK_ORDER,
  URGENT_DAYS,
} from './monthlyReview';
import {
  attributePointsToMonths,
  type CardIdentity,
  type MonthlyPointRecord,
} from './monthlyPoints';
import { calculateExpiryDate, TOTAL_POINTS_REQUIRED } from './calculator';

/** 一列衛福部匯出 Excel 的課程明細 */
function courseRow(o: {
  method?: string; attr?: string; cat?: string;
  points?: number | string; date?: string;
}) {
  return {
    '人員姓名': '測試員',
    '身分證字號/\n統一證號': 'A123456789',
    '認可狀態': '符合',
    '課程日期': o.date ?? '112/09/20',
    '實施方式': o.method ?? '01-1 實體課程',
    '課程屬性': o.attr ?? '專業課程',
    '課程類別': o.cat ?? '',
    '積分': o.points ?? 1,
  };
}

const EFF = '112/09/15';
const EXP = calculateExpiryDate(EFF); // 118/09/14
/** 115/01/01。第 1、2 證書年度已結束，第 3 年進行中 */
const ASOF = new Date(2026, 0, 1);

function card(o: Partial<CardIdentity> = {}): CardIdentity {
  return {
    cardId: 'A123456789_照顧服務人員',
    name: '王小明',
    effectiveDate: EFF,
    expiryDate: EXP,
    ...o,
  };
}

/** 把課程明細變成該人員的月報紀錄 */
function recordsOf(rows: ReturnType<typeof courseRow>[], c: CardIdentity): MonthlyPointRecord[] {
  return attributePointsToMonths(rows, c.effectiveDate, c.expiryDate).rows.map((row) => ({
    cardId: c.cardId, name: c.name, analyzedEffectiveDate: c.effectiveDate, row,
  }));
}

describe('cycleProgress', () => {
  it('依經過天數攤平，不是每年 20 分的固定格線', () => {
    // 112/09/15 ~ 118/09/14 共 2192 天；115/01/01 是第 840 天
    const p = cycleProgress(EFF, EXP, ASOF);
    expect(p).not.toBeNull();
    expect(p!.totalDays).toBe(2192);
    expect(p!.elapsedDays).toBe(840);
    expect(p!.expectedPoints).toBe(45.99);
  });

  it('生效日當天就算第 1 天，到期日當天算滿', () => {
    expect(cycleProgress(EFF, EXP, new Date(2023, 8, 15))!.elapsedDays).toBe(1);
    const atEnd = cycleProgress(EFF, EXP, new Date(2029, 8, 14))!;
    expect(atEnd.elapsedDays).toBe(atEnd.totalDays);
    expect(atEnd.expectedPoints).toBe(TOTAL_POINTS_REQUIRED);
  });

  it('超過到期日不會算出 120 分以上，早於生效日不會算出負數', () => {
    expect(cycleProgress(EFF, EXP, new Date(2040, 0, 1))!.expectedPoints).toBe(TOTAL_POINTS_REQUIRED);
    expect(cycleProgress(EFF, EXP, new Date(2020, 0, 1))!.expectedPoints).toBe(0);
  });

  it('起訖日無法解析時回傳 null，不畫假的進度條', () => {
    expect(cycleProgress('', '', ASOF)).toBeNull();
    expect(cycleProgress('待補', EXP, ASOF)).toBeNull();
  });
});

describe('五項監控', () => {
  it('新制文化：已結束沒補的年度與進行中待補的年度要分開', () => {
    // 第 2 年（113/09/15~114/09/14，已結束且受規範）什麼都沒修
    // 第 3 年（進行中）只修了原住民族
    const row = buildReviewRow(card(), recordsOf([
      courseRow({ date: '114/10/20', cat: '原住民族文化', points: 1 }),
    ], card()), ASOF);

    expect(row.culturalOverdue.map(w => w.index)).toEqual([2]);
    expect(row.culturalPending.map(w => w.index)).toEqual([3]);
    expect(row.culturalCheckable).toBe(true);
  });

  it('新制文化：沒有任何月報資料時是「無法檢核」，不是「沒問題」', () => {
    const row = buildReviewRow(card(), [], ASOF);
    expect(row.culturalCheckable).toBe(false);
    expect(row.culturalOverdue).toEqual([]);
  });

  it('四大核心：列出還沒修到的科目與總分缺口', () => {
    const row = buildReviewRow(card(), recordsOf([
      courseRow({ date: '113/01/10', cat: '消防安全', points: 3 }),
      courseRow({ date: '113/02/10', cat: '感染管制', points: 2 }),
    ], card()), ASOF);

    expect(row.missingCoreSubjects).toEqual(['緊急應變', '性別敏感度']);
    expect(row.coreShortfall).toBe(5);
  });

  it('QER 超過 36 分上限的部分要標出來 —— 那些分數等於白修', () => {
    const row = buildReviewRow(card(), recordsOf([
      courseRow({ date: '113/01/10', attr: '專業品質', points: 40 }),
    ], card()), ASOF);

    expect(row.qerOverflow).toBe(4);
  });

  it('網路積分距上限還剩多少', () => {
    // 生效日 112/09/15 早於分界日 112/10/12 → 線上採計上限 60
    const row = buildReviewRow(card(), recordsOf([
      courseRow({ date: '113/01/10', method: '01-2 非同步網路課程', points: 15 }),
    ], card()), ASOF);

    expect(row.results.onlineCap).toBe(60);
    expect(row.onlineRemaining).toBe(45);
  });

  it('小卡到期日與總分缺口', () => {
    const row = buildReviewRow(card(), recordsOf([
      courseRow({ date: '113/01/10', points: 20 }),
    ], card()), ASOF);

    // 115/01/01 到 118/09/14 共 1352 天
    expect(row.daysToExpiry).toBe(1352);
    expect(row.totalShortfall).toBe(100);
  });
});

describe('危險度排序：危險不等於總分最低', () => {
  it('逾期未補的人排在總分更低但還來得及的人前面', () => {
    const overdue = card({ cardId: 'A111111111_照顧服務人員', name: '逾期者' });
    const behind = card({ cardId: 'B222222222_照顧服務人員', name: '落後者' });

    const rows = buildMonthlyReview(
      [behind, overdue],
      [
        // 逾期者總分 100，但第 2 年（已結束）沒補新制文化
        ...recordsOf([courseRow({ date: '113/01/10', points: 100 })], overdue),
        // 落後者總分 0，可是還有三年多可以補
        ...recordsOf([
          courseRow({ date: '113/10/01', cat: '原住民族文化', points: 1 }),
          courseRow({ date: '113/10/02', cat: '多元族群文化', points: 1 }),
          courseRow({ date: '114/10/01', cat: '原住民族文化', points: 1 }),
          courseRow({ date: '114/10/02', cat: '多元族群文化', points: 1 }),
        ], behind),
      ],
      ASOF,
    );

    expect(rows.map(r => r.name)).toEqual(['逾期者', '落後者']);
    expect(rows[0].risk).toBe('overdue');
    expect(rows[1].risk).toBe('behind');
    expect(rows[0].results.totalPoints).toBeGreaterThan(rows[1].results.totalPoints);
  });

  it('起訖日待補的人排在很前面 —— 算不出來就永遠不會被檢查到', () => {
    const pending = card({ cardId: 'C333333333_照顧服務人員', name: '待補起訖日', effectiveDate: '', expiryDate: '' });
    const normal = card({ cardId: 'D444444444_照顧服務人員', name: '正常' });

    const rows = buildMonthlyReview([normal, pending], [], ASOF);
    expect(rows[0].name).toBe('待補起訖日');
    expect(rows[0].risk).toBe('unknown');
    expect(rows[0].progress).toBeNull();
  });

  it('一年內到期又還沒達標的算緊迫', () => {
    // 生效日往前推，讓 115/01/01 距到期不到一年
    const soon = card({ cardId: 'E555555555_照顧服務人員', name: '快到期', effectiveDate: '109/03/01', expiryDate: calculateExpiryDate('109/03/01') });
    const row = buildReviewRow(soon, recordsOf([
      // 兩個受規範年度都補齊，排除 overdue；總分仍然不足
      courseRow({ date: '113/07/01', cat: '原住民族文化', points: 1 }),
      courseRow({ date: '113/07/02', cat: '多元族群文化', points: 1 }),
      courseRow({ date: '114/07/01', cat: '原住民族文化', points: 1 }),
      courseRow({ date: '114/07/02', cat: '多元族群文化', points: 1 }),
    ], soon), ASOF);

    expect(row.daysToExpiry).toBeLessThanOrEqual(URGENT_DAYS);
    expect(row.results.isTotalPointsMet).toBe(false);
    expect(row.risk).toBe('urgent');
  });

  it('達標且進度超前的人是 ok', () => {
    const row = buildReviewRow(card(), recordsOf([
      courseRow({ date: '113/01/10', attr: '專業課程', points: 100 }),
      courseRow({ date: '113/01/11', attr: '專業品質', points: 30 }),
      courseRow({ date: '113/02/01', cat: '消防安全', points: 3 }),
      courseRow({ date: '113/02/02', cat: '緊急應變', points: 3 }),
      courseRow({ date: '113/02/03', cat: '感染管制', points: 3 }),
      courseRow({ date: '113/02/04', cat: '性別敏感度', points: 3 }),
      courseRow({ date: '113/10/01', cat: '原住民族文化', points: 1 }),
      courseRow({ date: '113/10/02', cat: '多元族群文化', points: 1 }),
      courseRow({ date: '114/10/01', cat: '原住民族文化', points: 1 }),
      courseRow({ date: '114/10/02', cat: '多元族群文化', points: 1 }),
    ], card()), ASOF);

    expect(row.risk).toBe('ok');
  });

  it('名冊上一列積分都沒有的人不會消失 —— 他們正是最該被看見的', () => {
    const rows = buildMonthlyReview([card()], [], ASOF);
    expect(rows).toHaveLength(1);
    expect(rows[0].results.totalPoints).toBe(0);
  });
});

describe('summariseRisk', () => {
  it('每個等級都有一個數字，即使是 0', () => {
    const counts = summariseRisk(buildMonthlyReview([card()], [], ASOF));
    expect(Object.keys(counts).sort()).toEqual([...RISK_ORDER].sort());
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
  });
});


describe('逐月累計曲線', () => {
  it('最後一點必定等於報表上的最終總計', () => {
    // 這是這個函式唯一難做對的地方。採計上限是對整個 6 年週期套用的，
    // 所以曲線不能是每月增量相加 —— 那樣超過上限的月份會讓曲線一路虛高。
    const rows = [
      courseRow({ date: '112/10/01', attr: '專業課程', points: 30 }),
      courseRow({ date: '113/05/10', attr: '專業品質', points: 40 }),  // QER 超過 36 上限
      courseRow({ date: '114/02/20', attr: '專業倫理', method: '01-2 非同步網路課程', points: 25 }),
    ];
    const records = recordsOf(rows, card());
    const series = cumulativeSeries(card(), records, ASOF);
    const final = buildReviewRow(card(), records, ASOF).results.totalPoints;

    expect(series.length).toBeGreaterThan(0);
    expect(series[series.length - 1].total).toBe(final);
    // 若是單純相加會得到 95；套用 QER 36 上限之後不會是那個數字
    expect(final).toBeLessThan(95);
  });

  it('沒有月份可放的積分（無法歸月、效期外）在曲線起點就計入', () => {
    // 不先計入的話那些積分會從曲線上消失，最後一點就對不上報表
    const records = recordsOf([
      courseRow({ date: '待補', attr: '專業課程', points: 5 }),
      courseRow({ date: '112/08/01', attr: '專業課程', points: 3 }),   // 早於生效日
      courseRow({ date: '113/01/10', attr: '專業課程', points: 2 }),
    ], card());

    const series = cumulativeSeries(card(), records, ASOF);
    expect(series[0].total).toBe(8);
    expect(series[series.length - 1].total).toBe(10);
  });

  it('逐月累加而不是每月獨立', () => {
    const series = cumulativeSeries(card(), recordsOf([
      courseRow({ date: '112/10/05', attr: '專業課程', points: 4 }),
      courseRow({ date: '112/12/05', attr: '專業課程', points: 6 }),
    ], card()), ASOF);

    const at = (m: string) => series.find(p => p.month === m)?.total;
    expect(at('112/09')).toBe(0);
    expect(at('112/10')).toBe(4);
    expect(at('112/11')).toBe(4);   // 這個月沒上課，累計不會掉回 0
    expect(at('112/12')).toBe(10);
    expect(at('113/01')).toBe(10);
  });

  it('從生效月畫到本月，不畫到還沒發生的未來', () => {
    const series = cumulativeSeries(card(), [], ASOF);
    expect(series[0].month).toBe('112/09');
    expect(series[series.length - 1].month).toBe('115/01');
  });

  it('應達進度沿著曲線遞增，最後不超過 120', () => {
    const series = cumulativeSeries(card(), [], ASOF);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].expected).toBeGreaterThanOrEqual(series[i - 1].expected);
    }
    expect(series[series.length - 1].expected).toBeLessThanOrEqual(TOTAL_POINTS_REQUIRED);
  });

  it('起訖日算不出來時回傳空陣列，不畫假的曲線', () => {
    expect(cumulativeSeries(card({ effectiveDate: '', expiryDate: '' }), [], ASOF)).toEqual([]);
  });
});


describe('buildSummaryRow', () => {
  it('補上名冊才有的三欄與小卡起訖日', () => {
    const c = card({ nationality: '印尼' });
    const row = buildSummaryRow(buildReviewRow(c, recordsOf([
      courseRow({ date: '113/01/10', attr: '專業課程', points: 12 }),
    ], c), ASOF));

    expect(row['身分證號']).toBe('A123456789');
    expect(row['姓名']).toBe('王小明');
    expect(row['國籍']).toBe('印尼');
    expect(row['職業類別']).toBe('照顧服務人員');
    expect(row['小卡起始日']).toBe(EFF);
    expect(row['小卡到期日']).toBe(EXP);
    expect(row['最終總計']).toBe(12);
  });

  it('有月報資料時，舊制文化超上限那欄是數字而不是「無明細無法扣除」', () => {
    const c = card();
    const row = buildSummaryRow(buildReviewRow(c, recordsOf([
      courseRow({
        date: '113/01/10', attr: '專業倫理', method: '01-2 非同步網路課程',
        cat: '原住民族與多元族群文化敏感度及能力', points: 5,
      }),
    ], c), ASOF));

    expect(row['舊制文化超上限未採計']).toBe(3);
  });
});


describe('buildTrendTable', () => {
  it('年度以生效月起算、每 12 個曆月一年', () => {
    // 生效日 112/09/15 → 第 1 年是 112/09 ~ 113/08（12 格），第 2 年自 113/09 起。
    // 這是顯示用的取景窗，與逐年檢核那個落在月中的精確邊界略有差異
    const table = buildTrendTable(buildMonthlyReview([card()], [], ASOF));
    const monthOf = (m: string) => table.points.find(p => p.month === m);

    expect(monthOf('112/09')?.cardYearIndex).toBe(1);
    expect(monthOf('113/08')?.cardYearIndex).toBe(1);
    expect(monthOf('113/09')?.cardYearIndex).toBe(2);
    expect(monthOf('114/09')?.cardYearIndex).toBe(3);
  });

  it('顯示名稱帶職業類別 —— 同名不同職類的人要分得出來', () => {
    const table = buildTrendTable(buildMonthlyReview([card()], [], ASOF));
    expect(table.people[0].display).toBe('王小明（照顧服務人員）');
    expect(table.points[0].display).toBe('王小明（照顧服務人員）');
  });

  it('每個人的列範圍對得上自己的資料 —— SPARKLINE 靠它取範圍', () => {
    const a = card({ cardId: 'A111111111_照顧服務人員', name: '甲' });
    const b = card({
      cardId: 'B222222222_照顧服務人員', name: '乙',
      effectiveDate: '114/06/01', expiryDate: calculateExpiryDate('114/06/01'),
    });

    const table = buildTrendTable(buildMonthlyReview([a, b], [], ASOF));
    for (const person of table.people) {
      const slice = table.points.slice(person.fromIndex, person.toIndex + 1);
      expect(slice.every(pt => pt.cardId === person.cardId)).toBe(true);
      expect(slice.length).toBeGreaterThan(0);
    }
    expect(table.people[1].fromIndex).toBe(table.people[0].toIndex + 1);
  });

  it('累計值就是曲線上的值，沒有另外算一次', () => {
    const c = card();
    const rows = buildMonthlyReview([c], recordsOf([
      courseRow({ date: '112/10/05', attr: '專業課程', points: 4 }),
    ], c), ASOF);
    const table = buildTrendTable(rows);

    expect(table.points.find(p => p.month === '112/10')?.total).toBe(4);
    expect(table.people[0].current).toBe(rows[0].results.totalPoints);
  });

  it('起訖日算不出來的人不進走勢表，也不會讓年度選項爆掉', () => {
    const table = buildTrendTable(buildMonthlyReview(
      [card({ effectiveDate: '', expiryDate: '' })], [], ASOF,
    ));
    expect(table.points).toEqual([]);
    expect(table.people).toEqual([]);
    expect(table.maxCardYear).toBe(1);
  });
});
