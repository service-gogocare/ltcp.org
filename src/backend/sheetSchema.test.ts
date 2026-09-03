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
  monthlyRecordToRow,
  parseMonthlyReport,
  planMonthlyReplace,
} from './sheetSchema';
import {
  ATTRIBUTE_BUCKETS,
  CATEGORY_BUCKETS,
  CARD_YEAR_OUT_OF_RANGE,
  MONTH_UNASSIGNED,
  courseMonthRange,
  type MonthlyPointRecord,
} from '../monthlyPoints';
import type { AttributeBucket } from '../calculator';

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

  it('只刪上傳範圍內、且這次有出現的人員的列', () => {
    const plan = planMonthlyReplace(
      existing,
      [record({ cardId: 'A123456789_照顧服務人員', month: '114/03', year: 2, buckets: { professionalPhysical: 9 } })],
      { from: '114/01', to: '114/06' },
    );

    // 只有 A 的 114/03 那列落在範圍內：113/05 太早、114/08 太晚、B 這次沒出現
    expect(plan.deleteRowIndexes).toEqual([2]);
    expect(plan.appends).toHaveLength(1);
  });

  it('同一份檔重跑兩次，列數與數值都不變', () => {
    const records = [
      record({ cardId: 'A123456789_照顧服務人員', month: '114/03', year: 2, buckets: { professionalPhysical: 2 } }),
    ];
    const range = { from: '114/03', to: '114/03' };

    const apply = (values: (string | number)[][]) => {
      const plan = planMonthlyReplace(values, records, range);
      const kept = values.filter((_, i) => i === 0 || !plan.deleteRowIndexes.includes(i));
      return [...kept, ...plan.appends];
    };

    const once = apply(existing);
    const twice = apply(once);
    expect(twice).toEqual(once);
  });

  it('刪除索引由大到小，逐列刪才不會刪錯', () => {
    const plan = planMonthlyReplace(
      existing,
      [record({ cardId: 'A123456789_照顧服務人員', month: '113/05', year: 1 })],
      { from: '113/01', to: '114/12' },
    );

    expect(plan.deleteRowIndexes).toEqual([3, 2, 1]);
  });

  it('「無法歸月」的列一律刪掉，否則每次上傳都會多一份', () => {
    const values = buildMonthlyValues([
      record({ cardId: 'A123456789_照顧服務人員', month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE }),
      record({ cardId: 'B120169842_居家服務督導員', month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE }),
    ]);

    const plan = planMonthlyReplace(
      values,
      [record({ cardId: 'A123456789_照顧服務人員', month: '114/03', year: 2 })],
      { from: '114/03', to: '114/03' },
    );

    // 只刪 A 的那列；B 這次沒出現，原封不動
    expect(plan.deleteRowIndexes).toEqual([1]);
  });

  it('檔案沒有任何可解析日期時，只清掉無法歸月的列', () => {
    const values = buildMonthlyValues([
      record({ cardId: 'A123456789_照顧服務人員', month: '114/03', year: 2 }),
      record({ cardId: 'A123456789_照顧服務人員', month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE }),
    ]);

    const plan = planMonthlyReplace(
      values,
      [record({ cardId: 'A123456789_照顧服務人員', month: MONTH_UNASSIGNED, year: CARD_YEAR_OUT_OF_RANGE })],
      null,
    );

    expect(plan.deleteRowIndexes).toEqual([2]);
  });

  it('曆月看不懂的列不刪 —— 看不懂的東西不替使用者決定要不要毀掉', () => {
    const values = buildMonthlyValues([
      record({ cardId: 'A123456789_照顧服務人員', month: '114/03', year: 2 }),
    ]);
    values[1][MONTHLY_HEADER_ROW.indexOf('曆月')] = '手改過的東西';

    const plan = planMonthlyReplace(
      values,
      [record({ cardId: 'A123456789_照顧服務人員', month: '114/03', year: 2 })],
      { from: '114/01', to: '114/12' },
    );

    expect(plan.deleteRowIndexes).toEqual([]);
  });

  it('分頁不存在（空陣列）時直接附加，不算錯誤', () => {
    const plan = planMonthlyReplace([], [record({})], { from: '114/03', to: '114/03' });
    expect(plan.blocked).toBeUndefined();
    expect(plan.deleteRowIndexes).toEqual([]);
    expect(plan.appends).toHaveLength(1);
  });

  it('標題列缺必要欄位時整批擋下，不亂寫', () => {
    const plan = planMonthlyReplace([['身分證號', '姓名']], [record({})], { from: '114/03', to: '114/03' });
    expect(plan.blocked).toContain('缺少必要欄位');
    expect(plan.appends).toEqual([]);
  });
});

describe('courseMonthRange', () => {
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

  it('取檔案內最早與最晚的曆月', () => {
    expect(courseMonthRange([
      row({ date: '114/03/20' }),
      row({ date: '113/05/01' }),
      row({ date: '114/08/15' }),
    ])).toEqual({ from: '113/05', to: '114/08' });
  });

  it('不採計的列也算進範圍', () => {
    // 課程被移除或改成不符合時，那個月就不再有可採計的列。
    // 若用「算得出積分的課程」去定範圍，那個月會永遠清不掉。
    expect(courseMonthRange([
      row({ date: '113/05/01', status: '審核中' }),
      row({ date: '114/03/20', points: 0 }),
    ])).toEqual({ from: '113/05', to: '114/03' });
  });

  it('沒有任何可解析日期時回傳 null', () => {
    expect(courseMonthRange([row({ date: '待補' })])).toBeNull();
    expect(courseMonthRange([])).toBeNull();
  });

  it('民國 99 年不會因字串比大小而排錯', () => {
    expect(courseMonthRange([
      row({ date: '100/01/05' }),
      row({ date: '99/12/05' }),
    ])).toEqual({ from: '99/12', to: '100/01' });
  });
});
