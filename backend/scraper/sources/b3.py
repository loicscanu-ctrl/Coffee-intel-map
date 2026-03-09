import re
from datetime import date
from bs4 import BeautifulSoup
from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = -14.235, -51.925

def parse_b3(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"last.?value|settlement|cotacao|valor|quotation", re.I))
    if not tag:
        tag = soup.find(string=re.compile(r"R\$\s*[\d.,]+"))
    if not tag:
        return None
    text = tag if isinstance(tag, str) else tag.get_text(strip=True)
    return {
        "title": f"B3 Brazil Coffee Futures – {_TODAY()}",
        "body": translate_to_english(f"B3 Brazil coffee futures settlement: {text}", "pt"),
        "source": "B3",
        "category": "general",
        "lat": _LAT, "lng": _LNG,
        "tags": ["futures", "brazil", "arabica"],
    }

async def run(page) -> list[dict]:
    results = []
    urls = [
        "https://www.b3.com.br/en_us/market-data-and-indices/data-services/market-data/quotes/futures/ica/",
        "https://www.b3.com.br/en_us/market-data-and-indices/data-services/market-data/quotes/futures/icf/",
    ]
    for url in urls:
        try:
            await page.goto(url, wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(4000)
            html = await page.content()
            item = parse_b3(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[b3] {url} failed: {e}")
    return results
