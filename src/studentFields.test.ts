import { describe, it, expect } from 'vitest';
import { maskStudentId } from './studentFields';

describe('maskStudentId', () => {
  it('遮掉中間 3 碼，保留前 4 碼與後 3 碼', () => {
    expect(maskStudentId('B122456111')).toBe('B122***111');
    expect(maskStudentId('X220145029')).toBe('X220***029');
  });

  it('顯示長度與原號碼一致', () => {
    // 固定三顆星會讓 11 碼的號碼看起來像 10 碼，那是另一種誤導
    const id = 'AB123456789';
    expect(maskStudentId(id)).toHaveLength(id.length);
    expect(maskStudentId(id)).toBe('AB12****789');
  });

  it('外籍人士的 2 碼英文統一證號同樣遮中間', () => {
    expect(maskStudentId('AB12345678')).toBe('AB12***678');
  });

  it('去除前後空白再遮', () => {
    expect(maskStudentId('  B122456111 ')).toBe('B122***111');
  });

  it('短於 8 碼時只留第一碼 —— 格式不明，保守處理', () => {
    // 照「前 4 後 3」硬套的話 7 碼會一個字都遮不到
    expect(maskStudentId('A123456')).toBe('A******');
    expect(maskStudentId('A12')).toBe('A**');
  });

  it('空字串與單一字元不會擲錯', () => {
    expect(maskStudentId('')).toBe('');
    expect(maskStudentId('A')).toBe('A');
  });

  it('恰好 8 碼時仍遮得到中間 1 碼', () => {
    expect(maskStudentId('A1234567')).toBe('A123*567');
  });

  it('不改動原字串，也不回傳可以拼回原號碼的東西', () => {
    const masked = maskStudentId('B122456111');
    expect(masked).not.toContain('456');
    expect(masked.replace(/\*/g, '')).toBe('B122111');
  });
});
