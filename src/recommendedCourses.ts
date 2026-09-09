/**
 * 推薦課程彙總（純邏輯）
 * ---------------------------------------------------------------------------
 * 把「每個人各自被推薦哪些課」翻成「每一門課有哪些人要上」。機構實際要做的事
 * 是開班或報名，那是以課程為單位，不是以人為單位。
 *
 * 這段原本只存在於 App.tsx 的下載函式裡，所以雲端試算表沒有這張表。
 * 抽成純函式是為了讓**下載的 Excel 與寫進試算表的內容出自同一份程式** ——
 * 各寫一份的話兩邊的分組規則、積分標籤、去重方式都會慢慢分岔，
 * 而症狀是「同一次分析，下載的檔案和雲端的表不一樣」，沒有人會知道哪個對。
 */

import type { Course } from './calculator';

/**
 * 推薦課程彙總分頁的欄位順序。下載的 Excel 與試算表共用。
 *
 * 第一欄原本叫「日期」，但它的內容是 Course.date —— 課程認可字號的審核期間，
 * 一段區間而不是某一天。叫「日期」會讓人拿它當開課日排課。
 */
export const RECOMMENDED_COLUMNS = [
  '字號審核期間', '課程名稱', '課程積分數', '上課名單', '總點數', '人數', '課程連結',
] as const;

export interface RecommendedCourseGroup {
  url: string;
  date: string;
  name: string;
  /** 例：「專業品質(感染管制)2點」。組法見 courseCreditLabel */
  creditsLabel: string;
  /** 被推薦這門課的人，依第一次出現的順序 */
  students: string[];
  /** 單堂積分 × 人數。機構用它估整體效益 */
  totalPoints: number;
}

/** 主要屬性標籤：決定這門課算哪一類積分 */
const PRIMARY_TAGS = ['專業品質', '專業倫理', '專業法規', '專業課程'];

/** 次要標籤：四大核心與文化類，括號附註用 */
const SECONDARY_TAGS = [
  '消防安全', '緊急應變', '感染管制', '感染管控', '性別敏感度', '原住民族', '多元族群',
];

/**
 * 課程積分的顯示標籤。
 *
 * 為什麼要把次要標籤放進括號：一門課可能同時是「專業品質」與「感染管制」，
 * 只印前者的話，正在補四大核心的人看不出這門課能不能抵。
 */
export function courseCreditLabel(course: Course): string {
  const tags = course.tags ?? [];
  const primary = tags.find((t) => PRIMARY_TAGS.some((p) => t.includes(p)));
  const secondary = tags.find((t) => SECONDARY_TAGS.some((sec) => t.includes(sec)));

  let label = primary || tags[0] || '專業課程';
  // 只有在括號內容與主標籤不同時才附註。沒有這一層，一門只掛「原住民族」的課
  // 會變成「原住民族(原住民族)」—— 那是搬過來之前就有的缺陷，測試抓到的
  if (secondary && !label.includes(secondary)) label += `(${secondary})`;
  return `${label}${course.points}點`;
}

/**
 * 依課程分組。
 *
 * 以 url 當鍵而不是課程名稱：同名不同期的課是兩門課（日期與連結都不同），
 * 用名稱當鍵會把它們併成一列，上課名單就變成一群其實要上不同期的人。
 */
export function groupRecommendedCourses(
  people: { name: string; courses: Course[] }[],
): RecommendedCourseGroup[] {
  const byUrl = new Map<string, RecommendedCourseGroup>();
  const pointsByUrl = new Map<string, number>();

  for (const person of people) {
    for (const course of person.courses ?? []) {
      if (!course?.url) continue;

      let group = byUrl.get(course.url);
      if (!group) {
        group = {
          url: course.url,
          date: course.date || '',
          name: course.name,
          creditsLabel: courseCreditLabel(course),
          students: [],
          totalPoints: 0,
        };
        byUrl.set(course.url, group);
        pointsByUrl.set(course.url, course.points);
      }

      // 同一個人被推薦同一門課兩次（不同缺口都指向它）只算一次 ——
      // 不去重的話人數會虛高，而機構是照人數開班的
      if (!person.name || group.students.includes(person.name)) continue;
      group.students.push(person.name);
    }
  }

  const groups = [...byUrl.values()];
  for (const group of groups) {
    const unit = pointsByUrl.get(group.url) ?? 0;
    // 先乘再修到小數 2 位：單堂 0.33 分乘 3 人先四捨五入會湊不回 1
    group.totalPoints = Number((unit * group.students.length).toFixed(2));
  }

  // 人數多的排前面：那是最值得先開的班
  return groups.sort((a, b) => b.students.length - a.students.length
    || a.name.localeCompare(b.name, 'zh-Hant'));
}

/**
 * 組出整張推薦課程彙總（標題列 + 每門課一列）。
 *
 * 上課名單用換行分隔，與下載的 Excel 一致 —— 試算表上把該欄設成自動換行
 * 就看得完整，用逗號的話長名單會被截在欄寬外。
 */
export function buildRecommendedValues(
  groups: RecommendedCourseGroup[],
): (string | number)[][] {
  return [
    [...RECOMMENDED_COLUMNS],
    ...groups.map((g) => [
      g.date,
      g.name,
      g.creditsLabel,
      g.students.join('\n'),
      g.totalPoints,
      g.students.length,
      g.url,
    ]),
  ];
}
