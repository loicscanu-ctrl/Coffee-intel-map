"""
vietnam_supply.py — scrape Vietnam coffee export data and fertilizer import context.

Exports source chain (highest priority first):
  1. Vietnam Customs 2x monthly bulletins (customs.gov.vn) — primary source as of
     2026-05. Scraped by vn_coffee_export.run() in the monthly Playwright session,
     persisted to backend/scraper/cache/vn_coffee_export.json. ~10-day publication
     lag (e.g. Dec 2024 published Jan 10 2025). Same publication system as our
     existing vn_fertilizer 1n imports, just filtered for type "2x" (xuất khẩu).
  2. ICO historical CSV (www.ico.org) — legacy fallback. Started returning 403
     from cloud IPs in Sep 2024 but kept in case the WAF behaviour reverses.
  3. Static vn_export_destination_port.json — final backstop, frozen at 2024-08.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import datetime

import requests

logger = logging.getLogger(__name__)

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}

# ICO historical exports CSV — "2b - Exports of green coffee"
# Rows = exporting countries, columns = coffee-year months (e.g. "2023 Jan")
_ICO_CSV_URL = (
    "https://www.ico.org/historical/1990%20onwards/CSV/"
    "2b%20-%20Exports%20of%20green%20coffee.csv"
)

_VIET_NAMES = {"viet nam", "vietnam", "viet-nam"}

# ── ICO CSV parser ────────────────────────────────────────────────────────────

def _parse_ico_exports(content: str) -> list[dict]:
    """Parse ICO green coffee export CSV. Returns list of {month, total_k_bags} dicts."""
    reader = csv.DictReader(io.StringIO(content))
    rows   = list(reader)

    # Find Vietnam row (first column is country name)
    country_col = reader.fieldnames[0] if reader.fieldnames else "Country"
    viet_row = next(
        (r for r in rows if r.get(country_col, "").strip().lower() in _VIET_NAMES),
        None,
    )
    if viet_row is None:
        logger.warning("[vietnam_supply] ICO CSV: Vietnam row not found")
        return []

    monthly: list[dict] = []
    for col, val in viet_row.items():
        if col == country_col:
            continue
        col = col.strip()
        # ICO format: "2023 Jan", "2023 Feb", ...
        m = re.match(r"(\d{4})\s+([A-Za-z]{3})", col)
        if not m:
            continue
        year_str, mon_str = m.group(1), m.group(2)
        try:
            dt = datetime.strptime(f"{year_str} {mon_str}", "%Y %b")
        except ValueError:
            continue
        month_key = f"{dt.year}-{dt.month:02d}"
        try:
            bags_k = float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            continue
        if bags_k <= 0:
            continue
        monthly.append({"month": month_key, "total_k_bags": round(bags_k, 1)})

    # Sort chronologically; keep last 36 months
    monthly.sort(key=lambda x: x["month"])
    if len(monthly) > 36:
        monthly = monthly[-36:]

    # Add YoY % per row
    by_month: dict[str, float] = {r["month"]: r["total_k_bags"] for r in monthly}
    result = []
    for r in monthly:
        y, mo = r["month"].split("-")
        prev_key = f"{int(y)-1}-{mo}"
        prev = by_month.get(prev_key)
        yoy = round((r["total_k_bags"] - prev) / prev * 100, 1) if prev else None
        result.append({**r, "yoy_pct": yoy})

    return result


def _fetch_customs_exports() -> list[dict]:
    """Read monthly coffee exports from vn_coffee_export cache (tonnes → k_bags)."""
    import json as _json
    from pathlib import Path as _Path
    cache = (
        _Path(__file__).resolve().parents[2]
        / "scraper" / "cache" / "vn_coffee_export.json"
    )
    if not cache.exists():
        return []
    try:
        data = _json.loads(cache.read_text(encoding="utf-8"))
        monthly = data.get("monthly") or []
        out: list[dict] = []
        for r in monthly:
            t = r.get("tonnes") or 0
            if t <= 0:
                continue
            out.append({
                "month":        r["month"],
                "total_k_bags": round(t / 60, 1),
            })
        return sorted(out, key=lambda r: r["month"])
    except Exception as e:
        logger.warning(f"[vietnam_supply] vn_coffee_export cache read failed: {e}")
        return []


def _fetch_ico_exports() -> list[dict]:
    """Try ICO CSV. Empty list on any failure."""
    try:
        resp = requests.get(_ICO_CSV_URL, headers=_HEADERS, timeout=30)
        if resp.status_code != 200:
            return []
        parsed = _parse_ico_exports(resp.text)
        # _parse_ico_exports already adds yoy_pct + truncates; strip yoy for merge.
        return [{"month": r["month"], "total_k_bags": r["total_k_bags"]} for r in parsed]
    except Exception as e:
        logger.warning(f"[vietnam_supply] ICO fetch failed: {e}")
        return []


def _fetch_static_exports() -> list[dict]:
    """Read monthly_total (MT) from vn_export_destination_port.json → k_bags."""
    import json as _json
    from pathlib import Path as _Path
    port_file = (
        _Path(__file__).resolve().parents[3]
        / "frontend" / "public" / "data" / "vn_export_destination_port.json"
    )
    if not port_file.exists():
        return []
    try:
        data = _json.loads(port_file.read_text(encoding="utf-8"))
        mt_by_month: dict = data.get("monthly_total", {})
        if not mt_by_month:
            return []
        return [
            {"month": m, "total_k_bags": round(mt / 60, 1)}
            for m, mt in sorted(mt_by_month.items())
            if mt and mt > 0
        ]
    except Exception as e:
        logger.warning(f"[vietnam_supply] static fallback read failed: {e}")
        return []


def _compute_yoy(monthly: list[dict]) -> list[dict]:
    by_month = {r["month"]: r["total_k_bags"] for r in monthly}
    out: list[dict] = []
    for r in monthly:
        y, mo = r["month"].split("-")
        prev = by_month.get(f"{int(y)-1}-{mo}")
        yoy = round((r["total_k_bags"] - prev) / prev * 100, 1) if prev else None
        out.append({**r, "yoy_pct": yoy})
    return out


def fetch_exports() -> dict | None:
    """Run the source chain, merge by month with higher-priority sources winning.

    Customs (cache) → ICO (live HTTP) → static. Keep the last 36 months,
    compute YoY across the merged series, and report which sources contributed.
    """
    sources = [
        ("Vietnam Customs (customs.gov.vn) 2x", _fetch_customs_exports),
        ("ICO",                                  _fetch_ico_exports),
        ("Vietnam Customs (static snapshot)",    _fetch_static_exports),
    ]

    by_month: dict[str, dict] = {}
    for name, fn in sources:
        try:
            rows = fn()
        except Exception as e:
            logger.warning(f"[vietnam_supply] {name} threw {type(e).__name__}: {e}")
            continue
        for r in rows:
            if r["month"] not in by_month:
                by_month[r["month"]] = {**r, "_source": name}

    if not by_month:
        return None

    all_months = sorted(by_month.keys())
    full = [{"month": m, "total_k_bags": by_month[m]["total_k_bags"]} for m in all_months]
    full = _compute_yoy(full)
    monthly = full[-36:]

    window_months = {r["month"] for r in monthly}
    sources_used = sorted({by_month[m]["_source"] for m in window_months})

    return {
        "source":       " + ".join(sources_used),
        "last_updated": monthly[-1]["month"],
        "unit":         "thousand_60kg_bags",
        "monthly":      monthly,
    }


# ── Fertilizer import context ──────────────────────────────────────────────────
# Vietnam imports mainly NPK blends, urea, and potash from China, Russia, and
# the Middle East. Prices track global markets with a slight China-supply premium.
# Monthly volumes from MARD/GSO are not consistently machine-readable; we publish
# known annual averages as context for traders.

def build_fertilizer_context() -> dict:
    """Return fertilizer import context for Vietnam.

    Merges static metadata with scraped monthly data from vn_fertilizer cache
    (written by vn_fertilizer.run() in the monthly scraper workflow).
    Falls back gracefully when the cache doesn't exist yet.
    """
    import json as _json
    from pathlib import Path as _Path

    _CACHE = _Path(__file__).resolve().parents[2] / "scraper" / "cache" / "vn_fertilizer.json"

    ctx: dict = {
        "source":  "Vietnam Customs (customs.gov.vn) 1n import reports",
        "note":    "Vietnam imports ~4–5Mt/yr fertilizer. Urea mainly from China/Russia; NPK from China; Potash from Canada/Russia via Singapore.",
        "key_suppliers": {
            "urea":  "China (60%), Russia (25%), Middle East (15%)",
            "npk":   "China (80%+)",
            "potash": "Canada/Russia via Singapore",
        },
        "price_sensitivity": "Vietnam urea prices lag global CFR by ~2–4 weeks via China trading channel.",
    }

    try:
        if _CACHE.exists():
            cache = _json.loads(_CACHE.read_text(encoding="utf-8"))
            monthly = cache.get("monthly")
            if monthly:
                ctx["monthly"] = monthly
                ctx["source"] = "Vietnam Customs 1n reports (auto-scraped)"
    except Exception as e:
        logger.warning(f"[vietnam_supply] vn_fertilizer cache read failed: {e}")

    return ctx


# ── Entry point ───────────────────────────────────────────────────────────────

def build_vietnam_supply() -> dict:
    """Build full vietnam_supply dict for JSON output."""
    exports = fetch_exports()
    return {
        "scraped_at":         datetime.utcnow().isoformat() + "Z",
        "country":            "vietnam",
        "exports":            exports,
        "fertilizer_context": build_fertilizer_context(),
    }
