"""Wording test for ECF European port stocks → news-feed commentary."""
from scraper.sources.ecf_stocks import _compute_commentary


def test_ecf_renders_net_delta_only_when_breakdown_missing():
    """Latest two entries have bag totals but no per-type breakdown — the
    template's type-split clause must disappear."""
    series = [
        {"period": "2026-03", "value_raw": 12_000_000},  # 12M bags = 720,000 t
        {"period": "2026-04", "value_raw": 12_500_000},  # 12.5M bags = 750,000 t → +30,000 t
    ]
    text = _compute_commentary(series)
    assert text is not None
    assert "ECF Inventory Release: Total European port stocks shifted by +30,000 tons" in text
    # No arabica/robusta clause
    assert "Type split" not in text
    assert "Arabica" not in text


def test_ecf_renders_type_split_when_breakdown_present():
    """Both rows carry breakdown → the clause fires with arabica/robusta deltas."""
    series = [
        {
            "period": "2026-03", "value_raw": 12_000_000,
            "arabica_washed_mt": 500_000, "arabica_unwashed_mt": 100_000, "robusta_mt": 120_000,
        },
        {
            "period": "2026-04", "value_raw": 12_500_000,
            "arabica_washed_mt": 520_000, "arabica_unwashed_mt": 105_000, "robusta_mt": 125_000,
        },
    ]
    text = _compute_commentary(series)
    assert text is not None
    # arabica delta = (520+105) - (500+100) = 25,000 MT
    assert "+25,000 tons in Arabica" in text
    assert "+5,000 tons in Robusta" in text


def test_ecf_returns_none_for_short_series():
    """ECF needs two entries to compute a delta."""
    assert _compute_commentary([]) is None
    assert _compute_commentary([{"period": "2026-04", "value_raw": 12_000_000}]) is None


def test_ecf_returns_none_when_both_totals_zero():
    """A pair of placeholder/zero rows shouldn't produce commentary."""
    series = [
        {"period": "2026-03", "value_raw": 0},
        {"period": "2026-04", "value_raw": 0},
    ]
    assert _compute_commentary(series) is None
