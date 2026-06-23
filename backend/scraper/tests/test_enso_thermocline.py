"""Tests for the NDBC-based thermocline fetcher. Network paths out
of scope as usual; parsers exercise against fixture text mirroring
NOAA NDBC's .ocean realtime feed format from the operator blueprint."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from scraper.sources import enso_thermocline as therm

# Real-shape NDBC .ocean realtime feed. Format from the blueprint:
#   • Line 1: `#YY  MM DD hh mm DEPTH OTMP COND  SAL  O2% ...` (column names)
#   • Line 2: `#yr  mo dy hr mn m     degC mS/cm psu  %   ...` (units)
#   • Data rows: whitespace-separated, "MM" is the missing-value sentinel
#
# Multiple depths per timestamp (one row per sensor). For this fixture
# we use a fixed reference timestamp of 2026-06-22 12:00 UTC and walk
# back ~45 days so the analyser can compute the 30-day delta.
_NDBC_OCEAN_SAMPLE = """\
#YY  MM DD hh mm DEPTH OTMP COND  SAL  O2% O2PPM CLCON TURB PH EH
#yr  mo dy hr mn m     degC mS/cm psu  %   ppm   ug/l  FTU  -  mv
2026 06 22 12 00  10.0 28.5 MM    MM   MM  MM    MM    MM   MM MM
2026 06 22 12 00 100.0 22.1 MM    MM   MM  MM    MM    MM   MM MM
2026 06 22 12 00 150.0 17.5 MM    MM   MM  MM    MM    MM   MM MM
2026 06 22 12 00 300.0 12.4 MM    MM   MM  MM    MM    MM   MM MM
2026 06 21 12 00 150.0 17.3 MM    MM   MM  MM    MM    MM   MM MM
2026 06 20 12 00 150.0 17.4 MM    MM   MM  MM    MM    MM   MM MM
2026 06 19 12 00 150.0 17.2 MM    MM   MM  MM    MM    MM   MM MM
2026 06 18 12 00 150.0 17.5 MM    MM   MM  MM    MM    MM   MM MM
2026 06 17 12 00 150.0 17.3 MM    MM   MM  MM    MM    MM   MM MM
2026 06 16 12 00 150.0 17.4 MM    MM   MM  MM    MM    MM   MM MM
2026 05 23 12 00 150.0 16.0 MM    MM   MM  MM    MM    MM   MM MM
2026 05 22 12 00 150.0 16.1 MM    MM   MM  MM    MM    MM   MM MM
2026 05 21 12 00 150.0 16.2 MM    MM   MM  MM    MM    MM   MM MM
2026 05 20 12 00 150.0 16.0 MM    MM   MM  MM    MM    MM   MM MM
2026 05 19 12 00 150.0 16.1 MM    MM   MM  MM    MM    MM   MM MM
2026 05 18 12 00 150.0 16.3 MM    MM   MM  MM    MM    MM   MM MM
2026 05 17 12 00 150.0 16.0 MM    MM   MM  MM    MM    MM   MM MM
"""

# Edge cases — missing data, sensor outages, off-window depths
_NDBC_EDGE_CASES = """\
#YY  MM DD hh mm DEPTH OTMP COND  SAL  O2% O2PPM CLCON TURB PH EH
#yr  mo dy hr mn m     degC mS/cm psu  %   ppm   ug/l  FTU  -  mv
2026 06 22 12 00  10.0 28.5 MM    MM   MM  MM    MM    MM   MM MM
2026 06 22 12 00 150.0 MM   MM    MM   MM  MM    MM    MM   MM MM
2026 06 21 12 00 150.0 17.3 MM    MM   MM  MM    MM    MM   MM MM
2026 06 21 12 00 500.0 8.1  MM    MM   MM  MM    MM    MM   MM MM
not a data row at all
2026 06 21 12 00 180.0 16.9 MM    MM   MM  MM    MM    MM   MM MM
2026 06 21 12 00 140.0 17.6 MM    MM   MM  MM    MM    MM   MM MM
"""


# ── BuoySite ─────────────────────────────────────────────────────────────


def test_buoy_site_longitude_e_converts_negative_lon_to_0_360():
    """Frontend / Phase 2 use 0..360 east convention; map pins use
    -180..+180. The dataclass holds the negative form and computes
    the positive on demand."""
    site = therm.BuoySite("51023", 0.0, -155.0, "0°N 155°W", "155W")
    assert site.lon_negative == -155.0
    assert site.longitude_e  == 205.0      # 360 - 155


def test_ndbc_buoy_catalog_has_seven_anchor_sites():
    """Sanity check on the operator-supplied buoy list — exactly 7
    stations split across 3 longitude columns, headline 51023 at
    0°N 155°W (dead center of the Niño 3.4 box)."""
    assert len(therm.NDBC_BUOYS) == 7
    columns = {s.column for s in therm.NDBC_BUOYS}
    assert columns == {"170W", "155W", "140W"}
    headline = next(s for s in therm.NDBC_BUOYS if s.station_id == therm.HEADLINE_STATION_ID)
    assert headline.lat == 0.0
    assert headline.lon_negative == -155.0


# ── parse_ocean_file ─────────────────────────────────────────────────────


def test_parse_ocean_file_yields_only_depth_window_observations():
    """The depth window is [130, 200] m — bracketing the canonical
    140/150/180 m TAO sensors. Surface (10m), thermocline-edge
    (100m), and abyssal (300m, 500m) measurements are dropped at
    parse time so the JSON stays small."""
    obs = therm.parse_ocean_file(_NDBC_OCEAN_SAMPLE)
    assert all(therm.DEPTH_LOWER_M <= o.depth_m <= therm.DEPTH_UPPER_M for o in obs)
    # 7 daily 150-m readings in the recent week + 7 in the baseline
    # window = 14 in-window observations from the full fixture.
    assert len(obs) == 14


def test_parse_ocean_file_skips_comment_rows_and_blank_lines():
    """Two leading `#` rows (header + units) must NOT produce
    observations. Garbage lines that don't start with a 4-digit
    year are silently dropped."""
    obs = therm.parse_ocean_file(_NDBC_EDGE_CASES)
    # Valid in-window rows: 2026-06-21 at 150m, 180m, 140m = 3 entries.
    # The 150m row with OTMP=MM is dropped. The 500m and surface
    # rows are out-of-window. The "not a data row" line is skipped.
    assert len(obs) == 3
    depths = sorted(o.depth_m for o in obs)
    assert depths == [140.0, 150.0, 180.0]


def test_parse_ocean_file_drops_mm_missing_sentinels():
    """NDBC's missing-value sentinel is the literal "MM" — any row
    with MM in DEPTH or OTMP gets dropped rather than yielding a
    spurious 0.0 °C reading."""
    obs = therm.parse_ocean_file(_NDBC_EDGE_CASES)
    # The 2026-06-22 12:00 row at 150m had OTMP=MM and must not appear.
    june_22 = [o for o in obs if o.timestamp.day == 22 and o.timestamp.month == 6]
    assert june_22 == []


def test_parse_ocean_file_returns_utc_timestamps():
    obs = therm.parse_ocean_file(_NDBC_OCEAN_SAMPLE)
    assert all(o.timestamp.tzinfo is UTC for o in obs)


# ── analyse_buoy ─────────────────────────────────────────────────────────


def _make_obs(days_ago: int, temp_c: float, depth_m: float = 150.0) -> therm.OceanObs:
    return therm.OceanObs(
        timestamp=datetime.now(UTC) - timedelta(days=days_ago),
        depth_m=depth_m,
        temp_c=temp_c,
    )


_SITE = therm.BuoySite("51023", 0.0, -155.0, "0°N 155°W", "155W")


def test_analyse_buoy_classifies_warm_kelvin_on_positive_delta():
    """Recent week ≥ 1.0 °C warmer than the 30-day-ago baseline
    week → 'warm-kelvin-wave'. The synthetic data: baseline ~16.0,
    recent ~17.5, delta = +1.5 °C."""
    obs = (
        [_make_obs(d, 17.5) for d in range(0, 7)]        # recent week
        + [_make_obs(d, 16.0) for d in range(30, 37)]    # baseline week
    )
    an = therm.analyse_buoy(_SITE, obs)
    assert an.recent_7d_mean_c    == 17.5
    assert an.baseline_30d_mean_c == 16.0
    assert an.delta_30d_c         == 1.5
    assert an.kelvin_signal       == "warm-kelvin-wave"


def test_analyse_buoy_classifies_cold_kelvin_on_negative_delta():
    obs = (
        [_make_obs(d, 15.0) for d in range(0, 7)]
        + [_make_obs(d, 16.5) for d in range(30, 37)]
    )
    an = therm.analyse_buoy(_SITE, obs)
    assert an.delta_30d_c    == -1.5
    assert an.kelvin_signal  == "cold-kelvin-wave"


def test_analyse_buoy_marks_neutral_when_delta_below_threshold():
    """Within ±1.0 °C → neutral. A 0.5 °C wobble isn't a Kelvin
    wave; it's normal week-to-week noise."""
    obs = (
        [_make_obs(d, 16.5) for d in range(0, 7)]
        + [_make_obs(d, 16.0) for d in range(30, 37)]
    )
    an = therm.analyse_buoy(_SITE, obs)
    assert an.delta_30d_c   == 0.5
    assert an.kelvin_signal == "neutral"


def test_analyse_buoy_returns_no_data_signal_when_baseline_missing():
    """A buoy that only has the past 5 days of telemetry can't
    yield a 30-day delta — degrade to 'no-data' rather than
    inventing a baseline."""
    obs = [_make_obs(d, 17.0) for d in range(0, 5)]
    an = therm.analyse_buoy(_SITE, obs)
    assert an.recent_7d_mean_c    == 17.0
    assert an.baseline_30d_mean_c is None
    assert an.delta_30d_c         is None
    assert an.kelvin_signal       == "no-data"


def test_analyse_buoy_handles_no_observations_gracefully():
    an = therm.analyse_buoy(_SITE, [])
    assert an.obs_count     == 0
    assert an.latest        is None
    assert an.kelvin_signal == "no-data"


# ── payload assembly ─────────────────────────────────────────────────────


def test_build_payload_emits_seven_buoy_slots_for_stable_layout():
    """Even buoys with zero data get a slot in `buoys` so the
    frontend layout stays consistent across runs (offline buoy
    shows 'no-data' in its card slot rather than disappearing)."""
    analyses = [therm.analyse_buoy(s, []) for s in therm.NDBC_BUOYS]
    doc = therm.build_payload(analyses)
    assert len(doc["thermocline"]["buoys"]) == 7
    assert {b["station_id"] for b in doc["thermocline"]["buoys"]} == {
        "51305", "51010", "51306", "51021", "51023", "51022", "51311",
    }


def test_build_payload_surfaces_headline_buoy_for_kpi_strip():
    obs = (
        [_make_obs(d, 18.0) for d in range(0, 7)]
        + [_make_obs(d, 16.0) for d in range(30, 37)]
    )
    analyses = []
    for site in therm.NDBC_BUOYS:
        if site.station_id == therm.HEADLINE_STATION_ID:
            analyses.append(therm.analyse_buoy(site, obs))
        else:
            analyses.append(therm.analyse_buoy(site, []))
    doc = therm.build_payload(analyses)
    headline = doc["thermocline"]["headline"]
    assert headline["station_id"]     == "51023"
    assert headline["label"]          == "0°N 155°W"
    assert headline["lat"]            == 0.0
    assert headline["lon"]            == -155.0
    assert headline["delta_30d_c"]    == 2.0
    assert headline["kelvin_signal"]  == "warm-kelvin-wave"
    assert "4–6 weeks" in headline["reading"]


def test_build_payload_by_longitude_averages_columns():
    """The west→east strip shows mean 7-day T per longitude column —
    lets the operator SEE the wave migrating eastward without
    staring at 7 individual cards."""
    # Two warm buoys at 155°W column, one cold at 140°W column.
    site_155_a = next(s for s in therm.NDBC_BUOYS if s.station_id == "51021")
    site_155_b = next(s for s in therm.NDBC_BUOYS if s.station_id == "51023")
    site_140   = next(s for s in therm.NDBC_BUOYS if s.station_id == "51311")
    analyses = [
        therm.analyse_buoy(site_155_a, [_make_obs(d, 18.0) for d in range(0, 7)]),
        therm.analyse_buoy(site_155_b, [_make_obs(d, 17.0) for d in range(0, 7)]),
        therm.analyse_buoy(site_140,   [_make_obs(d, 14.0) for d in range(0, 7)]),
    ]
    doc = therm.build_payload(analyses)
    bl = doc["thermocline"]["by_longitude"]
    assert bl["155W"]["mean_temp_c"] == 17.5    # (18 + 17) / 2
    assert bl["155W"]["n_buoys"]     == 2
    assert bl["140W"]["mean_temp_c"] == 14.0
    assert bl["140W"]["n_buoys"]     == 1
    # 170W column had no analyses → still present, mean None, n_buoys 0.
    assert bl["170W"] == {"mean_temp_c": None, "n_buoys": 0}


def test_build_payload_buoys_carry_lat_lon_for_map_pins():
    """Bonus feature: each buoy slot has lat + lon (Leaflet
    convention, -180..+180 east) so the ENSO risk map can pin
    them directly without a frontend coordinate lookup table."""
    analyses = [therm.analyse_buoy(s, []) for s in therm.NDBC_BUOYS]
    doc = therm.build_payload(analyses)
    for b in doc["thermocline"]["buoys"]:
        assert "lat" in b and "lon" in b
        assert -5 <= b["lat"] <=  5      # all equatorial
        assert -180 <= b["lon"] <= -130  # all eastern Pacific


# ── reading text ─────────────────────────────────────────────────────────


def test_reading_text_for_warm_kelvin_mentions_surface_lead_time():
    an = therm.BuoyAnalysis(
        site=_SITE, obs_count=10,
        latest=therm.OceanObs(datetime.now(UTC), 150.0, 17.5),
        recent_7d_mean_c=17.5, baseline_30d_mean_c=16.0, delta_30d_c=1.5,
        kelvin_signal="warm-kelvin-wave",
    )
    text = therm._reading_text(an)
    assert "+1.50" in text
    assert "4–6 weeks" in text


def test_reading_text_for_no_data_explains_offline_sensor():
    an = therm.BuoyAnalysis(
        site=_SITE, obs_count=0, latest=None,
        recent_7d_mean_c=None, baseline_30d_mean_c=None, delta_30d_c=None,
        kelvin_signal="no-data",
    )
    assert "offline" in therm._reading_text(an).lower()


def test_reading_text_when_baseline_still_building_does_not_fire_alert():
    """A buoy with recent observations but no 30-day baseline yet
    (e.g. just re-commissioned) should explain the missing baseline,
    NOT trigger a false Kelvin classification."""
    an = therm.BuoyAnalysis(
        site=_SITE, obs_count=5,
        latest=therm.OceanObs(datetime.now(UTC), 150.0, 17.5),
        recent_7d_mean_c=17.5, baseline_30d_mean_c=None, delta_30d_c=None,
        kelvin_signal="no-data",
    )
    text = therm._reading_text(an)
    assert "baseline" in text.lower()


def test_fmt_signed_tolerates_none():
    assert therm._fmt_signed( 2.5)  == "+2.50"
    assert therm._fmt_signed(-1.3)  == "-1.30"
    assert therm._fmt_signed(None)  == "—"
