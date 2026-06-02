"""Wording + math test for CECAFE → news-feed commentary."""
from scraper.fetch_cecafe import _compute_commentary


def _row(date: str, total: int) -> dict:
    """Minimal CECAFE series row — _compute_commentary only reads date and total."""
    return {"date": date, "total": total, "arabica": 0, "conillon": 0}


def test_cecafe_renders_factual_tons_and_seasonal_pct():
    # 5 historical Junes averaging ~3,000,000 bags each; latest = 3,300,000.
    series = [
        _row("2021-06", 2_900_000),
        _row("2022-06", 3_000_000),
        _row("2023-06", 3_100_000),
        _row("2024-06", 2_950_000),
        _row("2025-06", 3_050_000),
        _row("2026-06", 3_300_000),  # latest
    ]
    result = _compute_commentary(series)
    assert result is not None
    period, text = result
    assert period == "2026-06"
    assert "Brazil shipping velocity reports" in text
    # 3,300,000 bags × 60kg / 1000 = 198,000 tons
    assert "198,000 tons" in text
    # Seasonal median of [2.9M, 3.0M, 3.1M, 2.95M, 3.05M] = 3.0M
    # (3.3M - 3.0M) / 3.0M = +10.0%
    assert "+10.0%" in text


def test_cecafe_insufficient_history_returns_none():
    """Need at least 3 prior same-month rows for a credible seasonal reference."""
    series = [
        _row("2025-06", 3_050_000),
        _row("2026-06", 3_300_000),
    ]
    assert _compute_commentary(series) is None


def test_cecafe_empty_series_returns_none():
    assert _compute_commentary([]) is None


def test_cecafe_zero_latest_returns_none():
    """A zero-volume month likely means a stale/incomplete row — don't render."""
    series = [
        _row("2021-06", 3_000_000),
        _row("2022-06", 3_000_000),
        _row("2023-06", 3_000_000),
        _row("2026-06", 0),
    ]
    assert _compute_commentary(series) is None


def test_cecafe_negative_pct_when_below_seasonal():
    """Verify the signed format renders a minus sign when latest underperforms."""
    series = [
        _row("2021-06", 3_000_000),
        _row("2022-06", 3_000_000),
        _row("2023-06", 3_000_000),
        _row("2024-06", 3_000_000),
        _row("2025-06", 3_000_000),
        _row("2026-06", 2_700_000),  # -10% vs seasonal median
    ]
    _, text = _compute_commentary(series)
    assert "-10.0%" in text
