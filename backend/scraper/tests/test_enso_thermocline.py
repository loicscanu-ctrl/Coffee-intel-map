"""Tests for the v5 ERDDAP-via-CF-Worker thermocline fetcher.
Network paths out of scope; parsers exercise against fixture
JSON mirroring ERDDAP tabledap's response shape."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from scraper.sources import enso_thermocline as therm

# Real-shape ERDDAP tabledap JSON response. tabledap returns the
# "table" object with columnNames + columnTypes + columnUnits + rows.
# We include several observations across 3 anchor sites at depths
# 140/150/180 (in-window) plus one row at 500m (off-window, dropped)
# plus one row at a longitude outside our anchor set (dropped by
# the _nearest_site bucketer).
_ERDDAP_JSON = json.dumps({
    "table": {
        "columnNames": ["time", "latitude", "longitude", "depth", "T_25"],
        "columnTypes": ["String", "double", "double", "double", "float"],
        "columnUnits": ["UTC", "degrees_north", "degrees_east", "m", "degree_C"],
        "rows": [
            # 0°N 155°W (lon_e = 205) — headline buoy, depth 150 m, recent
            ["2026-06-22T12:00:00Z", 0.0, 205.0, 150.0, 17.5],
            ["2026-06-21T12:00:00Z", 0.0, 205.0, 150.0, 17.3],
            # 0°N 155°W — baseline window (30-37 days ago)
            ["2026-05-22T12:00:00Z", 0.0, 205.0, 150.0, 16.0],
            ["2026-05-21T12:00:00Z", 0.0, 205.0, 150.0, 16.1],
            # 0°N 140°W (lon_e = 220) — depth 180 m (still in window)
            ["2026-06-22T12:00:00Z", 0.0, 220.0, 180.0, 14.5],
            # 0°N 170°W (lon_e = 190) — depth 140 m (still in window)
            ["2026-06-22T12:00:00Z", 0.0, 190.0, 140.0, 18.7],
            # Off-window depth — dropped at parse time
            ["2026-06-22T12:00:00Z", 0.0, 205.0, 500.0, 8.0],
            # Way-off longitude (Atlantic) — kept at parse, dropped by bucketer
            ["2026-06-22T12:00:00Z", 0.0, 320.0, 150.0, 22.0],
        ],
    },
})

# Synthesised JSON for the "schema drift" test — temperature column
# under an unexpected name. Parser should report empty + warn.
_ERDDAP_JSON_WRONG_SCHEMA = json.dumps({
    "table": {
        "columnNames": ["time", "latitude", "longitude", "depth", "salinity"],
        "columnTypes": ["String", "double", "double", "double", "float"],
        "rows": [
            ["2026-06-22T12:00:00Z", 0.0, 205.0, 150.0, 34.5],
        ],
    },
})

_ERDDAP_GARBAGE = "<html>404 Not Found</html>"


# ── BuoySite ─────────────────────────────────────────────────────────────


def test_buoy_site_longitude_e_converts_negative_lon_to_0_360():
    site = therm.BuoySite("0n155w", 0.0, -155.0, "0°N 155°W", "155W")
    assert site.lon_negative == -155.0
    assert site.longitude_e  == 205.0


def test_buoy_catalog_has_seven_anchor_sites():
    assert len(therm.NDBC_BUOYS) == 7
    assert {s.column for s in therm.NDBC_BUOYS} == {"170W", "155W", "140W"}
    h = next(s for s in therm.NDBC_BUOYS if s.station_id == therm.HEADLINE_STATION_ID)
    assert h.lat == 0.0
    assert h.lon_negative == -155.0


# ── _nearest_site bucketer ───────────────────────────────────────────────


def test_nearest_site_snaps_observations_to_anchor_sites():
    """ERDDAP returns raw buoy positions which may drift slightly
    from the catalog lat/lon (mooring station-keeping isn't perfect).
    ±1.5° lat / ±2.5° lon tolerance covers normal drift without
    misattributing between adjacent anchors."""
    # Exact match: 0°N 155°W (lon_e = 205)
    s = therm._nearest_site(0.0, 205.0)
    assert s is not None and s.station_id == "0n155w"
    # Slight drift, still within tolerance — snaps to same anchor
    s = therm._nearest_site(0.2, 205.7)
    assert s is not None and s.station_id == "0n155w"
    # 0°N 140°W (lon_e = 220)
    s = therm._nearest_site(0.0, 220.0)
    assert s is not None and s.station_id == "0n140w"


def test_nearest_site_drops_observations_far_from_any_anchor():
    """Atlantic observation at lon_e=320 (40°W) is nowhere near any
    of our equatorial Pacific anchors — return None rather than
    misattribute to the nearest (which would be hundreds of km away)."""
    assert therm._nearest_site(0.0, 320.0) is None
    assert therm._nearest_site(45.0, 205.0) is None    # right longitude, wrong lat (45°N)


# ── ERDDAP JSON parser ───────────────────────────────────────────────────


def test_parse_erddap_json_returns_observations_in_depth_window():
    """The parser MUST drop depths outside [130, 200] m — that's the
    Kelvin-wave depth band. A 500 m abyssal reading sneaking through
    would contaminate the per-buoy mean."""
    obs = therm.parse_erddap_json(_ERDDAP_JSON)
    assert all(therm.DEPTH_LOWER_M <= o.depth_m <= therm.DEPTH_UPPER_M for o in obs)
    # 6 in-window rows × 1 dropped (500m) × 1 kept (Atlantic, dropped later by bucketer)
    # = 7 observations make it through the parser.
    assert len(obs) == 7


def test_parse_erddap_json_yields_utc_timestamps():
    obs = therm.parse_erddap_json(_ERDDAP_JSON)
    assert all(o.timestamp.tzinfo is UTC for o in obs)


def test_parse_erddap_json_locates_temperature_column_by_name():
    """ERDDAP datasets across versions call the temp field different
    things (T_25, T_20, T, temperature, WTMP). The picker walks
    the canonical list rather than hardcoding index 4."""
    j = json.dumps({"table": {
        "columnNames": ["time", "latitude", "longitude", "depth", "WTMP"],
        "rows": [["2026-06-22T12:00:00Z", 0.0, 205.0, 150.0, 17.5]],
    }})
    obs = therm.parse_erddap_json(j)
    assert len(obs) == 1
    assert obs[0].temp_c == 17.5


def test_parse_erddap_json_returns_empty_when_no_temperature_column():
    """Defensive: if ERDDAP serves a schema we can't recognise,
    return [] and let the caller surface a clear error rather than
    fabricating values from a salinity column."""
    obs = therm.parse_erddap_json(_ERDDAP_JSON_WRONG_SCHEMA)
    assert obs == []


def test_parse_erddap_json_returns_empty_on_non_json_response():
    """A 404 HTML response from ERDDAP would crash a naive parser.
    json.loads catches it cleanly."""
    obs = therm.parse_erddap_json(_ERDDAP_GARBAGE)
    assert obs == []


# ── analyse_buoy ─────────────────────────────────────────────────────────


def _obs(days_ago: int, temp_c: float, lon_e: float = 205.0, depth_m: float = 150.0):
    return therm.OceanObs(
        timestamp=datetime.now(UTC) - timedelta(days=days_ago),
        lat=0.0, lon_e=lon_e, depth_m=depth_m, temp_c=temp_c,
    )


_SITE = therm.BuoySite("0n155w", 0.0, -155.0, "0°N 155°W", "155W")


def test_analyse_buoy_classifies_warm_kelvin_on_positive_delta():
    obs = (
        [_obs(d, 17.5) for d in range(0, 7)]
        + [_obs(d, 16.0) for d in range(30, 37)]
    )
    a = therm.analyse_buoy(_SITE, obs)
    assert a.recent_7d_mean_c    == 17.5
    assert a.baseline_30d_mean_c == 16.0
    assert a.delta_30d_c         == 1.5
    assert a.kelvin_signal       == "warm-kelvin-wave"


def test_analyse_buoy_classifies_cold_kelvin_on_negative_delta():
    obs = (
        [_obs(d, 15.0) for d in range(0, 7)]
        + [_obs(d, 16.5) for d in range(30, 37)]
    )
    a = therm.analyse_buoy(_SITE, obs)
    assert a.delta_30d_c   == -1.5
    assert a.kelvin_signal == "cold-kelvin-wave"


def test_analyse_buoy_neutral_below_threshold():
    obs = (
        [_obs(d, 16.5) for d in range(0, 7)]
        + [_obs(d, 16.0) for d in range(30, 37)]
    )
    a = therm.analyse_buoy(_SITE, obs)
    assert a.kelvin_signal == "neutral"


def test_analyse_buoy_no_data_when_baseline_missing():
    """5 days of recent obs + nothing else → can't compute the
    30-day delta. Return 'no-data' rather than fire a spurious alert."""
    a = therm.analyse_buoy(_SITE, [_obs(d, 17.0) for d in range(0, 5)])
    assert a.delta_30d_c   is None
    assert a.kelvin_signal == "no-data"


def test_analyse_buoy_empty_input():
    a = therm.analyse_buoy(_SITE, [])
    assert a.obs_count     == 0
    assert a.latest        is None
    assert a.kelvin_signal == "no-data"


# ── proxy config + fetch ─────────────────────────────────────────────────


def test_proxy_env_returns_none_for_missing_or_empty(monkeypatch):
    """The workflow runs `--write` even when the proxy env vars
    aren't set yet (operator forgot to wire up secrets). The fetcher
    should detect that cleanly via _proxy_env returning Nones, exit
    with code 2, and NOT crash."""
    monkeypatch.delenv("ERDDAP_PROXY_BASE",   raising=False)
    monkeypatch.delenv("ERDDAP_PROXY_SECRET", raising=False)
    assert therm._proxy_env() == (None, None)
    monkeypatch.setenv("ERDDAP_PROXY_BASE",   "  ")
    monkeypatch.setenv("ERDDAP_PROXY_SECRET", "")
    assert therm._proxy_env() == (None, None)


def test_proxy_env_returns_both_when_set(monkeypatch):
    monkeypatch.setenv("ERDDAP_PROXY_BASE",   "https://erddap-proxy.test.workers.dev")
    monkeypatch.setenv("ERDDAP_PROXY_SECRET", "secret-x")
    assert therm._proxy_env() == ("https://erddap-proxy.test.workers.dev", "secret-x")


def test_build_tabledap_query_includes_lat_lon_depth_and_time_constraints():
    """ERDDAP tabledap constraints are URL-appended as ?col>=val&col<=val
    — not key=value params. The query string the proxy forwards should
    cover all four filters (lat, lon, depth, time) so the upstream
    returns only the few KB we actually need."""
    q = therm._build_tabledap_query("pmelTaoMonT", "2024-01-01")
    assert q.startswith("pmelTaoMonT.json?")
    assert "latitude>=" in q and "latitude<=" in q
    assert "longitude>=" in q and "longitude<=" in q
    assert "depth>=130" in q and "depth<=200" in q
    assert "time>=2024-01-01" in q


# ── payload assembly ─────────────────────────────────────────────────────


def test_build_payload_emits_stable_seven_buoy_layout():
    """Even buoys with zero observations get a slot — frontend layout
    stays consistent across runs (offline buoy shows 'no-data' in
    its card slot, doesn't disappear)."""
    analyses = [therm.analyse_buoy(s, []) for s in therm.NDBC_BUOYS]
    doc = therm.build_payload(analyses, "pmelTaoMonT")
    assert len(doc["thermocline"]["buoys"]) == 7
    assert doc["thermocline"]["dataset_id"] == "pmelTaoMonT"


def test_build_payload_surfaces_headline_buoy():
    obs = (
        [_obs(d, 18.0) for d in range(0, 7)]
        + [_obs(d, 16.0) for d in range(30, 37)]
    )
    analyses = []
    for site in therm.NDBC_BUOYS:
        if site.station_id == therm.HEADLINE_STATION_ID:
            analyses.append(therm.analyse_buoy(site, obs))
        else:
            analyses.append(therm.analyse_buoy(site, []))
    doc = therm.build_payload(analyses, "pmelTaoMonT")
    h = doc["thermocline"]["headline"]
    assert h["station_id"]    == "0n155w"
    assert h["lat"]           == 0.0
    assert h["lon"]           == -155.0
    assert h["delta_30d_c"]   == 2.0
    assert h["kelvin_signal"] == "warm-kelvin-wave"
    assert "4–6 weeks" in h["reading"]


def test_build_payload_carries_lat_lon_for_map_pins():
    """The risk map's buoy overlay layer reads `lat`/`lon` directly
    from each buoy slot — no separate coordinate lookup table."""
    analyses = [therm.analyse_buoy(s, []) for s in therm.NDBC_BUOYS]
    doc = therm.build_payload(analyses, None)
    for b in doc["thermocline"]["buoys"]:
        assert "lat" in b and "lon" in b
        assert -5 <= b["lat"] <=  5
        assert -180 <= b["lon"] <= -130
