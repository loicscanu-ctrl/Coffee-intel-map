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


# ── Wide → narrow mapping (for the cot_position child table migration) ────────

_CROP_SUFFIXES: dict[str, str] = {
    "":       "all",
    "_old":   "old",
    "_other": "other",
}
_CATEGORIES_BY_NAME = {cat: sides for cat, sides in _CATEGORIES_WITH_SPREAD}


def field_to_position(field_name: str) -> tuple[str, str, str, str] | None:
    """Parse a wide-table column name into (crop, category, side, kind).

    kind is "oi" for position fields and "traders" for the t_-prefixed
    trader-count fields. Returns None for non-position fields like
    oi_total, price_ny, structure_ny, etc.

    Examples:
        "mm_long"          -> ("all",   "mm",   "long",   "oi")
        "swap_spread_old"  -> ("old",   "swap", "spread", "oi")
        "t_pmpu_short"     -> ("all",   "pmpu", "short",  "traders")
        "price_ny"         -> None
    """
    name = field_name
    kind = "oi"
    if name.startswith("t_"):
        kind = "traders"
        name = name[2:]

    # Detect crop suffix (longest match wins so "_other" beats "")
    crop = "all"
    base = name
    for suffix in ("_other", "_old"):
        if name.endswith(suffix):
            crop = _CROP_SUFFIXES[suffix]
            base = name[: -len(suffix)]
            break

    # Trader counts only exist for crop=all in the wide schema
    if kind == "traders" and crop != "all":
        return None

    parts = base.rsplit("_", 1)
    if len(parts) != 2:
        return None
    cat, side = parts
    sides = _CATEGORIES_BY_NAME.get(cat)
    if not sides or side not in sides:
        return None

    return (crop, cat, side, kind)


def position_rows_from_fields(fields: dict[str, Any]) -> list[dict[str, Any]]:
    """Group a wide-style fields dict into one (crop, category, side) row per
    physical position, merging the oi and traders values for each row.

    Returns a list of dicts shaped like:
        {"crop": "all", "category": "mm", "side": "long",
         "oi": 50000, "traders": 30}

    Only includes rows that have at least one non-None value in the input.
    Used by upsert_cot_weekly to dual-write into the cot_position table.
    """
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for field_name, value in fields.items():
        parsed = field_to_position(field_name)
        if parsed is None:
            continue
        crop, cat, side, kind = parsed
        key = (crop, cat, side)
        if key not in grouped:
            grouped[key] = {"crop": crop, "category": cat, "side": side,
                            "oi": None, "traders": None}
        grouped[key][kind] = value
    # Drop rows where both oi and traders are None (defensive — shouldn't
    # happen since we only land here for parseable fields, but keeps the
    # output table clean if a caller passes literal None values).
    return [r for r in grouped.values()
            if r["oi"] is not None or r["traders"] is not None]


def cot_weekly_to_position_rows(row: Any) -> list[dict[str, Any]]:
    """Read every position-shaped column off a CotWeekly ORM row and return the
    corresponding cot_position rows. Used by the backfill script.

    Mirrors the contract of position_rows_from_fields but pulls values from
    the row's attributes instead of a fields dict, so the backfill script
    doesn't need to enumerate column names by hand.
    """
    fields: dict[str, Any] = {}
    for suffix in ("", "_old", "_other"):
        for name in _position_field_names(suffix):
            fields[name] = getattr(row, name, None)
    for name in _trader_count_field_names():
        fields[name] = getattr(row, name, None)
    return position_rows_from_fields(fields)
