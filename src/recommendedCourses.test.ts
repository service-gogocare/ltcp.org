import { describe, it, expect } from 'vitest';
import {
  groupRecommendedCourses,
  buildRecommendedValues,
  courseCreditLabel,
  RECOMMENDED_COLUMNS,
} from './recommendedCourses';
import type { Course } from './calculator';

const course = (o: Partial<Course> = {}): Course => ({
  url: 'https://example.com/a',
  name: 'A 課',
  type: '實體',
  points: 2,
  tags: ['專業課程'],
  ...o,
});

describe('courseCreditLabel', () => {
  it('主要屬性加點數', () => {
    expect(courseCreditLabel(course({ tags: ['專業品質'], points: 3 }))).toBe('專業品質3點');
  });

  it('次要標籤放進括號', () => {
    // 一門課可能同時算專業品質與感染管制。只印前者的話，
    // 正在補四大核心的人看不出這門課能不能抵
    expect(courseCreditLabel(course({ tags: ['專業品質', '感染管制'], points: 2 })))
      .toBe('專業品質(感染管制)2點');
  });

  it('沒有主要屬性時退回第一個標籤', () => {
    expect(courseCreditLabel(course({ tags: ['原住民族'], points: 1 }))).toBe('原住民族1點');
  });

  it('完全沒有標籤時給預設值，不留空白', () => {
    expect(courseCreditLabel(course({ tags: [], points: 1 }))).toBe('專業課程1點');
  });
});

describe('groupRecommendedCourses', () => {
  it('把「每人推薦哪些課」翻成「每門課有誰要上」', () => {
    const groups = groupRecommendedCourses([
      { name: '王小明', courses: [course()] },
      { name: '李小龍', courses: [course()] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].students).toEqual(['王小明', '李小龍']);
    expect(groups[0].totalPoints).toBe(4);
  });

  it('同一個人被推薦同一門課兩次只算一次', () => {
    // 不同缺口都指向同一門課時會重複出現。不去重人數會虛高，
    // 而機構是照人數開班的
    const groups = groupRecommendedCourses([
      { name: '王小明', courses: [course(), course()] },
    ]);
    expect(groups[0].students).toEqual(['王小明']);
    expect(groups[0].totalPoints).toBe(2);
  });

  it('同名不同期的課不合併', () => {
    // 以 url 當鍵而不是名稱：日期與連結都不同的是兩門課，
    // 併成一列的話上課名單會混到其實要上不同期的人
    const groups = groupRecommendedCourses([
      { name: '甲', courses: [course({ url: 'u1', date: '115/01/05' })] },
      { name: '乙', courses: [course({ url: 'u2', date: '115/03/05' })] },
    ]);
    expect(groups).toHaveLength(2);
  });

  it('人數多的排前面', () => {
    const groups = groupRecommendedCourses([
      { name: '甲', courses: [course({ url: 'few', name: '少人' })] },
      { name: '乙', courses: [course({ url: 'many', name: '多人' })] },
      { name: '丙', courses: [course({ url: 'many', name: '多人' })] },
    ]);
    expect(groups[0].name).toBe('多人');
  });

  it('總點數先乘再修小數，不會湊不回來', () => {
    const groups = groupRecommendedCourses([
      { name: '甲', courses: [course({ points: 0.33 })] },
      { name: '乙', courses: [course({ points: 0.33 })] },
      { name: '丙', courses: [course({ points: 0.33 })] },
    ]);
    expect(groups[0].totalPoints).toBe(0.99);
  });

  it('沒有連結或沒有姓名的資料不會產生殘缺的列', () => {
    const groups = groupRecommendedCourses([
      { name: '甲', courses: [course({ url: '' })] },
      { name: '', courses: [course({ url: 'u1' })] },
    ]);
    // 沒 url 的整筆略過；沒姓名的仍建立課程列但名單是空的
    expect(groups.map(g => g.url)).toEqual(['u1']);
    expect(groups[0].students).toEqual([]);
  });

  it('沒有任何推薦時回傳空陣列', () => {
    expect(groupRecommendedCourses([{ name: '甲', courses: [] }])).toEqual([]);
  });
});

describe('buildRecommendedValues', () => {
  it('第一列是標題列，欄數固定', () => {
    const values = buildRecommendedValues(groupRecommendedCourses([
      { name: '王小明', courses: [course({ date: '115/01/05' })] },
    ]));
    expect(values[0]).toEqual([...RECOMMENDED_COLUMNS]);
    expect(values[1]).toHaveLength(RECOMMENDED_COLUMNS.length);
  });

  it('總點數與人數是數字，讓試算表上 SUM 得起來', () => {
    const values = buildRecommendedValues(groupRecommendedCourses([
      { name: '甲', courses: [course()] },
      { name: '乙', courses: [course()] },
    ]));
    expect(typeof values[1][4]).toBe('number');
    expect(typeof values[1][5]).toBe('number');
    expect(values[1][5]).toBe(2);
  });

  it('上課名單用換行分隔', () => {
    const values = buildRecommendedValues(groupRecommendedCourses([
      { name: '甲', courses: [course()] },
      { name: '乙', courses: [course()] },
    ]));
    expect(values[1][3]).toBe('甲\n乙');
  });

  it('沒有推薦課程時只有標題列，不寫出空白資料列', () => {
    expect(buildRecommendedValues([])).toEqual([[...RECOMMENDED_COLUMNS]]);
  });
});
