"""Tests for the v5 ERDDAP-via-CF-Worker thermocline fetcher.
Network paths out of scope; parsers exercise against fixture
JSON mirroring ERDDAP tabledap's response shape."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

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
            # 0°N 140°W (lon_e = 220) — depth 160 m (upper edge of window)
            ["2026-06-22T12:00:00Z", 0.0, 220.0, 160.0, 14.5],
            # 0°N 170°W (lon_e = 190) — depth 140 m (lower edge of window)
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


def test_buoy_catalog_covers_full_tao_triton_array():
    """3 latitudes (2°N / 0°N / 2°S — Niño 3.4 inner core) × 8 longitudes
    (165°E through 95°W — 156°E TRITON sites were decommissioned and
    returned no PFEG data, so the column was dropped) = 24 anchor
    sites. Headline is dead-center."""
    assert len(therm.NDBC_BUOYS) == 24
    assert {s.column for s in therm.NDBC_BUOYS} == {
        "165E", "180", "170W", "155W", "140W", "125W", "110W", "95W",
    }
    assert {s.lat for s in therm.NDBC_BUOYS} == {2.0, 0.0, -2.0}
    h = next(s for s in therm.NDBC_BUOYS if s.station_id == therm.HEADLINE_STATION_ID)
    assert h.lat == 0.0
    assert h.lon_negative == -155.0


def test_column_order_w_to_e_runs_asia_to_americas():
    """West-to-east order so the card grid reads like a map: Asia-side
    columns leftmost (lower east-degrees), Americas-side rightmost."""
    expected = ("165E", "180", "170W", "155W", "140W", "125W", "110W", "95W")
    assert therm.COLUMN_ORDER_W_TO_E == expected


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
    """The parser MUST drop depths outside the configured band — that's
    the Kelvin-wave depth band around 150 m. A 500 m abyssal reading
    sneaking through would contaminate the per-buoy mean."""
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
    assert a.window_min_c  is None
    assert a.window_max_c  is None


def test_analyse_buoy_records_window_min_max():
    """min/max over the fetched window let the card show where today's
    reading sits inside the recent envelope (range bar visualization).
    Anything inside the obs list counts — we don't filter for a sub-
    window, the bar reflects everything we asked ERDDAP for."""
    obs = [_obs(0, 19.5), _obs(10, 18.0), _obs(20, 21.2), _obs(40, 17.4)]
    a = therm.analyse_buoy(_SITE, obs)
    assert a.window_min_c == 17.4
    assert a.window_max_c == 21.2
    # And single-obs case → min == max.
    a1 = therm.analyse_buoy(_SITE, [_obs(0, 20.0)])
    assert a1.window_min_c == 20.0 == a1.window_max_c


# ── proxy config + fetch ─────────────────────────────────────────────────


def test_proxy_env_returns_none_for_missing_or_empty(monkeypatch):
    """The workflow runs `--write` even when the proxy env vars
    aren't set yet (operator forgot to wire up secrets). The fetcher
    should detect that cleanly via _proxy_env returning Nones, exit
    with code 2, and NOT crash."""
    for var in ("ERDDAP_PROXY_BASE", "ERDDAP_PROXY_SECRET"):
        monkeypatch.delenv(var, raising=False)
    assert therm._proxy_env() == (None, None)
    monkeypatch.setenv("ERDDAP_PROXY_BASE",   "  ")
    monkeypatch.setenv("ERDDAP_PROXY_SECRET", "")
    assert therm._proxy_env() == (None, None)


def test_proxy_env_returns_both_when_set(monkeypatch):
    monkeypatch.setenv("ERDDAP_PROXY_BASE",   "https://noaa-proxy.test.workers.dev")
    monkeypatch.setenv("ERDDAP_PROXY_SECRET", "secret-x")
    assert therm._proxy_env() == ("https://noaa-proxy.test.workers.dev", "secret-x")


class _StubResp:
    def __init__(self, status: int, text: str = ""):
        self.status_code = status
        self.text = text


def test_fetch_via_proxy_retries_once_on_5xx(monkeypatch):
    """PFEG is intermittently slow → CF Worker returns 522. A single
    retry after a short backoff catches the transient case (same
    dataset that timed out at T often serves in <3s at T+10s) without
    blowing the workflow's overall budget. Two attempts max."""
    responses = iter([_StubResp(522, "timeout"), _StubResp(200, '{"table":{}}')])
    sleeps: list[float] = []
    monkeypatch.setattr(therm.requests, "get", lambda *a, **k: next(responses))
    monkeypatch.setattr(therm.time, "sleep", sleeps.append)
    text, status = therm._fetch_via_proxy(
        "https://noaa-proxy.test.workers.dev", "s", "pmelTaoDyT.json?&time>=2024-01-01",
    )
    assert status == 200
    assert text == '{"table":{}}'
    assert sleeps == [10]


def test_fetch_via_proxy_does_not_retry_on_4xx(monkeypatch):
    """4xx is a "wrong dataset / bad request" signal, not a transient
    upstream blip. Don't burn a retry on it — fall through immediately
    so the caller can try the next dataset candidate."""
    calls = {"n": 0}

    def fake_get(*a, **k):
        calls["n"] += 1
        return _StubResp(404, "not found")

    monkeypatch.setattr(therm.requests, "get", fake_get)
    monkeypatch.setattr(therm.time, "sleep", lambda _: pytest.fail("should not sleep"))
    text, status = therm._fetch_via_proxy(
        "https://noaa-proxy.test.workers.dev", "s", "pmelTaoMonsT.json?&time>=2024-01-01",
    )
    assert status == 404
    assert calls["n"] == 1


def test_build_tabledap_query_includes_lat_lon_depth_and_time_constraints():
    """ERDDAP tabledap constraints are URL-appended as ?col>=val&col<=val
    — not key=value params. The query string the proxy forwards should
    cover all four filters (lat, lon, depth, time) so the upstream
    returns only the few KB we actually need."""
    q = therm._build_tabledap_query("pmelTaoMonT", "2024-01-01")
    assert q.startswith("pmelTaoMonT.json?")
    assert "latitude>=" in q and "latitude<=" in q
    assert "longitude>=" in q and "longitude<=" in q
    assert f"depth>={therm.DEPTH_LOWER_M}" in q and f"depth<={therm.DEPTH_UPPER_M}" in q
    assert "time>=2024-01-01" in q


# ── payload assembly ─────────────────────────────────────────────────────


def test_build_payload_emits_stable_full_array_layout():
    """Every BuoySite gets a slot, even ones with zero observations —
    frontend layout stays consistent across runs (an offline buoy
    shows 'no-data' in its grid cell instead of disappearing)."""
    analyses = [therm.analyse_buoy(s, []) for s in therm.NDBC_BUOYS]
    doc = therm.build_payload(analyses, "pmelTaoMonT")
    assert len(doc["thermocline"]["buoys"]) == len(therm.NDBC_BUOYS)
    assert doc["thermocline"]["dataset_id"] == "pmelTaoMonT"


def test_build_payload_includes_west_to_east_longitude_order():
    """Frontend reads longitude_order straight from the payload to lay
    out the mini-map without re-deriving geographic order from labels."""
    analyses = [therm.analyse_buoy(s, []) for s in therm.NDBC_BUOYS]
    doc = therm.build_payload(analyses, "pmelTaoMonT")
    order = doc["thermocline"]["longitude_order"]
    assert order == list(therm.COLUMN_ORDER_W_TO_E)
    # And that order really is west-to-east (low east-degrees first).
    east_degrees = [
        min(s.longitude_e for s in therm.NDBC_BUOYS if s.column == c)
        for c in order
    ]
    assert east_degrees == sorted(east_degrees)


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
    from each buoy slot — no separate coordinate lookup table. lons
    are in Leaflet's -180..+180 convention (positive for east of
    Greenwich, negative for west)."""
    analyses = [therm.analyse_buoy(s, []) for s in therm.NDBC_BUOYS]
    doc = therm.build_payload(analyses, None)
    for b in doc["thermocline"]["buoys"]:
        assert "lat" in b and "lon" in b
        assert -5 <= b["lat"] <=  5
        # Spans 156°E (positive) through 95°W (negative) — the full
        # operational TAO/TRITON array.
        assert -180 <= b["lon"] <= 180


# ── staleness-tolerant fetch-failure exit code ───────────────────────────


def _write_json_with_age(tmp_path, monkeypatch, *, days_old: float | None):
    """Point therm.OUT_PATH at a temp file. days_old=None → no file
    on disk (simulates a never-yet-populated pipeline)."""
    out = tmp_path / "enso_thermocline.json"
    monkeypatch.setattr(therm, "OUT_PATH", out)
    if days_old is not None:
        ts = datetime.now(UTC) - timedelta(days=days_old)
        out.write_text(json.dumps({"scraped_at": ts.isoformat()}))
    return out


def test_fetch_failure_soft_skips_when_data_fresh(tmp_path, monkeypatch):
    """A transient PFEG outage with a still-fresh committed JSON is a
    no-op (exit 3) — TAO daily data lags ~3 weeks so nothing is lost,
    and we don't want a Telegram alert for every upstream hiccup."""
    _write_json_with_age(tmp_path, monkeypatch, days_old=2.0)
    assert therm._fetch_failure_exit_code("upstream 522") == 3


def test_fetch_failure_escalates_when_data_stale(tmp_path, monkeypatch):
    """If we haven't refreshed in > STALE_AFTER_DAYS, the pipeline is
    genuinely broken (not just a bad morning) — escalate to exit 1 so
    the workflow alerts."""
    _write_json_with_age(tmp_path, monkeypatch, days_old=therm.STALE_AFTER_DAYS + 1)
    assert therm._fetch_failure_exit_code("upstream 522") == 1


def test_fetch_failure_escalates_when_data_missing(tmp_path, monkeypatch):
    """No committed JSON at all = the pipeline never succeeded; a fetch
    failure here is a real failure worth alerting on (exit 1)."""
    _write_json_with_age(tmp_path, monkeypatch, days_old=None)
    assert therm._fetch_failure_exit_code("upstream 522") == 1


def test_fetch_failure_boundary_is_inclusive(tmp_path, monkeypatch):
    """Exactly at the threshold counts as still-fresh (≤, not <) so the
    boundary day doesn't flip to an alert."""
    _write_json_with_age(tmp_path, monkeypatch, days_old=therm.STALE_AFTER_DAYS - 0.01)
    assert therm._fetch_failure_exit_code("upstream 522") == 3


# ── archive (date-keyed per-buoy temperature history) ─────────────────────


def _day(days_ago: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).strftime("%Y-%m-%d")


def test_build_tabledap_query_adds_upper_bound_when_end_date_given():
    """The backfill fetches bounded year-chunks; end_date adds the upper
    time constraint so each chunk is small. Daily run omits it."""
    q = therm._build_tabledap_query("pmelTaoDyT", "2010-01-01", "2010-12-31")
    assert "time>=2010-01-01" in q and "time<=2010-12-31" in q
    q2 = therm._build_tabledap_query("pmelTaoDyT", "2010-01-01")
    assert "time<=" not in q2


def test_obs_to_daily_means_collapses_depths_and_drops_unmapped():
    """Multiple in-window depths on one (buoy, day) average to a single
    150 m-band value; obs that don't snap to an anchor site are dropped."""
    obs = [
        _obs(0, 18.0, lon_e=205.0, depth_m=140.0),   # 0n155w, today
        _obs(0, 20.0, lon_e=205.0, depth_m=160.0),   # 0n155w, today (other depth)
        _obs(1, 19.0, lon_e=205.0, depth_m=150.0),   # 0n155w, yesterday
        _obs(0, 25.0, lon_e=320.0, depth_m=150.0),   # Atlantic — unmapped, dropped
    ]
    daily = therm._obs_to_daily_means(obs)
    assert set(daily.keys()) == {"0n155w"}
    assert daily["0n155w"][_day(0)] == 19.0   # mean(18, 20)
    assert daily["0n155w"][_day(1)] == 19.0


def test_merge_into_archive_latest_fetch_wins():
    """PMEL revises values over time; a re-fetch of the same (buoy, day)
    overwrites. Returns the count of cells written."""
    archive = therm._empty_archive()
    n1 = therm._merge_into_archive(archive, {"0n155w": {"2026-01-01": 18.0}})
    n2 = therm._merge_into_archive(archive, {"0n155w": {"2026-01-01": 18.5,
                                                        "2026-01-02": 19.0}})
    assert n1 == 1 and n2 == 2
    assert archive["buoys"]["0n155w"]["2026-01-01"] == 18.5   # corrected
    assert archive["buoys"]["0n155w"]["2026-01-02"] == 19.0


def test_trim_archive_drops_dates_past_retention():
    archive = therm._empty_archive()
    old = (datetime.now(UTC) - timedelta(days=therm.ARCHIVE_RETENTION_DAYS + 30)).strftime("%Y-%m-%d")
    archive["buoys"]["0n155w"] = {old: 18.0, _day(1): 19.0}
    dropped = therm._trim_archive(archive)
    assert dropped == 1
    assert old not in archive["buoys"]["0n155w"]
    assert _day(1) in archive["buoys"]["0n155w"]


def test_analyse_from_archive_climatology_spans_full_history():
    """Range bar (window_min/max) must reflect the buoy's WHOLE archived
    history, while Δ-30d is computed only from the recent snapshot window.
    A years-old extreme should set the climatology floor even though it's
    far outside the Δ-30d window."""
    archive = therm._empty_archive()
    series = {}
    # Recent: last 7 days warm (~20), 30-37 days ago cooler (~17) → +Δ30d.
    for d in range(0, 7):
        series[_day(d)] = 20.0
    for d in range(30, 37):
        series[_day(d)] = 17.0
    # A years-old cold extreme — outside the 75-day window, inside history.
    series[_day(900)] = 9.5
    archive["buoys"]["0n155w"] = series

    analyses = {a.site.station_id: a for a in therm._analyse_from_archive(archive)}
    a = analyses["0n155w"]
    assert a.delta_30d_c == 3.0                # 20 − 17, from recent window only
    assert a.kelvin_signal == "warm-kelvin-wave"
    assert a.window_min_c == 9.5               # climatology floor from full history
    assert a.window_max_c == 20.0
    # A buoy with no archive series degrades to no-data, not a crash.
    assert analyses["2n95w"].kelvin_signal == "no-data"


def test_run_writes_snapshot_and_archive_end_to_end(tmp_path, monkeypatch):
    """Full daily-run path with the network stubbed: a fetched window is
    merged into the archive, then BOTH the public snapshot and the
    archive file are written. Re-running merges (doesn't clobber)."""
    monkeypatch.setattr(therm, "OUT_PATH", tmp_path / "snap.json")
    monkeypatch.setattr(therm, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(therm, "_proxy_env", lambda: ("https://x.workers.dev", "s"))

    # Stub the network: return a span of synthetic obs for the headline
    # buoy (0n155w → lon_e 205) covering both Δ-30d windows.
    obs = [_obs(d, 20.0) for d in range(0, 7)] + [_obs(d, 17.0) for d in range(30, 37)]
    monkeypatch.setattr(
        therm, "_fetch_window",
        lambda *a, **k: (obs, "pmelTaoDyT", None),
    )

    rc = therm.run(write=True)
    assert rc == 0
    assert (tmp_path / "snap.json").exists()
    assert (tmp_path / "archive.json").exists()

    snap = json.loads((tmp_path / "snap.json").read_text())
    assert len(snap["thermocline"]["buoys"]) == len(therm.NDBC_BUOYS)
    head = snap["thermocline"]["headline"]
    assert head["station_id"] == "0n155w"
    assert head["kelvin_signal"] == "warm-kelvin-wave"

    archive = json.loads((tmp_path / "archive.json").read_text())
    assert "0n155w" in archive["buoys"]
    assert len(archive["buoys"]["0n155w"]) == 14   # 7 recent + 7 baseline days
