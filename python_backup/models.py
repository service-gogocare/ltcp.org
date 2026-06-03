# models.py — 積分資料結構定義


class PointsData:
    """積分資料結構"""

    def __init__(self):
        self.id = ''
        self.name = ''
        self.birthday = ''
        self.card_expiry_date = ''
        self.effective_date = ''
        self.earliest_course_date = ''

        self.professional_physical = 0
        self.professional_online = 0

        self.quality_physical = 0
        self.quality_online = 0

        self.ethics_physical = 0
        self.ethics_online = 0

        self.regulations_physical = 0
        self.regulations_online = 0

        self.fire_safety = 0
        self.emergency_response = 0
        self.infection_control = 0
        self.gender_sensitivity = 0

        self.cultural_old = 0
        self.cultural_new_indigenous = 0
        self.cultural_new_multicultural = 0


class CalculationResults:
    """計算結果"""

    def __init__(self):
        self.quality_ethics_regulations_sum = 0
        self.capped_quality_ethics_regulations_sum = 0
        self.is_quality_ethics_regulations_sum_met = False

        self.core_courses_sum = 0
        self.is_core_courses_sum_met = False
        self.are_all_core_courses_taken = False

        self.cultural_old_capped = 0
        self.cultural_new_total = 0

        self.total_points = 0
        self.is_total_points_met = False

        self.online_cap = None
        self.total_online_sum = 0
        self.online_points_counted = 0
        self.online_overflow = 0

        self.professional_sum = 0
        self.attention_notes = ''
