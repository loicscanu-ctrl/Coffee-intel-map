import re
from datetime import date
from bs4 import BeautifulSoup
from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = 14.058, 108.277

def parse_giacaphe(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"price|gia|gias", re.I))
    if not tag:
        tag = soup.find("td", string=re.compile(r"\d{2,3}[.,]\d{3}"))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Vietnam Local Coffee Price (Giacaphe) – {_TODAY()}",
        "body": translate_to_english(f"Vietnam local coffee price: {text} VND/kg", "vi"),
        "source": "Giacaphe",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "vietnam", "robusta"],
    }

def parse_tintaynguyen(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(["h1", "h2", "h3"], class_=re.compile(r"title|entry|heading", re.I))
    if not tag:
        tag = soup.find(["h1", "h2"])
    if not tag:
        return None
    text = tag.get_text(strip=True)
    translated = translate_to_english(text, "vi")
    return {
        "title": f"Vietnam Coffee Intel (Tintaynguyen) – {_TODAY()}",
        "body": translated,
        "source": "Tintaynguyen",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["news", "vietnam"],
    }

def parse_vicofa(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(["h1", "h2", "h3"])
    if not tag:
        return None
    text = tag.get_text(strip=True)
    translated = translate_to_english(text, "vi")
    return {
        "title": f"Vicofa News – {_TODAY()}",
        "body": translated,
        "source": "Vicofa",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["news", "vietnam"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://giacaphe.com/gia-ca-phe-noi-dia/", parse_giacaphe),
        ("https://tintaynguyen.com/gia-ca-phe/", parse_tintaynguyen),
        ("https://vicofa.org.vn/", parse_vicofa),
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
            print(f"[vietnam] {url} failed: {e}")
    return results
