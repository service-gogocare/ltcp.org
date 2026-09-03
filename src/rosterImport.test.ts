import { describe, it, expect } from 'vitest';
import {
  parseRosterImport,
  buildRosterTemplate,
  ROSTER_TEMPLATE_HEADER,
} from './rosterImport';

const H = [...ROSTER_TEMPLATE_HEADER];

describe('buildRosterTemplate', () => {
  it('第一列是標題列，第二列是說明列', () => {
    const t = buildRosterTemplate();
    expect(t[0]).toEqual(H);
    expect(t[1][0]).toContain('例：');
  });

  it('說明列每一格都用 isGuideRow 認得的前綴開頭', () => {
    // 少一格符合就會讓整列被當成人員資料，而那是使用者看不懂的錯誤
    for (const cell of buildRosterTemplate()[1]) {
      expect(cell).toMatch(/^(例：|可填：|留空)/);
    }
  });

  it('不預先放空白資料列，避免被誤存成真人員', () => {
    expect(buildRosterTemplate()).toHaveLength(2);
  });

  it('範本自己解析回來不會產生任何人員', () => {
    const { cards, issues } = parseRosterImport(buildRosterTemplate());
    expect(cards).toEqual({});
    expect(issues).toEqual([]);   // 說明列要被認出來略過，不能報成錯誤
  });
});

describe('parseRosterImport', () => {
  it('解析正常內容', () => {
    const { cards, issues } = parseRosterImport([
      H,
      ['A123456789', '王小明', '臺灣', '照顧服務人員', '113/08/20', '119/08/19'],
      ['B120169842', '李小龍', '印尼', '居家服務督導員', '112/02/25', '118/02/24'],
    ]);
    expect(issues).toEqual([]);
    expect(Object.keys(cards)).toEqual(['A123456789_照顧服務人員', 'B120169842_居家服務督導員']);
    expect(cards['A123456789_照顧服務人員']).toEqual({
      name: '王小明', role: '照顧服務人員', nationality: '臺灣',
      effectiveDate: '113/08/20', expiryDate: '119/08/19',
    });
  });

  it('只填生效日會自動算出到期日', () => {
    const { cards } = parseRosterImport([H, ['A1', '王小明', '臺灣', '照顧服務人員', '113/08/20', '']]);
    expect(cards['A1_照顧服務人員'].expiryDate).toBe('119/08/19');
  });

  it('只填到期日會反推生效日', () => {
    const { cards } = parseRosterImport([H, ['A1', '王小明', '臺灣', '照顧服務人員', '', '119/08/19']]);
    expect(cards['A1_照顧服務人員'].effectiveDate).toBe('113/08/20');
  });

  it('起訖日全空的列被略過並說明原因', () => {
    // 這是這個匯入管道存在的理由：沒有效期就算不出證書年度，
    // 收下來只會產生一批「效期外」的假資料
    const { cards, issues } = parseRosterImport([H, ['A1', '王小明', '臺灣', '照顧服務人員', '', '']]);
    expect(cards).toEqual({});
    expect(issues[0]).toMatchObject({ kind: 'missingDates', row: 2 });
    expect(issues[0].message).toContain('必填');
  });

  it('日期無法解析的列被略過', () => {
    const { cards, issues } = parseRosterImport([H, ['A1', '王小明', '臺灣', '照顧服務人員', '不是日期', '']]);
    expect(cards).toEqual({});
    expect(issues[0].kind).toBe('invalidDate');
  });

  it('容忍西元、七碼民國與連字號等寫法', () => {
    const { cards, issues } = parseRosterImport([
      H,
      ['A1', '甲', '臺灣', '照顧服務人員', '1130820', ''],
      ['A2', '乙', '臺灣', '照顧服務人員', '2024-08-20', ''],
    ]);
    expect(issues).toEqual([]);
    expect(cards['A1_照顧服務人員'].effectiveDate).toBe('113/08/20');
    expect(cards['A2_照顧服務人員'].effectiveDate).toBe('113/08/20');
  });

  it('欄位順序被調換也能對應', () => {
    const { cards, issues } = parseRosterImport([
      ['姓名', '生效日期', '身分證號', '職業類別'],
      ['王小明', '113/08/20', 'A1', '照顧服務人員'],
    ]);
    expect(issues).toEqual([]);
    expect(cards['A1_照顧服務人員'].name).toBe('王小明');
  });

  it('缺必要欄位時整批不解析', () => {
    const { cards, issues } = parseRosterImport([['姓名', '生效日期'], ['王小明', '113/08/20']]);
    expect(cards).toEqual({});
    expect(issues[0].kind).toBe('missingColumn');
    expect(issues[0].message).toContain('身分證號');
  });

  it('職業類別不在選項內時正規化並提醒', () => {
    const { cards, issues } = parseRosterImport([H, ['A1', '陳錦賜', '臺灣', '照顧服務員', '113/08/20', '']]);
    expect(cards['A1_照顧服務人員'].role).toBe('照顧服務人員');
    expect(issues[0]).toMatchObject({ kind: 'unknownRole', row: 2 });
  });

  it('身分證號＋職類重複時保留先出現的，並指出與哪一列重複', () => {
    const { cards, issues } = parseRosterImport([
      H,
      ['A1', '先出現', '臺灣', '照顧服務人員', '113/08/20', ''],
      ['A1', '後出現', '臺灣', '照顧服務人員', '110/01/01', ''],
    ]);
    expect(Object.keys(cards)).toHaveLength(1);
    expect(cards['A1_照顧服務人員'].name).toBe('先出現');
    expect(issues[0]).toMatchObject({ kind: 'duplicate', row: 3 });
    expect(issues[0].message).toContain('第 2 列');
  });

  it('同一人不同職類不算重複', () => {
    const { cards } = parseRosterImport([
      H,
      ['A1', '李小龍', '臺灣', '照顧服務人員', '113/08/20', ''],
      ['A1', '李小龍', '臺灣', '居家服務督導員', '112/02/25', ''],
    ]);
    expect(Object.keys(cards)).toHaveLength(2);
  });

  it('沒有身分證號或沒有姓名的列被略過', () => {
    const { cards, issues } = parseRosterImport([
      H,
      ['', '無證號', '臺灣', '照顧服務人員', '113/08/20', ''],
      ['A2', '', '臺灣', '照顧服務人員', '113/08/20', ''],
    ]);
    expect(cards).toEqual({});
    expect(issues.map(i => i.kind)).toEqual(['emptyId', 'emptyName']);
  });

  it('略過空白列且不記為問題', () => {
    const { cards, issues } = parseRosterImport([
      H,
      ['A1', '王小明', '臺灣', '照顧服務人員', '113/08/20', ''],
      ['', '', '', '', '', ''],
      [],
    ]);
    expect(Object.keys(cards)).toHaveLength(1);
    expect(issues).toEqual([]);
  });

  it('國籍不在選項內或空白時預設臺灣', () => {
    const { cards } = parseRosterImport([
      H,
      ['A1', '甲', '火星', '照顧服務人員', '113/08/20', ''],
      ['A2', '乙', '', '照顧服務人員', '113/08/20', ''],
    ]);
    expect(cards['A1_照顧服務人員'].nationality).toBe('臺灣');
    expect(cards['A2_照顧服務人員'].nationality).toBe('臺灣');
  });

  it('去除儲存格前後空白', () => {
    const { cards } = parseRosterImport([H, ['  A1 ', ' 王小明 ', '臺灣', ' 照顧服務人員 ', ' 113/08/20 ', '']]);
    expect(cards['A1_照顧服務人員'].name).toBe('王小明');
  });
});
