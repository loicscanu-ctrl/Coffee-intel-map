"""Commentary builder — renders factual news-feed badges from a template + context.

Scrapers compute deltas and build a context dict, then call:

    from scraper.commentary import render
    text = render("ice_certified_stocks", {
        "market":         "KC Arabica",
        "delta_signed":   "-2,400",
        "units":          "bags",
        "total":          "842,100",
        "grading_delta":  12,
        "decert_delta":   8,
        "port":           "Antwerp",
    })

The text is then embedded under a `_commentary` key inside the existing
`meta` JSON string of a NewsItem. The news.json exporter unpacks that key
back to a top-level `commentary` field for the frontend.

Templates live in `templates.json` next to this file so the wording can be
tweaked without code changes. The Jinja `StrictUndefined` policy means a
missing context key fails loudly at render time rather than silently
producing "{{ var }}" in the news feed.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jinja2 import Environment, StrictUndefined, TemplateError

_TEMPLATES_PATH = Path(__file__).resolve().parent / "templates.json"


class CommentaryError(RuntimeError):
    """Raised when a template is missing or rendering fails."""


@lru_cache(maxsize=1)
def _env() -> Environment:
    env = Environment(
        undefined=StrictUndefined,
        autoescape=False,
        trim_blocks=False,
        lstrip_blocks=False,
    )
    # Numeric helpers — every scraper formats deltas the same way.
    env.filters["signed"]  = _filter_signed
    env.filters["thousep"] = _filter_thousep
    return env


@lru_cache(maxsize=1)
def _templates() -> dict[str, str]:
    raw = json.loads(_TEMPLATES_PATH.read_text(encoding="utf-8"))
    # Drop comment keys (anything starting with "_") so callers can't render them.
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def render(event_type: str, ctx: dict) -> str:
    """Render the template for `event_type` with `ctx`. Raises CommentaryError
    on a missing template or any Jinja rendering failure (including missing
    context keys, courtesy of StrictUndefined)."""
    tmpls = _templates()
    if event_type not in tmpls:
        raise CommentaryError(f"Unknown commentary event_type: {event_type!r}")
    try:
        return _env().from_string(tmpls[event_type]).render(**ctx).strip()
    except TemplateError as e:
        raise CommentaryError(f"Render failed for {event_type!r}: {e}") from e


# ── Helpers callers can reuse so all templates emit identical number shapes ──

def signed(n: float | int, *, decimals: int = 0) -> str:
    """`+1,234` / `-1,234` / `0` — always includes the sign for nonzero, with
    thousands separator. Used in every template that shows a delta."""
    if n == 0:
        return "0"
    fmt = f"{{:+,.{decimals}f}}"
    return fmt.format(n)


def thousep(n: float | int, *, decimals: int = 0) -> str:
    """`1,234,567` — no sign. Used for totals/absolute numbers."""
    fmt = f"{{:,.{decimals}f}}"
    return fmt.format(n)


def _filter_signed(value, decimals: int = 0) -> str:
    return signed(float(value), decimals=decimals)


def _filter_thousep(value, decimals: int = 0) -> str:
    return thousep(float(value), decimals=decimals)


# ── Exporter helper ──────────────────────────────────────────────────────────
# Kept here (rather than in scraper.exporters.news) so unit tests can exercise
# the round-trip without dragging in sqlalchemy / models / database via the
# news exporter's module-level imports.

def extract_commentary_from_meta(meta_str: str | None) -> dict | None:
    """Lift the `_commentary` block out of a NewsItem.meta JSON string so the
    frontend reads it from a top-level `commentary` field instead of reaching
    into a stringified blob.

    Scrapers that emit a commentary badge embed it under a `_commentary` key
    inside their existing meta payload — that keeps the DB schema unchanged
    while letting the exporter promote the block to a structured field.

    Returns None when meta is missing, not JSON, not a dict, or doesn't carry
    a non-empty `_commentary.text`. Older meta payloads (a JSON list, scalar,
    or a plain non-JSON string) flow through unchanged because nothing here
    mutates them.
    """
    if not meta_str:
        return None
    try:
        parsed = json.loads(meta_str)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    block = parsed.get("_commentary")
    if not isinstance(block, dict) or not block.get("text"):
        return None
    return {
        "text":               block["text"],
        "hasUpdate":          bool(block.get("hasUpdate", True)),
        "isLatestTradingDay": bool(block.get("isLatestTradingDay", False)),
    }


def embed_commentary(meta: dict, *, text: str, has_update: bool = True,
                     is_latest_trading_day: bool = False) -> dict:
    """Helper for scrapers: embed a `_commentary` block in a meta dict that
    will later be JSON-stringified and stored on NewsItem.meta. Idempotent —
    callers can re-invoke and the latest text wins."""
    meta["_commentary"] = {
        "text":               text,
        "hasUpdate":          has_update,
        "isLatestTradingDay": is_latest_trading_day,
    }
    return meta
