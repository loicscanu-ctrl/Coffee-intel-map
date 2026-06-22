"""Tests for the NOAA ENSO-indices fetcher — Niño 3.4 weekly + SOI
monthly. Network paths (fetch) are out of scope; we exercise the pure-
Python parsers against captured fixture text that mirrors NOAA's
actual file format."""
from __future__ import annotations

from scraper.sources import enso_indices as enso

# Real-shape sample from `wksst8110.for`. Columns are:
#   date, SST 1+2, SSTA 1+2, SST 3, SSTA 3, SST 3.4, SSTA 3.4, SST 4, SSTA 4
# Header rows mimic what NOAA actually ships — a title, a blank line,
# the column-label row, and another header — so the parser has to
# skip everything that doesn't begin with a date token.
_NINO34_SAMPLE = """\
SST and SST Anomaly Indices

                Nino1+2       Nino3        Nino34        Nino4
Week           SST SSTA      SST SSTA     SST SSTA      SST SSTA
03JAN1990     24.7 -0.5     25.0 -0.6    25.7 -0.4     28.6 -0.7
10JAN1990     24.6 -0.6     25.2 -0.5    25.8 -0.4     28.6 -0.7
17DEC2025     22.1  0.3     24.8  0.7    27.4  0.9     29.1  0.5
24DEC2025     22.4  0.5     24.9  0.8    27.7  1.1     29.2  0.6
"""

# Real-shape SOI fixture — both the ANOMALY and STANDARDIZED sections,
# with the column header row inside each. We expect ONLY the
# standardized rows to be emitted, with -999.9 sentinels dropped.
_SOI_SAMPLE = """\
SOUTHERN OSCILLATION INDEX

ANOMALY
YEAR     JAN     FEB     MAR     APR     MAY     JUN     JUL     AUG     SEP     OCT     NOV     DEC
1951     1.5     0.9    -0.1   -3.0     0.6     0.2    -0.7   -1.7    -0.6   -0.1    -0.7    -0.7
2025     0.4    -0.2     0.1    0.7    -0.5    -0.3     0.8    1.0     0.6   -0.2     0.1     0.3
2026    -0.8    -1.2    -1.5   -999.9 -999.9 -999.9 -999.9 -999.9 -999.9 -999.9 -999.9 -999.9

STANDARDIZED DATA
YEAR     JAN     FEB     MAR     APR     MAY     JUN     JUL     AUG     SEP     OCT     NOV     DEC
1951     1.5     0.9    -0.1   -3.0     0.6     0.2    -0.7   -1.7    -0.6   -0.1    -0.7    -0.7
2025     0.4    -0.2     0.1    0.7    -0.5    -0.3     0.8    1.0     0.6   -0.2     0.1     0.3
2026    -0.8    -1.2    -1.5   -999.9 -999.9 -999.9 -999.9 -999.9 -999.9 -999.9 -999.9 -999.9
"""


# ── Niño 3.4 ────────────────────────────────────────────────────────────────


def test_nino34_parses_anomaly_column_in_chronological_order():
    rows = enso.parse_nino34(_NINO34_SAMPLE)
    assert len(rows) == 4
    # Sorted ascending — even when the file lists in any order.
    months = [r.week_ending for r in rows]
    assert months == sorted(months)
    # First week: 03JAN1990 → SSTA 3.4 = -0.4 (column index 6).
    assert rows[0].week_ending == "1990-01-03"
    assert rows[0].sst_anomaly == -0.4
    # Last week: 24DEC2025 → SSTA 3.4 = 1.1 (an El Niño reading).
    assert rows[-1].week_ending == "2025-12-24"
    assert rows[-1].sst_anomaly == 1.1


def test_nino34_skips_header_rows_and_blank_lines():
    # The header has a title, blank line, and two column-label rows
    # before the first data line — none should produce an entry.
    rows = enso.parse_nino34(_NINO34_SAMPLE)
    # Only the 4 dated lines turn into entries.
    assert len(rows) == 4


def test_nino34_drops_lines_with_too_few_columns():
    text = (
        "03JAN1990     24.7 -0.5\n"       # truncated — drop
        "10JAN1990     24.6 -0.6  25.2 -0.5  25.8 -0.4  28.6 -0.7\n"
    )
    rows = enso.parse_nino34(text)
    assert len(rows) == 1
    assert rows[0].week_ending == "1990-01-10"


def test_phase_for_nino34_applies_threshold_bands():
    assert enso._phase_for_nino34( 1.1) == "el-nino"   # well above +0.5
    assert enso._phase_for_nino34( 0.5) == "el-nino"   # boundary
    assert enso._phase_for_nino34( 0.2) == "neutral"
    assert enso._phase_for_nino34(-0.5) == "la-nina"   # boundary
    assert enso._phase_for_nino34(-1.3) == "la-nina"
    assert enso._phase_for_nino34(None) == "unknown"


# ── SOI ─────────────────────────────────────────────────────────────────────


def test_soi_returns_only_standardized_section_not_anomaly():
    rows = enso.parse_soi(_SOI_SAMPLE)
    # The ANOMALY block has 3 year-rows of 12 months each; if we ever
    # leak into it we'd get up to 36 extra rows. The standardized
    # block has 12 (1951) + 12 (2025) + 3 (2026, the rest are -999.9 dropped).
    assert len(rows) == 27


def test_soi_filters_sentinel_missing_values():
    rows = enso.parse_soi(_SOI_SAMPLE)
    # 2026 only has Jan/Feb/Mar in the fixture (rest = -999.9).
    months_2026 = [r.month for r in rows if r.month.startswith("2026")]
    assert months_2026 == ["2026-01", "2026-02", "2026-03"]


def test_soi_emits_chronological_ordering_across_years():
    rows = enso.parse_soi(_SOI_SAMPLE)
    months = [r.month for r in rows]
    assert months == sorted(months)
    # First entry is 1951-01.
    assert rows[0].month == "1951-01"
    assert rows[0].soi   == 1.5
    # Latest in the standardized section is 2026-03 = -1.5 (deep La Niña-ish atmosphere).
    assert rows[-1].month == "2026-03"
    assert rows[-1].soi   == -1.5


# ── payload assembly ───────────────────────────────────────────────────────


def test_build_payload_compiles_latest_summary_for_each_index():
    n34  = enso.parse_nino34(_NINO34_SAMPLE)
    soi  = enso.parse_soi(_SOI_SAMPLE)
    doc  = enso.build_payload(n34, soi)
    # Top-level structure.
    assert set(doc) == {"scraped_at", "nino34", "soi"}
    # Niño 3.4 latest summary.
    assert doc["nino34"]["latest"]["week_ending"] == "2025-12-24"
    assert doc["nino34"]["latest"]["sst_anomaly"] == 1.1
    assert doc["nino34"]["latest"]["phase"]       == "el-nino"
    # SOI latest summary.
    assert doc["soi"]["latest"]["month"] == "2026-03"
    assert doc["soi"]["latest"]["soi"]   == -1.5
    # Full series shipped so the chart can window however it likes.
    assert len(doc["nino34"]["weekly"]) == len(n34)
    assert len(doc["soi"]["monthly"])   == len(soi)


def test_build_payload_handles_empty_inputs_without_crashing():
    doc = enso.build_payload([], [])
    assert doc["nino34"]["latest"]["sst_anomaly"] is None
    assert doc["nino34"]["latest"]["phase"]      == "unknown"
    assert doc["soi"]["latest"]["soi"]           is None
    assert doc["nino34"]["weekly"] == []
    assert doc["soi"]["monthly"]   == []
