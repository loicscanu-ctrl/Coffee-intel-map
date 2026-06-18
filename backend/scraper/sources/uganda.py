import json
import re
from datetime import date

from bs4 import BeautifulSoup


def _today() -> str:
    return date.today().isoformat()
_LAT, _LNG = 1.3733, 32.2903   # Uganda
_URL = "https://ugandacoffee.go.ug/"

_PRICE_MIN, _PRICE_MAX = 80.0, 500.0


def _is_plausible(price: float) -> bool:
    return _PRICE_MIN <= price <= _PRICE_MAX


# Grades to lift from the UCDA homepage price table. Robusta Screen 15 is the
# headline (and the one we key the NewsItem on); Wugar and Drugar (washed /
# natural Arabica) sit in the same table and are captured in one pass so we
# don't run a second scraper for them.
_GRADE_PATTERNS = {
    "Screen 15": r"screen\s*15|fine\s*robusta",
    "Wugar":     r"\bwugar\b",
    "Drugar":    r"\bdrugar\b",
}


def _find_grade_price(soup, pattern: str) -> float | None:
    """Find a plausible price for the first label/row matching `pattern`. Tries
    the homepage's label/price-data pairing first, then a generic table-row scan."""
    labels = soup.find_all(class_="lable")
    prices = soup.find_all(class_="price-data")
    for i, label_el in enumerate(labels):
        if re.search(pattern, label_el.get_text(strip=True), re.I) and i < len(prices):
            m = re.search(r"(\d{2,3}\.\d{1,2})", prices[i].get_text(strip=True))
            if m and _is_plausible(float(m.group(1))):
                return float(m.group(1))

    for el in soup.find_all(string=re.compile(pattern, re.I)):
        row = el.find_parent("tr")
        if not row:
            continue
        for td in row.find_all("td"):
            m = re.search(r"(\d{2,3}\.\d{1,2})", td.get_text(strip=True))
            if m and _is_plausible(float(m.group(1))):
                return float(m.group(1))
    return None


def parse_uganda_price(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")

    grades = {
        name: price
        for name, pat in _GRADE_PATTERNS.items()
        if (price := _find_grade_price(soup, pat)) is not None
    }
    s15 = grades.get("Screen 15")
    if s15 is None:
        return None
    return _make_price_item(s15, grades)


def _make_price_item(price: float, grades: dict | None = None) -> dict:
    grades = grades or {"Screen 15": price}
    extra = ", ".join(f"{g} {p:.2f}" for g, p in grades.items() if g != "Screen 15")
    return {
        "title":    f"Uganda Screen 15 – {_today()}",
        "body":     f"Uganda Fine Robusta Screen 15 price: {price:.2f} US¢/lb"
                    + (f" · Arabica: {extra}" if extra else ""),
        "source":   "UCDA",
        "category": "supply",
        "lat":      _LAT,
        "lng":      _LNG,
        "tags":     ["price", "robusta", "uganda"],
        # `grades` carries every captured grade (Screen 15 + Wugar/Drugar when
        # present); `usd_cwt` stays the Screen 15 headline for back-compat.
        "meta":     json.dumps({"usd_cwt": price, "as_of": _today(),
                                "grade": "Screen 15", "grades": grades}),
        # Structured price for the exporter — avoids re-parsing `body`.
        "price_data": {"symbol": "UGA_S15", "price": float(price),
                       "currency": "USD", "unit": "per_cwt"},
    }


async def run(page) -> list[dict]:
    results = []

    # 1. UCDA price (Playwright)
    try:
        await page.goto(_URL, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(4000)
        html = await page.content()
        item = parse_uganda_price(html)
        price_path = "/"
        if not item:
            for sub in ["/prices", "/component/allprices", "/index.php/prices", "/market-information"]:
                try:
                    await page.goto(_URL.rstrip("/") + sub, wait_until="domcontentloaded", timeout=20000)
                    await page.wait_for_timeout(3000)
                    html = await page.content()
                    item = parse_uganda_price(html)
                    if item:
                        price_path = sub
                        break
                except Exception:
                    continue
        if item:
            print(f"[uganda] Screen 15 price found at {price_path}")
            results.append(item)
        else:
            print("[uganda] could not find Screen 15 price")
    except Exception as e:
        print(f"[uganda] UCDA scrape failed: {e}")

    return results
