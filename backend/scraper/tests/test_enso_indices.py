"""Tests for the NOAA ENSO-indices fetcher — Niño 3.4 weekly + SOI
monthly. Network paths (fetch) are out of scope; we exercise the pure-
Python parsers against captured fixture text that mirrors NOAA's
actual file format."""
from __future__ import annotations

from scraper.sources import enso_indices as enso

# Real-shape Niño 3.4 sample — captured from the live NOAA wksst9120.for
# dump on 22 Jun 2026 (workflow diag run). Critical to the test contract:
#   • Lines begin with ONE leading space (NOAA's data-line indent)
#   • Negative SSTAs FUSE into the preceding SST cell — `20.6-0.1`,
#     not `20.6 -0.1`. The v1 .split()-based parser missed every row
#     where Niño 1+2 SSTA was negative (i.e. most weeks) — see v3's
#     re.findall fix.
_NINO34_SAMPLE = (
    " Weekly SST data starts week centered on 2Sept1981\n"
    "\n"
    "                Nino1+2      Nino3        Nino34        Nino4\n"
    " Week          SST SSTA     SST SSTA     SST SSTA     SST SSTA\n"
    " 02SEP1981     20.6-0.1     24.8-0.1     26.5-0.2     28.3-0.3\n"
    " 17DEC2025     22.1 0.3     24.8 0.7     27.4 0.9     29.1 0.5\n"
    " 17JUN2026     26.1 3.0     28.5 1.9     29.3 1.7     30.2 1.3\n"
)

# Real-shape SOI fixture — mirrors NOAA's actual file, including
# the negative-number fusion in the 2026 row (-0.9-999.9-999.9).
# The v1 .split() parser dropped that row entirely (cols < 12);
# v3's re.findall recovers all 12 values then filters sentinels.
_SOI_SAMPLE = (
    "(STAND TAHITI - STAND DARWIN)  SEA LEVEL PRESS\n"
    "                        ANOMALY\n"
    "\n"
    "YEAR   JAN   FEB   MAR   APR   MAY   JUN   JUL   AUG   SEP   OCT   NOV   DEC\n"
    "1951   2.5   1.5  -0.2  -0.5  -1.1   0.3  -1.7  -0.4  -1.8  -1.6  -1.3  -1.2\n"
    "2025   0.4  -0.2   0.1   0.7  -0.5  -0.3   0.8   1.0   0.6  -0.2   0.1   0.3\n"
    "2026   1.1   1.4   1.2  -0.6  -0.9-999.9-999.9-999.9-999.9-999.9-999.9-999.9\n"
    "\n"
    "                       STANDARDIZED DATA\n"
    "\n"
    "YEAR   JAN   FEB   MAR   APR   MAY   JUN   JUL   AUG   SEP   OCT   NOV   DEC\n"
    "1951   1.5   0.9  -0.1  -3.0   0.6   0.2  -0.7  -1.7  -0.6  -0.1  -0.7  -0.7\n"
    "2025   0.4  -0.2   0.1   0.7  -0.5  -0.3   0.8   1.0   0.6  -0.2   0.1   0.3\n"
    "2026  -0.8  -1.2  -1.5-999.9-999.9-999.9-999.9-999.9-999.9-999.9-999.9-999.9\n"
)


# ── Niño 3.4 ────────────────────────────────────────────────────────────────


def test_nino34_parses_anomaly_column_in_chronological_order():
    rows = enso.parse_nino34(_NINO34_SAMPLE)
    assert len(rows) == 3
    # Sorted ascending — even when the file lists in any order.
    months = [r.week_ending for r in rows]
    assert months == sorted(months)
    # First week: 02SEP1981 → SSTA 3.4 = -0.2 (Niño 3.4 anomaly = 6th
    # signed-decimal on the row, index 5 after the date strip).
    assert rows[0].week_ending == "1981-09-02"
    assert rows[0].sst_anomaly == -0.2
    # Last week: 17JUN2026 → SSTA 3.4 = 1.7 (strong El Niño reading).
    assert rows[-1].week_ending == "2026-06-17"
    assert rows[-1].sst_anomaly == 1.7


def test_nino34_skips_header_rows_and_blank_lines():
    rows = enso.parse_nino34(_NINO34_SAMPLE)
    # The header has a title, blank line, the column-name row, and the
    # SST/SSTA label row — none should produce an entry.
    assert len(rows) == 3


def test_nino34_drops_lines_with_too_few_columns():
    text = (
        " 03JAN1990     24.7-0.5\n"       # truncated — only 2 numbers
        " 10JAN1990     24.6-0.6  25.2-0.5  25.8-0.4  28.6-0.7\n"  # 8 numbers
    )
    rows = enso.parse_nino34(text)
    assert len(rows) == 1
    assert rows[0].week_ending == "1990-01-10"


def test_nino34_handles_fused_negative_numbers():
    """The v1-killing bug: NOAA pads its fixed-width file with single
    spaces that get visually eaten by leading minus signs. So
    `20.6 -0.1` arrives as `20.6-0.1` and `.split()` fails. v3 uses
    re.findall to walk signed decimals regardless of spacing."""
    text = " 02SEP1981     20.6-0.1     24.8-0.1     26.5-0.2     28.3-0.3\n"
    rows = enso.parse_nino34(text)
    assert len(rows) == 1
    assert rows[0].sst_anomaly == -0.2    # Niño 3.4 SSTA (6th number)


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
    assert doc["nino34"]["latest"]["week_ending"] == "2026-06-17"
    assert doc["nino34"]["latest"]["sst_anomaly"] == 1.7
    assert doc["nino34"]["latest"]["phase"]       == "el-nino"
    # SOI latest summary (standardized section).
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


# ── partial-failure resilience (v2 fixes from dry-run feedback) ─────────────


def test_fmt_signed_tolerates_none_for_partial_fetch_logging():
    """v1 dry-run crashed with TypeError when one endpoint returned 0
    rows because the log line did `{value:+.2f}` against a None.
    v2 routes summary numbers through _fmt_signed, which prints '—'
    for None instead of crashing — so partial success (1 of 2
    endpoints worked) still produces a usable log + JSON."""
    assert enso._fmt_signed( 1.25) == "+1.25"
    assert enso._fmt_signed(-0.50) == "-0.50"
    assert enso._fmt_signed(None)  == "—"


def test_fetch_first_ok_walks_candidate_list(monkeypatch):
    """v2 tries multiple URL variants per index — NOAA serves several
    concurrent file formats (wksst9120 / wksst8110, .for / .bnd, www /
    no-www). When the first URL 404s we want the second to be tried
    automatically, without a code change."""
    seen: list[str] = []
    def fake_fetch(url, *, timeout=30):
        seen.append(url)
        # Pretend the first two URLs 404; the third succeeds.
        if "wksst9120" in url or url.endswith(".bnd"):
            return None
        return "fake noaa text"
    monkeypatch.setattr(enso, "_fetch", fake_fetch)

    text, winning = enso._fetch_first_ok([
        "https://example.test/wksst9120.for",
        "https://example.test/wksst8110.bnd",
        "https://example.test/wksst8110.for",
    ])
    assert text == "fake noaa text"
    assert winning.endswith("wksst8110.for")
    # All three candidates probed in order.
    assert seen == [
        "https://example.test/wksst9120.for",
        "https://example.test/wksst8110.bnd",
        "https://example.test/wksst8110.for",
    ]


def test_fetch_first_ok_returns_none_when_all_candidates_fail(monkeypatch):
    monkeypatch.setattr(enso, "_fetch", lambda url, **kw: None)
    text, winning = enso._fetch_first_ok(["a", "b", "c"])
    assert text    is None
    assert winning is None
