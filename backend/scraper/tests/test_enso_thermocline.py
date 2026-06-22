"""Tests for the Phase 3 TAO/TRITON thermocline fetcher. Network paths
out of scope as usual; parsers exercise against fixture CSV mirroring
the ERDDAP tabledap response format."""
from __future__ import annotations

from scraper.sources import enso_thermocline as therm

# Real-shape ERDDAP tabledap CSV. Header row + units row + data rows.
# Five longitudes × multiple months. Includes:
#   • A non-equatorial latitude row (should be filtered by the URL,
#     not the parser — but if it leaks through we should still
#     classify by nearest site)
#   • A longitude outside our anchor set (235 = ~125°W) — should be
#     dropped by _nearest_site (>15° from any anchor)
#   • Multiple depths within the 140-180 m window (parser keeps both).
_ERDDAP_CSV = """\
time,latitude,longitude,depth,T_25
UTC,degrees_north,degrees_east,m,degree_C
2024-01-15T12:00:00Z,0.0,165.0,140.0,21.5
2024-02-15T12:00:00Z,0.0,165.0,140.0,21.8
2024-03-15T12:00:00Z,0.0,165.0,140.0,22.0
2024-04-15T12:00:00Z,0.0,165.0,140.0,22.2
2024-05-15T12:00:00Z,0.0,165.0,140.0,22.4
2024-06-15T12:00:00Z,0.0,165.0,140.0,22.5
2024-07-15T12:00:00Z,0.0,165.0,140.0,22.4
2024-08-15T12:00:00Z,0.0,165.0,140.0,22.2
2024-09-15T12:00:00Z,0.0,165.0,140.0,22.0
2024-10-15T12:00:00Z,0.0,165.0,140.0,21.8
2024-11-15T12:00:00Z,0.0,165.0,140.0,21.6
2024-12-15T12:00:00Z,0.0,165.0,140.0,21.5
2025-01-15T12:00:00Z,0.0,165.0,140.0,22.5
2026-05-15T12:00:00Z,0.0,165.0,140.0,23.7
2026-05-15T12:00:00Z,0.0,180.0,180.0,21.0
2026-05-15T12:00:00Z,0.0,190.0,140.0,17.5
2026-05-15T12:00:00Z,0.0,220.0,180.0,18.5
2026-05-15T12:00:00Z,0.0,250.0,140.0,14.5
2026-05-15T12:00:00Z,0.0,235.0,140.0,15.5
"""


# ── _nearest_site ──────────────────────────────────────────────────────────


def test_nearest_site_buckets_within_15_degrees():
    """Each TAO measurement comes in with the exact buoy longitude
    (165, 180, 190, 220, 250). We bucket them ±15° so future TAO
    mooring shifts don't drop our coverage."""
    assert therm._nearest_site(165.0) == (165.0, "165°E")
    assert therm._nearest_site(170.0) == (165.0, "165°E")     # within tolerance
    assert therm._nearest_site(220.0) == (220.0, "140°W")     # headline buoy
    assert therm._nearest_site(250.0) == (250.0, "110°W")


def test_nearest_site_returns_none_when_far_from_all_anchors():
    """A buoy at 235°E (~125°W) is between 110°W (250) and 140°W (220),
    >15° from each. Drop rather than misattribute."""
    assert therm._nearest_site(235.0) is None
    assert therm._nearest_site(  0.0) is None     # Atlantic — not us
    assert therm._nearest_site(300.0) is None     # off the eastern edge


# ── column resolution ──────────────────────────────────────────────────────


def test_pick_temp_column_finds_t25():
    header = ["time", "latitude", "longitude", "depth", "T_25"]
    assert therm._pick_temp_column(header) == 4


def test_pick_temp_column_falls_back_to_variant_names():
    """Different ERDDAP datasets call the same field different names —
    T_25 (most common), T_20, T, temperature. The picker tries the
    canonical list, then falls back to any column starting with 't'."""
    assert therm._pick_temp_column(["time", "depth", "T_20"])        == 2
    assert therm._pick_temp_column(["time", "depth", "temperature"]) == 2
    assert therm._pick_temp_column(["time", "depth", "T"])           == 2
    # No temperature-shaped column at all → None.
    assert therm._pick_temp_column(["time", "depth", "salinity"])    is None


# ── CSV parsing ────────────────────────────────────────────────────────────


def test_parse_erddap_csv_skips_units_row_and_keeps_data_rows():
    samples = therm.parse_erddap_csv(_ERDDAP_CSV)
    # 14 monthly samples at 165°E + 4 May-2026 samples at the
    # other 4 anchors = 18 samples. The 235°E row (not within ±15°
    # of any anchor) is dropped — that's why it's 18, not 19.
    assert len(samples) == 18


def test_parse_erddap_csv_drops_longitudes_outside_anchor_buckets():
    samples = therm.parse_erddap_csv(_ERDDAP_CSV)
    # No sample at 235°E (the off-anchor measurement) should survive.
    assert not any(abs(s.longitude_e - 235.0) < 1 for s in samples)


def test_parse_erddap_csv_yields_month_string_not_full_iso():
    """ERDDAP serves time as 2024-01-15T12:00:00Z. We're doing monthly
    aggregation so the day-of-month is noise — strip to YYYY-MM."""
    samples = therm.parse_erddap_csv(_ERDDAP_CSV)
    assert all(len(s.month) == 7 and s.month[4] == "-" for s in samples)
    assert samples[0].month == "2024-01"


def test_parse_erddap_csv_returns_empty_for_unrecognised_schema():
    """If ERDDAP drifts to a schema where no temperature column is
    findable, we return [] rather than guessing. Caller treats that
    as a parser failure and tells the operator to re-run with --diag."""
    bad = (
        "time,latitude,longitude,depth,salinity\n"
        "UTC,degrees_north,degrees_east,m,psu\n"
        "2024-01-15T12:00:00Z,0.0,220.0,150.0,34.5\n"
    )
    assert therm.parse_erddap_csv(bad) == []


# ── anomaly enrichment ────────────────────────────────────────────────────


def test_enrich_with_anomalies_uses_trailing_12_month_baseline():
    """Anomaly = current temp - mean of the previous 12 months at the
    same site. Demonstrates with the 165°E series:
      • 12 months Jan-Dec 2024 average to ~22.0 °C (the sample's
        intentional sine-wave pattern). The Jan 2025 reading of 22.5
        gives anomaly ≈ +0.5 °C.
      • The May 2026 reading of 23.7 jumps above the trailing window's
        mean for a strong positive anomaly."""
    samples = therm.parse_erddap_csv(_ERDDAP_CSV)
    therm._enrich_with_anomalies(samples)
    s165 = sorted(
        (s for s in samples if s.longitude_e == 165.0),
        key=lambda s: s.month,
    )
    # First 6 samples can't have an anomaly (insufficient baseline).
    assert all(s.temp_anomaly_c is None for s in s165[:6])
    # Jan 2025 — 12 months of baseline available → anomaly computed.
    jan_25 = next(s for s in s165 if s.month == "2025-01")
    assert jan_25.temp_anomaly_c is not None
    # Trailing 12 mean was the 2024 sine wave averaging ~21.99 → +0.51 ish.
    assert 0.3 <= jan_25.temp_anomaly_c <= 0.7


def test_enrich_with_anomalies_does_not_cross_sites():
    """Each site computes its own baseline. A 165°E history must NOT
    contribute to a 140°W anomaly — they're 55° of longitude apart
    and at very different absolute temperatures (warm pool vs cold tongue)."""
    samples = therm.parse_erddap_csv(_ERDDAP_CSV)
    therm._enrich_with_anomalies(samples)
    # The lone May-2026 sample at 140°W (220°E) has no prior history
    # in this fixture, so its anomaly should be None — proves we're
    # not leaking baseline from 165°E.
    s140w = next(s for s in samples if abs(s.longitude_e - 220.0) < 0.1)
    assert s140w.temp_anomaly_c is None


# ── Kelvin classification ─────────────────────────────────────────────────


def test_classify_kelvin_applies_threshold_bands():
    assert therm._classify_kelvin( 1.5) == "warm-kelvin-wave"
    assert therm._classify_kelvin( 1.0) == "warm-kelvin-wave"   # boundary
    assert therm._classify_kelvin( 0.4) == "neutral"
    assert therm._classify_kelvin(-1.0) == "cold-kelvin-wave"
    assert therm._classify_kelvin(-2.1) == "cold-kelvin-wave"
    assert therm._classify_kelvin(None) == "unknown"


# ── payload assembly ──────────────────────────────────────────────────────


def test_build_payload_surfaces_headline_buoy_and_per_site_snapshot():
    samples = therm.parse_erddap_csv(_ERDDAP_CSV)
    therm._enrich_with_anomalies(samples)
    doc = therm.build_payload(samples, "pmelTaoMonT")
    t = doc["thermocline"]
    assert t["winning_dataset"] == "pmelTaoMonT"
    assert t["depth_m"]         == 150
    # Headline buoy = 0°N 140°W = longitude 220.
    assert t["headline_buoy"]["longitude_e"] == 220.0
    assert t["headline_buoy"]["label"]       == "0°N 140°W"
    # by_site has exactly 5 entries — one per anchor — even if some
    # sites have no data (graceful empty card vs. silent gap).
    assert len(t["by_site"]) == 5
    site_lons = [s["longitude_e"] for s in t["by_site"]]
    assert site_lons == [165.0, 180.0, 190.0, 220.0, 250.0]


def test_build_payload_classifies_kelvin_signal_on_headline_latest():
    """When the latest 140°W reading shows an anomaly above the
    +1.0 °C threshold, the headline_buoy.kelvin_signal must say
    'warm-kelvin-wave' — that's the alert the UI fires."""
    # Synthesise a buoy series with a clear warming ramp at 220°E.
    samples = [
        therm.ThermoclineSample(month=f"2025-{m:02d}", longitude_e=220.0,
                                site_label="140°W", depth_m=150.0,
                                temp_c=18.0, temp_anomaly_c=None)
        for m in range(1, 13)
    ]
    # Add a late spike — May 2026 at +20.0 °C (huge warm anomaly).
    samples.append(
        therm.ThermoclineSample(month="2026-05", longitude_e=220.0,
                                site_label="140°W", depth_m=150.0,
                                temp_c=20.0, temp_anomaly_c=None)
    )
    therm._enrich_with_anomalies(samples)
    doc = therm.build_payload(samples, "pmelTaoMonT")
    latest = doc["thermocline"]["headline_buoy"]["latest"]
    assert latest["month"] == "2026-05"
    assert latest["temp_anomaly_c"] == 2.0
    assert latest["kelvin_signal"]  == "warm-kelvin-wave"


def test_build_payload_handles_empty_input():
    doc = therm.build_payload([], None)
    assert doc["thermocline"]["winning_dataset"] is None
    assert doc["thermocline"]["headline_buoy"]["latest"]["temp_c"] is None
    assert doc["thermocline"]["headline_buoy"]["latest"]["kelvin_signal"] == "unknown"
    assert doc["thermocline"]["headline_buoy"]["monthly"] == []
    # by_site still has 5 placeholder entries — one per anchor.
    assert len(doc["thermocline"]["by_site"]) == 5
    assert all(s["temp_c"] is None for s in doc["thermocline"]["by_site"])


# ── fetch-fallback resilience ─────────────────────────────────────────────


def test_fetch_first_ok_walks_dataset_candidates(monkeypatch):
    seen: list[str] = []
    def fake_fetch(url, *, timeout=60):
        seen.append(url)
        return "fake csv" if "pmelTaoMonT" in url else None
    monkeypatch.setattr(therm, "_fetch", fake_fetch)
    text, ds = therm._fetch_first_ok(["pmelTaoDyT", "pmelTaoMonT", "pmelTaoMonsT"])
    assert text == "fake csv"
    assert ds   == "pmelTaoMonT"
    # The third candidate was never probed.
    assert len(seen) == 2


def test_fetch_first_ok_returns_none_when_all_candidates_fail(monkeypatch):
    monkeypatch.setattr(therm, "_fetch", lambda url, **_: None)
    text, ds = therm._fetch_first_ok(["a", "b"])
    assert text is None
    assert ds   is None
