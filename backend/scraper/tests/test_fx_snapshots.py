"""Anchor-selection tests for the intraday FX snapshot fetcher.

The fetcher's correctness rests on two deterministic rules, tested here
offline (the Barchart fetch itself reuses the KC/RC mechanism proven in CI):

  * 17:30-London anchor = close of the bar starting 17:15 Europe/London —
    correct across DST including the US/UK mismatch weeks.
  * 03:00-UTC anchor = close of the LATEST bar starting ≤ 02:45 UTC that day —
    unaffected by how late the cron actually fires (later bars never shift it).
"""
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from scraper.fetch_fx_snapshots import _anchors, _pair_days, _parse_bars

_CHICAGO = ZoneInfo("America/Chicago")


def _csv_line(utc_dt: datetime, close: float) -> str:
    ct = utc_dt.astimezone(_CHICAGO)
    return f"{ct.strftime('%Y-%m-%d %H:%M')},{ct.day},{close},{close},{close},{close},0"


def test_london_1730_anchor_across_dst():
    # 17:15 London starts: summer (BST, UTC+1) → 16:15Z; winter (GMT) → 17:15Z;
    # US/UK mismatch week (UK switched Oct 26 2025, US not until Nov 2) → 17:15Z.
    cases = [
        (datetime(2025, 7, 16, 16, 15, tzinfo=UTC), "2025-07-16"),
        (datetime(2025, 1, 15, 17, 15, tzinfo=UTC), "2025-01-15"),
        (datetime(2025, 10, 29, 17, 15, tzinfo=UTC), "2025-10-29"),
    ]
    csv = "\n".join(_csv_line(dt, 5.0 + i) for i, (dt, _) in enumerate(cases))
    l1730, _ = _anchors(_parse_bars(csv))
    for i, (_, ldn_date) in enumerate(cases):
        assert l1730[ldn_date] == 5.0 + i


def test_utc_0300_anchor_is_deterministic_under_cron_drift():
    d = datetime(2025, 7, 17, tzinfo=UTC)
    bars = [
        (d.replace(hour=2, minute=30), 1.10),
        (d.replace(hour=2, minute=45), 1.11),   # ← the 03:00 price
        (d.replace(hour=3, minute=0),  1.12),   # exists when cron ran late
        (d.replace(hour=3, minute=15), 1.13),
    ]
    csv = "\n".join(_csv_line(dt, c) for dt, c in bars)
    _, u0300 = _anchors(_parse_bars(csv))
    assert u0300["2025-07-17"] == 1.11          # later bars never shift the anchor
    # Without the late bars the result is identical:
    csv_early = "\n".join(_csv_line(dt, c) for dt, c in bars[:2])
    _, u_early = _anchors(_parse_bars(csv_early))
    assert u_early["2025-07-17"] == 1.11


def test_pair_days_monday_uses_friday_close():
    l1730 = {"2025-07-10": 5.0, "2025-07-11": 5.1}          # Thu, Fri
    u0300 = {"2025-07-11": 5.05, "2025-07-14": 5.2}          # Fri, Mon
    days = _pair_days(l1730, u0300)
    assert days["2025-07-11"]["prev_1730"] == 5.0            # Fri ← Thu 17:30
    assert days["2025-07-14"]["prev_1730"] == 5.1            # Mon ← Fri 17:30
    assert days["2025-07-14"]["at_0300"] == 5.2
