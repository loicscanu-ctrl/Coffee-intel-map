"""Shared ICE coffee contract date math — First Notice Day (FND) and
trading-day offsets for KC/RC/RM contract symbols.

Previously copy-pasted across scraper/export_static_json.py, routes/futures.py
and a couple of scripts. Centralised here so the FND rule
(which must match the frontend's `firstNoticeDay`) lives in exactly one place.
Holidays are intentionally NOT adjusted — the calculation matches the frontend,
which also ignores exchange holidays.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

LETTER_TO_MONTH = {
    "F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
    "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12,
}


def first_business_day(year: int, month: int) -> date:
    """First Mon–Fri of the given month (holidays not adjusted)."""
    d = date(year, month, 1)
    while d.weekday() >= 5:  # Sat=5, Sun=6
        d += timedelta(days=1)
    return d


def subtract_business_days(d: date, n: int) -> date:
    """Move back `n` business days from `d`."""
    remaining = n
    while remaining > 0:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            remaining -= 1
    return d


def calc_fnd(symbol: str):
    """First Notice Day for an ICE coffee contract symbol (KC/RM/RC + month
    letter + 2-digit year), or None if it doesn't parse. KC FND = 7 business
    days before the first business day of the delivery month; RC/RM = 4.
    """
    m = re.match(r'^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$', symbol, re.I)
    if not m:
        return None
    product, letter, yr = m.group(1), m.group(2).upper(), int(m.group(3))
    month_num = LETTER_TO_MONTH.get(letter)
    if not month_num:
        return None
    days_before = 7 if product.upper() == "KC" else 4
    return subtract_business_days(first_business_day(2000 + yr, month_num), days_before)


def trading_days_to(d1: date, fnd: date) -> int:
    """Signed trading (Mon–Fri) days from d1 to fnd; negative = before FND,
    0 if d1 is already on/after fnd."""
    if d1 >= fnd:
        return 0
    count, cur = 0, d1
    while cur < fnd:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            count += 1
    return -count
