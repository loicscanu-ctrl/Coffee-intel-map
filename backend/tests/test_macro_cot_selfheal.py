# backend/tests/test_macro_cot_selfheal.py
"""Tests for the self-healing multi-week COT window.

Root case: on 2026-06-30 the whole ICE complex (robusta, brent, gasoil, white
sugar, cocoa London) was missing from the Global Money Flow — the ICE file
lagged the holiday-shifted CFTC run, and the old parsers only ever ingested the
newest row per symbol, so the next week's run skipped straight past the hole.
The fix re-parses the trailing SELF_HEAL_WEEKS window on every run and upserts
whatever the DB is missing.
"""
from datetime import date, timedelta

import pandas as pd
import pytest

import scraper.sources.macro_cot as mc

# Imported at module level so Base.metadata knows these tables BEFORE the
# conftest `db`/`scraper_db` fixtures run create_all (they only create tables
# registered at that point).
from models import CommodityCot, CommodityPrice  # noqa: F401
from scraper.db_macro import upsert_commodity_cot, upsert_commodity_price


def _recent_tuesdays(n: int) -> list[date]:
    """Last n COT report Tuesdays, oldest-first, ending at the most recent
    Tuesday on/before today (keeps the staleness guard's overdue check quiet)."""
    today = date.today()
    latest = today - timedelta(days=(today.weekday() - 1) % 7)
    return [latest - timedelta(weeks=i) for i in range(n - 1, -1, -1)]


def _yymmdd(d: date) -> int:
    return int(d.strftime("%y%m%d"))


def _cftc_frame(dates: list[date]) -> pd.DataFrame:
    rows = []
    for i, d in enumerate(dates):
        rows.append({
            "Market_and_Exchange_Names": "COFFEE C - ICE FUTURES U.S.",
            "As_of_Date_In_Form_YYMMDD": _yymmdd(d),
            "Open_Interest_All": 200_000 + i,
            "M_Money_Positions_Long_All": 40_000 + i,
            "M_Money_Positions_Short_All": 10_000 + i,
            "M_Money_Positions_Spread_All": 5_000 + i,
        })
    return pd.DataFrame(rows)


def _ice_frame(dates: list[date]) -> pd.DataFrame:
    rows = []
    for i, d in enumerate(dates):
        rows.append({
            "Market_and_Exchange_Names": "ICE Robusta Coffee Futures - ICE Futures Europe",
            "As_of_Date_In_Form_YYMMDD": _yymmdd(d),
            "Open_Interest_All": 100_000 + i,
            "M_Money_Positions_Long_All": 30_000 + i,
            "M_Money_Positions_Short_All": 6_000 + i,
            "M_Money_Positions_Spread_All": 3_000 + i,
        })
    return pd.DataFrame(rows)


# ── Parser window tests ───────────────────────────────────────────────────────

def test_parse_cftc_returns_recent_window_newest_first():
    dates = _recent_tuesdays(4)
    out = mc._parse_cftc(_cftc_frame(dates), weeks_back=3)
    rows = out["arabica"]
    assert [d for d, _ in rows] == sorted(dates, reverse=True)[:3]
    # Newest row carries the newest values (i == 3 for the last date)
    assert rows[0][1]["oi_total"] == 200_003


def test_parse_ice_returns_recent_window_newest_first():
    dates = _recent_tuesdays(3)
    out = mc._parse_ice(_ice_frame(dates), weeks_back=8)
    rows = out["robusta"]
    # Only 3 weeks available — window clamps to what exists
    assert len(rows) == 3
    assert rows[0][0] == max(dates)


def test_parse_full_symbol_returns_window_list():
    dates = _recent_tuesdays(3)
    rows = mc._parse_full_symbol(
        _cftc_frame(dates), "Market_and_Exchange_Names", "As_of_Date_In_Form_YYMMDD",
        "COFFEE C - ICE FUTURES U.S.", has_nr_traders=True, weeks_back=2,
    )
    assert len(rows) == 2
    assert rows[0][0] == max(dates)
    assert rows[0][1]["mm_long"] == 40_002
    assert rows[0][1]["oi_total"] == 200_002


def test_parse_full_symbol_no_match_returns_empty_list():
    frame = _cftc_frame(_recent_tuesdays(2))
    assert mc._parse_full_symbol(
        frame, "Market_and_Exchange_Names", "As_of_Date_In_Form_YYMMDD", "NO SUCH MARKET"
    ) == []


# ── Market-name matching: lookalikes must never be ingested ───────────────────

SILVER = "SILVER - COMMODITY EXCHANGE INC."
MICRO_SILVER = "MICRO SILVER - COMMODITY EXCHANGE INC."


def _silver_frame(names: list[str]) -> pd.DataFrame:
    d = _recent_tuesdays(1)[0]
    return pd.DataFrame([{
        "Market_and_Exchange_Names": n,
        "As_of_Date_In_Form_YYMMDD": _yymmdd(d),
        "Open_Interest_All": 150_000 if n == SILVER else 30_000,
        "M_Money_Positions_Long_All": 27_000 if n == SILVER else 0,
        "M_Money_Positions_Short_All": 11_000 if n == SILVER else 0,
        "M_Money_Positions_Spread_All": 0,
    } for n in names])


def test_match_prefers_exact_row_over_micro_lookalike():
    rows = mc._match_market_rows(_silver_frame([MICRO_SILVER, SILVER]),
                                 "Market_and_Exchange_Names", SILVER)
    assert list(rows["Market_and_Exchange_Names"]) == [SILVER]


def test_match_never_falls_back_to_embedding_lookalike():
    # The early-2026 silver corruption: exact row absent from a partial file →
    # the old contains-fallback ingested MICRO SILVER (mm=0, OI ~30k) as
    # full-size silver. The matcher must return NOTHING instead.
    rows = mc._match_market_rows(_silver_frame([MICRO_SILVER]),
                                 "Market_and_Exchange_Names", SILVER)
    assert rows.empty


def test_match_accepts_prefix_variant_when_exact_absent():
    # A trailing-suffix variant (formatting drift) still matches via startswith.
    variant = SILVER + "  "
    rows = mc._match_market_rows(_silver_frame([variant, MICRO_SILVER]),
                                 "Market_and_Exchange_Names", SILVER)
    assert list(rows["Market_and_Exchange_Names"]) == [variant]


# ── End-to-end self-heal tests (sqlite via conftest fixtures) ─────────────────

@pytest.fixture
def healing_env(db, scraper_db, monkeypatch):
    """Mock all network I/O; yield (dates, run) where run() executes
    _fetch_and_upsert against the sqlite test DB."""
    dates = _recent_tuesdays(3)
    monkeypatch.setattr(mc, "_download_cftc_df", lambda year: _cftc_frame(dates))
    monkeypatch.setattr(mc, "_download_ice_df", lambda year: _ice_frame(dates))
    yf_calls: list = []

    def fake_yf(pairs):
        yf_calls.append(list(pairs))
        return {p: 100.0 for p in pairs}

    monkeypatch.setattr(mc, "_fetch_yfinance_prices", fake_yf)
    monkeypatch.setattr(mc, "_fetch_stooq_prices", lambda pairs: {})
    monkeypatch.setattr(mc, "_fetch_gbpusd_rates", lambda dates_: {})
    monkeypatch.setattr(mc, "_front_month_price_from_archive", lambda market, d: 4000.0)
    monkeypatch.setattr(mc, "_backfill_archive_prices", lambda db_: None)
    return dates, (lambda: mc._fetch_and_upsert(db)), db, yf_calls


def _cot_rows(db, symbol):
    return {r.date for r in db.query(CommodityCot).filter_by(symbol=symbol)}


def test_fresh_db_ingests_full_window(healing_env):
    dates, run, db, _ = healing_env
    run()
    assert _cot_rows(db, "arabica") == set(dates)
    assert _cot_rows(db, "robusta") == set(dates)


def test_hole_healed_without_new_data(healing_env):
    # The 2026-06-30 scenario: arabica complete, robusta missing the middle
    # week. Latest arabica == DB latest ("no new data"), but the run must still
    # proceed and fill the robusta hole instead of returning early.
    dates, run, db, _ = healing_env
    for d in dates:
        upsert_commodity_cot(db, "arabica", d, {"mm_long": 1, "mm_short": 1, "mm_spread": 1, "oi_total": 1})
    for d in (dates[0], dates[2]):
        upsert_commodity_cot(db, "robusta", d, {"mm_long": 1, "mm_short": 1, "mm_spread": 1, "oi_total": 1})
    run()
    assert _cot_rows(db, "robusta") == set(dates)


def test_complete_window_skips_early(healing_env):
    # Everything present (positions AND prices) → the run no-ops before any
    # price fetching.
    dates, run, db, yf_calls = healing_env
    for sym in ("arabica", "robusta"):
        for d in dates:
            upsert_commodity_cot(db, sym, d, {"mm_long": 1, "mm_short": 1, "mm_spread": 1, "oi_total": 1})
            upsert_commodity_price(db, sym, d, 123.0)
    run()
    assert yf_calls == []


def test_deep_heal_env_forces_upsert_on_complete_window(healing_env, monkeypatch):
    # Complete window would normally no-op; MACRO_COT_HEAL_WEEKS forces the
    # upsert phase so stale/corrupt rows get overwritten by the re-parse.
    dates, run, db, _ = healing_env
    for sym in ("arabica", "robusta"):
        for d in dates:
            upsert_commodity_cot(db, sym, d, {"mm_long": 1, "mm_short": 1, "mm_spread": 1, "oi_total": 1})
            upsert_commodity_price(db, sym, d, 123.0)
    monkeypatch.setenv("MACRO_COT_HEAL_WEEKS", "3")
    run()
    from models import CommodityCot
    row = db.query(CommodityCot).filter_by(symbol="arabica", date=dates[-1]).first()
    # Overwritten with the parsed frame's values (oi 200_002), not the seeded 1s
    assert row.oi_total == 200_002


def test_insane_stored_price_is_refetched(healing_env):
    # A poisoned price row (dead-feed garbage) must be treated as missing and
    # refetched, not skipped — the ZR=F rough-rice failure mode.
    dates, run, db, yf_calls = healing_env
    for d in dates:
        upsert_commodity_price(db, "arabica", d, 3.2)     # sane history
    upsert_commodity_price(db, "arabica", dates[-1], 900.0)  # poisoned latest
    run()
    assert ("arabica", dates[-1]) in set(yf_calls[0])
    from models import CommodityPrice
    row = db.query(CommodityPrice).filter_by(symbol="arabica", date=dates[-1]).first()
    assert row.close_price == 100.0  # overwritten by the (mocked) refetch


def test_price_holes_fetched_only_for_missing_pairs(healing_env):
    dates, run, db, yf_calls = healing_env
    run()
    # arabica (yfinance-sourced) prices exist for the whole window now
    priced = {r.date for r in db.query(CommodityPrice).filter_by(symbol="arabica")}
    assert priced == set(dates)
    first_call_pairs = set(yf_calls[0])
    assert {("arabica", d) for d in dates} <= first_call_pairs
    # robusta is archive-sourced (never via yfinance)
    assert all(sym != "robusta" for sym, _ in first_call_pairs)
    # Second run: everything priced → no further yfinance calls
    yf_calls.clear()
    run()
    assert yf_calls == []
