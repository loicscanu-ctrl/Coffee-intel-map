"""Tests for the shared contract_dates module (deduped FND / trading-day math)."""
from datetime import date

from contract_dates import (
    calc_fnd,
    first_business_day,
    subtract_business_days,
    trading_days_to,
)


def test_first_business_day_skips_weekend():
    # 2026-05-01 is a Friday → itself
    assert first_business_day(2026, 5) == date(2026, 5, 1)
    # 2026-08-01 is a Saturday → 2026-08-03 (Mon)
    assert first_business_day(2026, 8) == date(2026, 8, 3)


def test_subtract_business_days():
    # back 1 business day from Mon 2026-05-04 → Fri 2026-05-01
    assert subtract_business_days(date(2026, 5, 4), 1) == date(2026, 5, 1)


def test_calc_fnd_kc_is_7_rc_is_4_business_days():
    assert calc_fnd("KCK26") == date(2026, 4, 22)   # 7 biz days before 2026-05-01
    assert calc_fnd("RCK26") == date(2026, 4, 27)   # 4 biz days before
    assert calc_fnd("rmk26") == date(2026, 4, 27)   # case-insensitive, RM == RC offset
    # KC notices earlier than RC for the same delivery month
    assert calc_fnd("KCK26") < calc_fnd("RCK26")


def test_calc_fnd_rejects_bad_symbols():
    assert calc_fnd("KC") is None
    assert calc_fnd("ZZ99") is None
    assert calc_fnd("") is None


def test_trading_days_to_signed_and_zero():
    assert trading_days_to(date(2026, 1, 5), date(2026, 1, 12)) == -5   # Mon→next Mon
    assert trading_days_to(date(2026, 1, 12), date(2026, 1, 5)) == 0    # d1 >= fnd
