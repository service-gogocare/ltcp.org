import { describe, it, expect } from 'vitest';
import {
  composeCardId,
  applyFieldChange,
  applyDateChange,
  buildSavePlan,
  buildDeletePlan,
  describeDeletePlan,
} from './cardPlan';
import type { StudentRow } from './studentFields';

/** 造一列人員資料；id 預設等於複合鍵，originalId 預設等於 id（＝已存在雲端） */
function row(over: Partial<StudentRow> & { studentId: string; role: string }): StudentRow {
  const id = over.id ?? composeCardId(over.studentId, over.role);
  return {
    selected: true,
    id,
    originalId: 'originalId' in over ? over.originalId : id,
    studentId: over.studentId,
    name: over.name ?? '測試員',
    nationality: over.nationality ?? '臺灣',
    role: over.role,
    earliestDate: over.earliestDate ?? '',
    effectiveDate: over.effectiveDate ?? '113/08/20',
    expiryDate: over.expiryDate ?? '119/08/19',
    rows: over.rows ?? [],
    ...('selected' in over ? { selected: over.selected! } : {}),
  };
}

describe('composeCardId', () => {
  it('文件 ID 是身分證號加職業類別', () => {
    expect(composeCardId('A123456789', '照顧服務人員')).toBe('A123456789_照顧服務人員');
  });
});

describe('applyFieldChange', () => {
  it('改職業類別會同步換掉 id，但保留 originalId 供儲存時刪舊文件', () => {
    const before = row({ studentId: 'A123456789', role: '照顧服務人員' });
    const after = applyFieldChange(before, 'role', '居家服務督導員');

    expect(after.id).toBe('A123456789_居家服務督導員');
    expect(after.originalId).toBe('A123456789_照顧服務人員');
    expect(after.role).toBe('居家服務督導員');
  });

  it('改姓名或國籍不會動到 id', () => {
    const before = row({ studentId: 'A123456789', role: '照顧服務人員' });
    expect(applyFieldChange(before, 'name', '佘月純').id).toBe(before.id);
    expect(applyFieldChange(before, 'nationality', '印尼').id).toBe(before.id);
    expect(applyFieldChange(before, 'name', '佘月純').name).toBe('佘月純');
  });

  it('不改動原本的物件（避免 React 讀到被改過的舊 state）', () => {
    const before = row({ studentId: 'A123456789', role: '照顧服務人員' });
    applyFieldChange(before, 'role', '個案管理人員');
    expect(before.role).toBe('照顧服務人員');
    expect(before.id).toBe('A123456789_照顧服務人員');
  });
});

describe('applyDateChange', () => {
  it('改生效日會自動算出 6 年減 1 天的到期日', () => {
    const after = applyDateChange(row({ studentId: 'A1', role: '照顧服務人員' }), 'effectiveDate', '113/08/20');
    expect(after.effectiveDate).toBe('113/08/20');
    expect(after.expiryDate).toBe('119/08/19');
  });

  it('改到期日會反推生效日', () => {
    const after = applyDateChange(row({ studentId: 'A1', role: '照顧服務人員' }), 'expiryDate', '121/04/20');
    expect(after.expiryDate).toBe('121/04/20');
    expect(after.effectiveDate).toBe('115/04/21');
  });

  it('生效日與到期日互相換算可以來回還原', () => {
    const a = applyDateChange(row({ studentId: 'A1', role: '照顧服務人員' }), 'effectiveDate', '112/09/01');
    const b = applyDateChange(a, 'expiryDate', a.expiryDate);
    expect(b.effectiveDate).toBe('112/09/01');
  });

  it('輸入還不是合法民國日期時不動另一個欄位（讓使用者能慢慢打字）', () => {
    const before = row({ studentId: 'A1', role: '照顧服務人員', effectiveDate: '113/08/20', expiryDate: '119/08/19' });
    const typing = applyDateChange(before, 'effectiveDate', '113/0');
    expect(typing.effectiveDate).toBe('113/0');
    expect(typing.expiryDate).toBe('119/08/19');   // 維持原值，沒有被清掉
  });
});

describe('buildSavePlan', () => {
  it('沒有資料時擋下來', () => {
    const result = buildSavePlan([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty');
  });

  it('沒改職類時只寫入、不刪除任何文件', () => {
    const result = buildSavePlan([row({ studentId: 'A1', role: '照顧服務人員' })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.writes.map((w) => w.docId)).toEqual(['A1_照顧服務人員']);
    expect(result.plan.deletes).toEqual([]);
    expect(result.plan.rekeys).toEqual([]);
  });

  it('改過職類的列要寫新 ID 並刪掉舊 ID', () => {
    const changed = applyFieldChange(
      row({ studentId: 'A1', role: '照顧服務人員', name: '葉裕明' }),
      'role',
      '居家服務督導員',
    );
    const result = buildSavePlan([changed]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.writes).toEqual([{
      docId: 'A1_居家服務督導員',
      record: {
        name: '葉裕明',
        role: '居家服務督導員',
        nationality: '臺灣',
        effectiveDate: '113/08/20',
        expiryDate: '119/08/19',
      },
    }]);
    expect(result.plan.deletes).toEqual(['A1_照顧服務人員']);
    expect(result.plan.rekeys).toEqual([
      { name: '葉裕明', from: 'A1_照顧服務人員', to: 'A1_居家服務督導員' },
    ]);
  });

  it('舊制文件（ID 只有身分證號）會被搬到複合鍵並刪掉舊文件', () => {
    const legacy = row({
      studentId: 'A122050970',
      role: '照顧服務人員',
      id: 'A122050970_照顧服務人員',
      originalId: 'A122050970',        // 3e2c752 之前的舊制 ID
      name: '陳錦賜',
    });
    const result = buildSavePlan([legacy]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.writes[0].docId).toBe('A122050970_照顧服務人員');
    expect(result.plan.deletes).toEqual(['A122050970']);
  });

  it('還沒寫進雲端的新列不會產生刪除動作', () => {
    const fresh = row({ studentId: 'A9', role: '照顧服務人員', originalId: undefined });
    const result = buildSavePlan([fresh]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.deletes).toEqual([]);
  });

  it('兩列撞到同一個文件 ID 時擋下來，不讓後寫的蓋掉前一筆', () => {
    // 一人兩職類，其中一列被批次改成跟另一列相同的職類
    const supervisor = row({ studentId: 'A1', role: '居家服務督導員', name: '甲' });
    const caregiver = row({ studentId: 'A1', role: '照顧服務人員', name: '乙' });
    const collided = applyFieldChange(supervisor, 'role', '照顧服務人員');

    const result = buildSavePlan([collided, caregiver]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('duplicateId');
    expect(result.message).toContain('A1_照顧服務人員');
    expect(result.message).toContain('甲');
    expect(result.message).toContain('乙');
  });

  it('日期不合法時擋下來，且不會產生任何寫入', () => {
    const bad = row({ studentId: 'A1', role: '照顧服務人員', expiryDate: '119/8' });
    const result = buildSavePlan([bad]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalidDate');
  });

  it('姓名空白時擋下來（只有空白字元也算空）', () => {
    const bad = row({ studentId: 'A1', role: '照顧服務人員', name: '   ' });
    const result = buildSavePlan([bad]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('emptyName');
  });

  it('一次驗證整批，任一列有問題就不做任何寫入', () => {
    const good = row({ studentId: 'A1', role: '照顧服務人員' });
    const bad = row({ studentId: 'A2', role: '照顧服務人員', effectiveDate: '' });
    expect(buildSavePlan([good, bad]).ok).toBe(false);
  });

  it('同一人真的有兩種職類時可以並存', () => {
    const result = buildSavePlan([
      row({ studentId: 'B120169842', role: '居家服務督導員', name: '李小龍' }),
      row({ studentId: 'B120169842', role: '照顧服務人員', name: '李小龍' }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.writes.map((w) => w.docId)).toEqual([
      'B120169842_居家服務督導員',
      'B120169842_照顧服務人員',
    ]);
    expect(result.plan.deletes).toEqual([]);
  });
});

describe('buildDeletePlan', () => {
  it('分開「雲端要刪的文件」與「只在表格上的列」', () => {
    const students = [
      row({ studentId: 'A1', role: '照顧服務人員', selected: true }),
      row({ studentId: 'A2', role: '照顧服務人員', selected: true, originalId: undefined }),
      row({ studentId: 'A3', role: '照顧服務人員', selected: false }),
    ];
    const plan = buildDeletePlan(students);

    expect(plan.inCloud.map((c) => c.docId)).toEqual(['A1_照顧服務人員']);
    expect(plan.localOnlyRowIds).toEqual(['A2_照顧服務人員']);
  });

  it('刪的是 originalId，不是被改過職類的 id', () => {
    const changed = applyFieldChange(row({ studentId: 'A1', role: '照顧服務人員' }), 'role', '個案管理人員');
    const plan = buildDeletePlan([changed]);
    expect(plan.inCloud[0].docId).toBe('A1_照顧服務人員');
    expect(plan.inCloud[0].rowId).toBe('A1_個案管理人員');
  });

  it('未勾選的列完全不出現在計畫裡', () => {
    const plan = buildDeletePlan([row({ studentId: 'A1', role: '照顧服務人員', selected: false })]);
    expect(plan.inCloud).toEqual([]);
    expect(plan.localOnlyRowIds).toEqual([]);
  });
});

describe('describeDeletePlan', () => {
  it('說明有幾筆會真的從雲端移除', () => {
    const plan = buildDeletePlan([
      row({ studentId: 'A1', role: '照顧服務人員', name: '甲', selected: true }),
      row({ studentId: 'A2', role: '照顧服務人員', name: '乙', selected: true, originalId: undefined }),
    ]);
    const text = describeDeletePlan(plan);
    expect(text).toContain('已勾選的 2 筆');
    expect(text).toContain('其中 1 筆已存在雲端');
    expect(text).toContain('甲');
  });

  it('超過上限只列前幾筆並註明總數', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      row({ studentId: `A${i}`, role: '照顧服務人員', name: `人${i}`, selected: true }));
    const text = describeDeletePlan(buildDeletePlan(many), 10);
    expect(text).toContain('人9');
    expect(text).not.toContain('人10');
    expect(text).toContain('…等共 12 筆');
  });
});
