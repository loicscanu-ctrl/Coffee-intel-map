"""
vietnam_supply.py — scrape Vietnam coffee export data and fertilizer import context.

Sources:
  Exports:             ICO historical CSV (public, no auth required)
  Fertilizer imports:  Vietnam General Statistics Office / MARD monthly bulletin
                       (falls back to static known values when unreachable)
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import datetime, date

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


def _fallback_from_vn_export_port() -> dict | None:
    """Read monthly_total (MT) from vn_export_destination_port.json → k_bags."""
    import json as _json
    from pathlib import Path as _Path
    port_file = (
        _Path(__file__).resolve().parents[3]
        / "frontend" / "public" / "data" / "vn_export_destination_port.json"
    )
    if not port_file.exists():
        return None
    try:
        data = _json.loads(port_file.read_text(encoding="utf-8"))
        mt_by_month: dict = data.get("monthly_total", {})
        if not mt_by_month:
            return None
        months = sorted(mt_by_month.keys())
        by_month: dict[str, float] = {}
        for m in months:
            by_month[m] = round(mt_by_month[m] / 60, 1)  # MT → thousand 60kg bags
        monthly = []
        for m in months:
            y, mo = m.split("-")
            prev_key = f"{int(y)-1}-{mo}"
            prev = by_month.get(prev_key)
            yoy = round((by_month[m] - prev) / prev * 100, 1) if prev else None
            monthly.append({"month": m, "total_k_bags": by_month[m], "yoy_pct": yoy})
        if len(monthly) > 36:
            monthly = monthly[-36:]
        last_month = monthly[-1]["month"]
        logger.info(f"[vietnam_supply] ICO unavailable — using vn_export_destination_port fallback ({last_month})")
        return {
            "source":       "Vietnam Customs (vn_export_destination_port)",
            "last_updated": last_month,
            "unit":         "thousand_60kg_bags",
            "monthly":      monthly,
        }
    except Exception as e:
        logger.warning(f"[vietnam_supply] fallback read failed: {e}")
        return None


def fetch_exports() -> dict | None:
    """Fetch ICO CSV and return Vietnam export dict, or None on failure."""
    try:
        resp = requests.get(_ICO_CSV_URL, headers=_HEADERS, timeout=30)
        resp.raise_for_status()
        monthly = _parse_ico_exports(resp.text)
        if not monthly:
            return _fallback_from_vn_export_port()
        last_month = monthly[-1]["month"]
        return {
            "source":       "ICO",
            "last_updated": last_month,
            "unit":         "thousand_60kg_bags",
            "monthly":      monthly,
        }
    except Exception as e:
        logger.warning(f"[vietnam_supply] ICO fetch failed: {e}")
        return _fallback_from_vn_export_port()


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
