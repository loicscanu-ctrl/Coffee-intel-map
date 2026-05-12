"""
psd_japan.py — USDA FAS PSD coffee data for Japan.

USDA's Production, Supply, and Distribution database publishes annual
green-coffee figures for every country. Source CSV is updated monthly
by USDA staff (typically mid-month) and bundled inside a zip at
https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip.

We pull Japan rows, keep Bean Imports + Domestic Consumption +
Ending Stocks attributes, and emit annual series. Replaces the
previous AJCA scraper, which screen-scraped a JS-rendered Japanese
page and produced inconsistent magnitudes.

Writes to backend/scraper/cache/psd_japan.json.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import zipfile
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_PSD_URL = "https://apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip"
_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "psd_japan.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# PSD attribute names we care about. They've drifted slightly over the
# years — match on prefix to be resilient.
_ATTRS = {
    "Bean Imports":         "imports_mt",
    "Domestic Consumption": "consumption_mt",
    "Ending Stocks":        "stocks_mt",
}

# PSD reports green coffee in 1000 60-kg bags. 1 bag = 60 kg → 1000 bags = 60 MT.
_BAGS_PER_UNIT = 1000
_KG_PER_BAG    = 60


def _to_mt(value_thousand_bags: float) -> int:
    """Convert 1000-bag units to MT (1000 bags × 60 kg = 60 MT per unit)."""
    return int(round(value_thousand_bags * _BAGS_PER_UNIT * _KG_PER_BAG / 1000))


def _fetch_csv() -> bytes | None:
    try:
        r = requests.get(_PSD_URL, headers=_HEADERS, timeout=60)
        r.raise_for_status()
    except Exception as e:
        logger.warning(f"[psd_japan] download failed: {e}")
        return None

    try:
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            # Pick the first CSV in the archive (USDA only ships one).
            for name in zf.namelist():
                if name.lower().endswith(".csv"):
                    return zf.read(name)
    except Exception as e:
        logger.warning(f"[psd_japan] zip extraction failed: {e}")
    return None


def _parse_japan(csv_bytes: bytes) -> dict | None:
    try:
        text = csv_bytes.decode("utf-8-sig", errors="replace")
    except Exception as e:
        logger.warning(f"[psd_japan] decode failed: {e}")
        return None

    reader = csv.DictReader(io.StringIO(text))
    # Field-name normalisation map. USDA has used several capitalisations.
    fields = {f.lower().strip(): f for f in (reader.fieldnames or [])}

    def get(row: dict, name: str) -> str:
        key = fields.get(name.lower(), name)
        return (row.get(key) or "").strip()

    # year_key → {attr_short_name: mt}
    by_year: dict[str, dict[str, int | None]] = {}

    for row in reader:
        country = get(row, "Country_Name") or get(row, "Country")
        if not country or country.strip().lower() != "japan":
            continue
        attr = get(row, "Attribute_Description") or get(row, "Attribute")
        short = None
        for prefix, key in _ATTRS.items():
            if attr.startswith(prefix):
                short = key
                break
        if not short:
            continue
        year = get(row, "Market_Year") or get(row, "Calendar_Year") or get(row, "Year")
        if not year:
            continue
        raw_val = get(row, "Value")
        if not raw_val:
            continue
        try:
            val = float(raw_val.replace(",", ""))
        except ValueError:
            continue
        mt = _to_mt(val)
        by_year.setdefault(year, {})[short] = mt

    if not by_year:
        logger.warning("[psd_japan] No Japan rows found in PSD CSV")
        return None

    years = sorted(by_year.keys())
    series = [
        {"year": y, **by_year[y]} for y in years
    ]
    latest = series[-1]
    return {
        "source":      "USDA FAS PSD",
        "last_updated": datetime.utcnow().date().isoformat(),
        "annual":      series,
        "latest_year": latest["year"],
        "latest_imports_mt":     latest.get("imports_mt"),
        "latest_consumption_mt": latest.get("consumption_mt"),
        "latest_stocks_mt":      latest.get("stocks_mt"),
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        content = _fetch_csv()
        if not content:
            print("[psd_japan] No data — retaining cache")
            return
        parsed = _parse_japan(content)
        if not parsed:
            print("[psd_japan] No Japan rows parsed — retaining cache")
            return
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(parsed, indent=2), encoding="utf-8")
        print(
            f"[psd_japan] {parsed['latest_year']} "
            f"imports={parsed['latest_imports_mt']} MT "
            f"stocks={parsed['latest_stocks_mt']} MT"
        )
    except Exception as e:
        print(f"[psd_japan] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[psd_japan] cache read failed: {e}")
        return None


if __name__ == "__main__":
    import asyncio

    async def _main():
        await run(None, None)

    asyncio.run(_main())
