import re
from datetime import date
from bs4 import BeautifulSoup
from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = -14.235, -51.925

def parse_cooabriel(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"valor|cotacao|price", re.I))
    if not tag:
        tag = soup.find("td", string=re.compile(r"R\$\s*[\d.,]+"))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Conilon Physical Price (Cooabriel) – {_TODAY()}",
        "body": translate_to_english(f"Conilon physical price today: {text}", "pt"),
        "source": "Cooabriel",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "brazil", "conilon"],
    }

def parse_noticiasagricolas(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"cotacao|valor|price", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Brazil Arabica Price (Noticiasagricolas) – {_TODAY()}",
        "body": translate_to_english(f"Arabica coffee price: {text}", "pt"),
        "source": "Noticiasagricolas",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "brazil", "arabica"],
    }

def parse_cecafe(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    if not tables:
        return None
    rows = tables[0].find_all("tr")
    if len(rows) < 2:
        return None
    cells = rows[1].find_all("td")
    if not cells:
        return None
    text = " | ".join(c.get_text(strip=True) for c in cells[:4])
    return {
        "title": f"Brazil Coffee Exports (Cecafe) – {_TODAY()}",
        "body": translate_to_english(f"Brazil coffee export data: {text}", "pt"),
        "source": "Cecafe",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["exports", "brazil"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://cooabriel.coop.br/cotacao-do-dia", parse_cooabriel),
        ("https://www.noticiasagricolas.com.br/cotacoes/cafe", parse_noticiasagricolas),
        ("https://www.cecafe.com.br/", parse_cecafe),
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
            print(f"[brazil] {url} failed: {e}")
    return results
