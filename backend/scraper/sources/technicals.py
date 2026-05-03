import re
from datetime import date

from bs4 import BeautifulSoup

_TODAY = lambda: date.today().isoformat()

def parse_cftc_cot(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"report|cot|commitment|cot-link", re.I))
    if not tag:
        tag = soup.find("a", string=re.compile(r"Coffee|Arabica|Robusta|Report", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    return {
        "title": f"CFTC Commitments of Traders – {_TODAY()}",
        "body": f"CoT Report: {text}",
        "source": "CFTC",
        "category": "general",
        "lat": 0.0, "lng": 0.0,
        "tags": ["technicals", "cot"],
    }

def parse_worldbank_fertilizer(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"odd|even|value|data|views-field", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    if not re.search(r"\d", text):
        return None
    return {
        "title": f"World Bank Fertilizer Index – {_TODAY()}",
        "body": f"Fertilizer commodity index: {text}",
        "source": "World Bank",
        "category": "supply",
        "lat": 0.0, "lng": 0.0,
        "tags": ["inputs", "fertilizer"],
    }

def parse_searates(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"rate|freight|price|index|rate-index", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    return {
        "title": f"Ocean Freight Rates (Searates) – {_TODAY()}",
        "body": f"Ocean freight market: {text}",
        "source": "Searates",
        "category": "general",
        "lat": 0.0, "lng": 0.0,
        "tags": ["logistics", "freight"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm", parse_cftc_cot),
        ("https://www.worldbank.org/en/research/commodity-markets",           parse_worldbank_fertilizer),
        ("https://www.searates.com/",                                          parse_searates),
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
            print(f"[technicals] {url} failed: {e}")
    return results
