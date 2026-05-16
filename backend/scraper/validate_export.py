"""
validate_export.py
Per-file validation for static JSON exports.

Each validate_* function receives the in-memory payload and returns
(passed: bool, reason: str).  Called by safe_write_json before any write.
"""
from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

# ── helpers ───────────────────────────────────────────────────────────────────

def _days_since_iso(iso_str: str) -> float:
    """Days since an ISO-8601 datetime string (handles Z and +00:00)."""
    try:
        s = iso_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return (datetime.now(UTC) - dt).total_seconds() / 86400
    except Exception:
        return float("inf")


def _days_since_date(date_str: str) -> int:
    """Days since a YYYY-MM-DD date string."""
    try:
        return (date.today() - date.fromisoformat(date_str)).days
    except Exception:
        return 9999


# ── validators ────────────────────────────────────────────────────────────────

def validate_futures_chain(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    for market in ("arabica", "robusta"):
        if data.get(market) is None:
            return False, f"missing {market}"
        contracts = data[market].get("contracts", [])
        if len(contracts) < 5:
            return False, f"{market} has {len(contracts)} contracts (need >= 5)"
        pub_date = data[market].get("pub_date")
        if pub_date and _days_since_date(pub_date) > 7:
            return False, f"{market} pub_date {pub_date} is > 7 days old"
    return True, "ok"


def validate_farmer_economics(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if data.get("weather") is None:
        return False, "weather is null"
    items = (data.get("fertilizer") or {}).get("items", [])
    if not items:
        return False, "fertilizer.items is empty"
    scraped_at = data.get("scraped_at")
    if scraped_at and _days_since_iso(scraped_at) > 2:
        return False, f"scraped_at {scraped_at} is > 48 h old"
    return True, "ok"


def validate_cot(data: list) -> tuple[bool, str]:
    if not isinstance(data, list) or len(data) == 0:
        return False, "empty list"
    report_date = data[-1].get("date") or data[-1].get("report_date")
    if report_date and _days_since_date(report_date) > 14:
        return False, f"most recent date {report_date} is > 14 days old"
    return True, "ok"


def validate_cot_recent(data: list) -> tuple[bool, str]:
    if not isinstance(data, list) or len(data) == 0:
        return False, "empty list"
    return True, "ok"


def validate_health(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if "scrapers" not in data:
        return False, "missing scrapers key"
    return True, "ok"


def validate_macro_cot(data: list) -> tuple[bool, str]:
    if not isinstance(data, list) or len(data) == 0:
        return False, "empty list"
    return True, "ok"


def validate_freight(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if not data.get("routes"):
        return False, "routes list is empty"
    return True, "ok"


def validate_oi_fnd_chart(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    for market in ("arabica", "robusta"):
        if market not in data:
            return False, f"missing {market}"
    return True, "ok"


def validate_oi_history(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    for market in ("arabica", "robusta"):
        rows = data.get(market) or []
        if not rows:
            return False, f"{market} rows are empty"
    return True, "ok"


def validate_quant_report(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    ci = data.get("currency_index")
    if not ci:
        return False, "currency_index is empty"

    # Staleness gate — if yfinance silently degrades (the 2026-05-11
    # onwards Yahoo Finance / GH Actions IP block produced empty-output
    # runs that still wrote a CCI section from the previous run via the
    # merge-into-existing logic), reject so the workflow's git checkout
    # fallback keeps the prior good file rather than committing stale data.
    scraped_at = ci.get("scraped_at") if isinstance(ci, dict) else None
    if not scraped_at:
        return False, "currency_index.scraped_at missing"
    try:
        from datetime import UTC, datetime, timedelta
        dt = datetime.fromisoformat(str(scraped_at).replace("Z", "+00:00"))
        age = datetime.now(UTC) - dt
        if age > timedelta(days=3):
            return False, f"currency_index.scraped_at is {age.days}d old"
    except Exception as e:
        return False, f"could not parse scraped_at ({e})"

    # currency_index.currencies must be non-empty and at least half the
    # 12 tracked pairs must have a non-null daily_chg — otherwise the
    # downstream sum would be biased by all the implicit zeros.
    currencies = ci.get("currencies") if isinstance(ci, dict) else None
    if not currencies or not isinstance(currencies, list):
        return False, "currency_index.currencies missing or wrong type"
    with_chg = sum(1 for c in currencies if c.get("daily_chg") is not None)
    if with_chg < len(currencies) // 2:
        return False, f"only {with_chg}/{len(currencies)} currencies have daily_chg"

    return True, "ok"


def validate_cecafe_daily(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    arabica = data.get("arabica") or {}
    conillon = data.get("conillon") or {}
    if not arabica and not conillon:
        return False, "no arabica or conillon data"
    return True, "ok"


def validate_earnings(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if not data.get("companies"):
        return False, "companies list is empty"
    return True, "ok"


def validate_kaffeesteuer(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if len(data) == 0:
        return False, "empty dict — no monthly records"
    return True, "ok"


# ── write helper ──────────────────────────────────────────────────────────────

def safe_write_json(path, payload, validate_fn, indent: int = 2) -> bool:
    """
    Validate payload then write to path atomically via a .tmp file.

    Returns True if written, False if validation failed.
    On failure the existing file at `path` is left untouched.
    """
    ok, reason = validate_fn(payload)
    if not ok:
        name = Path(path).name
        print(f"[validate] {name} FAILED: {reason} — keeping existing file")
        return False

    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(payload, indent=indent), encoding="utf-8")
    tmp.replace(path)
    return True
