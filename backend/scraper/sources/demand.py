import re
from datetime import date

from bs4 import BeautifulSoup

_TODAY = lambda: date.today().isoformat()

def parse_ecf(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"stat|stock|data|figure|stat-figure", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    return {
        "title": f"EU Port Coffee Stocks (ECF) – {_TODAY()}",
        "body": text,
        "source": "ECF",
        "category": "demand",
        "lat": 50.850, "lng": 4.352,
        "tags": ["stocks", "eu"],
    }

def parse_ajca(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find("table")
    if not tag:
        return None
    rows = tag.find_all("tr")
    if len(rows) < 2:
        return None
    text = rows[1].get_text(" | ", strip=True)[:300]
    return {
        "title": f"Japan Coffee Stocks (AJCA) – {_TODAY()}",
        "body": text,
        "source": "AJCA",
        "category": "demand",
        "lat": 36.204, "lng": 138.253,
        "tags": ["stocks", "japan"],
    }

def parse_bls_cpi(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"datavalue|cpivalue|value", re.I))
    if not tag:
        tag = soup.find("td", string=re.compile(r"^\d{3}[\.,]\d+$"))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"US CPI (BLS) – {_TODAY()}",
        "body": f"US Consumer Price Index: {text}",
        "source": "BLS",
        "category": "demand",
        "lat": 37.090, "lng": -95.713,
        "tags": ["cpi", "usa", "demand"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://www.ecf-coffee.org/statistics/",       parse_ecf),
        ("http://coffee.ajca.or.jp/data",                parse_ajca),
        ("https://www.bls.gov/news.release/cpi.t01.htm", parse_bls_cpi),
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
            print(f"[demand] {url} failed: {e}")
    return results
