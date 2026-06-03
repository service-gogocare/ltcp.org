# calculator.py — 積分計算純邏輯（無 UI / Selenium 依賴）
# 所有函式均為純函式，可獨立測試

from datetime import datetime
import re
import pandas as pd
from models import PointsData, CalculationResults
from config import (
    QER_REQUIRED, QER_CAP,
    ONLINE_CAP_OLD, ONLINE_CAP_NEW, ONLINE_CAP_CUTOFF_DATE,
    TOTAL_POINTS_REQUIRED,
    CORE_COURSES_REQUIRED, CORE_INDIVIDUAL_MINIMUM,
    CULTURAL_OLD_CAP,
    SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL,
)
from date_utils import normalize_date_to_roc_str, roc_str_to_datetime, datetime_to_roc_str


def calculate_points(points_data: PointsData) -> CalculationResults:
    """計算長照積分 - 完全依照原 TypeScript 邏輯"""
    results = CalculationResults()

    # ===== 課程屬性積分 =====
    professional_physical = points_data.professional_physical or 0
    professional_online = points_data.professional_online or 0

    qer_physical = (points_data.quality_physical or 0) + \
                   (points_data.ethics_physical or 0) + \
                   (points_data.regulations_physical or 0)

    qer_online = (points_data.quality_online or 0) + \
                 (points_data.ethics_online or 0) + \
                 (points_data.regulations_online or 0)

    total_online_sum = professional_online + qer_online
    quality_ethics_regulations_sum = qer_physical + qer_online

    results.professional_sum = professional_physical + professional_online
    results.quality_ethics_regulations_sum = quality_ethics_regulations_sum
    results.is_quality_ethics_regulations_sum_met = quality_ethics_regulations_sum >= QER_REQUIRED

    # ===== 品質/倫理/法規 上限計算 =====
    qer_overflow = max(0, quality_ethics_regulations_sum - QER_CAP)
    qer_online_contribution = max(0, qer_online - qer_overflow)
    qer_physical_contribution = max(0, qer_physical - max(0, qer_overflow - qer_online))

    capped_quality_ethics_regulations_sum = qer_online_contribution + qer_physical_contribution
    results.capped_quality_ethics_regulations_sum = capped_quality_ethics_regulations_sum

    # ===== 線上課程上限計算 =====
    total_points_before_online_cap = results.professional_sum + capped_quality_ethics_regulations_sum
    total_online_contribution = professional_online + qer_online_contribution

    # 根據生效日期判斷線上課程上限
    online_cap = None
    if points_data.effective_date:
        try:
            if '/' in points_data.effective_date:
                parts = points_data.effective_date.split('/')
                roc_year = int(parts[0])
                gregorian_year = roc_year + 1911
                effective_dt = datetime(gregorian_year, int(parts[1]), int(parts[2]))
            else:
                effective_dt = datetime.fromisoformat(points_data.effective_date)

            online_cap = ONLINE_CAP_OLD if effective_dt <= ONLINE_CAP_CUTOFF_DATE else ONLINE_CAP_NEW
        except (ValueError, TypeError, AttributeError):
            online_cap = None

    results.online_cap = online_cap
    results.total_online_sum = total_online_sum

    online_points_counted = min(total_online_contribution, online_cap) if online_cap else total_online_contribution
    online_overflow = total_online_contribution - online_points_counted

    results.online_points_counted = online_points_counted
    results.online_overflow = online_overflow

    total_points = total_points_before_online_cap - online_overflow
    results.total_points = round(total_points, 2)
    results.is_total_points_met = total_points >= TOTAL_POINTS_REQUIRED

    # ===== 核心課程 =====
    core_courses_sum = (points_data.fire_safety or 0) + \
                       (points_data.emergency_response or 0) + \
                       (points_data.infection_control or 0) + \
                       (points_data.gender_sensitivity or 0)

    results.core_courses_sum = round(core_courses_sum, 2)
    results.is_core_courses_sum_met = core_courses_sum >= CORE_COURSES_REQUIRED

    results.are_all_core_courses_taken = (
            (points_data.fire_safety or 0) >= CORE_INDIVIDUAL_MINIMUM and
            (points_data.emergency_response or 0) >= CORE_INDIVIDUAL_MINIMUM and
            (points_data.infection_control or 0) >= CORE_INDIVIDUAL_MINIMUM and
            (points_data.gender_sensitivity or 0) >= CORE_INDIVIDUAL_MINIMUM
    )

    # ===== 文化敏感課程 =====
    cultural_old_capped = min(points_data.cultural_old or 0, CULTURAL_OLD_CAP)
    cultural_new_total = (points_data.cultural_new_indigenous or 0) + \
                         (points_data.cultural_new_multicultural or 0)

    results.cultural_old_capped = round(cultural_old_capped, 2)
    results.cultural_new_total = round(cultural_new_total, 2)

    # ===== 生成警告訊息 =====
    results.attention_notes = generate_attention_notes(points_data, results)

    return results


def generate_attention_notes(points_data: PointsData, results: CalculationResults) -> str:
    """生成詳細的警告訊息"""
    notes = []

    # 1. 總積分檢查
    if not results.is_total_points_met:
        needed = TOTAL_POINTS_REQUIRED - results.total_points
        notes.append(f'總積分不足，尚缺 {needed:.2f} 分。')

    # 2. 品質/倫理/法規檢查
    if not results.is_quality_ethics_regulations_sum_met:
        needed = QER_REQUIRED - results.quality_ethics_regulations_sum
        notes.append(f' 專業品質/倫理/法規積分不足，尚缺 {needed:.2f} 分 (要求至少{QER_REQUIRED}分)。')

    # 3. 核心課程檢查
    if not results.are_all_core_courses_taken:
        missing_courses = []
        if (points_data.fire_safety or 0) < CORE_INDIVIDUAL_MINIMUM:
            missing_courses.append('消防安全')
        if (points_data.emergency_response or 0) < CORE_INDIVIDUAL_MINIMUM:
            missing_courses.append('緊急應變')
        if (points_data.infection_control or 0) < CORE_INDIVIDUAL_MINIMUM:
            missing_courses.append('感染管制')
        if (points_data.gender_sensitivity or 0) < CORE_INDIVIDUAL_MINIMUM:
            missing_courses.append('性別敏感度')

        if missing_courses:
            courses_str = '、'.join(missing_courses)
            notes.append(f" 核心課程 '{courses_str}' 積分不足 (各需至少{CORE_INDIVIDUAL_MINIMUM}分)。")
    elif not results.is_core_courses_sum_met:
        needed = CORE_COURSES_REQUIRED - results.core_courses_sum
        notes.append(f' 四大核心課程總積分不足，尚缺 {needed:.2f} 分 (要求至少{CORE_COURSES_REQUIRED}分)。')

    # 4. 文化敏感課程檢查
    if (points_data.cultural_new_indigenous or 0) < CORE_INDIVIDUAL_MINIMUM:
        notes.append(' 缺『原住民族文化』課程 (需1分)。')

    if (points_data.cultural_new_multicultural or 0) < CORE_INDIVIDUAL_MINIMUM:
        notes.append(' 缺『多元族群文化』課程 (需1分)。')

    if len(notes) == 0:
        return '✓ 符合換證基本要求'

    return ''.join(notes)


def build_csv_row(pdf_filename: str, points_data: PointsData, results: CalculationResults) -> dict:
    """建立 CSV 一行資料"""
    prof_total = points_data.professional_physical + points_data.professional_online

    raw_physical_total = (points_data.professional_physical +
                          points_data.quality_physical +
                          points_data.ethics_physical +
                          points_data.regulations_physical)

    raw_online_total = (points_data.professional_online +
                        points_data.quality_online +
                        points_data.ethics_online +
                        points_data.regulations_online)

    return {
        'ID': pdf_filename,
        '專業課程_實體': points_data.professional_physical,
        '專業課程_網路': points_data.professional_online,
        '專業課程_總計': prof_total,
        '專業品質_實體': points_data.quality_physical,
        '專業品質_網路': points_data.quality_online,
        '專業倫理_實體': points_data.ethics_physical,
        '專業倫理_網路': points_data.ethics_online,
        '專業法規_實體': points_data.regulations_physical,
        '專業法規_網路': points_data.regulations_online,
        '品質倫理法規_總計': results.capped_quality_ethics_regulations_sum,
        '消防安全': points_data.fire_safety,
        '緊急應變': points_data.emergency_response,
        '感染管制': points_data.infection_control,
        '性別敏感度': points_data.gender_sensitivity,
        '四大核心_總計': results.core_courses_sum,
        '原住民族與多元族群文化(舊)': results.cultural_old_capped,
        '原住民族文化(新)': points_data.cultural_new_indigenous,
        '多元族群文化(新)': points_data.cultural_new_multicultural,
        '實體課程(raw total)': raw_physical_total,
        '網路課程(raw total)': raw_online_total,
        '最終總計': results.total_points,
        '小卡到期日': points_data.card_expiry_date,
        '注意': results.attention_notes,
    }


def parse_excel_to_points_data(person_df: pd.DataFrame, effective_date: str, expiry_date: str) -> PointsData:
    """
    將單一員工的課程明細 DataFrame 解析並加總為 PointsData。
    """
    d = PointsData()
    if person_df.empty:
        return d

    # 1. 填寫基本資料 (從第一列拿姓名、身分證等)
    first_row = person_df.iloc[0]
    
    name_col = next((c for c in person_df.columns if '人員姓名' in c or '姓名' in c), '人員姓名')
    id_col = next((c for c in person_df.columns if '身分證' in c or 'ID' in c), '身分證字號/\n統一證號')
    
    d.name = str(first_row.get(name_col, '')).strip()
    d.id = str(first_row.get(id_col, '')).strip()
    d.birthday = ''  # Excel 無此欄位，帶空字串
    d.effective_date = effective_date
    d.card_expiry_date = expiry_date

    # 2. 篩選「認可狀態 == '符合'」的課程列
    status_col = next((c for c in person_df.columns if '認可狀態' in c or '認可' in c), '認可狀態')
    valid_df = person_df[person_df[status_col] == '符合']

    # 3. 遍歷所有符合課程
    course_date_col = next((c for c in person_df.columns if '課程日期' in c or '日期' in c), '課程日期')
    method_col = next((c for c in person_df.columns if '實施方式' in c), '實施方式')
    attr_col = next((c for c in person_df.columns if '課程屬性' in c or '屬性' in c), '課程屬性')
    cat_col = next((c for c in person_df.columns if '課程類別' in c), '課程類別')
    points_col = next((c for c in person_df.columns if c == '積分' or ('積分' in c and '累積' not in c)), '積分')

    # 收集最早課程日期
    earliest_dt = None
    all_dates_df = person_df.dropna(subset=[course_date_col])
    for _, row in all_dates_df.iterrows():
        dt_str = extract_course_date(row[course_date_col])
        if dt_str:
            dt_obj = roc_str_to_datetime(dt_str)
            if dt_obj:
                if earliest_dt is None or dt_obj < earliest_dt:
                    earliest_dt = dt_obj

    if earliest_dt:
        d.earliest_course_date = datetime_to_roc_str(earliest_dt)
    else:
        d.earliest_course_date = ''

    # 4. 加總積分
    for _, row in valid_df.iterrows():
        try:
            pts = float(row[points_col])
        except (ValueError, TypeError):
            pts = 0.0

        if pts <= 0:
            continue

        method_str = str(row.get(method_col, '')).strip()
        attr_str = str(row.get(attr_col, '')).strip()
        cat_str = str(row.get(cat_col, '')).strip()

        # 判斷實體或網路課程
        is_physical = True
        if '01-2' in method_str:
            is_physical = False
        elif '01-3' in method_str:
            is_physical = SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL
        elif '01-1' in method_str:
            is_physical = True
        else:
            if '網路' in method_str or '線上' in method_str:
                if '同步' in method_str:
                    is_physical = SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL
                else:
                    is_physical = False
            else:
                is_physical = True

        # 依課程屬性分類累加
        if '品質' in attr_str:
            if is_physical:
                d.quality_physical += pts
            else:
                d.quality_online += pts
        elif '倫理' in attr_str:
            if is_physical:
                d.ethics_physical += pts
            else:
                d.ethics_online += pts
        elif '法規' in attr_str:
            if is_physical:
                d.regulations_physical += pts
            else:
                d.regulations_online += pts
        elif '專業' in attr_str:
            if is_physical:
                d.professional_physical += pts
            else:
                d.professional_online += pts

        # 依課程類別累加核心四科及文化敏感課程
        # 核心四科
        if '消防' in cat_str:
            d.fire_safety += pts
        elif '緊急' in cat_str:
            d.emergency_response += pts
        elif '感染' in cat_str:
            d.infection_control += pts
        elif '性別' in cat_str:
            d.gender_sensitivity += pts

        # 文化敏感
        if '原住民族與多元族群文化' in cat_str:
            d.cultural_old += pts
        elif '原住民族' in cat_str:
            d.cultural_new_indigenous += pts
        elif '多元族群' in cat_str:
            d.cultural_new_multicultural += pts

    # 四捨五入
    d.professional_physical = round(d.professional_physical, 2)
    d.professional_online = round(d.professional_online, 2)
    d.quality_physical = round(d.quality_physical, 2)
    d.quality_online = round(d.quality_online, 2)
    d.ethics_physical = round(d.ethics_physical, 2)
    d.ethics_online = round(d.ethics_online, 2)
    d.regulations_physical = round(d.regulations_physical, 2)
    d.regulations_online = round(d.regulations_online, 2)
    d.fire_safety = round(d.fire_safety, 2)
    d.emergency_response = round(d.emergency_response, 2)
    d.infection_control = round(d.infection_control, 2)
    d.gender_sensitivity = round(d.gender_sensitivity, 2)
    d.cultural_old = round(d.cultural_old, 2)
    d.cultural_new_indigenous = round(d.cultural_new_indigenous, 2)
    d.cultural_new_multicultural = round(d.cultural_new_multicultural, 2)

    return d


def extract_course_date(course_date_val) -> str:
    """從課程日期字串中擷取開始日期並標準化為民國年字串 YYY/MM/DD"""
    if not course_date_val or pd.isna(course_date_val):
        return ""
    if isinstance(course_date_val, (datetime, pd.Timestamp)):
        return normalize_date_to_roc_str(course_date_val)
    val_str = str(course_date_val).strip()
    parts = re.split(r'[~-]', val_str)
    start_part = parts[0].strip()
    date_part = start_part.split(' ')[0]
    return normalize_date_to_roc_str(date_part)
