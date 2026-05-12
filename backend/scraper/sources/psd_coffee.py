"""
psd_coffee.py — USDA FAS PSD coffee data for European Union + Japan.

USDA's Production, Supply, and Distribution database publishes annual
green-coffee figures for every country. Source CSV is bundled inside a
zip at apps.fas.usda.gov/psdonline/downloads/psd_coffee_csv.zip and is
refreshed monthly by USDA staff.

This scraper pulls the annual Bean Imports / Domestic Consumption /
Ending Stocks attributes for two markets:
  - European Union (replaces the retired ICE static-Excel feed —
    ICE no longer publishes a daily Coffee_C_Cert_Stocks.xls)
  - Japan (replaces the AJCA HTML scraper which produced bad
    magnitudes)

Writes a single JSON cache at backend/scraper/cache/psd_coffee.json
shaped like:

  {
    "source": "USDA FAS PSD",
    "last_updated": "2026-05-12",
    "markets": {
      "eu":    {"annual": [...], "latest_year": ..., "latest_imports_mt": ..., ...},
      "japan": {"annual": [...], "latest_year": ..., "latest_imports_mt": ..., ...}
    }
  }
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
_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "psd_coffee.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# PSD attribute names → short key on the output. Match by prefix because
# USDA's exact strings have drifted ("Beans Imports" → "Bean Imports", etc.).
_ATTRS = {
    "Bean Imports":         "imports_mt",
    "Beans Imports":        "imports_mt",
    "Domestic Consumption": "consumption_mt",
    "Ending Stocks":        "stocks_mt",
}

# Country names PSD uses. Accept several historical spellings.
_MARKETS = {
    "eu":    ("european union", "european union (27)", "european union-27", "eu-27"),
    "japan": ("japan",),
}

# PSD reports green coffee in thousands of 60-kg bags.
# 1 unit = 1000 bags × 60 kg = 60 metric tons.
_BAGS_PER_UNIT = 1000
_KG_PER_BAG    = 60


def _to_mt(value_thousand_bags: float) -> int:
    return int(round(value_thousand_bags * _BAGS_PER_UNIT * _KG_PER_BAG / 1000))


def _fetch_csv() -> bytes | None:
    try:
        r = requests.get(_PSD_URL, headers=_HEADERS, timeout=60)
        r.raise_for_status()
    except Exception as e:
        logger.warning(f"[psd_coffee] download failed: {e}")
        return None

    try:
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            for name in zf.namelist():
                if name.lower().endswith(".csv"):
                    return zf.read(name)
    except Exception as e:
        logger.warning(f"[psd_coffee] zip extraction failed: {e}")
    return None


def _parse_market_rows(reader: csv.DictReader, country_aliases: tuple[str, ...]) -> dict | None:
    """Return {annual: [...], latest_year, latest_imports_mt, ...} for one market."""
    aliases = {a.lower() for a in country_aliases}
    fields = {f.lower().strip(): f for f in (reader.fieldnames or [])}

    def get(row: dict, name: str) -> str:
        key = fields.get(name.lower(), name)
        return (row.get(key) or "").strip()

    by_year: dict[str, dict[str, int]] = {}

    for row in reader:
        country = (get(row, "Country_Name") or get(row, "Country") or "").lower()
        if country not in aliases:
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
        by_year.setdefault(year, {})[short] = _to_mt(val)

    if not by_year:
        return None

    years = sorted(by_year.keys())
    series = [{"year": y, **by_year[y]} for y in years]
    latest = series[-1]
    return {
        "annual":                series,
        "latest_year":           latest["year"],
        "latest_imports_mt":     latest.get("imports_mt"),
        "latest_consumption_mt": latest.get("consumption_mt"),
        "latest_stocks_mt":      latest.get("stocks_mt"),
    }


def _parse_psd(csv_bytes: bytes) -> dict | None:
    text = csv_bytes.decode("utf-8-sig", errors="replace")
    markets: dict[str, dict] = {}
    for short, aliases in _MARKETS.items():
        # DictReader is single-pass; rebuild it per market.
        reader = csv.DictReader(io.StringIO(text))
        parsed = _parse_market_rows(reader, aliases)
        if parsed:
            markets[short] = parsed
        else:
            logger.warning(f"[psd_coffee] no rows for {short} (aliases tried: {aliases})")

    if not markets:
        return None

    return {
        "source":       "USDA FAS PSD",
        "last_updated": datetime.utcnow().date().isoformat(),
        "markets":      markets,
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        content = _fetch_csv()
        if not content:
            print("[psd_coffee] No CSV downloaded — retaining cache")
            return
        parsed = _parse_psd(content)
        if not parsed:
            print("[psd_coffee] No EU or Japan rows parsed — retaining cache")
            return

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(parsed, indent=2), encoding="utf-8")

        eu = parsed["markets"].get("eu", {})
        jp = parsed["markets"].get("japan", {})
        print(
            f"[psd_coffee] EU {eu.get('latest_year', '?')} "
            f"imp={eu.get('latest_imports_mt')} MT "
            f"stocks={eu.get('latest_stocks_mt')} MT | "
            f"Japan {jp.get('latest_year', '?')} "
            f"imp={jp.get('latest_imports_mt')} MT "
            f"stocks={jp.get('latest_stocks_mt')} MT"
        )
    except Exception as e:
        print(f"[psd_coffee] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[psd_coffee] cache read failed: {e}")
        return None


if __name__ == "__main__":
    import asyncio

    async def _main():
        await run(None, None)

    asyncio.run(_main())
