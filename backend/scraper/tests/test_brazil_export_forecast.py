"""Unit tests for scraper.brazil_export_forecast — the daily projection engine.

Live HTTP is not exercised — `build_projection()` takes the three source
payloads as kwargs so each scenario can mint a tiny fixture and assert on the
math (realized / certificados / seasonality / safeguard).
"""
from __future__ import annotations

import datetime as dt

from scraper import brazil_export_forecast as bef


# ── helper builders ──────────────────────────────────────────────────────────

def _series_row(date: str, total: int) -> dict:
    """Cecafe `series[]` row shape — only the fields the engine reads."""
    return {"date": date, "total": total, "arabica": total, "conillon": 0,
            "soluvel": 0}


def _stocks(exports_mt: int, year: str = "2025") -> dict:
    """Minimal demand_stocks.json shape needed by the engine."""
    return {"producers": {"brazil": {"annual": [
        {"year": year, "exports_mt": exports_mt},
    ]}}}


def _daily(certificados: dict) -> dict:
    """Minimal cecafe_daily v2 payload with the certificados source filled."""
    return {"updated": "2026-06-05", "_schema": "v2",
            "sources": {"embarques": {}, "certificados": certificados}}


# ── crop-year math ───────────────────────────────────────────────────────────

def test_crop_year_start_after_april():
    assert bef.crop_year_start(dt.date(2026, 6, 8)) == dt.date(2026, 4, 1)


def test_crop_year_start_before_april():
    assert bef.crop_year_start(dt.date(2026, 2, 15)) == dt.date(2025, 4, 1)


def test_crop_year_label():
    assert bef.crop_year_label(dt.date(2026, 4, 1)) == "2026/27"


def test_crop_year_months_wraps_calendar_year():
    months = bef.crop_year_months(dt.date(2026, 4, 1))
    assert months[0] == (2026, 4)
    assert months[8] == (2026, 12)
    assert months[9] == (2027, 1)
    assert months[-1] == (2027, 3)


# ── realized + certificados extraction ───────────────────────────────────────

def test_realized_filters_to_active_crop_year():
    series = [
        _series_row("2025-12", 999),   # last year — should be skipped
        _series_row("2026-04", 3_000_000),
        _series_row("2026-05", 2_500_000),
        _series_row("2027-04", 7_777),  # next year — out of window
    ]
    realized = bef.realized_from_series(series, dt.date(2026, 4, 1))
    assert realized == {"2026-04": 3_000_000, "2026-05": 2_500_000}


def test_certificados_pacing_scales_to_full_month():
    # 1M bags through day 5 of June (30 days) → projected ~6M bags.
    daily = _daily({
        "arabica":  {"2026-06": {"5": 600_000}},
        "conillon": {"2026-06": {"5": 300_000}},
        "soluvel":  {"2026-06": {"5": 100_000}},
    })
    out = bef.certificados_forecast(daily, dt.date(2026, 4, 1), realized={})
    assert "2026-06" in out
    # (600k + 300k + 100k) / 5 × 30 = 6,000,000
    assert out["2026-06"] == 6_000_000


def test_certificados_skips_months_already_realized():
    daily = _daily({"arabica": {"2026-04": {"15": 500_000}}})
    realized = {"2026-04": 9_999}
    out = bef.certificados_forecast(daily, dt.date(2026, 4, 1), realized)
    assert "2026-04" not in out


def test_certificados_v1_legacy_schema_still_parses():
    """Older files lack `sources` — top-level arabica/conillon/soluvel = certs."""
    daily = {
        "updated": "2025-12-05",
        "arabica":  {"2025-12": {"5": 1_000_000}},
        "conillon": {},
        "soluvel":  {},
    }
    out = bef.certificados_forecast(daily, dt.date(2025, 4, 1), realized={})
    # Dec has 31 days → (1M / 5) × 31 = 6,200,000
    assert out["2025-12"] == 6_200_000


# ── full build_projection end-to-end ─────────────────────────────────────────

def test_seasonality_distributes_remaining_via_prior_year():
    """Prior year July & August carried 40% / 60% of the Jul-Aug subset.
    Annual_target = 30, realized = 10, certificados = 10 → remaining=10,
    so Jul should land on 4 and Aug on 6."""
    series = [
        # Prior crop year (25/26): 12 months.
        *[_series_row(f"2025-{m:02d}", 0) for m in range(4, 13) if m not in (7, 8)],
        _series_row("2025-07", 4),
        _series_row("2025-08", 6),
        *[_series_row(f"2026-{m:02d}", 0) for m in (1, 2, 3)],
        # Active crop year (26/27): realized April only.
        _series_row("2026-04", 10),
    ]
    daily = _daily({
        # Certificados: a May projection of 10 (one full-month sample).
        "arabica": {"2026-05": {"31": 10}},
    })
    payload = bef.build_projection(
        today=dt.date(2026, 6, 1),
        cecafe={"series": series},
        daily=daily,
        stocks=_stocks(exports_mt=30 * 60 / 1_000),    # 30 bags
    )
    curve = {r["ym"]: r for r in payload["monthly_curve"]}
    assert curve["2026-04"]["status"] == "realized"     and curve["2026-04"]["value"] == 10
    assert curve["2026-05"]["status"] == "certificados" and curve["2026-05"]["value"] == 10
    # Remaining = 30 - 10 - 10 = 10. Prior Jul=4, Aug=6, others=0 → shares 0.4/0.6/0…
    assert curve["2026-07"]["value"] == 4
    assert curve["2026-08"]["value"] == 6
    # Months without prior-year data go to zero (after rounding 0.0 × 10 = 0).
    assert curve["2026-09"]["value"] == 0
    assert payload["safeguard_triggered"] is False


def test_seasonality_uniform_when_prior_subset_empty():
    """Last year ran flat (all zeros) — engine still produces a non-degenerate
    curve by falling back to a uniform split across remaining months."""
    series = [
        *[_series_row(f"2025-{m:02d}", 0) for m in range(4, 13)],
        *[_series_row(f"2026-{m:02d}", 0) for m in (1, 2, 3)],
        _series_row("2026-04", 0),
    ]
    payload = bef.build_projection(
        today=dt.date(2026, 6, 1),
        cecafe={"series": series},
        daily={"updated": "2026-06-01", "_schema": "v2",
               "sources": {"embarques": {}, "certificados": {}}},
        stocks=_stocks(exports_mt=11 * 60 / 1_000),   # 11 bags annual target
    )
    # Realized only carries 1 month at 0, so remaining = 11 spread uniformly
    # over 11 months → 1 bag each.
    seasonals = [r["value"] for r in payload["monthly_curve"]
                 if r["status"] == "seasonality"]
    assert sum(seasonals) == 11
    assert all(v == 1 for v in seasonals)


def test_safeguard_raises_target_and_sets_flag():
    """Realized+certs already exceed the USDA target → safeguard raises the
    target and the remaining months get the historical minimum each."""
    series = [
        # Five years of "Aug" = 100 each → historical_min(Aug)=100.
        *[_series_row(f"{y}-08", 100) for y in (2021, 2022, 2023, 2024, 2025)],
        # Active year April realized at 50 (sole released month).
        _series_row("2026-04", 50),
    ]
    # USDA target is only 30 → realized (50) already exceeds it.
    payload = bef.build_projection(
        today=dt.date(2026, 5, 1),
        cecafe={"series": series},
        daily={"updated": "2026-05-01", "_schema": "v2",
               "sources": {"embarques": {}, "certificados": {}}},
        stocks=_stocks(exports_mt=30 * 60 / 1_000),
    )
    assert payload["safeguard_triggered"] is True
    # New target = 50 (realized) + 100 (Aug min) + 0 (every other month: no
    # prior data so historical_min returns 0) = 150.
    assert payload["annual_target"] == 150
    aug = next(r for r in payload["monthly_curve"] if r["ym"] == "2026-08")
    assert aug["value"] == 100


def test_target_falls_back_when_psd_missing():
    """If demand_stocks.json has no Brazil entry, the engine still emits a
    coherent projection using the prior crop year's total as the target."""
    series = [
        *[_series_row(f"2025-{m:02d}", 1) for m in range(4, 13)],
        *[_series_row(f"2026-{m:02d}", 1) for m in (1, 2, 3)],
        _series_row("2026-04", 1),
    ]
    payload = bef.build_projection(
        today=dt.date(2026, 5, 1),
        cecafe={"series": series},
        daily={"updated": "2026-05-01", "_schema": "v2",
               "sources": {"embarques": {}, "certificados": {}}},
        stocks={},
    )
    # Prior crop year (Apr 2025 → Mar 2026) sums to 12 bags.
    assert payload["annual_target"] == 12
    assert "fallback" in (payload["target_source"] or "")
