import { rocStrToDate } from './calculator';
import {
  ROLE_OPTIONS,
  NATIONALITY_OPTIONS,
  type EditableField,
  type StudentRow,
} from './studentFields';

interface BatchEditBarProps {
  selectedCount: number;
  totalCount: number;
  onToggleAll: (checked: boolean) => void;
  onBatchDelete: () => void;
}

/**
 * 選取列：全選、顯示已選數量、批次刪除。
 *
 * 原本這裡還有四組「套用職業類別／國籍／生效日／到期日」的下拉與按鈕，
 * 但每一列的欄位本來就能直接編輯，那四組只是把同一件事做兩次，
 * 還把左欄撐寬到擠壞右欄的版面，因此移除。
 */
export function BatchEditBar({
  selectedCount, totalCount, onToggleAll, onBatchDelete,
}: BatchEditBarProps) {
  const none = selectedCount === 0;
  const btn: React.CSSProperties = { padding: '4px 10px', fontSize: '12.5px', minHeight: '34px' };

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center',
        padding: '10px 12px', marginBottom: '12px', borderRadius: '8px',
        background: 'rgba(8, 145, 178, 0.05)', border: '1px solid var(--panel-border)',
      }}
    >
      <button className="btn btn-secondary" style={btn} onClick={() => onToggleAll(true)}>全選</button>
      <button className="btn btn-secondary" style={btn} onClick={() => onToggleAll(false)}>取消全選</button>
      <span style={{ fontSize: '13px', fontWeight: 600, color: none ? 'var(--text-muted)' : 'var(--primary)' }}>
        已選 {selectedCount} / {totalCount} 筆
      </span>

      <button
        className="btn"
        style={{ ...btn, marginLeft: 'auto', color: 'var(--destructive)', borderColor: 'var(--destructive)' }}
        disabled={none}
        onClick={onBatchDelete}
      >
        🗑 批次刪除已選 {selectedCount} 筆
      </button>
    </div>
  );
}

interface StudentTableProps {
  students: StudentRow[];
  /** 稽查員唯讀：所有輸入停用、不顯示操作欄 */
  readOnly: boolean;
  /** 未勾選的列要不要淡化（主畫面用勾選決定要分析誰，淡化有意義；管理面板不需要） */
  dimUnselected?: boolean;
  onToggleRow: (id: string, checked: boolean) => void;
  onFieldChange: (id: string, field: EditableField, value: string) => void;
  onDateChange: (id: string, field: 'effectiveDate' | 'expiryDate', value: string) => void;
  onDeleteRow: (id: string, name: string) => void;
}

export function StudentTable({
  students, readOnly, dimUnselected = false, onToggleRow, onFieldChange, onDateChange, onDeleteRow,
}: StudentTableProps) {
  return (
    <div className="table-container">
      <table className="custom-table">
        <thead>
          <tr>
            <th style={{ width: '40px', textAlign: 'center' }}>選取</th>
            <th>姓名</th>
            <th style={{ width: '84px' }}>國籍</th>
            <th>身分證號</th>
            {/* 不設固定寬度，讓「居家服務督導員」這種較長的職類能完整顯示 */}
            <th>職業類別</th>
            <th style={{ textAlign: 'center' }}>生效日期</th>
            <th style={{ textAlign: 'center' }}>小卡到期日</th>
            {!readOnly && <th style={{ textAlign: 'center' }}>操作</th>}
          </tr>
        </thead>
        <tbody>
          {students.map((student) => {
            // 空白＝待補，不是錯誤。衛福部積分名冊沒有小卡起訖日，
            // 剛匯入的新人員本來就是空的，用紅框「錯誤」表示會讓人以為系統壞了。
            const effBlank = !student.effectiveDate.trim();
            const expBlank = !student.expiryDate.trim();
            const isEffValid = effBlank || rocStrToDate(student.effectiveDate) !== null;
            const isExpValid = expBlank || rocStrToDate(student.expiryDate) !== null;
            const isPending = effBlank && expBlank;
            return (
              <tr
                key={student.id}
                style={dimUnselected && !student.selected ? { opacity: 0.45 } : undefined}
              >
                <td style={{ textAlign: 'center' }}>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={student.selected}
                      onChange={e => onToggleRow(student.id, e.target.checked)}
                    />
                    <span className="checkmark"></span>
                  </label>
                </td>
                <td>
                  <input
                    type="text"
                    className="table-input"
                    style={{ fontWeight: 600, textAlign: 'left' }}
                    value={student.name}
                    disabled={readOnly}
                    onChange={e => onFieldChange(student.id, 'name', e.target.value)}
                  />
                </td>
                <td>
                  <select
                    className="table-input"
                    value={NATIONALITY_OPTIONS.includes(student.nationality) ? student.nationality : '臺灣'}
                    disabled={readOnly}
                    onChange={e => onFieldChange(student.id, 'nationality', e.target.value)}
                  >
                    {NATIONALITY_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                {/* 身分證號是小卡文件 ID 的一部分，改了就是另一個人；要換請刪除後重新新增 */}
                <td style={{ fontFamily: 'var(--mono)', fontSize: '13px' }} title="身分證號為識別鍵，不可修改">
                  {student.studentId}
                </td>
                <td>
                  <select
                    className="table-input"
                    value={ROLE_OPTIONS.includes(student.role) ? student.role : ROLE_OPTIONS[0]}
                    disabled={readOnly}
                    onChange={e => onFieldChange(student.id, 'role', e.target.value)}
                  >
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    {/* 舊資料可能存了不在選項內的字串，先原樣列出避免被靜默改掉 */}
                    {!ROLE_OPTIONS.includes(student.role) && (
                      <option value={student.role}>{student.role}（舊資料）</option>
                    )}
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="text"
                    className={`table-input ${!isEffValid ? 'invalid' : ''} ${isPending ? 'pending' : ''}`}
                    value={student.effectiveDate}
                    disabled={readOnly}
                    onChange={e => onDateChange(student.id, 'effectiveDate', e.target.value)}
                    placeholder={isPending ? '待補' : '112/09/01'}
                    title={isPending ? '衛福部積分名冊不含小卡起訖日，請手動填入。填生效日會自動算出到期日。' : undefined}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="text"
                    className={`table-input ${!isExpValid ? 'invalid' : ''} ${isPending ? 'pending' : ''}`}
                    value={student.expiryDate}
                    disabled={readOnly}
                    onChange={e => onDateChange(student.id, 'expiryDate', e.target.value)}
                    placeholder={isPending ? '待補' : '118/08/31'}
                    title={isPending ? '填入生效日後會自動計算，也可以直接填到期日反推生效日。' : undefined}
                  />
                </td>
                {!readOnly && (
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn"
                      style={{ color: 'var(--destructive)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
                      onClick={() => onDeleteRow(student.id, student.name)}
                    >
                      刪除
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
