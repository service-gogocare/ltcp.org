/**
 * 月份積分歸屬引擎（純函式，不碰網路、不碰時間）
 *
 * 分析的當下課程明細還在記憶體裡，把每一門課的積分歸屬到「曆月 + 所屬證書年度」，
 * 歸屬完就丟掉明細、只存大項目積分。這樣：
 *
 *   - 比存課程明細省：41 人 × 數十門課 ≈ 上千列，換成月份彙總是幾十列
 *   - 比快照相減準：月份來自真實課程日期，補課記到正確的月、漏跑一個月不會出現空格、
 *     衛福部匯出範圍變動也不會算出負數
 *
 * ## 兩個必須守住的性質
 *
 * 1. **所有列的加總，必須逐欄等於 parseExcelToPointsData 的結果。**
 *    這是最重要的不變式，也是 monthlyPoints.test.ts 的第一個測試。
 *    做不到的症狀是「總分 128、月份合計 121」，而且沒有任何錯誤訊息可查。
 *    為此，日期無法解析與日期在效期外的積分**不會被丟掉**，
 *    而是分別落在 month 為空、cardYearIndex 為 0 的列上（見下方兩個常數）。
 *
 * 2. **這裡不做任何分類判定。** 實施方式、課程屬性、課程類別、欄位標題比對
 *    全部呼叫 calculator.ts 的分類器。複製第二份就是上面那個症狀的來源。
 *
 * ## 採計上限一律不在這裡套用
 *
 * QER 36、線上 60/40/80、舊制文化 2 分，三者都是「整個 6 年週期累計」的判定。
 * 逐月套用會把每個月當成獨立週期，結果嚴重偏低。月份存的一律是原始值，
 * 上限在報表時對累計值套用。
 *
 * ## 為什麼沒有 asOf 參數
 *
 * 歸屬只用得到證書年度的起訖日，而那完全由生效日與到期日決定。
 * buildCardYears 的 status 欄（past/current/future）在這裡用不到，
 * 所以這個函式沒有任何時間相依，結果不會隨執行日期漂移。
 */
import type {
  AttributeBucket,
  CoreCategory,
  CulturalCategory,
  CulturalNewByYear,
  CulturalOldRecord,
  PointsData,
} from './calculator';
import {
  attributeBucketOf,
  buildCardYears,
  courseRowSkipReason,
  extractCourseDate,
  resolveCoreCategory,
  resolveCourseAttribute,
  resolveCourseColumns,
  resolveCourseIsPhysical,
  resolveCulturalCategory,
  rocStrToDate,
  round2,
  splitAttributeBucket,
  ATTRIBUTE_BUCKETS,
} from './calculator';
import { splitCardId } from './cardPlan';

/** 依「課程類別」分出的桶。與屬性桶是同一批積分的另一種切法，不另計分 */
export type CategoryBucket = CoreCategory | CulturalCategory;

/**
 * 八個屬性桶。**只有這八個相加才是計入 120 分總分的積分**。
 *
 * 定義在 calculator.ts（applyCulturalOldCap 的扣除順序也用它），這裡只轉出去，
 * 讓消費端不必知道它住在哪個檔案。兩邊各寫一份順序就會漂移。
 */
export { ATTRIBUTE_BUCKETS } from './calculator';

/** 七個類別桶。四大核心與文化課程的檢核用，不計入總分 */
export const CATEGORY_BUCKETS: readonly CategoryBucket[] = [
  'fireSafety', 'emergencyResponse', 'infectionControl', 'genderSensitivity',
  'culturalOld', 'culturalNewIndigenous', 'culturalNewMulticultural',
] as const;

/**
 * 課程日期無法解析時放進 month 的值。
 *
 * 這種積分仍然要有一列，否則月份合計會比總分少而且看不出少在哪。
 * 它沒有日期，所以無法被「依課程日期範圍取代」的寫入邏輯比對到 ——
 * 寫入時必須額外處理：只要某人出現在這次上傳的檔案裡，就先刪掉他的這一列。
 */
export const MONTH_UNASSIGNED = '';

/** 課程日期不落在任何證書年度內時的 cardYearIndex。證書年度序號本身從 1 起算 */
export const CARD_YEAR_OUT_OF_RANGE = 0;

/**
 * 這次上傳要取代到哪個曆月（含）為止；判斷不出來時回傳空字串。
 *
 * **為什麼是「到某月為止」而不是「某個區間」**：衛福部每次匯出的都是該員的
 * 生平全紀錄（實測 41 人的檔案涵蓋 108/05 ~ 115/05 共 57 個月），所以這份檔案
 * 對「匯出日以前」的每一個月都是權威的。用區間的話，某個月的課全部被撤銷時
 * 那個月不會出現在課程日期裡，就落在區間外而永遠清不掉。
 *
 * 上界用**匯出日期**而不是最晚的課程日期，理由同上。匯出日期讀不到時才退回
 * 最晚的課程月 —— 那樣仍然會漏掉「最後一個月的課全被撤銷」的情況，
 * 但總比完全不敢清好。
 *
 * 保留上界（而不是「全部清光」）是為了另一件事：重傳一份**較舊**的匯出檔時，
 * 比它新的月份不該被抹掉。
 *
 * @param allRows 這次上傳檔案的所有課程列（全部人員，不是單一人員）
 * @param exportDate 檔案表頭的匯出日期（民國字串），取自 findExportDate
 */
export function uploadThroughMonth(
  allRows: Record<string, unknown>[],
  exportDate: string,
): string {
  const fromHeader = toRocMonth(exportDate);
  if (fromHeader && !isNaN(monthSortKey(fromHeader))) return fromHeader;

  if (allRows.length === 0) return '';
  const cols = resolveCourseColumns(allRows[0]);
  let latest = '';
  for (const row of allRows) {
    const dateStr = extractCourseDate(row[cols.courseDateCol]);
    if (!rocStrToDate(dateStr)) continue;
    const month = toRocMonth(dateStr);
    if (!month) continue;
    if (!latest || monthSortKey(month) > monthSortKey(latest)) latest = month;
  }
  return latest;
}

/** 一位人員的一列月報，就是寫進試算表的一列 */
export interface MonthlyPointRecord {
  /** 「身分證號_職業類別」。同一人可能同時具備兩種職業類別，各自一張小卡 */
  cardId: string;
  name: string;
  /**
   * 分析當下這位人員的小卡生效日（民國字串）。
   *
   * 存它是為了偵測生效日事後被改：曆月跨年度時怎麼拆兩列由課程日期決定，
   * 而課程明細存完就丟了。生效日一改，年度邊界跟著移動，已存的月份列
   * **無法重算**。載入時比對此值與名冊現值，不一致就要明講「需重新上傳 Excel」，
   * 不可以拿舊的切分安靜地算下去。
   */
  analyzedEffectiveDate: string;
  row: MonthlyPointRow;
}

/** 一個「曆月 × 證書年度」的積分彙總，就是寫進試算表的一列 */
export interface MonthlyPointRow {
  /** 曆月，民國格式如 `114/03`。`MONTH_UNASSIGNED` 代表課程日期無法解析 */
  month: string;
  /** 所屬證書年度序號，1 起算。`CARD_YEAR_OUT_OF_RANGE` 代表在效期外 */
  cardYearIndex: number;
  /** 八個屬性桶的原始積分（未套用任何採計上限） */
  buckets: Record<AttributeBucket, number>;
  /** 七個類別桶的原始積分。與 buckets 是同一批積分的另一種切法，不要相加 */
  categories: Record<CategoryBucket, number>;
  /**
   * 舊制文化課程分別落在哪些屬性桶。
   *
   * 舊制文化的 2 分上限，超額要從它原本落入的屬性桶扣除而不是從總分減
   * （否則會與 QER 36 上限重複扣除，也會讓 QER 24 下限失準）。
   * 存每桶加總就夠，不必逐筆課程：applyCulturalOldCap 只依實體/網路排序，
   * 同桶的紀錄彼此可互換，合併成一筆的結果與逐筆完全相同。
   */
  culturalOldByBucket: Record<AttributeBucket, number>;
}

/** 歸屬結果，含所有「沒有進到月份列」的積分去向 —— 靜默丟掉會讓合計莫名變少 */
export interface MonthlyAttribution {
  /** 依曆月、證書年度排序；無法歸月的列排在最後 */
  rows: MonthlyPointRow[];
  /** 認可狀態不是「符合」而未採計的列數 */
  skippedNotApproved: number;
  /** 積分欄非數字或不大於 0 的列，值是它在 personRows 中的索引 */
  invalidPointsRows: number[];
  /** 課程日期無法解析、只能落在 MONTH_UNASSIGNED 列的積分 */
  unassignedPoints: number;
  /** 課程日期在證書效期外的積分。很常見，不是錯誤 */
  outOfRangePoints: number;
  /** 有積分但課程屬性對不到四個桶，因此不計入 120 分總分的積分 */
  unattributedPoints: number;
  /**
   * 生效日與到期日是否解析得出證書年度。
   *
   * false 代表這是待補起訖日的人員 —— 那是階段 1 之後的正常狀態，不是錯誤。
   * 此時所有列的 cardYearIndex 都會是 CARD_YEAR_OUT_OF_RANGE，
   * 積分仍然完整保留，等起訖日補上後重新上傳即可歸位。
   */
  hasCardWindow: boolean;
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  keys.forEach((k) => { out[k] = 0; });
  return out;
}

/** `114/03/15` → `114/03`；不是三段式日期時回傳 MONTH_UNASSIGNED */
function toRocMonth(rocDateStr: string): string {
  const parts = rocDateStr.split('/');
  if (parts.length !== 3) return MONTH_UNASSIGNED;
  return `${parts[0]}/${parts[1]}`;
}

/**
 * 曆月的可比較數值鍵。`114/03` → 114 * 12 + 3。無法解析時回傳 NaN。
 *
 * 不能用字串比大小：民國 99 年是兩位數，字典序會排到 100 年之後。
 * 這在別處已經埋過一次雷（見 CardYear 的 startDate/endDate 註解）。
 * 試算表層判斷「這個月在不在取代範圍內」也用這個，兩邊不能各寫一套。
 */
export function monthSortKey(month: string): number {
  const [year, mon] = month.split('/');
  return Number(year) * 12 + Number(mon);
}

function emptyRow(month: string, cardYearIndex: number): MonthlyPointRow {
  return {
    month,
    cardYearIndex,
    buckets: zeroed(ATTRIBUTE_BUCKETS),
    categories: zeroed(CATEGORY_BUCKETS),
    culturalOldByBucket: zeroed(ATTRIBUTE_BUCKETS),
  };
}

function roundRow(row: MonthlyPointRow): MonthlyPointRow {
  ATTRIBUTE_BUCKETS.forEach((k) => {
    row.buckets[k] = round2(row.buckets[k]);
    row.culturalOldByBucket[k] = round2(row.culturalOldByBucket[k]);
  });
  CATEGORY_BUCKETS.forEach((k) => { row.categories[k] = round2(row.categories[k]); });
  return row;
}

/**
 * 把一位人員的課程明細歸屬到月份。
 *
 * @param personRows 這位人員在衛福部匯出 Excel 中的所有課程列（**不去重** ——
 *   Excel 是權威來源，去重會藏掉評鑑委員也看得到的重複登錄）。
 *   欄位名稱由 resolveCourseColumns 模糊比對，所以型別只能到「字串鍵、值不明」
 * @param effectiveDate 小卡生效日（民國字串）。空白或無法解析時 hasCardWindow 為 false
 * @param expiryDate 小卡到期日（民國字串）
 */
export function attributePointsToMonths(
  personRows: Record<string, unknown>[],
  effectiveDate: string,
  expiryDate: string,
): MonthlyAttribution {
  const result: MonthlyAttribution = {
    rows: [],
    skippedNotApproved: 0,
    invalidPointsRows: [],
    unassignedPoints: 0,
    outOfRangePoints: 0,
    unattributedPoints: 0,
    hasCardWindow: false,
  };

  // 先算年度再看有沒有明細：沒有課程的人，起訖日是否有效仍然是有意義的資訊
  // status 欄在這裡用不到，所以不必傳 asOf；年度區間本身與執行時間無關
  const years = buildCardYears(effectiveDate, expiryDate);
  result.hasCardWindow = years.length > 0;

  if (personRows.length === 0) return result;

  const cols = resolveCourseColumns(personRows[0]);

  const byKey = new Map<string, MonthlyPointRow>();

  personRows.forEach((row, index) => {
    const skip = courseRowSkipReason(row, cols);
    if (skip === 'notApproved') { result.skippedNotApproved++; return; }
    if (skip === 'invalidPoints') { result.invalidPointsRows.push(index); return; }

    // courseRowSkipReason 已確認是大於 0 的數字，這裡不必再檢查
    const pts = parseFloat(String(row[cols.pointsCol]));

    const dateStr = extractCourseDate(row[cols.courseDateCol]);
    const courseDt = rocStrToDate(dateStr);

    let month = MONTH_UNASSIGNED;
    let cardYearIndex = CARD_YEAR_OUT_OF_RANGE;
    if (!courseDt) {
      result.unassignedPoints = round2(result.unassignedPoints + pts);
    } else {
      month = toRocMonth(dateStr);
      // 邊界當天算在該年度內：年度 i 的區間是 [起日, 訖日] 閉區間
      const year = years.find((y) => courseDt >= y.startDate && courseDt <= y.endDate);
      if (year) {
        cardYearIndex = year.index;
      } else {
        result.outOfRangePoints = round2(result.outOfRangePoints + pts);
      }
    }

    const key = `${month}|${cardYearIndex}`;
    let target = byKey.get(key);
    if (!target) {
      target = emptyRow(month, cardYearIndex);
      byKey.set(key, target);
    }

    const isPhysical = resolveCourseIsPhysical(String(row[cols.methodCol] ?? '').trim());
    const attrKey = resolveCourseAttribute(String(row[cols.attrCol] ?? '').trim());
    const catStr = String(row[cols.catCol] ?? '').trim();

    if (attrKey) {
      target.buckets[attributeBucketOf(attrKey, isPhysical)] += pts;
    } else {
      // 屬性對不到桶的積分不進 120 分總分（parseExcelToPointsData 歷來如此）。
      // 評鑑委員從同一份 Excel 加總時不看課程屬性欄，所以這個差額要能講得出來。
      result.unattributedPoints = round2(result.unattributedPoints + pts);
    }

    const coreKey = resolveCoreCategory(catStr);
    if (coreKey) target.categories[coreKey] += pts;

    // 核心與文化是兩條獨立判定，命中核心不該阻斷文化的比對
    const culturalKey = resolveCulturalCategory(catStr);
    if (culturalKey) {
      target.categories[culturalKey] += pts;
      if (culturalKey === 'culturalOld' && attrKey) {
        target.culturalOldByBucket[attributeBucketOf(attrKey, isPhysical)] += pts;
      }
    }
  });

  result.rows = [...byKey.values()]
    .map(roundRow)
    .sort((a, b) => {
      // 無法歸月的列固定排最後，不要夾在月份中間
      if (a.month === MONTH_UNASSIGNED) return b.month === MONTH_UNASSIGNED ? 0 : 1;
      if (b.month === MONTH_UNASSIGNED) return -1;
      const diff = monthSortKey(a.month) - monthSortKey(b.month);
      return diff !== 0 ? diff : a.cardYearIndex - b.cardYearIndex;
    });

  return result;
}


// ── 從月份列反推回 PointsData ────────────────────────────────────

/** 反推時需要的人員身分與小卡起訖日，來自名冊而不是月報 */
export interface CardIdentity {
  cardId: string;
  name: string;
  effectiveDate: string;
  expiryDate: string;
}

export interface MonthlyPointsDataResult {
  pointsData: PointsData;
  /**
   * 名冊上的生效日與分析當下不一致。
   *
   * 曆月橫跨證書年度邊界時要拆成兩列，怎麼拆是由**課程日期**決定的，
   * 而課程明細歸屬完就丟掉了。生效日一改，年度邊界跟著移動，
   * 已存的月份列**無法重算** —— 逐年檢核的結果因此不可信。
   *
   * 為真時必須明講「需重新上傳 Excel」，不可以拿舊的切分安靜地算下去。
   */
  effectiveDateChanged: boolean;
  /** 分析當下用的生效日，讓訊息講得出差在哪 */
  analyzedEffectiveDate: string;
}

/**
 * 這一列會不會被這次上傳取代。
 *
 * 規則只有一份，試算表層（planMonthlyReplace）與畫面層（replaceMonthlyRecords）
 * 都呼叫這裡。兩邊各寫一份的話，畫面顯示的「儲存後會變成什麼」會跟實際寫進去的
 * 不一樣，而使用者要到下次重新載入才會發現。
 *
 * 呼叫端負責先判斷 cardId 有沒有出現在這次上傳裡。
 */
export function isReplacedByUpload(month: string, throughMonth: string): boolean {
  // 沒有日期的列永遠比不到任何月份，不特別清掉會每次上傳都多一份
  if (month === MONTH_UNASSIGNED) return true;
  if (!throughMonth) return false;
  const key = monthSortKey(month);
  // 看不懂的月份（使用者手改過）不動 —— 看不懂的東西不替使用者決定要不要毀掉
  if (isNaN(key)) return false;
  // 比匯出月更新的月份不動：重傳一份較舊的匯出檔時不該抹掉新資料
  return key <= monthSortKey(throughMonth);
}

/**
 * 把新的分析結果套進既有的月報紀錄上，得到「儲存之後會長什麼樣」。
 *
 * 與 planMonthlyReplace 是同一個規則的兩種表現形式：那個算試算表要刪哪幾列，
 * 這個算畫面上該顯示什麼。共用 isReplacedByUpload 才不會兩邊給出不同的畫面。
 *
 * `touchedCardIds` 是**這次上傳涵蓋的所有人員**，不是「產出了紀錄的人員」。
 * 兩者不同：某人這個月的課全部變成「不符合」時，他一列紀錄都不會產出，
 * 但他的舊資料仍然必須被清掉，否則畫面上會留著已經不成立的積分。
 */
export function replaceMonthlyRecords(
  existing: MonthlyPointRecord[],
  incoming: MonthlyPointRecord[],
  throughMonth: string,
  touchedCardIds: string[],
): MonthlyPointRecord[] {
  const touched = new Set(touchedCardIds);
  const kept = existing.filter((r) => !(
    touched.has(r.cardId) && isReplacedByUpload(r.row.month, throughMonth)
  ));
  return [...kept, ...incoming];
}

/** 依 cardId 把整張積分月報分給各人員 */
export function groupMonthlyRecordsByCard(
  records: MonthlyPointRecord[],
): Map<string, MonthlyPointRecord[]> {
  const byCard = new Map<string, MonthlyPointRecord[]>();
  for (const record of records) {
    const list = byCard.get(record.cardId);
    if (list) list.push(record);
    else byCard.set(record.cardId, [record]);
  }
  return byCard;
}

/**
 * 把一位人員的月份列加總回 PointsData，讓 calculatePoints 能吃「從雲端載入」的資料。
 *
 * 這是 attributePointsToMonths 的反函式，也是 README 記載的兩個缺陷消失的地方：
 *
 *   - **舊制文化 2 分上限無法扣除**：由 culturalOldByBucket 重建 culturalOldRecords。
 *     每桶一筆就夠 —— applyCulturalOldCap 只依實體/網路排序，同桶紀錄彼此可互換。
 *   - **新制文化無法逐年驗證**：由每列的「所屬證書年度」重建 culturalNewByYear。
 *
 * 採計上限（QER 36、線上 60/40/80、舊制文化 2 分）在這一層**還沒**套用 ——
 * 它們是整個 6 年週期的累計判定，一律由 calculatePoints 對累計值套用。
 *
 * @param records 這位人員在積分月報上的所有列
 * @param card 這位人員在**名冊**上的身分與起訖日（月報上的是分析當下的快照）
 */
export function buildPointsDataFromMonths(
  records: MonthlyPointRecord[],
  card: CardIdentity,
): MonthlyPointsDataResult {
  const pointsData: PointsData = {
    id: splitCardId(card.cardId).studentId,
    name: card.name,
    birthday: '',
    cardExpiryDate: card.expiryDate,
    effectiveDate: card.effectiveDate,
    // 月份列只有月、沒有日。補一個日出來就是憑空發明日期，
    // 童庭那 41 筆錯誤起訖日正是這樣來的。這個欄位目前也沒有任何消費端。
    earliestCourseDate: '',
    professionalPhysical: 0, professionalOnline: 0,
    qualityPhysical: 0, qualityOnline: 0,
    ethicsPhysical: 0, ethicsOnline: 0,
    regulationsPhysical: 0, regulationsOnline: 0,
    fireSafety: 0, emergencyResponse: 0, infectionControl: 0, genderSensitivity: 0,
    culturalOld: 0, culturalNewIndigenous: 0, culturalNewMulticultural: 0,
  };

  const analyzedEffectiveDate = records.find((r) => r.analyzedEffectiveDate)?.analyzedEffectiveDate ?? '';

  // 一列都沒有時，維持「無明細」的語意：culturalOldRecords 與 culturalNewByYear
  // 都留 undefined。給空物件的話會變成「查過了、每年都 0 分」，
  // 於是已結束的受規範年度全被判成未達標 —— 但我們其實只是沒有資料。
  if (records.length === 0) {
    return { pointsData, effectiveDateChanged: false, analyzedEffectiveDate };
  }

  const culturalOldByBucket = zeroed(ATTRIBUTE_BUCKETS);
  const culturalNewByYear: CulturalNewByYear = {};

  for (const { row } of records) {
    ATTRIBUTE_BUCKETS.forEach((k) => { pointsData[k] += row.buckets[k]; });
    CATEGORY_BUCKETS.forEach((k) => { pointsData[k] += row.categories[k]; });
    ATTRIBUTE_BUCKETS.forEach((k) => { culturalOldByBucket[k] += row.culturalOldByBucket[k]; });

    const indigenous = row.categories.culturalNewIndigenous;
    const multicultural = row.categories.culturalNewMulticultural;
    if (indigenous !== 0 || multicultural !== 0) {
      const bucket = culturalNewByYear[row.cardYearIndex] ?? { indigenous: 0, multicultural: 0 };
      bucket.indigenous += indigenous;
      bucket.multicultural += multicultural;
      culturalNewByYear[row.cardYearIndex] = bucket;
    }
  }

  ATTRIBUTE_BUCKETS.forEach((k) => { pointsData[k] = round2(pointsData[k]); });
  CATEGORY_BUCKETS.forEach((k) => { pointsData[k] = round2(pointsData[k]); });

  const culturalOldRecords: CulturalOldRecord[] = [];
  for (const bucket of ATTRIBUTE_BUCKETS) {
    const points = round2(culturalOldByBucket[bucket]);
    if (points <= 0) continue;
    const { attr, isPhysical } = splitAttributeBucket(bucket);
    culturalOldRecords.push({ attr, isPhysical, points });
  }
  pointsData.culturalOldRecords = culturalOldRecords;
  pointsData.culturalNewByYear = culturalNewByYear;

  return {
    pointsData,
    effectiveDateChanged: !!analyzedEffectiveDate && analyzedEffectiveDate !== card.effectiveDate,
    analyzedEffectiveDate,
  };
}
