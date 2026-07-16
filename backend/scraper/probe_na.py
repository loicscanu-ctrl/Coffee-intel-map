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
    print("\n########## NEWS: RSS feed candidates ##########")
    for feed in [
        "https://www.noticiasagricolas.com.br/rss/noticias/cafe.xml",
        "https://www.noticiasagricolas.com.br/rss/cafe.xml",
        "https://www.noticiasagricolas.com.br/noticias/cafe/feed",
        "https://www.noticiasagricolas.com.br/rss/",
        "https://www.noticiasagricolas.com.br/feed/",
    ]:
        try:
            st, body = get(feed)
            is_rss = "<rss" in body[:600].lower() or "<feed" in body[:600].lower()
            print(f"  [{st}] rss={is_rss} {len(body)}B  {feed}")
            if is_rss:
                items = re.findall(r"<item>.*?</item>", body, re.S)[:3]
                for it in items:
                    t = re.search(r"<title>(.*?)</title>", it, re.S)
                    p = re.search(r"<pubDate>(.*?)</pubDate>", it, re.S)
                    l = re.search(r"<link>(.*?)</link>", it, re.S)
                    print(f"       · {(t.group(1) if t else '')[:70]!r} | {p.group(1) if p else '-'} | {l.group(1) if l else '-'}")
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {type(e).__name__} {feed}")

    print("\n########## NEWS: list page structure ##########")
    st, html = get("https://www.noticiasagricolas.com.br/noticias/cafe/")
    print(f"  list HTTP {st} {len(html)} bytes")
    soup = BeautifulSoup(html, "html.parser")
    # dump the first few article containers with surrounding structure
    arts = [a for a in soup.find_all("a", href=True)
            if re.search(r"/noticias/cafe/\d+-.+\.html", a["href"]) and len(a.get_text(strip=True)) > 20]
    print(f"  article links: {len(arts)}")
    for a in arts[:5]:
        # climb to the enclosing list item to see date/time markup
        li = a
        for _ in range(4):
            if li.parent:
                li = li.parent
        block = re.sub(r"\s+", " ", li.get_text(" ", strip=True))[:220]
        print(f"   · href={a['href']}")
        print(f"     text={a.get_text(' ', strip=True)[:80]!r}")
        print(f"     block={block!r}")


def main():
    probe_b3()
    probe_news()


if __name__ == "__main__":
    main()
