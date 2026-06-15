"""Wording test for the COT release news-feed commentary.

Exercises `_cot_commentary` directly so the badge stays pinned without
running the full CFTC/ICE scrape pipeline.
"""
from scraper.sources.futures import _cot_commentary


def test_cot_release_renders_factual_summary_ny():
    text = _cot_commentary(
        market="NY Arabica (KC)",
        oi_delta=3_200,
        pmpu_long_delta=1_200,
        pmpu_short_delta=-800,
        mm_long_delta=2_000,
        mm_short_delta=-500,
    )
    assert text is not None
    assert "CFTC Release for NY Arabica (KC)" in text
    # No price line — neither scraper has price WoW in scope at this point.
    assert "Price" not in text
    assert "Total OI up +3,200 WoW" in text
    # Industry Long: +1,200 → increased by 1,200
    assert "Industry Long increased by 1,200 lots" in text
    # Industry Short: -800 → decreased by 800 (abs value, no minus sign)
    assert "Industry Short decreased by 800 lots" in text
    # MM net delta: +2,000 - (-500) = +2,500 → increased
    assert "Managed Money increased their net exposure by 2,500 contracts" in text


def test_cot_release_renders_ldn():
    text = _cot_commentary(
        market="London Robusta (RC)",
        oi_delta=-1_500,
        pmpu_long_delta=0,
        pmpu_short_delta=0,
        mm_long_delta=-1_000,
        mm_short_delta=200,
    )
    assert "CFTC Release for London Robusta (RC)" in text
    assert "Total OI down -1,500 WoW" in text
    # MM net delta: -1,000 - 200 = -1,200 → decreased
    assert "Managed Money decreased their net exposure by 1,200 contracts" in text


def test_cot_release_handles_flat_industry():
    """Both PMPU deltas zero → wording stays factual ('increased by 0 lots' is
    accurate even if a little stilted; we don't editorialise)."""
    text = _cot_commentary(
        market="NY Arabica (KC)",
        oi_delta=100,
        pmpu_long_delta=0,
        pmpu_short_delta=0,
        mm_long_delta=50,
        mm_short_delta=0,
    )
    assert "Industry Long increased by 0 lots" in text
    assert "Industry Short increased by 0 lots" in text
