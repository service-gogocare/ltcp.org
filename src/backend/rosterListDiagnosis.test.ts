import { describe, it, expect } from 'vitest';
import { diagnoseRosterList, type RosterListCounts } from './rosterListDiagnosis';

const counts = (over: Partial<RosterListCounts> = {}): RosterListCounts => ({
  accessible: 0, tagged: 0, picked: 0, listed: 0, unrecognised: 0, ...over,
});

describe('diagnoseRosterList', () => {
  it('一切正常時只給數字，不製造沒有意義的警告', () => {
    const d = diagnoseRosterList(counts({ accessible: 3, tagged: 3, listed: 3 }));
    expect(d.level).toBe('info');
    expect(d.cause).toBeUndefined();
    expect(d.action).toBeUndefined();
  });

  it('數字摘要永遠都在，即使一切正常', () => {
    // 這一行是使用者回報問題時唯一能貼給我看的東西，不能省
    expect(diagnoseRosterList(counts({ accessible: 3, tagged: 3, listed: 3 })).summary)
      .toContain('可存取的試算表 3 份');
  });

  it('Drive 一份都沒回傳時指向授權層，並同時說明「本來就沒建過」也是這個結果', () => {
    const d = diagnoseRosterList(counts());
    expect(d.level).toBe('warning');
    expect(d.cause).toContain('drive.file');
    // 不能只說「授權斷了」—— 全新使用者看到的也是這個畫面，嚇到他等於製造假警報
    expect(d.action).toContain('從來沒有建立過名冊');
    expect(d.action).toContain('重新登入');
  });

  it('讀得到檔案卻一份都認不出來時，指向掉了的標記而不是授權', () => {
    const d = diagnoseRosterList(counts({ accessible: 2, unrecognised: 2 }));
    expect(d.level).toBe('warning');
    expect(d.cause).toContain('標記');
    expect(d.cause).not.toContain('drive.file');   // 這時候怪授權會把人帶去重登入白忙一趟
    expect(d.action).toContain('指認');
  });

  it('有名冊但另有未被認出的檔案時只是提示，不是警告', () => {
    const d = diagnoseRosterList(counts({ accessible: 4, tagged: 3, listed: 3, unrecognised: 1 }));
    expect(d.level).toBe('info');
    expect(d.cause).toContain('1 份');
    expect(d.action).toContain('名冊沒出現？');
  });

  it('列得出名冊時一律不擋路，即使 Drive 回傳數與列出數對不起來', () => {
    // 「選過但沒出現在 files.list、靠直接查詢救回來」的名冊會造成 listed > accessible
    const d = diagnoseRosterList(counts({ accessible: 0, picked: 1, listed: 1 }));
    expect(d.level).toBe('info');
  });
});
