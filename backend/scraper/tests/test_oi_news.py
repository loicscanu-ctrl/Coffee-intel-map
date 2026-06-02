"""Wording + matrix test for the daily-OI news-feed commentary."""
from scraper.oi_news_emit import _compute_commentary_for_market


def _day(date: str, contracts: list[tuple[str, int, float | None]]) -> dict:
    """Build a snapshot day from (symbol, oi, last_price) triples."""
    return {
        "date": date,
        "contracts": [
            {"symbol": s, "oi": oi, "last_price": p} for s, oi, p in contracts
        ],
    }


def test_long_building_when_price_up_and_oi_up():
    days = [
        _day("2026-06-02", [("KCN26", 50_000, 195.0), ("KCU26", 30_000, 192.0),
                            ("KCZ26", 18_000, 188.0), ("KCH27",  5_000, 185.0)]),
        _day("2026-06-01", [("KCN26", 48_000, 192.0), ("KCU26", 30_020, None),
                            ("KCZ26", 17_580, None), ("KCH27",  5_000, None)]),
    ]
    text = _compute_commentary_for_market("IFUS KC", days)
    assert text is not None
    # Total OI: 103,000 - 100,600 = +2,400; nearby (first 2): 80,000 - 78,020 = +1,980;
    # forward: +2,400 - +1,980 = +420
    assert "IFUS KC Open Interest changed by +2,400" in text
    assert "+1,980 on nearby two contracts" in text
    assert "+420 on forward contracts" in text
    assert "PRICE UP, LONG BUILDING" in text


def test_short_liquidation_when_price_up_and_oi_down():
    """Price up + OI down = shorts covering = SHORT LIQUIDATION."""
    days = [
        _day("2026-06-02", [("KCN26", 48_000, 195.0), ("KCU26", 29_000, 192.0)]),
        _day("2026-06-01", [("KCN26", 50_000, 192.0), ("KCU26", 30_000, None)]),
    ]
    text = _compute_commentary_for_market("IFUS KC", days)
    assert text is not None
    assert "PRICE UP, SHORT LIQUIDATION" in text
    # Total: 77,000 - 80,000 = -3,000
    assert "changed by -3,000" in text


def test_long_liquidation_when_price_down_and_oi_down():
    days = [
        _day("2026-06-02", [("KCN26", 48_000, 188.0), ("KCU26", 29_000, 185.0)]),
        _day("2026-06-01", [("KCN26", 50_000, 192.0), ("KCU26", 30_000, None)]),
    ]
    text = _compute_commentary_for_market("IFUS KC", days)
    assert "PRICE DOWN, LONG LIQUIDATION" in text


def test_short_building_when_price_down_and_oi_up():
    days = [
        _day("2026-06-02", [("KCN26", 52_000, 188.0), ("KCU26", 31_000, 185.0)]),
        _day("2026-06-01", [("KCN26", 50_000, 192.0), ("KCU26", 30_000, None)]),
    ]
    text = _compute_commentary_for_market("IFUS KC", days)
    assert "PRICE DOWN, SHORT BUILDING" in text


def test_returns_none_without_price_direction():
    """Flat price (or no price on either day) → no regime, skip."""
    days = [
        _day("2026-06-02", [("KCN26", 50_000, 192.0)]),
        _day("2026-06-01", [("KCN26", 49_000, 192.0)]),
    ]
    assert _compute_commentary_for_market("IFUS KC", days) is None


def test_returns_none_with_only_one_day():
    days = [_day("2026-06-02", [("KCN26", 50_000, 192.0)])]
    assert _compute_commentary_for_market("IFUS KC", days) is None


def test_returns_none_with_no_data():
    assert _compute_commentary_for_market("IFUS KC", []) is None
