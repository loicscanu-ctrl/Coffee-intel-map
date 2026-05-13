import re
from datetime import date

from bs4 import BeautifulSoup

from scraper.translate import translate_to_english


def _today() -> str:
    return date.today().isoformat()

_LAT, _LNG = -0.789, 113.921  # Indonesia


def parse_alfabean(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"price|idr|harga", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Indonesia Local Coffee Price (Alfabean) – {_today()}",
        "body": translate_to_english(f"Indonesia local coffee price: {text} IDR/kg", "id"),
        "source": "Alfabean",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "indonesia"],
    }


async def run(page) -> list[dict]:
    results = []
    try:
        await page.goto("https://www.alfabean.com/price-list/", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
        html = await page.content()
        item = parse_alfabean(html)
        if item:
            results.append(item)
    except Exception as e:
        print(f"[origins] alfabean failed: {e}")
    return results
