import { describe, it, expect } from 'vitest';
import {
  mapHeaders,
  parseRoster,
  cardToRow,
  buildRosterValues,
  ROSTER_HEADER_ROW,
  columnLetter,
  toA1Range,
  planSheetWrites,
  planSheetDeletes,
} from './sheetSchema';

const H = ROSTER_HEADER_ROW;

describe('mapHeaders', () => {
  it('對應標準標題列', () => {
    const { index, missing } = mapHeaders(H);
    expect(missing).toEqual([]);
    expect(index).toEqual({
      studentId: 0, name: 1, nationality: 2, role: 3, effectiveDate: 4, expiryDate: 5,
    });
  });

  it('欄位順序被調換也能對應', () => {
    const { index, missing } = mapHeaders(['姓名', '到期日期', '生效日期', '職業類別', '身分證號']);
    expect(missing).toEqual([]);
    expect(index.name).toBe(0);
    expect(index.expiryDate).toBe(1);
    expect(index.studentId).toBe(4);
  });

  it('容忍別名與多餘文字', () => {
    const { missing, index } = mapHeaders(['身份證字號', '人員姓名', '國籍', '職登類別', '小卡生效日', '小卡到期日']);
    expect(missing).toEqual([]);
    expect(index.role).toBe(3);
  });

  it('國籍不是必要欄位，缺了不算問題', () => {
    const { missing, index } = mapHeaders(['身分證號', '姓名', '職業類別', '生效日期', '到期日期']);
    expect(missing).toEqual([]);
    expect(index.nationality).toBeUndefined();
  });

  it('缺少必要欄位時列出來', () => {
    const { missing } = mapHeaders(['姓名', '國籍']);
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
