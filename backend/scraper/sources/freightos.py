# backend/scraper/sources/freightos.py
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from scraper.db import upsert_freight_rate

FBX_INDICES = {
    "FBX11": "https://www.freightos.com/enterprise/terminal/fbx-11-china-to-northern-europe/",
    "FBX01": "https://www.freightos.com/enterprise/terminal/fbx-01-china-to-north-america-west-coast/",
    "FBX03": "https://www.freightos.com/enterprise/terminal/fbx-03-china-to-north-america-east-coast/",
}

RATE_SELECTOR = ".fr-value-amount"


async def _scrape_index(page, index_code: str, url: str) -> bool:
    """Navigate to FBX page, extract current rate, upsert to DB. Returns True on success."""
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_selector(RATE_SELECTOR, timeout=15000)
        text = await page.inner_text(RATE_SELECTOR)
        # Strip "$", commas, spaces — e.g. "$2,614.20" -> 2614.20
        clean = re.sub(r"[^\d.]", "", text)
        rate = float(clean)
        upsert_freight_rate(index_code, date.today(), rate)
        print(f"[freightos] {index_code}: {rate}")
        return True
    except Exception as e:
        print(f"[freightos] {index_code}: ERROR - {e}")
        return False


async def run(page) -> list[dict]:
    """Scrape all FBX indices and write to freight_rates table. Returns [] (side-effect only)."""
    for index_code, url in FBX_INDICES.items():
        await _scrape_index(page, index_code, url)
    return []
