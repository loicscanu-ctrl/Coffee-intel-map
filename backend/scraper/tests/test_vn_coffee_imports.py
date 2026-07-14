"""Tests for the coffee-imports piggyback on the vn_fertilizer 1n harvest —
the k2 cumulative → monthly derivation (year-boundary reset, partial-start
handling) that turns the bulletin's YTD 'Cà phê' row into a monthly series."""
from __future__ import annotations

from scraper.sources.vn_fertilizer import derive_coffee_monthly


def _cum(t: float, u: float) -> dict:
    return {"ytd_tonnes": t, "ytd_usd": u}


def test_monthly_is_diff_of_cumulatives():
    rows = derive_coffee_monthly({
        "2026-01": _cum(30_000, 120e6),
        "2026-02": _cum(75_000, 300e6),
        "2026-03": _cum(95_000, 380e6),
    })
    assert [r["month"] for r in rows] == ["2026-01", "2026-02", "2026-03"]
    assert rows[0]["tonnes"] == 30_000            # January = its own YTD
    assert rows[1]["tonnes"] == 45_000
    assert rows[2]["tonnes"] == 20_000
    assert rows[2]["value_usd"] == 80e6
    assert rows[2]["ytd_tonnes"] == 95_000        # cumulative preserved


def test_year_boundary_resets_cumulative():
    rows = derive_coffee_monthly({
        "2025-12": _cum(200_000, 800e6),
        "2026-01": _cum(28_000, 110e6),
    })
    jan = rows[1]
    assert jan["tonnes"] == 28_000                # not 28k − 200k
    assert jan["value_usd"] == 110e6


def test_non_january_start_yields_no_monthly_figure():
    # First month in the list isn't January: its cumulative is YTD, so a
    # monthly figure would be a lie — tonnes/value must be None, YTD kept.
    rows = derive_coffee_monthly({
        "2025-05": _cum(600_000, 2.4e9),
        "2025-06": _cum(750_000, 3.0e9),
    })
    assert rows[0]["tonnes"] is None and rows[0]["value_usd"] is None
    assert rows[0]["ytd_tonnes"] == 600_000
    assert rows[1]["tonnes"] == 150_000           # diffable from month 2 on


def test_revision_downward_clamps_to_zero():
    # Preliminary bulletins occasionally revise YTD downward; a negative
    # monthly figure would be nonsense — clamp at 0.
    rows = derive_coffee_monthly({
        "2026-01": _cum(50_000, 200e6),
        "2026-02": _cum(49_000, 199e6),
    })
    assert rows[1]["tonnes"] == 0.0
    assert rows[1]["value_usd"] == 0.0
