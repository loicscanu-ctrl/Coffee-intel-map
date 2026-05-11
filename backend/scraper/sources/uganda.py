import csv
import io
import json
import re
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = 1.3733, 32.2903   # Uganda
_URL = "https://ugandacoffee.go.ug/"

_PRICE_MIN, _PRICE_MAX = 80.0, 500.0

_ICO_CSV_URL = (
    "https://www.ico.org/historical/1990%20onwards/CSV/"
    "2b%20-%20Exports%20of%20green%20coffee.csv"
)
_UGA_NAMES = {"uganda"}

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}


def _is_plausible(price: float) -> bool:
    return _PRICE_MIN <= price <= _PRICE_MAX


def _parse_ico_uganda(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)
    country_col = (reader.fieldnames or [""])[0]
    uga_row = next(
        (r for r in rows if r.get(country_col, "").strip().lower() in _UGA_NAMES),
        None,
    )
    if uga_row is None:
        return []
    monthly: list[dict] = []
    for col, val in uga_row.items():
        if col == country_col:
            continue
        m = re.match(r"(\d{4})\s+([A-Za-z]{3})", col.strip())
        if not m:
            continue
        try:
            dt = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y %b")
        except ValueError:
            continue
        try:
            bags_k = float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            continue
        if bags_k <= 0:
            continue
        monthly.append({"month": f"{dt.year}-{dt.month:02d}", "total_k_bags": round(bags_k, 1)})

    monthly.sort(key=lambda x: x["month"])
    if len(monthly) > 48:
        monthly = monthly[-48:]

    by_month = {r["month"]: r["total_k_bags"] for r in monthly}
    result = []
    for r in monthly:
        ym = r["month"]
        yr, mo = ym.split("-")
        ly = f"{int(yr) - 1}-{mo}"
        ly_val = by_month.get(ly)
        yoy = round((r["total_k_bags"] - ly_val) / ly_val * 100, 1) if ly_val and ly_val > 0 else None
        result.append({**r, "yoy_pct": yoy})
    return result


def _fetch_ico_exports() -> list[dict]:
    try:
        r = requests.get(_ICO_CSV_URL, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        return _parse_ico_uganda(r.text)
    except Exception as e:
        print(f"[uganda] ICO CSV fetch failed: {e}")
        return []


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
    monthly = _fetch_ico_exports()
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
