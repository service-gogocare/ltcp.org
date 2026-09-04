/**
 * 「找不到名冊」的成因判讀（純函式）
 * ---------------------------------------------------------------------------
 * drive.file 範圍下，**Drive 看得見的檔案與本程式讀得到的檔案是兩個不同的集合**。
 * 所以清單是空的時候，原因可能落在三個完全不同的地方：
 *
 *   1. Drive 一份試算表都沒回傳   → 授權層斷了（撤銷過授權、換帳號、換 client ID）
 *   2. 回傳了但沒有一份帶名冊標記 → 建立名冊的最後一步「設定標記」沒成功
 *   3. 都正常，只是還沒建過       → 單純的空狀態
 *
 * 原本只丟數字（「帶標記 0、選過 0」），等於要使用者自己知道上面這三層是什麼。
 * 這個模組把數字翻成「最可能的原因」與「下一步該做什麼」。
 *
 * 放獨立檔案是為了讓它被 vitest 蓋住 —— 判讀邏輯出錯的症狀是
 * 「使用者照著錯的指示白忙一輪」，那正是最該有測試的地方。
 */

export interface RosterListCounts {
  /** files.list 回傳的試算表總數（本程式讀得到的全部，不論是不是名冊） */
  accessible: number;
  /** 其中帶有本系統 appProperties 標記的 */
  tagged: number;
  /** 其中靠「使用者親自選過」認出來的 */
  picked: number;
  /** 最終列進下拉選單的名冊數 */
  listed: number;
  /** 讀得到、但沒被認出是名冊的試算表數 */
  unrecognised: number;
}

export interface RosterListDiagnosis {
  level: 'info' | 'warning';
  /** 一行數字，永遠都有 */
  summary: string;
  /** 最可能的原因；一切正常時沒有 */
  cause?: string;
  /** 下一步該做什麼；沒有可做的事時沒有 */
  action?: string;
}

export function diagnoseRosterList(c: RosterListCounts): RosterListDiagnosis {
  const summary =
    `可存取的試算表 ${c.accessible} 份：帶標記 ${c.tagged}、選過 ${c.picked}、`
    + `未被認出 ${c.unrecognised}；列出 ${c.listed} 份名冊。`;

  if (c.listed > 0) {
    if (c.unrecognised > 0) {
      return {
        level: 'info',
        summary,
        cause: `另外有 ${c.unrecognised} 份試算表本程式讀得到，但沒被認出是名冊。`,
        action: '如果其中有你要用的名冊，按「名冊沒出現？」指認它。',
      };
    }
    return { level: 'info', summary };
  }

  // 讀得到檔案卻一份名冊都認不出來 —— 標記掉了，檔案本身多半是完整的
  if (c.unrecognised > 0) {
    return {
      level: 'warning',
      summary,
      cause:
        `本程式讀得到 ${c.unrecognised} 份試算表，但沒有一份被認出是名冊。`
        + '最常見的原因是建立名冊時最後一步「設定名冊標記」沒有成功'
        + '（網路中斷，或分頁在建立途中被關掉）—— 檔案本身通常是完整的。',
      action:
        '按「名冊沒出現？」展開清單，在裡面指認哪一份是你的名冊。'
        + '指認後會把標記補上去，之後就會固定出現在下拉選單裡。',
    };
  }

  // 走到這裡代表 accessible 也是 0：Drive 什麼都沒回傳
  return {
    level: 'warning',
    summary,
    cause:
      'Drive 沒有回傳任何本程式可存取的試算表。授權範圍是 drive.file，'
      + '程式只讀得到「自己建立的」與「你親自選過的」檔案 —— '
      + '在雲端硬碟看得見，不代表程式讀得到。',
    action:
      '如果你從來沒有建立過名冊，這是正常的，按「＋ 建立名冊」開始。'
      + '如果你確定雲端硬碟裡有名冊，那是授權層斷了：可能移除過本程式的存取權、'
      + '換過 Google 帳號，或系統設定裡的 OAuth 用戶端 ID 改過。'
      + '請先登出再重新登入；仍然是 0 就用「開啟分享給我的名冊」把檔案選一次。',
  };
}
