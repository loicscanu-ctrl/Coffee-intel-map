"""Wording test for the Vietnam Robusta absorption-ratio badge.

Hits the pure render layer so the user's locked wording stays pinned without
spinning up a DB or fixture data.
"""
from scraper.commentary import render_absorption as _r


def _render_physical_absorption(*, phys_delta_usd_mt: int, futures_delta: int) -> str:
    """Thin shim binding the test to the Vietnam/London origin pair used in
    the user's reference example. The underlying helper is origin-agnostic."""
    return _r(
        origin="Vietnam Robusta",
        benchmark="London Robusta",
        phys_delta_usd_mt=phys_delta_usd_mt,
        futures_delta=futures_delta,
    )


def test_full_absorption_renders_100_percent():
    """London +100 / Vietnam +100 → 100% absorption."""
    text = _render_physical_absorption(phys_delta_usd_mt=100, futures_delta=100)
    assert text == (
        "Vietnam Robusta physical cash price adjusted by +100 USD/ton today "
        "while London Robusta moved by +100 USD/ton. 100% of the market change "
        "has gone into the local price."
    )


def test_partial_absorption_renders_correct_ratio():
    """User's spec example: London +100 / Vietnam +55 → 55% absorption."""
    text = _render_physical_absorption(phys_delta_usd_mt=55, futures_delta=100)
    assert "+55 USD/ton" in text
    assert "+100 USD/ton" in text
    assert "55% of the market change has gone into the local price" in text


def test_negative_session_both_sides_down():
    """London -100 / Vietnam -100 → 100% absorption (still factual, no sentiment)."""
    text = _render_physical_absorption(phys_delta_usd_mt=-100, futures_delta=-100)
    assert "-100 USD/ton" in text
    # Both deltas negative, ratio is positive (-100 / -100 × 100 = 100)
    assert "100% of the market change has gone into the local price" in text


def test_no_futures_move_uses_dedicated_template():
    """London 0 / Vietnam +30 → the no-move template fires, no ratio computed."""
    text = _render_physical_absorption(phys_delta_usd_mt=30, futures_delta=0)
    assert "no transmission ratio is computable" in text
    assert "+30 USD/ton" in text
    # The main template's percent string must not appear.
    assert "of the market change" not in text


def test_over_absorption_renders_above_100():
    """Vietnam overshoots London (e.g. supply panic) → > 100%, still rendered factually."""
    text = _render_physical_absorption(phys_delta_usd_mt=150, futures_delta=100)
    assert "150% of the market change has gone into the local price" in text


def test_opposite_direction_renders_negative_ratio():
    """Vietnam moves opposite of London — a real scenario (basis blowing out).
    The factual ratio is negative, which the template should render as a
    bare integer with leading minus (no `%` confusion)."""
    text = _render_physical_absorption(phys_delta_usd_mt=-30, futures_delta=100)
    assert "-30% of the market change has gone into the local price" in text
