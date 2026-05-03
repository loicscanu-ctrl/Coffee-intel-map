import re
from datetime import date

from bs4 import BeautifulSoup

from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()

COORDS = {
    "indonesia": (-0.789, 113.921),
    "honduras":  (15.200, -86.242),
    "uganda":    (1.373, 32.290),
    "colombia":  (4.571, -74.297),
}

def _first_text(html, selectors):
    soup = BeautifulSoup(html, "html.parser")
    for selector in selectors:
        tag = soup.find(class_=re.compile(selector, re.I))
        if tag:
            return tag.get_text(strip=True)
    return None

def parse_alfabean(html: str) -> dict | None:
    text = _first_text(html, [r"price|idr|harga"])
    if not text:
        return None
    lat, lng = COORDS["indonesia"]
    return {
        "title": f"Indonesia Local Coffee Price (Alfabean) – {_TODAY()}",
        "body": translate_to_english(f"Indonesia local coffee price: {text} IDR/kg", "id"),
        "source": "Alfabean",
        "category": "supply",
        "lat": lat, "lng": lng,
        "tags": ["price", "indonesia"],
    }

def parse_ihcafe(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(string=re.compile(r"L\.\s*[\d.,]+|HNL|Lempira", re.I))
    if not tag:
        tag = soup.find("td", string=re.compile(r"[\d.,]{4,}"))
    if not tag:
        return None
    text = tag if isinstance(tag, str) else tag.get_text(strip=True)
    lat, lng = COORDS["honduras"]
    return {
        "title": f"Honduras Coffee Price (IHCafe) – {_TODAY()}",
        "body": translate_to_english(f"Honduras daily coffee price: {text}", "es"),
        "source": "IHCafe",
        "category": "supply",
        "lat": lat, "lng": lng,
        "tags": ["price", "honduras"],
    }

def parse_uganda(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"export|stat|news|content|export-volume", re.I))
    if not tag:
        tag = soup.find("p")
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    lat, lng = COORDS["uganda"]
    return {
        "title": f"Uganda Coffee Export Data – {_TODAY()}",
        "body": text,
        "source": "Uganda Coffee Board",
        "category": "supply",
        "lat": lat, "lng": lng,
        "tags": ["exports", "uganda"],
    }

def parse_colombia(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"estadistica|stat|production|news|estadisticas", re.I))
    if not tag:
        tag = soup.find("div")
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    lat, lng = COORDS["colombia"]
    return {
        "title": f"Colombia Coffee Stats (Federación de Cafeteros) – {_TODAY()}",
        "body": translate_to_english(text, "es"),
        "source": "Federación de Cafeteros",
        "category": "supply",
        "lat": lat, "lng": lng,
        "tags": ["stats", "colombia"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://www.alfabean.com/price-list/",     parse_alfabean),
        ("https://www.ihcafe.hn/",                   parse_ihcafe),
        ("https://ugandacoffee.go.ug/",              parse_uganda),
        ("https://federaciondecafeteros.org/",       parse_colombia),
    ]
    for url, parser in sources:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            html = await page.content()
            item = parser(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[origins] {url} failed: {e}")
    return results
