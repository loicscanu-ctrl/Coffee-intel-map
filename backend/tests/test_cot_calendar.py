# backend/tests/test_cot_calendar.py
"""Tests for the CFTC COT release calendar (holiday-aware release-day logic)."""
from datetime import date

from scraper.cot_calendar import (
    add_business_days,
    cot_release_date,
    holiday_name,
    release_due_on,
    us_federal_holidays,
)


def test_juneteenth_2026_is_a_friday_holiday():
    # The case that started this: Juneteenth 2026 lands on Friday 06-19.
    assert holiday_name(date(2026, 6, 19)) == "Juneteenth"
    assert holiday_name(date(2026, 6, 18)) is None


def test_normal_week_release_is_friday():
    # Report Tue 2026-07-07 → normal Friday 2026-07-10 (no holidays that week).
    assert cot_release_date(date(2026, 7, 7)) == date(2026, 7, 10)


def test_juneteenth_delays_release_to_monday():
    # Report Tue 2026-06-16: Fri 06-19 is Juneteenth → release shifts to Mon 06-22.
    assert cot_release_date(date(2026, 6, 16)) == date(2026, 6, 22)


def test_release_due_on_delayed_monday():
    due, tue, reason = release_due_on(date(2026, 6, 22))
    assert due is True
    assert tue == date(2026, 6, 16)
    assert "holiday-delayed" in reason and "Juneteenth" in reason


def test_no_release_on_the_juneteenth_friday_itself():
    due, _, _ = release_due_on(date(2026, 6, 19))
    assert due is False


def test_release_due_on_normal_friday():
    due, tue, reason = release_due_on(date(2026, 7, 10))
    assert due is True
    assert tue == date(2026, 7, 7)
    assert "normal Friday" in reason


def test_no_release_midweek():
    # A plain Wednesday is never a release day.
    assert release_due_on(date(2026, 7, 8))[0] is False


def test_thanksgiving_week_delays_release():
    # Thanksgiving 2026 = Thu 11-26. Report Tue 11-24 → Wed 25, [Thu 26 holiday],
    # Fri 27, Mon 30 → release Monday 2026-11-30.
    assert holiday_name(date(2026, 11, 26)) == "Thanksgiving Day"
    assert cot_release_date(date(2026, 11, 24)) == date(2026, 11, 30)


def test_add_business_days_skips_weekend_and_holiday():
    # From Thu 2026-06-18: +1 = [skip Fri Juneteenth, Sat, Sun] → Mon 06-22.
    assert add_business_days(date(2026, 6, 18), 1) == date(2026, 6, 22)


def test_weekend_holiday_observance_shift():
    # 2027-12-25 (Christmas) is a Saturday → observed Friday 2027-12-24.
    hols = us_federal_holidays(2027)
    assert date(2027, 12, 24) in hols
    assert hols[date(2027, 12, 24)] == "Christmas Day"
    # 2027-07-04 (Independence Day) is a Sunday → observed Monday 2027-07-05.
    assert holiday_name(date(2027, 7, 5)) == "Independence Day"


def test_eleven_federal_holidays_per_year():
    assert len(us_federal_holidays(2026)) == 11
