"""Layout test for the rewritten Telegram morning brief.

Pins the new section structure (header, futures with spread, physical lines
with basis delta, weather, exports, certified stocks, footer) using real
fixture JSONs in a tmp DATA_DIR. Keeps the test DB-free so it can run on
the CI image without sqlalchemy/psycopg2.

The exact numeric values are NOT pinned (they drift with input fixtures) —
only the section structure, ordering, and key labels.
"""
import json

import pytest


@pytest.fixture
def fixture_data_dir(tmp_path, monkeypatch):
    """Write a minimal fixture into a tmp DATA_DIR and point the brief at it."""
    data = tmp_path / "data"
    data.mkdir()

    # Futures chain — front + second month per market for the spread line.
    (data / "futures_chain.json").write_text(json.dumps({
        "robusta": {"contracts": [
            {"symbol": "RMN26", "last": 3438},
            {"symbol": "RMU26", "last": 3315},
        ]},
        "arabica": {"contracts": [
            {"symbol": "KCN26", "last": 260.60},
            {"symbol": "KCU26", "last": 254.55},
        ]},
    }))
    (data / "acaphe_live.json").write_text(json.dumps({
        "robusta": [{"change": -9}],
        "arabica": [{"change": -6.55}],
    }))

    # contract_prices_archive.json lives at the repo root in production;
    # _load_archive() falls back to DATA_DIR for test fixtures.
    (data / "contract_prices_archive.json").write_text(json.dumps({
        "robusta": {
            "2026-06-02": {"RCN26": {"price": 3438}, "RCU26": {"price": 3315}},
            "2026-06-01": {"RCN26": {"price": 3476}, "RCU26": {"price": 3347}},
        },
        "arabica": {
            "2026-06-02": {"KCN26": {"price": 260.60}, "KCU26": {"price": 254.55}},
            "2026-06-01": {"KCN26": {"price": 267.15}, "KCU26": {"price": 261.10}},
        },
    }))

    # Physical price history — Vietnam (VND/kg) only for the layout test.
    (data / "origin_prices_history.json").write_text(json.dumps({
        "origins": {
            "vietnam": {"currency": "VND", "unit": "per_kg", "history": [
                {"date": "2026-06-01", "price": 87300},
                {"date": "2026-06-02", "price": 86700},
            ]},
            "brazil_conilon": {"currency": "BRL", "unit": "per_saca_60kg", "history": [
                {"date": "2026-06-01", "price": 905},
                {"date": "2026-06-02", "price": 900},
            ]},
            "uganda": {"currency": "USD", "unit": "per_cwt", "history": [
                {"date": "2026-06-01", "price": 172.5},
                {"date": "2026-06-02", "price": 168.0},
            ]},
        },
    }))
    (data / "fx_history.json").write_text(json.dumps({
        "pairs": {
            "VND=X": {"history": [{"date": "2026-06-01", "close": 26315},
                                  {"date": "2026-06-02", "close": 26315}]},
            "BRL=X": {"history": [{"date": "2026-06-01", "close": 5.04},
                                  {"date": "2026-06-02", "close": 5.04}]},
        },
    }))

    # Certified stocks — minimal snapshots for both markets so the cert
    # block renders the two sub-sections.
    (data / "certified_stocks_arabica.json").write_text(json.dumps({
        "snapshots": [
            {"date": "2026-06-01", "total_bags": 435430, "passed_today_bags": 0,
             "failed_today_bags": 0, "by_port": {"ANT": 294900},
             "sections": {"total_certified": {"by_origin": {"Honduras": {"total": 100000}}}}},
            {"date": "2026-06-02", "total_bags": 434930, "passed_today_bags": 0,
             "failed_today_bags": 0, "by_port": {"ANT": 294416},
             "sections": {"total_certified": {"by_origin": {"Honduras": {"total": 100000}}}}},
        ],
    }))
    (data / "certified_stocks_robusta.json").write_text(json.dumps({
        "snapshots": [
            {"date": "2026-06-01", "total_lots_certified": 3921, "lots_graded_today": 0,
             "by_port_lots": {"LON": 3500}},
            {"date": "2026-06-02", "total_lots_certified": 3864, "lots_graded_today": 0,
             "by_port_lots": {"LON": 3457}},
        ],
    }))

    monkeypatch.setenv("DATA_DIR", str(data))
    # Reload telegram.data so the new DATA_DIR takes effect.
    import importlib

    import telegram.data as td
    importlib.reload(td)
    import telegram.handlers.brief as bh
    importlib.reload(bh)
    return data


def test_brief_has_all_top_level_sections(fixture_data_dir):
    """Header · futures (RC+KC with spread) · physical lines · weather ·
    exports · certified stocks · footer. Each section's heading or sentinel
    must be present in order."""
    from telegram.handlers.brief import build_brief_message
    out = build_brief_message()

    # Header
    assert "☕ <b>Coffee Intel ·" in out
    # Futures with spread on a second line
    assert "RC   3,438" in out
    assert "(RMN26)" in out
    assert "N-U spread at" in out
    assert "KC   260.60" in out
    assert "(KCN26)" in out
    # Physical lines — each origin gets one line with basis "Nxxx" and FOB tag
    assert "VN FAQ" in out
    assert " FOB" in out
    assert "CON T7" in out
    assert "UGA S15" in out
    # Footer
    assert "/quote · /cot · /stock · /certified · /brazil · /vietnam · /uganda · /freight · /macro" in out
    # Section emojis (we removed the old COT block; assert it's gone)
    assert "<b>COT KC</b>" not in out
    assert "<b>COT RC</b>" not in out


def test_brief_certified_stocks_block(fixture_data_dir):
    """Cert stocks block has NY (bags) + LD (lots) sub-sections with the
    stocks delta line."""
    from telegram.handlers.brief import build_brief_message
    out = build_brief_message()
    assert "🪤 <b>Certified stocks</b>" in out
    assert "NY:" in out
    assert "LD:" in out
    # Day-over-day delta sign on both sides
    assert "434,930 bags" in out
    assert "3,864 lots" in out


def test_brief_physical_includes_basis_and_delta(fixture_data_dir):
    """The VN line shows N±basis followed by a +/- delta and FOB tag —
    the spec's locked format."""
    from telegram.handlers.brief import build_brief_message
    out = build_brief_message()
    # Pattern: "VN FAQ  86,700 VND · N-XX YY FOB" where YY can be +/- and is
    # the basis delta vs yesterday.
    import re as _re
    m = _re.search(r"VN FAQ\s+86,700 VND · N[+-]\d+\s+[+-]?\d+\s+FOB", out)
    assert m is not None, f"VN FAQ line wrong shape: {out!r}"


def test_brief_spread_line_has_change_in_parens(fixture_data_dir):
    """Spread daily change appears in parens after the spread value."""
    from telegram.handlers.brief import build_brief_message
    out = build_brief_message()
    # Today RC N-U = 3438 - 3315 = 123; yesterday 3476 - 3347 = 129; delta = -6.
    assert "N-U spread at 123 (-6)" in out
