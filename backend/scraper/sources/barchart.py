import re
from datetime import date
from bs4 import BeautifulSoup

BARCHART_SYMBOLS = {
    "KCA":    ("ICE NY Arabica",     "general", ["futures", "arabica", "price"], "global"),
    "RCA":    ("ICE London Robusta", "general", ["futures", "robusta", "price"], "global"),
    "USDBRL": ("USD/BRL FX Rate",    "general", ["fx", "brazil"],               "brazil"),
    "USDVND": ("USD/VND FX Rate",    "general", ["fx", "vietnam"],              "vietnam"),
    "USDIDR": ("USD/IDR FX Rate",    "general", ["fx", "indonesia"],            "indonesia"),
    "USDHNL": ("USD/HNL FX Rate",    "general", ["fx", "honduras"],             "honduras"),
}

COUNTRY_COORDS = {
    "brazil":    (-14.235, -51.925),
    "vietnam":   (14.058, 108.277),
    "indonesia": (-0.789, 113.921),
    "honduras":  (15.200, -86.242),
    "global":    (0.0, 0.0),
}

def parse_barchart_price(html: str, symbol: str, label: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    # Barchart renders price in a span with data-testid="last-price" or class containing "last-price"
    tag = soup.find(attrs={"data-testid": "last-price"})
    if not tag:
        # Fallback: look for any element whose text looks like a price
        candidates = soup.find_all(string=re.compile(r"^\d[\d,.]+$"))
        tag = candidates[0].parent if candidates else None
    if not tag:
        return None
    price_text = tag.get_text(strip=True)
    today = date.today().isoformat()
    name, category, tags, country = BARCHART_SYMBOLS.get(symbol, (label, "general", ["price"], "global"))
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
    name, *_ = BARCHART_SYMBOLS.get(symbol, (symbol, None, None, None))
    url = f"https://www.barchart.com/futures/quotes/{symbol}/overview"
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(3000)
    html = await page.content()
    return parse_barchart_price(html, symbol, name)

async def run(page) -> list[dict]:
    results = []
    for symbol in BARCHART_SYMBOLS:
        item = await scrape_barchart(page, symbol)
        if item:
            results.append(item)
    return results
