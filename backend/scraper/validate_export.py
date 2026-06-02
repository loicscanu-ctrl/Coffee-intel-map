"""
validate_export.py
Per-file validation for static JSON exports.

Each validate_* function receives the in-memory payload and returns
(passed: bool, reason: str).  Called by safe_write_json before any write.
"""
from __future__ import annotations

import json
import re
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


def _first_number(value) -> float | None:
    """Parse the leading numeric value out of a ticker `value` field.

    Ticker values are display strings, e.g. '273.45', '100,000 VND ($1,234)',
    '1.0552 (…)'. We compare the first number (thousands-separators stripped):
        '100,000 VND ($1,234)' → 100000.0
        '1.0552 (…)'           → 1.0552
    """
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    m = re.search(r"-?\d[\d,]*\.?\d*", value)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


# ── cross-run sanity (volatility) guards ──────────────────────────────────────

def price_swing_guard(threshold: float = 0.30):
    """Build an (old, new) -> (ok, reason) guard for latest_prices-shaped data.

    Rejects the new payload when any ticker's leading numeric value moved more
    than `threshold` (fractional) versus the same-label ticker in the previous
    good file. This catches unit/parse breaks that pass type, shape and
    freshness checks — e.g. the VN FAQ price read as 10,000 instead of 100,000
    VND, or an FX rate dropping a digit.
    """
    def _check(old: dict, new: dict) -> tuple[bool, str]:
        if not isinstance(old, dict) or not isinstance(new, dict):
            return True, "ok"  # nothing comparable → don't block
        old_by_label = {
            t.get("label"): t.get("value")
            for t in (old.get("tickers") or [])
            if isinstance(t, dict)
        }
        for t in (new.get("tickers") or []):
            if not isinstance(t, dict):
                continue
            new_v = _first_number(t.get("value"))
            old_v = _first_number(old_by_label.get(t.get("label")))
            if old_v is None or new_v is None or old_v == 0:
                continue
            change = abs(new_v - old_v) / abs(old_v)
            if change > threshold:
                return False, (
                    f"{t.get('label')} swung {change * 100:.0f}% "
                    f"({old_v:g} → {new_v:g}), suspected parsing error"
                )
        return True, "ok"

    return _check


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
    # v2 schema: per-source buckets under data["sources"]["embarques"|"certificados"].
    # v1 legacy: arabica/conillon/soluvel at the top level (came from the
    # Certificados de Origem table). Accept BOTH so the dual-source migration
    # doesn't get rejected and reverted by the workflow's validate step (which
    # was the bug that kept embarques from ever committing).
    sources = data.get("sources")
    if isinstance(sources, dict):
        # Valid if ANY source carries arabica or conillon data.
        for src_name, bucket in sources.items():
            if not isinstance(bucket, dict):
                continue
            if (bucket.get("arabica") or {}) or (bucket.get("conillon") or {}):
                return True, f"ok (v2, source={src_name})"
        return False, "v2 schema but no source has arabica/conillon data"
    # Legacy fallback.
    arabica = data.get("arabica") or {}
    conillon = data.get("conillon") or {}
    if not arabica and not conillon:
        return False, "no arabica or conillon data"
    return True, "ok (v1 legacy)"


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

def safe_write_json(path, payload, validate_fn, indent: int = 2, sanity_fn=None) -> bool:
    """
    Validate payload then write to path atomically via a .tmp file.

    `validate_fn(payload) -> (ok, reason)` checks the new payload in isolation
    (shape, freshness). `sanity_fn(old_payload, new_payload) -> (ok, reason)` is
    an optional cross-run guard compared against the last good file (e.g. a
    volatility/price-swing check); it is skipped on the first-ever write.

    Returns True if written, False if validation/sanity failed or the content
    is unchanged. On failure the existing file at `path` is left untouched.
    """
    ok, reason = validate_fn(payload)
    if not ok:
        name = Path(path).name
        print(f"[validate] {name} FAILED: {reason} — keeping existing file")
        return False

    serialized = json.dumps(payload, indent=indent)

    # Read the existing file once (as text) — reused by the sanity guard and the
    # content short-circuit below.
    p = Path(path)
    existing = None
    if p.exists():
        try:
            existing = p.read_text(encoding="utf-8")
        except Exception:
            existing = None  # unreadable/corrupt → treat as no prior

    # Cross-run sanity guard (volatility). It needs the parsed prior payload, so
    # we only pay the json.loads cost when a guard is actually supplied — not on
    # every one of the ~21 files. Skipped on the first-ever write.
    if sanity_fn is not None and existing is not None:
        try:
            old_payload = json.loads(existing)
        except Exception:
            old_payload = None
        if old_payload is not None:
            ok2, reason2 = sanity_fn(old_payload, payload)
            if not ok2:
                print(f"[validate] {Path(path).name} SANITY FAILED: {reason2} — keeping existing file")
                return False

    # Content short-circuit: these files are always written as
    # json.dumps(payload, indent=indent), so comparing the on-disk text to the
    # freshly-serialized string is exact and skips a CPU-heavy JSON re-parse.
    # Makes the export idempotent and avoids pointless .tmp churn.
    if existing == serialized:
        return False

    tmp = Path(str(path) + ".tmp")
    tmp.write_text(serialized, encoding="utf-8")
    tmp.replace(path)
    return True
