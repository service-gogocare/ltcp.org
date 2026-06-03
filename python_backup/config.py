# config.py — 所有可調整的常數集中管理
# 修改此檔案即可調整系統行為，無需修改主程式邏輯

from datetime import datetime

# ==================== 網路設定 ====================
LOGIN_URL = "https://ltcpap.mohw.gov.tw/molc/eg999/index"

# ==================== 積分計算規則 ====================
# 換證所需最低總積分
TOTAL_POINTS_REQUIRED = 120

# 品質/倫理/法規類積分要求
QER_REQUIRED = 24    # 最低需達到的積分
QER_CAP = 36         # 此類積分上限

# 線上課程積分上限（依生效日期判斷適用哪個上限）
ONLINE_CAP_OLD = 60  # 生效日期在截止日之前（含）適用
ONLINE_CAP_NEW = 40  # 生效日期在截止日之後適用
ONLINE_CAP_CUTOFF_DATE = datetime(2023, 10, 12)  # 上限切換日期

# 01-3.線上實體同步課程 是否歸類為實體課程（True 歸類為實體，False 歸類為網路）
SYNCHRONOUS_ONLINE_COUNTS_AS_PHYSICAL = True

# 核心課程要求
CORE_COURSES_REQUIRED = 10    # 四大核心課程總積分最低要求
CORE_INDIVIDUAL_MINIMUM = 1   # 每門核心課程各自最低積分

# 文化敏感課程（舊制）上限
CULTURAL_OLD_CAP = 2

# ==================== Selenium 時間設定 ====================
SELENIUM_WAIT_SECONDS = 20    # 一般元素等待逾時（秒）
SELENIUM_LOGIN_WAIT = 5       # 登入頁面等待（秒）
SELENIUM_SHORT_WAIT = 2       # 短暫等待（秒）
INTER_RECORD_SLEEP = 5        # 每筆記錄處理完後的等待間隔（秒）

# ==================== 視窗設定 ====================
WINDOW_WIDTH = 950
WINDOW_HEIGHT = 750
WINDOW_MIN_WIDTH = 800
WINDOW_MIN_HEIGHT = 600

# ==================== 資料格式要求 ====================
# Excel 欄位名稱 → 內部統一名稱對照表（rename 後驗證用 REQUIRED_EXCEL_COLUMNS）
EXCEL_COLUMN_MAP = {'身分證字號': 'ID', '出生年月日': 'BIRTHDAY'}
REQUIRED_EXCEL_COLUMNS = ['ID', 'BIRTHDAY', '職登類別', '姓名']
