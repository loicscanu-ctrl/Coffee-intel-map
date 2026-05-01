"""
cot_schema — single source of truth for the CotWeekly serialization shape.

The cot_weekly table is denormalized: each row carries ~50 position fields
spanning category × side × crop-split, plus trader counts and per-market
extras. Two callers (routes/cot.py and scraper/export_static_json.py) used
to copy-paste near-identical dict builders that diverged subtly. This module
generates the dict programmatically so adding a new field is a one-line
change in one place — and the unit test locks the wire format.

Key design points:
  * Output dict KEY ORDER must remain stable. Downstream consumers compare
    JSON output across runs; reordering would produce noisy diffs.
  * The API endpoint (/api/cot) drops the old/other crop-split fields; the
    static export (cot.json) keeps them. Toggle via include_crop_split.
"""
from __future__ import annotations

from typing import Any

# Position categories and their sides. pmpu and nr do not have a "spread"
# column — only swap / mm / other do.
_CATEGORIES_WITH_SPREAD: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("pmpu",  ("long", "short")),
    ("swap",  ("long", "short", "spread")),
    ("mm",    ("long", "short", "spread")),
    ("other", ("long", "short", "spread")),
    ("nr",    ("long", "short")),
)

# Per-market data points joined onto the weekly row from the COT Excel
# "Other" sheet. Same names for ny/ldn variants.
_MARKET_EXTRAS: tuple[str, ...] = (
    "price", "structure", "exch_oi", "vol", "efp", "spread_vol",
)
_MARKETS: tuple[str, ...] = ("ny", "ldn")


def _position_field_names(suffix: str = "") -> list[str]:
    """e.g. suffix='' → ['pmpu_long','pmpu_short',...]; '_old'/'_other' for crop splits."""
    return [
        f"{cat}_{side}{suffix}"
        for cat, sides in _CATEGORIES_WITH_SPREAD
        for side in sides
    ]


def _trader_count_field_names() -> list[str]:
    """Trader-count columns mirror the position columns with a 't_' prefix."""
    return [f"t_{name}" for name in _position_field_names()]


def _market_extra_field_names() -> list[str]:
    """e.g. ['price_ny','price_ldn','structure_ny',...]"""
    return [f"{base}_{mkt}" for base in _MARKET_EXTRAS for mkt in _MARKETS]


def serialize_cot_row(row: Any, *, include_crop_split: bool = False) -> dict[str, Any]:
    """
    Build the JSON-shaped dict for a CotWeekly row using getattr — same
    field names, same key order as the prior hand-written copy-paste.
    Set include_crop_split=True to include the NY-only old/other crop fields
    (used by the static export but not the API).
    """
    out: dict[str, Any] = {"oi_total": getattr(row, "oi_total", None)}
    for name in _position_field_names():
        out[name] = getattr(row, name, None)
    for name in _trader_count_field_names():
        out[name] = getattr(row, name, None)
    if include_crop_split:
        for suffix in ("_old", "_other"):
            for name in _position_field_names(suffix):
                out[name] = getattr(row, name, None)
    for name in _market_extra_field_names():
        out[name] = getattr(row, name, None)
    return out
