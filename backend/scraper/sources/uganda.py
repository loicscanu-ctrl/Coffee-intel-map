import re
from datetime import date

from bs4 import BeautifulSoup

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = 1.3733, 32.2903   # Uganda
_URL = "https://ugandacoffee.go.ug/"

# Price range sanity check: Screen 15 is quoted in USD/cwt (100 lbs)
# Typical range roughly 100–400 USD/cwt
_PRICE_MIN, _PRICE_MAX = 80.0, 500.0


def _is_plausible(price: float) -> bool:
    return _PRICE_MIN <= price <= _PRICE_MAX


def parse_uganda_price(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")

    # Primary: labels and price-data are parallel lists — find by index
    # <div class="lable">Robusta – Screen 15</div>
    # <div class="price-data">175.76</div>
    labels = soup.find_all(class_="lable")
    prices = soup.find_all(class_="price-data")
    for i, label_el in enumerate(labels):
        if re.search(r"robusta.*screen\s*15|screen\s*15.*robusta", label_el.get_text(strip=True), re.I):
            if i < len(prices):
                m = re.search(r"(\d{2,3}\.\d{1,2})", prices[i].get_text(strip=True))
                if m:
                    price = float(m.group(1))
                    if _is_plausible(price):
                        return _make_item(price)

    # Fallback: table row containing "Screen 15"
    for el in soup.find_all(string=re.compile(r"screen\s*15|fine\s*robusta", re.I)):
        row = el.find_parent("tr")
        if not row:
            continue
        for td in row.find_all("td"):
            m = re.search(r"(\d{2,3}\.\d{1,2})", td.get_text(strip=True))
            if m:
                price = float(m.group(1))
                if _is_plausible(price):
                    return _make_item(price)

    return None


def _make_item(price: float) -> dict:
    return {
        "title": f"Uganda Screen 15 – {_TODAY()}",
        "body":  f"Uganda Fine Robusta Screen 15 price: {price:.2f} USD/cwt",
        "source": "UCDA",
        "category": "supply",
        "lat": _LAT,
        "lng": _LNG,
        "tags": ["price", "robusta", "uganda"],
    }


async def run(page) -> list[dict]:
    try:
        await page.goto(_URL, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(4000)
        html = await page.content()
        item = parse_uganda_price(html)
        if item:
            return [item]
        # Try a dedicated prices sub-page if home page yielded nothing
        for sub in ["/prices", "/component/allprices", "/index.php/prices", "/market-information"]:
            try:
                await page.goto(_URL.rstrip("/") + sub, wait_until="domcontentloaded", timeout=20000)
                await page.wait_for_timeout(3000)
                html = await page.content()
                item = parse_uganda_price(html)
                if item:
                    return [item]
            except Exception:
                continue
        print("[uganda] could not find Screen 15 price")
        return []
    except Exception as e:
        print(f"[uganda] failed: {e}")
        return []
