"""Shared helpers for the coffee-import scrapers."""

from __future__ import annotations


def merge_monthly(old: dict | None, new: dict | None) -> dict:
    """Union two {'YYYY-MM': value} maps into a sorted history.

    New values override old for the same month (so revisions to recent months are
    picked up), but months only present in `old` are preserved. This lets each
    scraper run *extend* the stored monthly series with newly-published months
    instead of replacing it with whatever short rolling window the source serves
    — i.e. the committed JSON becomes a growing archive."""
    merged = dict(old or {})
    for k, v in (new or {}).items():
        if v is not None:
            merged[k] = v
    return {k: merged[k] for k in sorted(merged)}


def merge_origin_monthly(old_origins: list[dict] | None, new_origins: list[dict]) -> list[dict]:
    """Merge per-origin `monthly` maps from a previous file into freshly-parsed
    origins (in place on the new list), keying by origin name."""
    old_by_name = {o.get("name"): (o.get("monthly") or {}) for o in (old_origins or [])}
    for o in new_origins:
        merged = merge_monthly(old_by_name.get(o.get("name")), o.get("monthly"))
        if merged:
            o["monthly"] = merged
    return new_origins
