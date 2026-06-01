"""Tests for the /cot Telegram handler — signals block formatting (issue #132 Body-1)."""
from __future__ import annotations

import pytest

# Path setup matches the other backend tests (conftest.py adds backend/ to sys.path).
from telegram.handlers import cot

# Minimal cot_recent.json shape — two adjacent weeks so the handler picks
# `latest` + `prev` and renders the per-market header block. Numbers are
# arbitrary; the test asserts on the signals block, not these numbers.
_COT_FIXTURE = [
    {
        "date": "2026-05-19",
        "ny":  {"mm_long": 80_000, "mm_short": 40_000, "pmpu_long": 20_000, "pmpu_short": 70_000,
                "oi_total": 250_000, "price_ny":  330.0},
        "ldn": {"mm_long": 30_000, "mm_short": 20_000, "pmpu_long":  5_000, "pmpu_short": 25_000,
                "oi_total": 130_000, "price_ldn": 4500.0},
    },
    {
        "date": "2026-05-26",
        "ny":  {"mm_long": 85_000, "mm_short": 35_000, "pmpu_long": 22_000, "pmpu_short": 72_000,
                "oi_total": 255_000, "price_ny":  338.0},
        "ldn": {"mm_long": 31_000, "mm_short": 19_000, "pmpu_long":  5_500, "pmpu_short": 25_500,
                "oi_total": 131_000, "price_ldn": 4550.0},
    },
]


def _make_signals_doc():
    """Synthetic signals.json with one row per (severity × market) plus an
    AGRO row that must NOT appear in either NY or LDN block."""
    return {
        "date": "2026-05-26",
        "scoreNY": 4,
        "scoreLDN": 1,
        "signals": [
            {"id": "CR5", "name": "Squeeze Risk", "category": "CR", "categoryLabel": "Spec",
             "market": "NY",  "severity": "alert",    "score":  3, "magnitude": "large",  "text": "..."},
            {"id": "ML5", "name": "Fund Long Exit", "category": "ML", "categoryLabel": "Spec",
             "market": "NY",  "severity": "watch",    "score": -2, "magnitude": "small",  "text": "..."},
            {"id": "CP1", "name": "Normal Hedging", "category": "CP", "categoryLabel": "Producer",
             "market": "NY",  "severity": "info",     "score":  0, "magnitude": "small",  "text": "..."},
            {"id": "CI2", "name": "Commercial Convergence Bearish", "category": "CI", "categoryLabel": "Commercial",
             "market": "LDN", "severity": "critical", "score": -3, "magnitude": "medium", "text": "..."},
            # AGRO row — must be excluded from NY and LDN blocks (market="PHYS").
            {"id": "AGRO_brazil_Cerrado_blossom_drop", "name": "Flowering Disruption",
             "category": "AGRO", "categoryLabel": "Agronomic",
             "market": "PHYS", "severity": "watch", "timeframe": "forecast",
             "score": 0, "magnitude": "medium", "text": "..."},
        ],
        "generatedAt": "2026-05-26T00:00:00Z",
    }


@pytest.fixture
def _patched_load(monkeypatch):
    """Patch the `load` symbol that `cot.py` imported — that's the one the
    handler calls. The default returns cot_recent.json + signals.json shapes."""
    sig_doc = _make_signals_doc()

    def fake_load(filename: str):
        if filename == "cot_recent.json":
            return _COT_FIXTURE
        if filename == "signals.json":
            return sig_doc
        return None

    monkeypatch.setattr(cot, "load", fake_load)
    return sig_doc


def test_signals_block_renders_with_ny_and_ldn_sections(_patched_load):
    out = cot.handle("", {})
    assert "Signals (NY):" in out
    assert "Signals (LDN):" in out


def test_severity_tags_use_canonical_short_forms(_patched_load):
    out = cot.handle("", {})
    assert "[CRIT]"  in out   # critical → CRIT
    assert "[ALERT]" in out   # alert    → ALERT
    assert "[WARN]"  in out   # watch    → WARN
    assert "[INFO]"  in out   # info     → INFO


def test_score_signed_with_magnitude(_patched_load):
    out = cot.handle("", {})
    # CR5: +3, large
    assert "(+3, large)"  in out
    # ML5: -2, small
    assert "(-2, small)"  in out
    # CP1: zero score — sign omitted but magnitude kept
    assert "(0, small)"   in out


def test_agro_rows_excluded_from_market_blocks(_patched_load):
    """AGRO rows have market='PHYS' — they belong on a future /agro command,
    not in the NY/LDN signal listings on /cot."""
    out = cot.handle("", {})
    assert "Flowering Disruption" not in out
    assert "AGRO_brazil_Cerrado_blossom_drop" not in out
    assert "PHYS" not in out


def test_critical_sorts_above_alert_above_watch(_patched_load):
    """Within the NY block, severity rank drives ordering: alert (3) > watch (2)
    > info (1). The single LDN row is critical (4)."""
    out = cot.handle("", {})
    ny_pos    = out.index("Signals (NY):")
    cr5_pos   = out.index("[ALERT] CR5")
    ml5_pos   = out.index("[WARN] ML5")
    cp1_pos   = out.index("[INFO] CP1")
    assert ny_pos < cr5_pos < ml5_pos < cp1_pos


def test_handler_renders_without_signals_file(monkeypatch):
    """signals.json may be absent on a fresh runner — handler must not crash;
    just omit the signals block."""
    def fake_load(filename: str):
        if filename == "cot_recent.json":
            return _COT_FIXTURE
        return None  # signals.json absent

    monkeypatch.setattr(cot, "load", fake_load)
    out = cot.handle("", {})
    assert "COT Report" in out
    assert "Signals (NY):" not in out
    assert "Signals (LDN):" not in out


def test_handler_omits_market_block_with_no_signals(monkeypatch):
    """If signals.json has rows but none for a given market, that market's
    block is omitted entirely (no orphan header)."""
    def fake_load(filename: str):
        if filename == "cot_recent.json":
            return _COT_FIXTURE
        if filename == "signals.json":
            return {
                "signals": [
                    {"id": "CR5", "name": "Squeeze Risk", "market": "NY",
                     "severity": "alert", "score": 3, "magnitude": "large"},
                ],
            }
        return None

    monkeypatch.setattr(cot, "load", fake_load)
    out = cot.handle("", {})
    assert "Signals (NY):" in out
    assert "Signals (LDN):" not in out


def test_signal_line_format_unit():
    """_signal_line is pure — easy to lock down."""
    line = cot._signal_line({
        "id": "CR5", "name": "Squeeze Risk", "severity": "alert",
        "score": 3, "magnitude": "large",
    })
    assert line == "  [ALERT] CR5 Squeeze Risk (+3, large)"


def test_signal_line_negative_score():
    line = cot._signal_line({
        "id": "ML5", "name": "Fund Long Exit", "severity": "watch",
        "score": -2, "magnitude": "small",
    })
    assert line == "  [WARN] ML5 Fund Long Exit (-2, small)"


def test_signal_line_missing_magnitude():
    """A signal lacking magnitude renders just the score."""
    line = cot._signal_line({
        "id": "XX1", "name": "Foo", "severity": "info", "score": 5,
    })
    assert line == "  [INFO] XX1 Foo (+5)"


def test_warn_and_watch_treated_as_synonyms(monkeypatch):
    """Live drift: quant signals use severity='warn'; agronomic engine uses
    severity='watch'. Both must map to [WARN] tag and rank above info."""
    assert cot._SEVERITY_TAG["warn"]  == cot._SEVERITY_TAG["watch"]  == "WARN"
    assert cot._SEVERITY_RANK["warn"] == cot._SEVERITY_RANK["watch"] == 2

    # Integration: a 'warn' row must sort above an 'info' row in the same market.
    def fake_load(filename: str):
        if filename == "cot_recent.json":
            return _COT_FIXTURE
        if filename == "signals.json":
            return {
                "signals": [
                    {"id": "AA1", "name": "Info Row",  "market": "NY",
                     "severity": "info", "score": 0, "magnitude": "small"},
                    {"id": "BB2", "name": "Warn Row",  "market": "NY",
                     "severity": "warn", "score": 1, "magnitude": "small"},
                ],
            }
        return None

    monkeypatch.setattr(cot, "load", fake_load)
    out = cot.handle("", {})
    warn_pos = out.index("[WARN] BB2")
    info_pos = out.index("[INFO] AA1")
    assert warn_pos < info_pos, "warn must sort above info regardless of spelling"
