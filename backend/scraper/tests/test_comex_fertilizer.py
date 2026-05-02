from datetime import date

from scraper.sources.comex_fertilizer import _month_str_to_date, _parse_int


def test_month_str_to_date_iso_format():
    assert _month_str_to_date("2026-01") == date(2026, 1, 1)
    assert _month_str_to_date("2025-12") == date(2025, 12, 1)
    assert _month_str_to_date("2024-07") == date(2024, 7, 1)


def test_month_str_to_date_portuguese_abbrev():
    assert _month_str_to_date("Jan/2026") == date(2026, 1, 1)
    assert _month_str_to_date("Fev/2026") == date(2026, 2, 1)
    assert _month_str_to_date("Dez/2026") == date(2026, 12, 1)
    assert _month_str_to_date("Ago/2025") == date(2025, 8, 1)
    assert _month_str_to_date("Set/2025") == date(2025, 9, 1)
    assert _month_str_to_date("Out/2025") == date(2025, 10, 1)


def test_month_str_to_date_case_insensitive():
    assert _month_str_to_date("jan/2026") == date(2026, 1, 1)
    assert _month_str_to_date("JAN/2026") == date(2026, 1, 1)
    assert _month_str_to_date("DEZ/2026") == date(2026, 12, 1)
    assert _month_str_to_date("fev/2024") == date(2024, 2, 1)


def test_month_str_to_date_unknown_returns_none():
    assert _month_str_to_date("Q1/2026") is None
    assert _month_str_to_date("") is None
    assert _month_str_to_date("2026") is None
    assert _month_str_to_date("not-a-date") is None


def test_parse_int_strips_formatting():
    assert _parse_int("1.234.567") == 1234567
    assert _parse_int("1,234,567") == 1234567
    assert _parse_int("0") == 0
    assert _parse_int("42") == 42
    assert _parse_int("999 000") == 999000


def test_parse_int_empty_returns_none():
    assert _parse_int("") is None
    assert _parse_int("N/A") is None
    assert _parse_int("  ") is None
    assert _parse_int("-") is None
