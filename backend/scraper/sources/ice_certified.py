"""
ice_certified.py — ICE Coffee 'C' (Arabica) certified stocks.

ICE publishes a daily Excel snapshot of total certified Arabica bags at
licensed warehouses, broken down by port. Most certified stock sits at
European ports (Antwerp, Hamburg, Bremen, Trieste, Genoa, Le Havre,
Barcelona) plus US ports (New Orleans, NY, Houston, Miami, Virginia).

Because the file is a single-day snapshot, this scraper APPENDS each
daily reading to a JSON time-series cache at
backend/scraper/cache/ice_certified.json. The frontend reads this cache
through export_stocks.py and renders both a total bags figure and an
EU-ports vs non-EU-ports breakdown.

Writes to backend/scraper/cache/ice_certified.json (does not touch DB).
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import requests

logger = logging.getLogger(__name__)

_ICE_URL = "https://www.theice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls"
_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "ice_certified.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# Port-name substrings → region. Order matters: longest/most-specific first.
_EU_PORTS = ("antwerp", "hamburg", "bremen", "trieste", "genoa", "le havre", "barcelona")
_US_PORTS = ("new orleans", "new york", "houston", "miami", "virginia", "norfolk")


def _classify_port(name: str) -> str:
    n = name.lower()
    if any(p in n for p in _EU_PORTS):
        return "eu"
    if any(p in n for p in _US_PORTS):
        return "us"
    return "other"


def _parse_ice_xls(content: bytes) -> dict | None:
    """Return {total_bags, by_port: {name: bags}, as_of} or None on failure.

    The ICE Excel format has historically had:
      - A title row with the report date
      - A per-warehouse breakdown with one row per port
      - A Total row at the bottom
    Layouts shift slightly over time; we look for cells matching "Total"
    and port-keyword rows rather than relying on column positions.
    """
    try:
        # xlrd handles the legacy .xls; let pandas pick the engine.
        df = pd.read_excel(pd.io.common.BytesIO(content), header=None)
    except Exception as e:
        logger.warning(f"[ice_certified] pandas read_excel failed: {e}")
        return None

    by_port: dict[str, int] = {}
    total_bags: int | None = None
    as_of: str | None = None

    # First pass: scan every cell for a date-looking value (the report date).
    for _, row in df.iterrows():
        for cell in row:
            if isinstance(cell, (datetime, pd.Timestamp)):
                as_of = cell.date().isoformat()
                break
            if isinstance(cell, str) and as_of is None:
                # Try ISO / common date formats
                for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d-%b-%Y", "%B %d, %Y"):
                    try:
                        as_of = datetime.strptime(cell.strip(), fmt).date().isoformat()
                        break
                    except ValueError:
                        pass
                if as_of:
                    break
        if as_of:
            break

    # Second pass: find Total + port rows
    for _, row in df.iterrows():
        cells = [c for c in row if c is not None and not (isinstance(c, float) and pd.isna(c))]
        if not cells:
            continue
        label = str(cells[0]).strip().lower() if isinstance(cells[0], str) else ""
        # Numeric values in this row
        nums = [int(c) for c in cells if isinstance(c, (int, float)) and not pd.isna(c) and float(c).is_integer()]
        nums = [n for n in nums if 0 < n < 10_000_000]  # bag counts, ignore years etc.

        if not nums:
            continue

        if "total" in label and total_bags is None:
            total_bags = max(nums)
            continue

        # Treat any row whose first cell mentions a known port keyword as a port row.
        if any(p in label for p in _EU_PORTS + _US_PORTS):
            by_port[label.title()] = max(nums)

    if total_bags is None and by_port:
        total_bags = sum(by_port.values())

    if total_bags is None:
        logger.warning("[ice_certified] No Total or port rows recognised")
        return None

    return {
        "as_of":      as_of or date.today().isoformat(),
        "total_bags": total_bags,
        "by_port":    by_port,
    }


def _load_cache() -> dict:
    if not _CACHE_PATH.exists():
        return {"series": []}
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[ice_certified] cache read failed, starting fresh: {e}")
        return {"series": []}


def _save_cache(payload: dict) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _download_via_requests() -> bytes | None:
    try:
        r = requests.get(_ICE_URL, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        return r.content
    except Exception as e:
        logger.warning(f"[ice_certified] requests download failed: {e}")
        return None


async def _download_via_playwright(page) -> bytes | None:
    """Fallback: use the real browser context to grab the file.

    ICE sits behind bot protection (Akamai/Cloudflare) that often rejects
    bare requests.get from data-center IPs. A Playwright page already has
    JS evaluation, cookies and a real TLS fingerprint, so the same URL
    typically loads. We navigate to the file, wait for the download
    event, and read the resulting bytes.
    """
    if page is None:
        return None
    try:
        # The .xls file ought to trigger a browser download. expect_download
        # captures it; if the browser opens it inline (some configurations),
        # we fall back to reading the response body.
        try:
            async with page.expect_download(timeout=30_000) as dl_info:
                await page.goto(_ICE_URL, timeout=30_000)
            download = await dl_info.value
            path = await download.path()
            if not path:
                return None
            from pathlib import Path as _P
            return _P(path).read_bytes()
        except Exception:
            # No download event — page may have loaded the file inline.
            resp = await page.goto(_ICE_URL, wait_until="domcontentloaded", timeout=30_000)
            if resp and resp.ok:
                return await resp.body()
            return None
    except Exception as e:
        logger.warning(f"[ice_certified] playwright download failed: {e}")
        return None


async def _fetch_ice(page) -> dict | None:
    content = _download_via_requests()
    if content is None:
        print("[ice_certified] requests blocked — falling back to Playwright")
        content = await _download_via_playwright(page)
    if not content:
        return None

    parsed = _parse_ice_xls(content)
    if not parsed:
        return None

    # Split by region using port classification.
    eu = us = other = 0
    for port, bags in parsed["by_port"].items():
        region = _classify_port(port)
        if region == "eu":
            eu += bags
        elif region == "us":
            us += bags
        else:
            other += bags

    parsed["eu_bags"] = eu
    parsed["us_bags"] = us
    parsed["other_bags"] = other
    return parsed


async def run(page, db) -> None:  # noqa: ARG001 — match the (page, db) signature
    """Append today's ICE certified snapshot to the time-series cache."""
    try:
        snap = await _fetch_ice(page)
        if not snap:
            print("[ice_certified] No data — retaining cache")
            return

        cache = _load_cache()
        series: list[dict] = cache.get("series", [])

        # Replace today's entry if present (re-runs in the same day overwrite).
        series = [s for s in series if s.get("as_of") != snap["as_of"]]
        series.append({
            "as_of":      snap["as_of"],
            "total_bags": snap["total_bags"],
            "eu_bags":    snap["eu_bags"],
            "us_bags":    snap["us_bags"],
            "other_bags": snap["other_bags"],
        })
        series.sort(key=lambda s: s["as_of"])
        # Keep last 365 days
        series = series[-365:]

        _save_cache({
            "source":      "ICE Coffee 'C' Certified Stocks",
            "source_url":  _ICE_URL,
            "scraped_at":  datetime.utcnow().isoformat() + "Z",
            "latest":      snap,
            "series":      series,
        })
        print(
            f"[ice_certified] {snap['as_of']} total={snap['total_bags']:,} "
            f"eu={snap['eu_bags']:,} us={snap['us_bags']:,} other={snap['other_bags']:,}"
        )
    except Exception as e:
        print(f"[ice_certified] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[ice_certified] cache read failed: {e}")
        return None


if __name__ == "__main__":
    import asyncio

    async def _main():
        # Standalone run: spin up a Playwright browser so the fallback path
        # is exercised when requests gets blocked.
        try:
            from playwright.async_api import async_playwright
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True)
                page = await browser.new_page()
                await run(page, None)
                await browser.close()
        except ImportError:
            print("[ice_certified] playwright not installed — requests-only mode")
            await run(None, None)

    asyncio.run(_main())
