# date_utils.py — 統一的民國年 / 西元年日期轉換工具
# 整合原 appbeta.py 中 4 個分散的日期函式

from datetime import datetime, timedelta
from typing import Optional, Callable


def gregorian_to_roc_year(gregorian_year: int) -> int:
    return gregorian_year - 1911


def roc_to_gregorian_year(roc_year: int) -> int:
    return roc_year + 1911


def datetime_to_roc_str(dt: datetime) -> str:
    """datetime 物件 → 民國年字串，例如 '112/03/15'"""
    roc_year = gregorian_to_roc_year(dt.year)
    return f"{roc_year}/{dt.month:02d}/{dt.day:02d}"


def roc_str_to_datetime(roc_date_str: str,
                        log_fn: Optional[Callable] = None) -> Optional[datetime]:
    """
    民國年字串 → datetime 物件，例如 '112/03/15' → datetime(2023, 3, 15)
    轉換失敗時回傳 None；若提供 log_fn 則記錄錯誤訊息。
    """
    try:
        parts = roc_date_str.strip().split('/')
        if len(parts) != 3:
            raise ValueError("日期格式不正確，預期 YYY/MM/DD")
        roc_year = int(parts[0])
        month = int(parts[1])
        day = int(parts[2])
        return datetime(roc_to_gregorian_year(roc_year), month, day)
    except (ValueError, AttributeError) as e:
        if log_fn:
            log_fn(f"日期轉換錯誤: {e}")
        return None


def normalize_date_to_roc_str(date_input) -> str:
    """
    接受多種輸入格式，統一轉換為民國年字串（YYY/MM/DD）。
    支援：
      - datetime 物件
      - float（Excel 序列日期）
      - 字串（西元年 / 民國年，多種格式）
    失敗時回傳空字串。

    整合原 convert_to_roc_date() 與 convert_birthday_to_roc() 的邏輯。
    """
    if date_input is None:
        return ''

    # datetime 物件
    if isinstance(date_input, datetime):
        roc_year = gregorian_to_roc_year(date_input.year)
        return f"{roc_year}/{date_input.month}/{date_input.day}"

    date_str = str(date_input).strip()
    if not date_str or date_str in ('0', 'nan', 'NaT', 'None'):
        return ''

    # Excel 序列日期（浮點數字串，例如 "44927.0"）
    if '.' in date_str and date_str.replace('.', '').isdigit():
        try:
            float_val = float(date_str)
            base_date = datetime(1900, 1, 1)
            target_date = base_date + timedelta(days=float_val - 1)
            roc_year = gregorian_to_roc_year(target_date.year)
            return f"{roc_year}/{target_date.month}/{target_date.day}"
        except (ValueError, OverflowError):
            pass

    # 斜線分隔
    if '/' in date_str:
        parts = date_str.split('/')
        if len(parts) == 3:
            try:
                year_int = int(parts[0])
                month_int = int(parts[1])
                day_int = int(parts[2])
                if year_int > 1911:
                    # 西元年格式
                    roc_year = gregorian_to_roc_year(year_int)
                    return f"{roc_year}/{month_int:02d}/{day_int:02d}"
                else:
                    # 已是民國年格式
                    return f"{year_int}/{month_int:02d}/{day_int:02d}"
            except (ValueError, IndexError):
                pass

    # 連字號分隔（西元年）
    if '-' in date_str:
        parts = date_str.split('-')
        if len(parts) >= 3:
            try:
                gregorian_year = int(parts[0])
                month = int(parts[1])
                day = int(parts[2])
                roc_year = gregorian_to_roc_year(gregorian_year)
                return f"{roc_year}/{month:02d}/{day:02d}"
            except (ValueError, IndexError):
                pass

    # 8 位純數字（YYYYMMDD）
    if len(date_str) == 8 and date_str.isdigit():
        try:
            year = int(date_str[0:4])
            month = int(date_str[4:6])
            day = int(date_str[6:8])
            roc_year = gregorian_to_roc_year(year)
            return f"{roc_year}/{month}/{day}"
        except ValueError:
            pass

    # 嘗試 strptime 各種格式
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y%m%d', '%d/%m/%Y', '%m/%d/%Y', '%Y-%m-%d %H:%M:%S'):
        try:
            date_obj = datetime.strptime(date_str, fmt)
            roc_year = gregorian_to_roc_year(date_obj.year)
            return f"{roc_year}/{date_obj.month}/{date_obj.day}"
        except ValueError:
            continue

    # 只有西元年（4 位數字）
    if len(date_str) == 4 and date_str.isdigit():
        try:
            gregorian_year = int(date_str)
            roc_year = gregorian_to_roc_year(gregorian_year)
            return str(roc_year)
        except ValueError:
            pass

    return ''
