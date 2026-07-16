"""
noticias_cafe.py — coffee news from Notícias Agrícolas.

Source: https://www.noticiasagricolas.com.br/noticias/cafe/

The site has no RSS feed, so we scrape the coffee-news list page for article
links (/noticias/cafe/{id}-{slug}.html), then open each article to read its
clean headline (og:title), summary (description meta) and published timestamp
(a visible "dd/mm/aaaa HH:MM" stamp — there is no article:published_time meta).
Brazil dropped DST in 2019, so the stamp is a fixed UTC-3 local time.

Emits the same item shape as sources/rss.py, so main.py upserts these into the
news feed alongside the English coffee feeds. Dedup is by title (db.upsert_news_item),
and og:title is stable per article, so re-runs never duplicate.
"""
from __future__ import annotations

import asyncio
import html
import re
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup

BASE = "https://www.noticiasagricolas.com.br"
LIST_URL = BASE + "/noticias/cafe/"
SOURCE = "Notícias Agrícolas"
MAX_ARTICLES = 12                       # most-recent N (list is newest-first)
BR_TZ = timezone(timedelta(hours=-3))   # America/Sao_Paulo, no DST since 2019

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
_HEADERS = {"User-Agent": UA, "Accept": "text/html",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"}

_LINK_RE = re.compile(r"/noticias/cafe/\d+-.+\.html")
_STAMP_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})\D{0,12}(\d{2}):(\d{2})")

# Portuguese + English keyword → category (checked against title + summary).
_CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("macro",  ["preço", "preços", "cotaç", "bolsa", "futuro", "mercado", "dólar",
                "câmbio", "exporta", "importa", "tarifa", "inflaç", "receita",
                "price", "futures", "market", "export", "tariff"]),
    ("supply", ["safra", "colheita", "produç", "oferta", "estoque", "robusta",
                "arábica", "conilon", "clima", "chuva", "seca", "geada",
                "harvest", "production", "supply", "crop", "weather", "frost"]),
    ("demand", ["demanda", "consumo", "venda", "torref", "varejo",
                "demand", "consumption", "retail", "roaster"]),
]


def _classify(text: str) -> str:
    low = text.lower()
    for category, keywords in _CATEGORY_RULES:
        if any(kw in low for kw in keywords):
            return category
    return "general"


def _clean(text: str) -> str:
    return re.sub(r"\s{2,}", " ", html.unescape(text or "")).strip()


def _meta(soup: BeautifulSoup, *keys: str) -> str | None:
    for k in keys:
        tag = (soup.find("meta", attrs={"property": k})
               or soup.find("meta", attrs={"name": k}))
        if tag and tag.get("content"):
            return tag["content"]
    return None


def _parse_stamp(page_html: str) -> datetime:
    m = _STAMP_RE.search(page_html)
    if m:
        dd, mm, yyyy, hh, mi = (int(x) for x in m.groups())
        try:
            return datetime(yyyy, mm, dd, hh, mi, tzinfo=BR_TZ)
        except ValueError:
            pass
    return datetime.now(BR_TZ)


def _fetch_list() -> list[str]:
    resp = requests.get(LIST_URL, headers=_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    urls, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if _LINK_RE.search(href) and len(a.get_text(strip=True)) > 20:
            full = href if href.startswith("http") else BASE + href
            if full not in seen:
                seen.add(full)
                urls.append(full)
    return urls[:MAX_ARTICLES]


def _fetch_article(url: str) -> dict | None:
    resp = requests.get(url, headers=_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    title = _clean(_meta(soup, "og:title") or "")
    if not title:
        h1 = soup.find("h1")
        title = _clean(h1.get_text(" ", strip=True)) if h1 else ""
    if not title:
        return None

    body = _clean(_meta(soup, "og:description", "description") or "")[:500]
    text = f"{title} {body}"
    return {
        "title":    title,
        "body":     body,
        "source":   SOURCE,
        "category": _classify(text),
        "lat":      None,
        "lng":      None,
        "tags":     ["news", "noticias_agricolas", "cafe"],
        "meta":     url,
        "pub_date": _parse_stamp(resp.text),
    }


def _scrape() -> list[dict]:
    try:
        urls = _fetch_list()
    except Exception as e:  # noqa: BLE001
        print(f"[noticias_cafe] list fetch failed — {e}")
        return []
    items = []
    for url in urls:
        try:
            item = _fetch_article(url)
            if item:
                items.append(item)
        except Exception as e:  # noqa: BLE001
            print(f"[noticias_cafe] {url}: {type(e).__name__}")
    print(f"[noticias_cafe] {len(items)} items")
    return items


async def run(page) -> list[dict]:
    """Scrape the coffee-news list off the Playwright thread (plain HTTP works)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _scrape)


if __name__ == "__main__":
    # Manual check: print the scraped items (headline, category, timestamp).
    for it in _scrape():
        print(f"  [{it['category']:7}] {it['pub_date'].isoformat()}  {it['title'][:70]}")
