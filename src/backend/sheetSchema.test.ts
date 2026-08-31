import { describe, it, expect } from 'vitest';
import {
  mapHeaders,
  parseRoster,
  cardToRow,
  buildRosterValues,
  ROSTER_HEADER_ROW,
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
