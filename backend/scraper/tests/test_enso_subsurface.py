"""Tests for the NOAA WWV (Warm Water Volume) fetcher — the Phase 2
subsurface heat indicator. Network fetch is out of scope; parsers
exercise against fixture text in both NOAA layouts (year-matrix and
flat YYYYMM)."""
from __future__ import annotations

from scraper.sources import enso_subsurface as wwv

# Year-matrix layout — PSL/NCAR convention. Each row: YEAR followed
# by 12 monthly columns. Includes a header `1980 2025` integer line
# that the parser must skip, a couple of real years, and a row with
# the -999.9 missing sentinel partway through (typical for the
# current/incomplete year).
_YEAR_MATRIX_SAMPLE = """\
   1980 2025
1980    -0.50  -0.30   0.10   0.20   0.40   0.70   1.10   1.40   1.50   1.30   1.00   0.60
2025     2.30   2.50   2.40   2.10   1.80   1.40   1.00   0.60   0.20  -0.10  -0.30  -0.50
2026     0.20   0.60   1.10   1.40   1.80-999.9 -999.9 -999.9 -999.9 -999.9 -999.9 -999.9
"""

# Flat YYYYMM layout — PMEL convention from the live wwv.dat fetched
# on 22 Jun 2026. Each data row: `YYYYMM   VOLUME   ANOMALY` in
# scientific notation. The volume column is ~2.6 × 10^16 m³ (slowly
# drifting absolute total); the anomaly column is the trader signal.
# Threshold ±1.0 × 10^14 m³ matches PMEL's published charts after
# the anomaly is divided by 1e14.
_FLAT_SAMPLE = """\
Warm Water Volume (m**3,5N-5S,120E-80W)
GTMBA Project Office/NOAA/PMEL/Seattle

 date     Volume       Anomaly
198001 0.2609619E+16 0.8121139E+14
198002 0.2574077E+16 0.9472282E+14
202604 0.2714248E+16 0.2838388E+15
202605 0.2671554E+16 0.2700635E+15
"""


# ── parsers ─────────────────────────────────────────────────────────────────


def test_parse_year_matrix_emits_one_row_per_month_with_sentinels_dropped():
    rows = wwv.parse_wwv_year_matrix(_YEAR_MATRIX_SAMPLE)
    # 1980 = 12 + 2025 = 12 + 2026 = 5 (months 6-12 are -999.9, dropped).
    assert len(rows) == 29
    months = [r.month for r in rows]
    assert months == sorted(months)
    # First row: 1980-01 = -0.5
    assert rows[0].month == "1980-01"
    assert rows[0].wwv_anomaly == -0.5
    # Header line `1980 2025` must NOT have produced a row.
    assert all(r.month != "1980-19" for r in rows)
    # 2026 sentinel-filled tail: only Jan-May made it through.
    rows_2026 = [r.month for r in rows if r.month.startswith("2026")]
    assert rows_2026 == ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]


def test_parse_year_matrix_handles_fused_negative_numbers():
    """Same defensive contract as enso_indices v3 — NOAA's fixed-width
    files fuse negative numbers with adjacent fields when the SST
    column is positive but SSTA is negative. WWV files have the same
    failure mode; the parser walks signed-decimals via re.findall."""
    # `2.30-999.9` would split into ['2.30', '-999.9'] via re.findall
    # but `.split()` would yield 1 token.
    text = "2026     1.80-999.9-999.9-999.9-999.9-999.9-999.9-999.9-999.9-999.9-999.9-999.9\n"
    rows = wwv.parse_wwv_year_matrix(text)
    assert len(rows) == 1
    assert rows[0].month == "2026-01"
    assert rows[0].wwv_anomaly == 1.8
    # Remaining 11 sentinels filtered, no spurious rows.


def test_parse_flat_yyyymm_layout_picks_anomaly_column_and_normalizes_units():
    """The PMEL wwv.dat serves YYYYMM | VOLUME | ANOMALY in
    scientific notation (real format captured from the v2 dispatch).
    v3 must:
      • Pick column 3 (anomaly), not column 2 (volume) — the v2
        parser shipped +0.27 instead of +2.70 because it grabbed
        the wrong column AND truncated the exponent.
      • Parse scientific notation (`0.2700635E+15`).
      • Divide by 1e14 to land in the trader-convention units
        (so the ±1.0 threshold matches PMEL's published charts)."""
    rows = wwv.parse_wwv_yyyymm_flat(_FLAT_SAMPLE)
    assert len(rows) == 4
    # 1980-01: anomaly = 0.8121139E+14 / 1e14 = 0.812
    assert rows[0].month       == "1980-01"
    assert rows[0].wwv_anomaly == 0.812
    # 2026-05: anomaly = 0.2700635E+15 / 1e14 = 2.701 (strong El Niño signal)
    assert rows[-1].month      == "2026-05"
    assert rows[-1].wwv_anomaly == 2.701


def test_signed_decimal_re_matches_scientific_notation():
    """Regression guard for the v2 truncation bug — `0.2700635E+15`
    must round-trip as the float 2.700635e+14, not 0.2700635."""
    matches = wwv._SIGNED_DECIMAL_RE.findall("0.2671554E+16 0.2700635E+15")
    assert matches == ["0.2671554E+16", "0.2700635E+15"]
    assert float(matches[1]) == 2.700635e+14


def test_parse_wwv_picks_strategy_with_more_rows():
    """The orchestrator tries BOTH layouts and uses whichever produces
    more rows — NOAA serves WWV in either format depending on which
    mirror URL won the candidate race. The wrong layout returns near-
    zero rows; the right one returns the full series."""
    # Year-matrix sample has 29 rows; flat sample fed through the
    # year-matrix parser returns 0 (no year prefix in flat lines).
    rows_via_orchestrator = wwv.parse_wwv(_YEAR_MATRIX_SAMPLE)
    assert len(rows_via_orchestrator) == 29
    # Reverse direction — flat fixture should pick the flat parser.
    rows_flat = wwv.parse_wwv(_FLAT_SAMPLE)
    assert len(rows_flat) == 4


# ── lead-signal classification ─────────────────────────────────────────────


def test_lead_signal_thresholds():
    """The trader signal: |WWV anomaly| > 1.0 historically precedes
    a Niño 3.4 surface event of the same sign within 4-6 months."""
    assert wwv._lead_signal( 2.3) == "el-nino-pending"
    assert wwv._lead_signal( 1.0) == "el-nino-pending"   # boundary
    assert wwv._lead_signal( 0.4) == "neutral"
    assert wwv._lead_signal(-1.0) == "la-nina-pending"   # boundary
    assert wwv._lead_signal(-2.1) == "la-nina-pending"
    assert wwv._lead_signal(None) == "unknown"


def test_fmt_signed_tolerates_none():
    """Same crash-safe pattern as enso_indices — partial fetch failures
    shouldn't crash the summary log."""
    assert wwv._fmt_signed( 2.5) == "+2.50"
    assert wwv._fmt_signed(-1.3) == "-1.30"
    assert wwv._fmt_signed(None) == "—"


# ── payload assembly ───────────────────────────────────────────────────────


def test_build_payload_summarises_latest_row():
    rows = wwv.parse_wwv(_YEAR_MATRIX_SAMPLE)
    doc  = wwv.build_payload(rows, "https://example.test/wwv.dat")
    assert set(doc) == {"scraped_at", "wwv"}
    assert doc["wwv"]["latest"]["month"]       == "2026-05"
    assert doc["wwv"]["latest"]["wwv_anomaly"] == 1.8
    # 1.8 > +1.0 threshold → El Niño pending.
    assert doc["wwv"]["latest"]["lead_signal"] == "el-nino-pending"
    # Source URL surfaced for the operator + thresholds documented.
    assert doc["wwv"]["source_url"] == "https://example.test/wwv.dat"
    assert doc["wwv"]["thresholds"]["el_nino_lead"] == 1.0
    # Full history shipped.
    assert len(doc["wwv"]["monthly"]) == len(rows)


def test_build_payload_handles_empty_input():
    """When all URL candidates 404 we still produce a usable JSON
    (rather than crashing) — the frontend degrades gracefully."""
    doc = wwv.build_payload([], None)
    assert doc["wwv"]["latest"]["wwv_anomaly"] is None
    assert doc["wwv"]["latest"]["lead_signal"] == "unknown"
    assert doc["wwv"]["monthly"]              == []


# ── fetch-fallback resilience ───────────────────────────────────────────────


def test_fetch_first_ok_walks_candidate_list(monkeypatch):
    seen: list[str] = []
    def fake_fetch(url, *, timeout=30):
        seen.append(url)
        return "fake wwv text" if "psl" in url else None
    monkeypatch.setattr(wwv, "_fetch", fake_fetch)
    text, winner = wwv._fetch_first_ok([
        "https://example.test/a", "https://psl.example.test/b", "https://example.test/c",
    ])
    assert text   == "fake wwv text"
    assert winner == "https://psl.example.test/b"
    # The fallback should not have probed the third URL after the second succeeded.
    assert seen == ["https://example.test/a", "https://psl.example.test/b"]


def test_fetch_first_ok_returns_none_when_all_fail(monkeypatch):
    monkeypatch.setattr(wwv, "_fetch", lambda url, **_: None)
    text, winner = wwv._fetch_first_ok(["a", "b"])
    assert text   is None
    assert winner is None
