import { describe, it, expect } from 'vitest';
import {
  mapHeaders,
  parseRoster,
  cardToRow,
  buildRosterValues,
  ROSTER_HEADER_ROW,
  ROSTER_COLUMNS,
  columnLetter,
  toA1Range,
  planSheetWrites,
  planSheetDeletes,
  MONTHLY_COLUMNS,
  MONTHLY_HEADER_ROW,
  MONTH_UNASSIGNED_LABEL,
  CARD_YEAR_OUT_OF_RANGE_LABEL,
  buildMonthlyValues,
  buildSummaryValues,
  SUMMARY_COLUMNS,
  buildTrendData,
  buildTrendValues,
  buildTrendFormulas,
  trendYearOptions,
  TREND_DATA_LIST_COL,
  TREND_SELECT_PERSON_ROW,
  TREND_SELECT_YEAR_ROW,
  TREND_MONTH_ROW,
  TREND_EARNED_ROW,
  TREND_LIST_HEADER_ROW,
  TREND_LIST_FIRST_ROW,
  TREND_LIST_SPARKLINE_COL,
  TREND_FIRST_DATA_COL,
  TREND_MONTHS_PER_YEAR,
  monthlyRecordToRow,
  parseMonthlyReport,
  planMonthlyReplace,
} from './sheetSchema';
import {
  ATTRIBUTE_BUCKETS,
  CATEGORY_BUCKETS,
  CARD_YEAR_OUT_OF_RANGE,
  MONTH_UNASSIGNED,
  uploadThroughMonth,
  type MonthlyPointRecord,
} from '../monthlyPoints';
import { findExportDate, type AttributeBucket } from '../calculator';

const H = ROSTER_HEADER_ROW;

describe('mapHeaders', () => {
  it('對應標準標題列', () => {
    const { index, missing } = mapHeaders(H, ROSTER_COLUMNS);
    expect(missing).toEqual([]);
    expect(index).toEqual({
      studentId: 0, name: 1, nationality: 2, role: 3, effectiveDate: 4, expiryDate: 5,
    });
  });

  it('欄位順序被調換也能對應', () => {
    const { index, missing } = mapHeaders(['姓名', '到期日期', '生效日期', '職業類別', '身分證號'], ROSTER_COLUMNS);
    expect(missing).toEqual([]);
    expect(index.name).toBe(0);
    expect(index.expiryDate).toBe(1);
    expect(index.studentId).toBe(4);
  });

  it('容忍別名與多餘文字', () => {
    const { missing, index } = mapHeaders(['身份證字號', '人員姓名', '國籍', '職登類別', '小卡生效日', '小卡到期日'], ROSTER_COLUMNS);
    expect(missing).toEqual([]);
    expect(index.role).toBe(3);
  });

  it('國籍不是必要欄位，缺了不算問題', () => {
    const { missing, index } = mapHeaders(['身分證號', '姓名', '職業類別', '生效日期', '到期日期'], ROSTER_COLUMNS);
    expect(missing).toEqual([]);
    expect(index.nationality).toBeUndefined();
  });

  it('缺少必要欄位時列出來', () => {
    const { missing } = mapHeaders(['姓名', '國籍'], ROSTER_COLUMNS);
    expect(missing).toEqual(['身分證號', '職業類別', '生效日期', '到期日期']);
  });
});

describe('parseRoster', () => {
  it('解析正常名冊', () => {
    const { cards, issues } = parseRoster([
      H,
      ['A123456789', '王小明', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
      ['B120169842', '李小龍', '印尼', '居家服務督導員', '112/02/25', '118/02/24'],
    ]);

    expect(issues).toEqual([]);
    expect(Object.keys(cards)).toEqual(['A123456789_照顧服務人員', 'B120169842_居家服務督導員']);
    expect(cards['A123456789_照顧服務人員']).toEqual({
      name: '王小明',
      role: '照顧服務人員',
      nationality: '臺灣',
      effectiveDate: '113/08/20',
      expiryDate: '119/08/19',
    });
  });

  it('缺必要欄位時不解析任何資料，避免把錯位的欄位當成正確資料', () => {
    const { cards, issues } = parseRoster([
      ['姓名', '生效日期'],
      ['王小明', '113/08/20'],
    ]);
    expect(cards).toEqual({});
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('missingColumn');
    expect(issues[0].message).toContain('身分證號');
  });

  it('空試算表回報標題列問題', () => {
    const { issues } = parseRoster([]);
    expect(issues[0].kind).toBe('missingColumn');
  });

  it('略過完全空白的列，且不記為問題', () => {
    const { cards, issues } = parseRoster([
      H,
      ['A1', '王小明', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
      ['', '', '', '', '', ''],
      [],
    ]);
    expect(Object.keys(cards)).toHaveLength(1);
    expect(issues).toEqual([]);
  });

  it('沒有身分證號的列會被略過並記錄列號', () => {
    const { cards, issues } = parseRoster([
      H,
      ['', '無證號者', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
    ]);
    expect(cards).toEqual({});
    expect(issues[0]).toMatchObject({ kind: 'emptyId', row: 2 });
  });

  it('姓名空白會記錄問題但仍讀進來，讓使用者在畫面上補', () => {
    const { cards, issues } = parseRoster([
      H,
      ['A1', '', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
    ]);
    expect(cards['A1_照顧服務人員'].name).toBe('');
    expect(issues.map((i) => i.kind)).toContain('emptyName');
  });

  it('職業類別不在選項內時正規化並提醒（照顧服務員 → 照顧服務人員）', () => {
    const { cards, issues } = parseRoster([
      H,
      ['A1', '陳錦賜', '臺灣', '照顧服務員', '113/08/20', '119/08/19'],
    ]);
    expect(cards['A1_照顧服務人員'].role).toBe('照顧服務人員');
    expect(issues[0]).toMatchObject({ kind: 'unknownRole', row: 2 });
    expect(issues[0].message).toContain('照顧服務員');
  });

  it('身分證號＋職業類別重複時保留先出現的那筆', () => {
    const { cards, issues } = parseRoster([
      H,
      ['A1', '先出現', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
      ['A1', '後出現', '臺灣', '照顧服務人員', '110/01/01', '115/12/31'],
    ]);
    expect(Object.keys(cards)).toHaveLength(1);
    expect(cards['A1_照顧服務人員'].name).toBe('先出現');
    expect(issues[0]).toMatchObject({ kind: 'duplicate', row: 3 });
  });

  it('同一人不同職類不算重複', () => {
    const { cards, issues } = parseRoster([
      H,
      ['A1', '李小龍', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
      ['A1', '李小龍', '臺灣', '居家服務督導員', '112/02/25', '118/02/24'],
    ]);
    expect(Object.keys(cards)).toHaveLength(2);
    expect(issues).toEqual([]);
  });

  it('日期無法解析時記錄問題，仍把該列讀進來', () => {
    const { cards, issues } = parseRoster([
      H,
      ['A1', '王小明', '臺灣', '照顧服務人員', '不是日期', ''],
    ]);
    expect(cards['A1_照顧服務人員']).toBeDefined();
    const dateIssues = issues.filter((i) => i.kind === 'invalidDate');
    expect(dateIssues).toHaveLength(2);
    expect(dateIssues[0].message).toContain('生效日期');
    expect(dateIssues[1].message).toContain('到期日期');
  });

  it('容忍西元、單位數月日與連字號等被試算表改過的日期寫法', () => {
    const { cards, issues } = parseRoster([
      H,
      ['A1', '甲', '臺灣', '照顧服務人員', '113/8/2', '2030-08-01'],
    ]);
    expect(issues.filter((i) => i.kind === 'invalidDate')).toEqual([]);
    expect(cards['A1_照顧服務人員'].effectiveDate).toBe('113/08/02');
    expect(cards['A1_照顧服務人員'].expiryDate).toBe('119/08/01');
  });

  it('國籍欄缺席時預設臺灣', () => {
    const { cards } = parseRoster([
      ['身分證號', '姓名', '職業類別', '生效日期', '到期日期'],
      ['A1', '王小明', '照顧服務人員', '113/08/20', '119/08/19'],
    ]);
    expect(cards['A1_照顧服務人員'].nationality).toBe('臺灣');
  });

  it('去除儲存格前後空白', () => {
    const { cards } = parseRoster([
      H,
      ['  A1  ', ' 王小明 ', '臺灣', ' 照顧服務人員 ', ' 113/08/20 ', '119/08/19'],
    ]);
    expect(cards['A1_照顧服務人員'].name).toBe('王小明');
  });

  it('資料列比標題列短時不會爆掉', () => {
    const { cards, issues } = parseRoster([H, ['A1', '王小明']]);
    expect(cards['A1_照顧服務人員']).toBeDefined();
    expect(issues.filter((i) => i.kind === 'invalidDate')).toHaveLength(2);
  });
});

describe('cardToRow 與 buildRosterValues', () => {
  it('欄位順序與標題列一致', () => {
    const row = cardToRow('A123456789_照顧服務人員', {
      name: '王小明',
      role: '照顧服務人員',
      nationality: '印尼',
      effectiveDate: '113/08/20',
      expiryDate: '119/08/19',
    });
    expect(row).toEqual(['A123456789', '王小明', '印尼', '照顧服務人員', '113/08/20', '119/08/19']);
  });

  it('寫出去再讀回來的內容完全相同', () => {
    const cards = {
      'A1_照顧服務人員': {
        name: '王小明', role: '照顧服務人員', nationality: '臺灣',
        effectiveDate: '113/08/20', expiryDate: '119/08/19',
      },
      'B2_居家服務督導員': {
        name: '李小龍', role: '居家服務督導員', nationality: '越南',
        effectiveDate: '112/02/25', expiryDate: '118/02/24',
      },
    };
    const { cards: roundTripped, issues } = parseRoster(buildRosterValues(cards));
    expect(issues).toEqual([]);
    expect(roundTripped).toEqual(cards);
  });

  it('buildRosterValues 第一列是標題列', () => {
    expect(buildRosterValues({})).toEqual([ROSTER_HEADER_ROW]);
  });
});

describe('columnLetter 與 toA1Range', () => {
  it('欄索引轉欄名', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(5)).toBe('F');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
  });

  it('分頁名稱加單引號，內部單引號跳脫', () => {
    expect(toA1Range('人員名冊', 4, 0, 5)).toBe("'人員名冊'!A5:F5");
    expect(toA1Range("O'Brien", 0, 2, 2)).toBe("'O''Brien'!C1:C1");
  });
});

describe('planSheetWrites', () => {
  const existing = [
    H,
    ['A1', '王小明', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
    ['B2', '李小龍', '臺灣', '居家服務督導員', '112/02/25', '118/02/24'],
  ];
  const rec = (over: Partial<import('./types').CardRecord> = {}) => ({
    name: '王小明', role: '照顧服務人員', nationality: '臺灣',
    effectiveDate: '113/08/20', expiryDate: '119/08/19', ...over,
  });

  it('既有的人更新對應那一列，不新增', () => {
    const plan = planSheetWrites(existing, [
      { cardId: 'A1_照顧服務人員', record: rec({ name: '王大明' }) },
    ]);
    expect(plan.appends).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].rowIndex).toBe(1);
    expect(plan.updates[0].values[1]).toBe('王大明');
  });

  it('新的人附加在最後', () => {
    const plan = planSheetWrites(existing, [
      { cardId: 'C3_照顧服務人員', record: rec({ name: '陳美玉' }) },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.appends).toEqual([['C3', '陳美玉', '臺灣', '照顧服務人員', '113/08/20', '119/08/19']]);
  });

  it('絕不刪除沒被列進來的人', () => {
    const plan = planSheetWrites(existing, [
      { cardId: 'A1_照顧服務人員', record: rec() },
    ]);
    // 李小龍不在 writes 裡，計畫中不該有任何與他相關的動作
    expect(plan.updates.every(u => u.rowIndex !== 2)).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('李小龍');
  });

  it('同一批裡同一個人出現兩次只附加一列，內容取最後一次', () => {
    const plan = planSheetWrites(existing, [
      { cardId: 'C3_照顧服務人員', record: rec({ name: '第一次' }) },
      { cardId: 'C3_照顧服務人員', record: rec({ name: '第二次' }) },
    ]);
    expect(plan.appends).toHaveLength(1);
    expect(plan.appends[0][1]).toBe('第二次');
  });

  it('依實際標題位置寫入，欄位順序被調換也不會寫錯欄', () => {
    const swapped = [
      ['姓名', '身分證號', '職業類別', '生效日期', '到期日期', '國籍'],
      ['王小明', 'A1', '照顧服務人員', '113/08/20', '119/08/19', '臺灣'],
    ];
    const plan = planSheetWrites(swapped, [
      { cardId: 'A1_照顧服務人員', record: rec({ name: '王大明', nationality: '越南' }) },
    ]);
    expect(plan.updates[0].values).toEqual(['王大明', 'A1', '照顧服務人員', '113/08/20', '119/08/19', '越南']);
  });

  it('更新範圍內沒對應到的欄沿用原值，不清空', () => {
    const withExtra = [
      ['身分證號', '備註', '姓名', '國籍', '職業類別', '生效日期', '到期日期'],
      ['A1', '這是使用者自己加的備註', '王小明', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
    ];
    const plan = planSheetWrites(withExtra, [
      { cardId: 'A1_照顧服務人員', record: rec({ name: '王大明' }) },
    ]);
    expect(plan.updates[0].values[1]).toBe('這是使用者自己加的備註');
    expect(plan.updates[0].values[2]).toBe('王大明');
  });

  it('缺必要欄位時整批擋下並說明原因', () => {
    const plan = planSheetWrites([['姓名', '國籍']], [
      { cardId: 'A1_照顧服務人員', record: rec() },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.appends).toEqual([]);
    expect(plan.blocked).toContain('身分證號');
  });

  it('空試算表擋下來而不是盲目寫入', () => {
    const plan = planSheetWrites([], [{ cardId: 'A1_照顧服務人員', record: rec() }]);
    expect(plan.blocked).toBeTruthy();
  });

  it('職類寫法不同但正規化後相同時視為同一人', () => {
    const legacy = [H, ['A1', '陳錦賜', '臺灣', '照顧服務員', '113/08/20', '119/08/19']];
    const plan = planSheetWrites(legacy, [
      { cardId: 'A1_照顧服務人員', record: rec({ name: '陳錦賜' }) },
    ]);
    expect(plan.appends).toEqual([]);
    expect(plan.updates[0].rowIndex).toBe(1);
  });
});

describe('planSheetDeletes', () => {
  const existing = [
    H,
    ['A1', '甲', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
    ['B2', '乙', '臺灣', '照顧服務人員', '112/02/25', '118/02/24'],
    ['C3', '丙', '臺灣', '照顧服務人員', '110/05/05', '116/05/04'],
  ];

  it('列索引由大到小排序，避免刪除時索引位移刪錯列', () => {
    const { rowIndexes } = planSheetDeletes(existing, ['A1_照顧服務人員', 'C3_照顧服務人員']);
    expect(rowIndexes).toEqual([3, 1]);
  });

  it('找不到的人列進 notFound 而不是靜默略過', () => {
    const { rowIndexes, notFound } = planSheetDeletes(existing, ['Z9_照顧服務人員']);
    expect(rowIndexes).toEqual([]);
    expect(notFound).toEqual(['Z9_照顧服務人員']);
  });

  it('同一人有重複列時一併刪除', () => {
    const dup = [...existing, ['A1', '甲', '臺灣', '照顧服務人員', '113/08/20', '119/08/19']];
    const { rowIndexes } = planSheetDeletes(dup, ['A1_照顧服務人員']);
    expect(rowIndexes).toEqual([4, 1]);
  });

  it('同一個 cardId 傳兩次不會產生重複的列索引', () => {
    const { rowIndexes } = planSheetDeletes(existing, ['A1_照顧服務人員', 'A1_照顧服務人員']);
    expect(rowIndexes).toEqual([1]);
  });
});


// ── 積分月報 ────────────────────────────────────────────────────

function zero<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  keys.forEach((k) => { out[k] = 0; });
  return out;
}

/** 一筆月報紀錄，只覆寫測試關心的欄位 */
function record(o: {
  cardId?: string;
  name?: string;
  eff?: string;
  month?: string;
  year?: number;
  buckets?: Partial<Record<AttributeBucket, number>>;
  categories?: Partial<Record<string, number>>;
  old?: Partial<Record<AttributeBucket, number>>;
}): MonthlyPointRecord {
  return {
    cardId: o.cardId ?? 'A123456789_照顧服務人員',
    name: o.name ?? '王小明',
    analyzedEffectiveDate: o.eff ?? '112/09/15',
    row: {
      month: o.month ?? '114/03',
      cardYearIndex: o.year ?? 2,
      buckets: { ...zero(ATTRIBUTE_BUCKETS), ...o.buckets },
      categories: { ...zero(CATEGORY_BUCKETS), ...o.categories } as never,
      culturalOldByBucket: { ...zero(ATTRIBUTE_BUCKETS), ...o.old },
    },
  };
}

describe('積分月報的欄位定義', () => {
  it('29 欄，鍵值唯一', () => {
    expect(MONTHLY_COLUMNS).toHaveLength(29);
    expect(new Set(MONTHLY_COLUMNS.map((c) => c.key)).size).toBe(29);
    expect(new Set(MONTHLY_HEADER_ROW).size).toBe(29);
  });

  it('每個欄位都對應到自己那一欄，別名不互相誤中', () => {
    // 這是最容易出錯的地方：mapHeaders 用 includes 比對，
    // 「※舊制文化」若當別名就會誤中「※舊制文化-專業-實體」。
    const { index, missing } = mapHeaders(MONTHLY_HEADER_ROW, MONTHLY_COLUMNS);
    expect(missing).toEqual([]);
    MONTHLY_COLUMNS.forEach((col, i) => {
      expect(index[col.key]).toBe(i);
    });
  });

  it('身分證號、職業類別、曆月、證書年度是必要欄位', () => {
    const required = MONTHLY_COLUMNS.filter((c) => c.required).map((c) => c.key);
    expect(required).toEqual(['studentId', 'role', 'month', 'cardYear']);
  });
});

describe('月報列的產生', () => {
  it('0 一律寫成空白，非 0 才印出來', () => {
    const row = monthlyRecordToRow(record({ buckets: { professionalPhysical: 3.5 } }));
    const cells = Object.fromEntries(MONTHLY_HEADER_ROW.map((h, i) => [h, row[i]]));

    expect(cells['專業課程-實體']).toBe(3.5);
    expect(cells['專業課程-網路']).toBe('');
    expect(cells['※消防安全']).toBe('');
  });

  it('身分證號與職業類別由 cardId 拆出來，各佔一欄', () => {
    const row = monthlyRecordToRow(record({ cardId: 'B120169842_居家服務督導員' }));
    const cells = Object.fromEntries(MONTHLY_HEADER_ROW.map((h, i) => [h, row[i]]));

    expect(cells['身分證號']).toBe('B120169842');
    expect(cells['職業類別']).toBe('居家服務督導員');
  });

  it('曆月與證書年度寫成看得懂的字', () => {
    const normal = monthlyRecordToRow(record({ month: '114/03', year: 2 }));
    expect(normal[MONTHLY_HEADER_ROW.indexOf('曆月')]).toBe('114/03');
    expect(normal[MONTHLY_HEADER_ROW.indexOf('證書年度')]).toBe('第2年');

    const outOfRange = monthlyRecordToRow(record({ month: '112/08', year: CARD_YEAR_OUT_OF_RANGE }));
    expect(outOfRange[MONTHLY_HEADER_ROW.indexOf('證書年度')]).toBe(CARD_YEAR_OUT_OF_RANGE_LABEL);

    const unassigned = monthlyRecordToRow(record({ month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE }));
    expect(unassigned[MONTHLY_HEADER_ROW.indexOf('曆月')]).toBe(MONTH_UNASSIGNED_LABEL);
  });

  it('buildMonthlyValues 第一列是標題列', () => {
    const values = buildMonthlyValues([record({})]);
    expect(values[0]).toEqual(MONTHLY_HEADER_ROW);
    expect(values).toHaveLength(2);
  });
});

describe('月報的解析', () => {
  it('寫出去再讀回來，內容完全相同', () => {
    const records = [
      record({
        cardId: 'A123456789_照顧服務人員', name: '王小明', eff: '112/09/15',
        month: '114/03', year: 2,
        buckets: { professionalPhysical: 3.5, qualityOnline: 1.25 },
        categories: { fireSafety: 1, culturalNewIndigenous: 1 },
      }),
      record({
        cardId: 'B120169842_居家服務督導員', name: '李小龍', eff: '110/05/05',
        month: '113/01', year: 1,
        buckets: { qualityOnline: 1.5 },
        categories: { culturalOld: 1.5 },
        old: { qualityOnline: 1.5 },
      }),
    ];

    const { records: back, issues } = parseMonthlyReport(buildMonthlyValues(records));
    expect(issues).toEqual([]);
    expect(back).toEqual(records);
  });

  it('無法歸月與效期外都還原得回來', () => {
    const records = [
      record({ month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE, buckets: { professionalPhysical: 2 } }),
      record({ month: '112/08', year: CARD_YEAR_OUT_OF_RANGE, buckets: { professionalPhysical: 4 } }),
    ];

    const { records: back } = parseMonthlyReport(buildMonthlyValues(records));
    expect(back[0].row.month).toBe(MONTH_UNASSIGNED);
    expect(back[0].row.cardYearIndex).toBe(CARD_YEAR_OUT_OF_RANGE);
    expect(back[1].row.month).toBe('112/08');
    expect(back[1].row.cardYearIndex).toBe(CARD_YEAR_OUT_OF_RANGE);
  });

  it('曆月看不懂時記問題，但積分保留', () => {
    const values = buildMonthlyValues([record({ buckets: { professionalPhysical: 5 } })]);
    values[1][MONTHLY_HEADER_ROW.indexOf('曆月')] = '去年三月';

    const { records: back, issues } = parseMonthlyReport(values);
    expect(issues.map((i) => i.kind)).toEqual(['invalidMonth']);
    expect(back[0].row.buckets.professionalPhysical).toBe(5);
  });

  it('證書年度看不懂時視為效期外，積分仍計入', () => {
    const values = buildMonthlyValues([record({ buckets: { professionalPhysical: 5 } })]);
    values[1][MONTHLY_HEADER_ROW.indexOf('證書年度')] = '第二年';

    const { records: back, issues } = parseMonthlyReport(values);
    expect(issues.map((i) => i.kind)).toEqual(['invalidCardYear']);
    expect(back[0].row.cardYearIndex).toBe(CARD_YEAR_OUT_OF_RANGE);
    expect(back[0].row.buckets.professionalPhysical).toBe(5);
  });

  it('缺必要欄位就不往下解析', () => {
    const { records: back, issues } = parseMonthlyReport([['身分證號', '姓名']]);
    expect(back).toEqual([]);
    expect(issues.map((i) => i.kind)).toEqual(['missingColumn']);
  });

  it('分頁是空的時回傳空結果，不算錯誤', () => {
    expect(parseMonthlyReport([])).toEqual({ records: [], issues: [] });
  });

  it('同一人的兩種職業類別分成兩筆，不會併在一起', () => {
    const records = [
      record({ cardId: 'A123456789_照顧服務人員', buckets: { professionalPhysical: 1 } }),
      record({ cardId: 'A123456789_居家服務督導員', buckets: { professionalPhysical: 2 } }),
    ];
    const { records: back } = parseMonthlyReport(buildMonthlyValues(records));

    expect(back.map((r) => r.cardId)).toEqual([
      'A123456789_照顧服務人員', 'A123456789_居家服務督導員',
    ]);
  });
});

describe('月報的取代寫入', () => {
  const existing = buildMonthlyValues([
    record({ cardId: 'A123456789_照顧服務人員', month: '113/05', year: 1, buckets: { professionalPhysical: 1 } }),
    record({ cardId: 'A123456789_照顧服務人員', month: '114/03', year: 2, buckets: { professionalPhysical: 2 } }),
    record({ cardId: 'A123456789_照顧服務人員', month: '114/08', year: 2, buckets: { professionalPhysical: 3 } }),
    record({ cardId: 'B120169842_居家服務督導員', month: '114/03', year: 1, buckets: { professionalPhysical: 4 } }),
  ]);
  const A = 'A123456789_照顧服務人員';

  it('取代匯出月以前的所有月份，只動這次出現的人員', () => {
    // 衛福部每次匯出都是生平全紀錄，所以匯出月以前的每個月都要重寫，
    // 不能只重寫「檔案裡有課的那些月」—— 被撤銷的課會清不掉。
    const plan = planMonthlyReplace(
      existing,
      [record({ cardId: A, month: '114/03', year: 2, buckets: { professionalPhysical: 9 } })],
      '114/06',
      [A],
    );

    // A 的 113/05 與 114/03 都在 114/06 以前，兩列都刪；114/08 比匯出月新所以留著。
    // B 這次沒出現，完全不動。
    expect(plan.deleteRowIndexes).toEqual([2, 1]);
    expect(plan.appends).toHaveLength(1);
  });

  it('比匯出月更新的月份不刪 —— 重傳一份較舊的匯出檔不該抹掉新資料', () => {
    const plan = planMonthlyReplace(existing, [], '114/03', [A]);
    // 只刪 113/05 與 114/03；114/08 留著
    expect(plan.deleteRowIndexes).toEqual([2, 1]);
  });

  it('同一份檔重跑兩次，列數與數值都不變', () => {
    const records = [
      record({ cardId: A, month: '114/03', year: 2, buckets: { professionalPhysical: 2 } }),
    ];

    const apply = (values: (string | number)[][]) => {
      const plan = planMonthlyReplace(values, records, '114/06', [A]);
      const kept = values.filter((_, i) => i === 0 || !plan.deleteRowIndexes.includes(i));
      return [...kept, ...plan.appends];
    };

    const once = apply(existing);
    const twice = apply(once);
    expect(twice).toEqual(once);
  });

  it('刪除索引由大到小，逐列刪才不會刪錯', () => {
    const plan = planMonthlyReplace(existing, [], '115/12', [A]);
    expect(plan.deleteRowIndexes).toEqual([3, 2, 1]);
  });

  it('「無法歸月」的列一律刪掉，否則每次上傳都會多一份', () => {
    const values = buildMonthlyValues([
      record({ cardId: A, month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE }),
      record({ cardId: 'B120169842_居家服務督導員', month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE }),
    ]);

    const plan = planMonthlyReplace(
      values,
      [record({ cardId: A, month: '114/03', year: 2 })],
      '114/03',
      [A],
    );

    // 只刪 A 的那列；B 這次沒出現，原封不動
    expect(plan.deleteRowIndexes).toEqual([1]);
  });

  it('判斷不出匯出月時，只清掉無法歸月的列', () => {
    const values = buildMonthlyValues([
      record({ cardId: A, month: '114/03', year: 2 }),
      record({ cardId: A, month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE }),
    ]);

    const plan = planMonthlyReplace(
      values,
      [record({ cardId: A, month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE })],
      '',
      [A],
    );

    expect(plan.deleteRowIndexes).toEqual([2]);
  });

  it('曆月看不懂的列不刪 —— 看不懂的東西不替使用者決定要不要毀掉', () => {
    const values = buildMonthlyValues([
      record({ cardId: A, month: '114/03', year: 2 }),
    ]);
    values[1][MONTHLY_HEADER_ROW.indexOf('曆月')] = '手改過的東西';

    const plan = planMonthlyReplace(
      values,
      [record({ cardId: A, month: '114/03', year: 2 })],
      '114/12',
      [A],
    );

    expect(plan.deleteRowIndexes).toEqual([]);
  });

  it('這次上傳有他、但一列積分都沒產出的人，舊資料仍然要清掉', () => {
    // 某人的課全部變成「不符合」時就是這個情況。
    // 若取代對象從 records 推導，他的舊積分會永遠留著。
    const plan = planMonthlyReplace(existing, [], '114/06', [A]);

    expect(plan.deleteRowIndexes).toEqual([2, 1]);
    expect(plan.appends).toEqual([]);
  });

  it('分頁不存在（空陣列）時直接附加，不算錯誤', () => {
    const plan = planMonthlyReplace([], [record({})], '114/03', []);
    expect(plan.blocked).toBeUndefined();
    expect(plan.deleteRowIndexes).toEqual([]);
    expect(plan.appends).toHaveLength(1);
  });

  it('標題列缺必要欄位時整批擋下，不亂寫', () => {
    const plan = planMonthlyReplace([['身分證號', '姓名']], [record({})], '114/03', []);
    expect(plan.blocked).toContain('缺少必要欄位');
    expect(plan.appends).toEqual([]);
  });
});

describe('uploadThroughMonth', () => {
  function row(o: { date?: string; status?: string; points?: number | string }) {
    return {
      '人員姓名': '測試員',
      '身分證字號/\n統一證號': 'A123456789',
      '認可狀態': o.status ?? '符合',
      '課程日期': o.date ?? '113/05/01',
      '實施方式': '01-1 實體課程',
      '課程屬性': '專業課程',
      '課程類別': '',
      '積分': o.points ?? 1,
    };
  }

  it('匯出日期優先，而不是最晚的課程日期', () => {
    // 這正是重點：最後一個月的課全部被撤銷時，課程日期只到 114/03，
    // 但這份檔案對 115/06 以前的每個月都是權威的。
    expect(uploadThroughMonth([row({ date: '114/03/20' })], '115/06/02')).toBe('115/06');
  });

  it('匯出日期讀不到時，退回檔案裡最晚的課程月', () => {
    expect(uploadThroughMonth([
      row({ date: '113/05/01' }),
      row({ date: '114/08/15' }),
      row({ date: '114/03/20' }),
    ], '')).toBe('114/08');
  });

  it('退回時不採計的列也算 —— 那些月份仍在這份檔的涵蓋範圍內', () => {
    expect(uploadThroughMonth([
      row({ date: '113/05/01' }),
      row({ date: '114/03/20', status: '不符合' }),
    ], '')).toBe('114/03');
  });

  it('民國 99 年不會因字串比大小而排錯', () => {
    expect(uploadThroughMonth([
      row({ date: '100/01/05' }),
      row({ date: '99/12/05' }),
    ], '')).toBe('100/01');
  });

  it('兩者都判斷不出來時回傳空字串', () => {
    expect(uploadThroughMonth([row({ date: '待補' })], '')).toBe('');
    expect(uploadThroughMonth([], '')).toBe('');
  });
});

describe('findExportDate', () => {
  it('讀得出衛福部匯出檔表頭的「匯出日期：115年06月02日」', () => {
    expect(findExportDate([
      ['報表名稱：機構人員教育訓練積分表'],
      ['匯出日期：115年06月02日'],
    ])).toBe('115/06/02');
  });

  it('也接受斜線格式', () => {
    expect(findExportDate([['匯出日期：115/06/02']])).toBe('115/06/02');
  });

  it('掃整個表頭區塊，不寫死在第幾列', () => {
    expect(findExportDate([[''], [''], ['', '匯出日期 115年12月31日']])).toBe('115/12/31');
  });

  it('找不到時回傳空字串，不亂猜', () => {
    expect(findExportDate([['報表名稱：機構人員教育訓練積分表']])).toBe('');
    expect(findExportDate([])).toBe('');
  });
});


describe('積分總表', () => {
  it('欄位順序與使用者指定的完全一致', () => {
    expect(SUMMARY_COLUMNS).toEqual([
      '身分證號', '國籍', '姓名', '職業類別',
      '專業課程_實體', '專業課程_網路', '專業課程_總計',
      '專業品質_實體', '專業品質_網路',
      '專業倫理_實體', '專業倫理_網路',
      '專業法規_實體', '專業法規_網路',
      '品質倫理法規_總計',
      '消防安全', '緊急應變', '感染管制', '性別敏感度', '四大核心_總計',
      '原住民族與多元族群文化(舊)', '舊制文化超上限未採計',
      '原住民族文化(新)', '多元族群文化(新)', '新制文化逐年檢核',
      '實體課程(raw total)', '網路課程(raw total)', '最終總計',
      '小卡起始日', '小卡到期日', '注意',
    ]);
  });

  it('依欄位名稱擺放，不依物件的鍵順序', () => {
    // buildCsvRow 產出的鍵順序與這張表的欄位順序不同，靠鍵名對應才不會錯位
    const values = buildSummaryValues([{ '最終總計': 88, '身分證號': 'A123456789', '姓名': '王小明' }]);
    expect(values[0]).toEqual(SUMMARY_COLUMNS);
    expect(values[1][SUMMARY_COLUMNS.indexOf('身分證號')]).toBe('A123456789');
    expect(values[1][SUMMARY_COLUMNS.indexOf('姓名')]).toBe('王小明');
    expect(values[1][SUMMARY_COLUMNS.indexOf('最終總計')]).toBe(88);
  });

  it('數字維持數字型別，使用者才 SUM 得起來', () => {
    const values = buildSummaryValues([{ '最終總計': 88.5 }]);
    expect(typeof values[1][SUMMARY_COLUMNS.indexOf('最終總計')]).toBe('number');
  });

  it('沒有的欄位寫空白，不會讓後面的欄位位移', () => {
    const values = buildSummaryValues([{ '身分證號': 'A123456789' }]);
    expect(values[1]).toHaveLength(SUMMARY_COLUMNS.length);
    expect(values[1][SUMMARY_COLUMNS.indexOf('注意')]).toBe('');
  });

  it('沒有任何人員時只留標題列', () => {
    expect(buildSummaryValues([])).toEqual([SUMMARY_COLUMNS]);
  });
});


describe('累計走勢分頁', () => {
  const table = {
    points: [
      { cardId: 'A_照', display: '王小明（照顧服務人員）', cardYearIndex: 1, month: '112/09', total: 0, expected: 0.05 },
      { cardId: 'A_照', display: '王小明（照顧服務人員）', cardYearIndex: 1, month: '112/10', total: 4, expected: 2.6 },
      { cardId: 'A_照', display: '王小明（照顧服務人員）', cardYearIndex: 2, month: '113/09', total: 30, expected: 20 },
      { cardId: 'B_居', display: '李小龍（居家服務督導員）', cardYearIndex: 1, month: '114/06', total: 5, expected: 1 },
    ],
    people: [
      { cardId: 'A_照', studentId: 'A123456789', role: '照顧服務人員', name: '王小明', display: '王小明（照顧服務人員）', current: 30, expected: 20, fromIndex: 0, toIndex: 2 },
      { cardId: 'B_居', studentId: 'B120169842', role: '居家服務督導員', name: '李小龍', display: '李小龍（居家服務督導員）', current: 5, expected: 1, fromIndex: 3, toIndex: 3 },
    ],
    maxCardYear: 2,
  };

  describe('隱藏長表', () => {
    const data = buildTrendData(table);

    it('一列一個「人員 × 曆月」，證書年度寫成可比對的字串', () => {
      expect(data[0].slice(0, 6)).toEqual(['人員鍵', '顯示名稱', '證書年度', '曆月', '累計實得', '應達進度']);
      expect(data[1].slice(0, 6)).toEqual(['A_照', '王小明（照顧服務人員）', '第1年', '112/09', 0, 0.05]);
      expect(data).toHaveLength(1 + table.points.length);
    });

    it('人員清單放在另一欄，供下拉選單當來源', () => {
      expect(data[0][TREND_DATA_LIST_COL]).toBe('人員清單');
      expect(data[1][TREND_DATA_LIST_COL]).toBe('王小明（照顧服務人員）');
      expect(data[2][TREND_DATA_LIST_COL]).toBe('李小龍（居家服務督導員）');
      expect(data[3][TREND_DATA_LIST_COL]).toBe('');
    });
  });

  describe('顯示面', () => {
    const values = buildTrendValues(table);

    it('只有 13 欄 —— 標籤加 12 個月，不再有橫向捲軸', () => {
      const width = TREND_FIRST_DATA_COL + TREND_MONTHS_PER_YEAR;
      expect(width).toBe(13);
      values.forEach(row => expect(row).toHaveLength(width));
    });

    it('標籤落在約定的列', () => {
      expect(values[TREND_SELECT_PERSON_ROW][0]).toBe('人員');
      expect(values[TREND_SELECT_YEAR_ROW][0]).toBe('證書年度');
      expect(values[TREND_MONTH_ROW][0]).toBe('曆月');
      expect(values[TREND_EARNED_ROW][0]).toBe('累計實得');
    });

    it('第一次打開就有預選值，不是一片空白', () => {
      expect(values[TREND_SELECT_PERSON_ROW][1]).toBe('王小明（照顧服務人員）');
      expect(values[TREND_SELECT_YEAR_ROW][1]).toBe('第1年');
    });

    it('一覽表接在下面，人員順序與長表一致', () => {
      expect(values[TREND_LIST_HEADER_ROW][0]).toBe('身分證號');
      expect(values[TREND_LIST_HEADER_ROW][TREND_LIST_SPARKLINE_COL]).toBe('累計走勢');
      expect(values[TREND_LIST_FIRST_ROW][2]).toBe('王小明');
      expect(values[TREND_LIST_FIRST_ROW + 1][2]).toBe('李小龍');
      expect(values).toHaveLength(TREND_LIST_FIRST_ROW + table.people.length);
    });
  });

  describe('公式', () => {
    const blocks = buildTrendFormulas(table);
    const find = (range: string) => blocks.find(b => b.range === range)?.values[0][0] ?? '';

    it('三條 FILTER 都比對兩個下拉選單的儲存格', () => {
      ['B6', 'B7', 'B8'].forEach(cell => {
        expect(find(cell)).toContain('$B$1');
        expect(find(cell)).toContain('$B$2');
        expect(find(cell)).toContain('TRANSPOSE(FILTER');
      });
      expect(find('B6')).toContain("!D2:D");
      expect(find('B7')).toContain("!E2:E");
      expect(find('B8')).toContain("!F2:F");
    });

    it('SPARKLINE 的列範圍對齊長表，且高度固定 0~120', () => {
      const sparklines = blocks[blocks.length - 1];
      expect(sparklines.values).toHaveLength(2);
      expect(sparklines.values[0][0]).toContain("!E2:E4");
      expect(sparklines.values[1][0]).toContain("!E5:E5");
      expect(sparklines.values[0][0]).toContain('"ymin",0;"ymax",120');
    });

    it('沒有人員時不產生 SPARKLINE 區塊', () => {
      const empty = buildTrendFormulas({ points: [], people: [], maxCardYear: 1 });
      expect(empty.every(b => !b.values[0][0].includes('SPARKLINE'))).toBe(true);
    });
  });

  it('年度選項依實際出現過的年度產生', () => {
    expect(trendYearOptions(table)).toEqual(['第1年', '第2年']);
  });
});
