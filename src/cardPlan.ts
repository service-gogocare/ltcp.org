/**
 * 小卡編輯的純邏輯
 * ---------------------------------------------------------------------------
 * 表格上的一列對應雲端一份文件，文件 ID 是「身分證號_職業類別」。
 * 因此改職業類別 ≠ 改一個欄位，而是換掉文件 ID：必須寫入新 ID 並刪掉舊 ID，
 * 否則同一個人會留下兩份文件（commit 3e2c752 換 key 時就是這樣讓童庭多出 41 筆）。
 *
 * 這些判斷全部集中在這裡而不寫在 React handler 裡，才有辦法用單元測試蓋住。
 */

import { rocStrToDate, calculateExpiryDate, calculateEffectiveDate } from './calculator';
import type { StudentRow, EditableField } from './studentFields';

/** 一份要寫進雲端的小卡內容（欄位與 dbService 的 CardRecord 對齊） */
export interface CardRecord {
  name: string;
  role: string;
  nationality: string;
  effectiveDate: string;
  expiryDate: string;
}

export interface CardWrite {
  docId: string;
  record: CardRecord;
}

export interface Rekey {
  name: string;
  from: string;
  to: string;
}

export interface SavePlan {
  writes: CardWrite[];
  /** 職業類別改過而必須刪掉的舊文件 ID（順序與 writes 對應的那筆一致） */
  deletes: string[];
  rekeys: Rekey[];
  /**
   * 小卡起訖日還沒填的人員。
   *
   * 這些列**允許儲存**（日期欄位寫入空字串），因為衛福部的積分名冊 Excel
   * 不含長照小卡起訖日，剛匯入的新人員本來就是這個狀態。
   * 舊版把「空白」和「格式錯誤」一視同仁，導致只要有一位待補人員，
   * 整批儲存就被取消 —— 連其他四十位正常人員也存不進去。
   */
  pendingDates: { docId: string; name: string; studentId: string }[];
}

export type SavePlanResult =
  | { ok: true; plan: SavePlan }
  | { ok: false; code: 'empty' | 'duplicateId' | 'invalidDate' | 'emptyName'; message: string };

export const composeCardId = (studentId: string, role: string): string => `${studentId}_${role}`;

/**
 * composeCardId 的反函式。
 *
 * 放在正函式旁邊是刻意的：這個拆解原本散在三個地方各自手寫
 * （sheetSchema.cardToRow、cardPlan.describeDeletePlan、以及畫面上的顯示），
 * 其中有一處還把整個 cardId 當成身分證號顯示出來，畫面上會出現
 * 「A123456789_照顧服務人員」這種字串。
 *
 * 舊制資料的 ID 只有身分證號、沒有 `_職類` 後綴，此時 role 為空字串。
 */
export function splitCardId(cardId: string): { studentId: string; role: string } {
  const sep = cardId.indexOf('_');
  return sep === -1
    ? { studentId: cardId, role: '' }
    : { studentId: cardId.slice(0, sep), role: cardId.slice(sep + 1) };
}

/**
 * 編輯姓名／國籍／職業類別。改職業類別時要同步更新 id（複合鍵的一部分），
 * 但 originalId 保持不動 —— 儲存時才靠「id ≠ originalId」判斷要不要刪舊文件。
 */
export function applyFieldChange(row: StudentRow, field: EditableField, value: string): StudentRow {
  const next: StudentRow = { ...row, [field]: value };
  if (field === 'role') next.id = composeCardId(row.studentId, value);
  return next;
}

/**
 * 編輯生效日或到期日，另一個日期依「6 年減 1 天」規則自動換算。
 * 只有在輸入已經是合法民國日期時才換算，否則使用者打字打到一半就會被改掉。
 */
export function applyDateChange(
  row: StudentRow,
  field: 'effectiveDate' | 'expiryDate',
  value: string,
): StudentRow {
  const next: StudentRow = { ...row, [field]: value };
  if (rocStrToDate(value) === null) return next;
  if (field === 'effectiveDate') next.expiryDate = calculateExpiryDate(value);
  else next.effectiveDate = calculateEffectiveDate(value);
  return next;
}

/**
 * 組出「儲存至雲端」要做的寫入與刪除。
 * 會先擋掉三種會造成資料遺失或覆蓋的狀況，回傳 ok: false 讓呼叫端顯示訊息。
 */
export function buildSavePlan(students: StudentRow[]): SavePlanResult {
  if (students.length === 0) {
    return { ok: false, code: 'empty', message: '沒有可保存的資料！' };
  }

  // 同一個「身分證號_職業類別」只能有一份文件。批次改職類很容易讓兩列撞到同一個
  // key，先擋下來，否則後寫入的那筆會把前一筆整個蓋掉。
  const seen = new Map<string, StudentRow>();
  for (const s of students) {
    const dup = seen.get(s.id);
    if (dup) {
      return {
        ok: false,
        code: 'duplicateId',
        message:
          `無法儲存：「${dup.name}」與「${s.name}」的身分證號與職業類別完全相同（${s.id}），`
          + `會互相覆蓋。\n請先修正其中一筆的職業類別，或刪除重複的那列。`,
      };
    }
    seen.set(s.id, s);
  }

  const writes: CardWrite[] = [];
  const deletes: string[] = [];
  const rekeys: Rekey[] = [];
  const pendingDates: SavePlan['pendingDates'] = [];

  for (const s of students) {
    const effRaw = s.effectiveDate.trim();
    const expRaw = s.expiryDate.trim();
    const bothBlank = !effRaw && !expRaw;

    // 兩個日期都空白＝待補（衛福部積分名冊沒有小卡起訖日，剛匯入的新人員就是這樣），
    // 允許儲存。非空但無法解析、或只填一個，都是誤輸入，仍然硬擋。
    if (bothBlank) {
      pendingDates.push({ docId: s.id, name: s.name, studentId: s.studentId });
    } else if (!rocStrToDate(effRaw) || !rocStrToDate(expRaw)) {
      return {
        ok: false,
        code: 'invalidDate',
        message: !effRaw || !expRaw
          ? `學員 ${s.name} (${s.studentId}) 只填了生效日或到期日其中一個。`
            + `\n請兩個都填（填一個會自動算出另一個），或兩個都清空留待之後補。`
          : `學員 ${s.name} (${s.studentId}) 的日期格式有誤，無法保存！`,
      };
    }
    if (!s.name.trim()) {
      return {
        ok: false,
        code: 'emptyName',
        message: `身分證號 ${s.studentId} 的姓名是空的，無法保存！`,
      };
    }

    writes.push({
      docId: s.id,
      record: {
        name: s.name,
        role: s.role,
        nationality: s.nationality,
        // 待補者寫入空字串而不是原始輸入，試算表上就是一格乾淨的空白
        effectiveDate: effRaw,
        expiryDate: expRaw,
      },
    });

    if (s.originalId && s.originalId !== s.id) {
      deletes.push(s.originalId);
      rekeys.push({ name: s.name, from: s.originalId, to: s.id });
    }
  }

  return { ok: true, plan: { writes, deletes, rekeys, pendingDates } };
}

export interface DeletePlan {
  /** 要從雲端刪除的列（已經寫進雲端過） */
  inCloud: { rowId: string; docId: string; name: string; studentId: string; role: string }[];
  /** 只存在表格上、直接移除即可的列 ID */
  localOnlyRowIds: string[];
}

/**
 * 組出「批次刪除」要做的事。
 * 刪的是 originalId（雲端那份），不是表格上可能已被改過職類的 id。
 */
export function buildDeletePlan(students: StudentRow[]): DeletePlan {
  const inCloud: DeletePlan['inCloud'] = [];
  const localOnlyRowIds: string[] = [];
  for (const s of students) {
    if (!s.selected) continue;
    if (s.originalId) {
      inCloud.push({
        rowId: s.id,
        docId: s.originalId,
        name: s.name,
        studentId: s.studentId,
        role: s.role,
      });
    } else {
      localOnlyRowIds.push(s.id);
    }
  }
  return { inCloud, localOnlyRowIds };
}

/** 批次刪除的確認訊息（超過 maxList 筆就只列前幾筆） */
/**
 * 批次刪除要求手動輸入確認的門檻筆數。
 *
 * 為什麼不是「一律要求」：刪掉一兩個離職人員是每個月都會做的事，
 * 每次都逼人打字只會訓練出機械式照抄，等到真正該停下來的那一次也照抄過去 ——
 * 那就等於沒有這道關卡。
 */
export const TYPED_CONFIRM_MIN_COUNT = 5;

/**
 * 這次刪除要不要求手動輸入筆數？
 *
 * 兩個條件任一成立即可：
 *   - 筆數達到門檻
 *   - 把整份名冊清空（就算只有兩個人，清成 0 也是另一種等級的事）
 *
 * 背景：名冊載入時每一列預設都是勾選狀態（那個勾選欄同時被「要分析誰」共用），
 * 所以「確認視窗按一下確定」與「清掉整份名冊」之間只隔著一次誤點。
 */
export function needsTypedConfirm(selectedCount: number, totalCount: number): boolean {
  if (selectedCount <= 0) return false;
  return selectedCount >= TYPED_CONFIRM_MIN_COUNT
    || (totalCount > 1 && selectedCount === totalCount);
}

/**
 * 手動輸入確認的提示文字。
 * 要打的是**筆數**而不是固定的字串：固定字串可以不看內容照打，
 * 筆數逼使用者去讀「到底要刪幾筆」，而那正是誤刪時看漏的那個數字。
 */
export function describeTypedConfirm(selectedCount: number, totalCount: number): string {
  return (
    `這次會刪除 ${selectedCount} 筆人員資料`
    + (selectedCount === totalCount ? `，也就是整份名冊（共 ${totalCount} 筆）` : '')
    + `，且無法復原。\n\n確認請輸入筆數：${selectedCount}`
  );
}

/**
 * 使用者輸入的是不是正確的筆數。
 * 容忍前後空白與全形數字 —— 中文輸入法很容易打出「５」，
 * 因為這種事擋下一次正當的刪除，只會讓人下次更想繞過整道關卡。
 */
export function isTypedConfirmValid(input: string | null, selectedCount: number): boolean {
  if (input === null) return false;
  const half = input.trim().replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  // 只收純數字。單靠 Number() 比較會讓 '0x8'、'8.0'、'+8'、'8e0' 全部等於 8 ——
  // 那不是「把筆數打一次」，這道關卡的重點正是逼人去讀那個數字
  const isDigits = half.length > 0 && [...half].every((c) => c >= '0' && c <= '9');
  return isDigits && Number(half) === selectedCount;
}

export function describeDeletePlan(plan: DeletePlan, maxList = 10): string {
  const all = [
    ...plan.inCloud.map((c) => ({ name: c.name, studentId: c.studentId, role: c.role })),
    ...plan.localOnlyRowIds.map((id) => ({
      name: '(未儲存的新列)',
      ...splitCardId(id),
    })),
  ];
  const total = all.length;
  const head = all.slice(0, maxList).map((x) => `・${x.name}（${x.studentId}／${x.role}）`).join('\n');
  return (
    `確定要刪除已勾選的 ${total} 筆人員資料嗎？\n`
    + `其中 ${plan.inCloud.length} 筆已存在雲端，會直接從資料庫移除且無法復原。\n\n`
    + head
    + (total > maxList ? `\n…等共 ${total} 筆` : '')
  );
}
