import json
import re
from datetime import date

from bs4 import BeautifulSoup

from scraper.sources._ico_common import fetch_ico_exports

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = 1.3733, 32.2903   # Uganda
_URL = "https://ugandacoffee.go.ug/"

_PRICE_MIN, _PRICE_MAX = 80.0, 500.0


def _is_plausible(price: float) -> bool:
    return _PRICE_MIN <= price <= _PRICE_MAX


def parse_uganda_price(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")

    labels = soup.find_all(class_="lable")
    prices = soup.find_all(class_="price-data")
    for i, label_el in enumerate(labels):
        if re.search(r"robusta.*screen\s*15|screen\s*15.*robusta", label_el.get_text(strip=True), re.I):
            if i < len(prices):
                m = re.search(r"(\d{2,3}\.\d{1,2})", prices[i].get_text(strip=True))
                if m:
                    price = float(m.group(1))
                    if _is_plausible(price):
                        return _make_price_item(price)

    for el in soup.find_all(string=re.compile(r"screen\s*15|fine\s*robusta", re.I)):
        row = el.find_parent("tr")
        if not row:
            continue
        for td in row.find_all("td"):
            m = re.search(r"(\d{2,3}\.\d{1,2})", td.get_text(strip=True))
            if m:
                price = float(m.group(1))
                if _is_plausible(price):
                    return _make_price_item(price)

    return None


def _make_price_item(price: float) -> dict:
    return {
        "title":    f"Uganda Screen 15 – {_TODAY()}",
        "body":     f"Uganda Fine Robusta Screen 15 price: {price:.2f} USD/cwt",
        "source":   "UCDA",
        "category": "supply",
        "lat":      _LAT,
        "lng":      _LNG,
        "tags":     ["price", "robusta", "uganda"],
        "meta":     json.dumps({"usd_cwt": price, "as_of": _TODAY(), "grade": "Screen 15"}),
    }


async def run(page) -> list[dict]:
    results = []

    # 1. UCDA price (Playwright)
    try:
        await page.goto(_URL, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(4000)
        html = await page.content()
        item = parse_uganda_price(html)
        if not item:
            for sub in ["/prices", "/component/allprices", "/index.php/prices", "/market-information"]:
                try:
                    await page.goto(_URL.rstrip("/") + sub, wait_until="domcontentloaded", timeout=20000)
                    await page.wait_for_timeout(3000)
                    html = await page.content()
                    item = parse_uganda_price(html)
                    if item:
                        break
                except Exception:
                    continue
        if item:
            results.append(item)
        else:
            print("[uganda] could not find Screen 15 price")
    except Exception as e:
        print(f"[uganda] UCDA scrape failed: {e}")

    # 2. ICO monthly exports (pure HTTP)
    monthly = fetch_ico_exports({"uganda"}, "uganda")
    if monthly:
        last = monthly[-1]
        results.append({
            "title":    f"Uganda Coffee Exports (ICO) – {last['month']}",
            "body":     (
                f"Uganda green coffee exports: {last['total_k_bags']:,}k bags in {last['month']}."
                + (f" YoY: {last['yoy_pct']:+.1f}%" if last.get("yoy_pct") is not None else "")
            ),
            "source":   "ICO",
            "category": "supply",
            "lat":      _LAT,
            "lng":      _LNG,
            "tags":     ["exports", "uganda", "ico"],
            "meta":     json.dumps({
                "monthly":      monthly,
                "last_updated": last["month"],
                "unit":         "thousand 60-kg bags",
            }),
        })

    return results
