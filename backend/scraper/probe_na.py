"""
Probe: verify the B3 4/5 parser end-to-end, and inspect the /noticias/cafe/ news
list (RSS feed? per-article date structure?) so we can build the news source.
Pure diagnostic — no DB, no commits.
"""
from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*",
                                               "Accept-Language": "pt-BR,pt;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def probe_b3():
    from scraper.sources.brazil_b3_arabica import fetch
    print("\n########## B3 4/5 parser check ##########")
    for d in [None, "2026-07-14", "2026-01-15", "2024-07-15"]:
        try:
            fech, contracts = fetch(d)
            front = contracts[0] if contracts else {}
            print(f"  {d or 'today'}: Fechamento={fech} front={front.get('month')} "
                  f"US$ {front.get('price')}  ({len(contracts)} contracts)")
        except Exception as e:  # noqa: BLE001
            print(f"  {d}: {type(e).__name__}: {e}")


def probe_news():
    from bs4 import BeautifulSoup
    base = "https://www.noticiasagricolas.com.br"

    print("\n########## NEWS: list page → links ##########")
    st, html = get(base + "/noticias/cafe/")
    print(f"  list HTTP {st} {len(html)} bytes")
    soup = BeautifulSoup(html, "html.parser")
    seen, arts = set(), []
    for a in soup.find_all("a", href=True):
        if re.search(r"/noticias/cafe/\d+-.+\.html", a["href"]) and len(a.get_text(strip=True)) > 20:
            if a["href"] not in seen:
                seen.add(a["href"])
                arts.append(a)
    print(f"  unique article links: {len(arts)}")

    print("\n########## NEWS: article page metadata ##########")
    for a in arts[:3]:
        href = a["href"] if a["href"].startswith("http") else base + a["href"]
        try:
            _, ah = get(href)
        except Exception as e:  # noqa: BLE001
            print(f"   ERR {type(e).__name__} {href}")
            continue
        asoup = BeautifulSoup(ah, "html.parser")

        def meta(*keys):
            for k in keys:
                m = (asoup.find("meta", attrs={"property": k})
                     or asoup.find("meta", attrs={"name": k})
                     or asoup.find("meta", attrs={"itemprop": k}))
                if m and m.get("content"):
                    return f"{k}={m['content']!r}"
            return None

        print(f"   · {href}")
        print(f"     list_text={a.get_text(' ', strip=True)[:70]!r}")
        print(f"     published={meta('article:published_time', 'article:modified_time', 'datePublished', 'date')}")
        print(f"     og:title ={meta('og:title')}")
        print(f"     og:desc  ={(meta('og:description', 'description') or '')[:120]}")
        # visible date/time near the article header
        tnode = asoup.find("time")
        if tnode:
            print(f"     <time>   ={tnode.get('datetime') or tnode.get_text(strip=True)!r}")
        vis = re.search(r"\d{2}/\d{2}/\d{4}[^<]{0,12}\d{2}:\d{2}", ah)
        print(f"     visible  ={vis.group(0) if vis else '-'!r}")


def main():
    probe_b3()
    probe_news()


if __name__ == "__main__":
    main()
