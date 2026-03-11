import re
import json as _json
from datetime import date
from bs4 import BeautifulSoup

# Futures symbols — scraped from Barchart
FUTURES_SYMBOLS = {
    "KCA": ("ICE NY Arabica",     "general", ["futures", "arabica", "price"], "global"),
    "RCA": ("ICE London Robusta", "general", ["futures", "robusta", "price"], "global"),
}

# FX pairs — fetched from open.er-api.com (free, no auth required)
FX_PAIRS = {
    "BRL": ("USD/BRL FX Rate", "general", ["fx", "brazil"],     "brazil"),
    "VND": ("USD/VND FX Rate", "general", ["fx", "vietnam"],    "vietnam"),
    "IDR": ("USD/IDR FX Rate", "general", ["fx", "indonesia"],  "indonesia"),
    "HNL": ("USD/HNL FX Rate", "general", ["fx", "honduras"],   "honduras"),
    "UGX": ("USD/UGX FX Rate", "general", ["fx", "uganda"],     "uganda"),
}

COUNTRY_COORDS = {
    "brazil":    (-14.235, -51.925),
    "vietnam":   (14.058, 108.277),
    "indonesia": (-0.789, 113.921),
    "honduras":  (15.200, -86.242),
    "uganda":    (1.3733, 32.2903),
    "global":    (0.0, 0.0),
}


def parse_barchart_price(html: str, symbol: str, label: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(attrs={"data-testid": "last-price"})
    if not tag:
        candidates = soup.find_all(string=re.compile(r"^\d[\d,.]+$"))
        tag = candidates[0].parent if candidates else None
    if not tag:
        return None
    price_text = tag.get_text(strip=True)
    today = date.today().isoformat()
    name, category, tags, country = FUTURES_SYMBOLS.get(symbol, (label, "general", ["price"], "global"))
    lat, lng = COUNTRY_COORDS.get(country, (0.0, 0.0))
    return {
        "title": f"{name} – {today}",
        "body": f"{name} price: {price_text}",
        "source": "Barchart",
        "category": category,
        "lat": lat,
        "lng": lng,
        "tags": tags,
    }


async def scrape_barchart(page, symbol: str) -> dict | None:
    name, *_ = FUTURES_SYMBOLS.get(symbol, (symbol, None, None, None))
    url = f"https://www.barchart.com/futures/quotes/{symbol}/overview"
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(3000)
    html = await page.content()
    return parse_barchart_price(html, symbol, name)


async def scrape_fx_rates(page) -> list[dict]:
    """Fetch FX rates from open.er-api.com (free, reliable, covers all needed pairs)."""
    today = date.today().isoformat()
    results = []
    try:
        currencies = ",".join(FX_PAIRS.keys())
        await page.goto(
            f"https://open.er-api.com/v6/latest/USD",
            wait_until="domcontentloaded",
            timeout=15000,
        )
        content = await page.content()
        m = re.search(r"\{.*\}", content, re.S)
        if not m:
            print("[barchart] FX: could not parse JSON from open.er-api.com")
            return results
        data = _json.loads(m.group(0))
        rates = data.get("rates", {})
        for currency, (name, category, tags, country) in FX_PAIRS.items():
            rate = rates.get(currency)
            if rate is None:
                print(f"[barchart] FX: {currency} not found in response")
                continue
            lat, lng = COUNTRY_COORDS.get(country, (0.0, 0.0))
            # Round to 2 decimal places for readability (VND/IDR get 0 decimals)
            formatted = str(int(round(rate))) if rate > 100 else f"{rate:.4f}"
            results.append({
                "title": f"{name} – {today}",
                "body":  f"{name} price: {formatted}",
                "source": "ExchangeRate-API",
                "category": category,
                "lat": lat,
                "lng": lng,
                "tags": tags,
            })
            print(f"[barchart] FX: USD/{currency} = {formatted}")
    except Exception as e:
        print(f"[barchart] FX fetch failed: {e}")
    return results


async def run(page) -> list[dict]:
    results = []
    # Futures from Barchart
    for symbol in FUTURES_SYMBOLS:
        item = await scrape_barchart(page, symbol)
        if item:
            results.append(item)
    # FX rates from open.er-api.com
    results.extend(await scrape_fx_rates(page))
    return results
