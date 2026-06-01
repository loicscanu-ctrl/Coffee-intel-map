"""Tests for the morning brief handler — upcoming events section (issue #132 Body-4)."""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from telegram.handlers import brief

# ── Fixtures ─────────────────────────────────────────────────────────────────

# "Now" — picking a fixed date so the test isn't time-dependent. May 30 is
# matched by today's events; May 31 is matched by tomorrow's.
NOW = datetime(2026, 5, 30, 8, 0, tzinfo=UTC)


def _events(*entries: dict) -> dict:
    """Wrap a list of event dicts in the events.json envelope shape."""
    return {"_schema": "test", "events": list(entries)}


# ── Happy path: today + tomorrow render ──────────────────────────────────────

def test_renders_today_and_tomorrow(monkeypatch):
    doc = _events(
        {"date": "2026-05-30", "category": "wasde", "title": "WASDE Crop Production Report"},
        {"date": "2026-05-31", "category": "fnd",   "title": "KCN26 First Notice Day"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert "Coming up · next 24h" in out
    assert "Today" in out
    assert "Tomorrow" in out
    assert "[WASDE] WASDE Crop Production Report" in out
    assert "[FND] KCN26 First Notice Day" in out


def test_today_listed_before_tomorrow(monkeypatch):
    """Chronological sort: today rows must come before tomorrow rows."""
    doc = _events(
        {"date": "2026-05-31", "category": "fnd",   "title": "Tomorrow Event"},
        {"date": "2026-05-30", "category": "wasde", "title": "Today Event"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    today_pos = out.index("Today Event")
    tomorrow_pos = out.index("Tomorrow Event")
    assert today_pos < tomorrow_pos


# ── Filtering: only today + tomorrow get through ─────────────────────────────

def test_skips_past_and_future_events(monkeypatch):
    doc = _events(
        {"date": "2026-05-29", "category": "ico",   "title": "Yesterday Event"},  # past
        {"date": "2026-05-30", "category": "wasde", "title": "Today Event"},
        {"date": "2026-05-31", "category": "fnd",   "title": "Tomorrow Event"},
        {"date": "2026-06-01", "category": "cecafe","title": "Day-after Event"},  # future
        {"date": "2026-12-31", "category": "ico",   "title": "Year-end Event"},   # future
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert "Yesterday Event" not in out
    assert "Day-after Event" not in out
    assert "Year-end Event" not in out
    assert "Today Event" in out
    assert "Tomorrow Event" in out


# ── Graceful degradation ─────────────────────────────────────────────────────

def test_returns_none_when_events_json_missing(monkeypatch):
    monkeypatch.setattr(brief, "load", lambda name: None)
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_events_list_empty(monkeypatch):
    monkeypatch.setattr(brief, "load",
                        lambda name: {"_schema": "test", "events": []})
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_no_matching_dates(monkeypatch):
    """events.json may be populated, but none of its rows hit today/tomorrow.
    Currently the case on live data — no upcoming events in 2026-05-30..31."""
    doc = _events(
        {"date": "2025-12-26", "category": "fnd", "title": "Past Event"},
        {"date": "2026-12-31", "category": "ico", "title": "Far-future Event"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    assert brief._upcoming_events_section(NOW) is None


def test_returns_none_when_events_json_is_not_a_dict(monkeypatch):
    """Defensive: load() could return a list or None on a malformed file."""
    monkeypatch.setattr(brief, "load", lambda name: ["not", "a", "dict"])
    assert brief._upcoming_events_section(NOW) is None


# ── Category label mapping ──────────────────────────────────────────────────

def test_unknown_category_falls_back_to_evt(monkeypatch):
    doc = _events(
        {"date": "2026-05-30", "category": "novel_category", "title": "X"},
    )
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert "[EVT] X" in out


@pytest.mark.parametrize("category,label", [
    ("wasde",           "WASDE"),
    ("ico",             "ICO"),
    ("vietnam_customs", "VN"),
    ("cecafe",          "CECAFÉ"),
    ("fnd",             "FND"),
    ("central_bank",    "CB"),
    ("other",           "EVT"),
])
def test_category_label_mapping(monkeypatch, category, label):
    doc = _events({"date": "2026-05-30", "category": category, "title": "Foo"})
    monkeypatch.setattr(brief, "load",
                        lambda name: doc if name == "events.json" else None)
    out = brief._upcoming_events_section(NOW)
    assert out is not None
    assert f"[{label}]" in out


# ── Integration smoke test: full brief tolerates missing optional data ──────

def test_build_brief_message_does_not_crash_with_no_events(monkeypatch):
    """Whole-handler smoke: brief renders even when every optional data
    source returns None (matching a fresh sandbox / cold-cache state)."""
    monkeypatch.setattr(brief, "load", lambda name: None)
    out = brief.build_brief_message()
    assert "Coffee Intel" in out
    assert "Coming up · next 24h" not in out   # section omitted gracefully


# ── Body-3: weather seasonal baseline filter ─────────────────────────────────

def _supply_doc(*regions: dict) -> dict:
    """Wrap a list of region dicts in the {country}_supply.json shape."""
    return {"weather": {"regions": list(regions)}}


def _patch_supply_loader(monkeypatch, supply_doc: dict):
    """Return supply_doc for any *_supply.json filename; None for others
    so the brief's optional blocks gracefully omit."""
    def fake_load(name: str):
        if name.endswith("_supply.json"):
            return supply_doc
        return None
    monkeypatch.setattr(brief, "load", fake_load)


def test_drought_below_seasonal_floor_helper():
    # Current rain < historical floor for this month → anomalous → True
    assert brief._drought_below_seasonal_floor(
        {"rain_mtd_mm": 10.0, "rain_hist_min": 25.0}) is True
    # Current rain == historical floor → still within range → False
    assert brief._drought_below_seasonal_floor(
        {"rain_mtd_mm": 25.0, "rain_hist_min": 25.0}) is False
    # Current rain > historical floor → normal seasonal noise → False
    assert brief._drought_below_seasonal_floor(
        {"rain_mtd_mm": 40.0, "rain_hist_min": 25.0}) is False


def test_drought_below_seasonal_floor_fail_closed_on_missing_data():
    # Either field missing → False (don't fire on incomplete baselines).
    assert brief._drought_below_seasonal_floor({"rain_mtd_mm": 10.0}) is False
    assert brief._drought_below_seasonal_floor({"rain_hist_min": 25.0}) is False
    assert brief._drought_below_seasonal_floor({}) is False
    # Non-numeric values → False
    assert brief._drought_below_seasonal_floor(
        {"rain_mtd_mm": None, "rain_hist_min": 25.0}) is False


def test_weather_line_suppresses_drought_within_seasonal_range(monkeypatch):
    """Sul de Minas in winter: drought=HIGH from upstream but rain is
    within the historical July range. Brief must stay silent."""
    _patch_supply_loader(monkeypatch, _supply_doc({
        "name": "Sul de Minas",
        "drought": "HIGH",
        "rain_mtd_mm": 18.0,
        "rain_hist_min": 12.0,   # Current 18 > floor 12 → normal dry season
    }))
    out = brief._weather_line()
    assert out == ""   # no false-positive alert


def test_weather_line_fires_drought_when_below_seasonal_floor(monkeypatch):
    """Sul de Minas in Mar/Apr (wet season): drought=HIGH AND rain
    below the historical March floor → genuinely anomalous."""
    _patch_supply_loader(monkeypatch, _supply_doc({
        "name": "Sul de Minas",
        "drought": "HIGH",
        "rain_mtd_mm": 8.0,
        "rain_hist_min": 45.0,   # Current 8 << floor 45 → real signal
    }))
    out = brief._weather_line()
    assert "Sul de Minas drought" in out


def test_weather_line_fires_when_baseline_missing_and_high(monkeypatch):
    """Without baseline data, the seasonal filter returns False so
    HIGH alone is no longer enough — matches the architect's
    "fail-closed" preference for noisy regions."""
    _patch_supply_loader(monkeypatch, _supply_doc({
        "name": "RegionWithoutBaseline",
        "drought": "HIGH",
        # rain_mtd_mm + rain_hist_min absent → seasonal check returns False
    }))
    out = brief._weather_line()
    assert "drought" not in out


def test_weather_line_csi_unchanged_by_baseline_filter(monkeypatch):
    """CSI alerts have no per-month baseline in the supply schema —
    they pass through the categorical level as before."""
    _patch_supply_loader(monkeypatch, _supply_doc({
        "name": "TestRegion",
        "drought": "LOW",
        "csi_30d_level": "HIGH",
    }))
    out = brief._weather_line()
    assert "TestRegion CSI" in out


def test_weather_line_caps_at_three_alerts(monkeypatch):
    """The existing 3-alert cap on the weather line is preserved by
    the new gate (not broken by the new filter)."""
    _patch_supply_loader(monkeypatch, _supply_doc(*[
        {"name": f"R{i}", "drought": "HIGH",
         "rain_mtd_mm": 0.0, "rain_hist_min": 30.0}  # all genuinely below floor
        for i in range(5)
    ]))
    out = brief._weather_line()
    # 5 regions qualify but cap at 3
    assert out.count("drought") == 3
