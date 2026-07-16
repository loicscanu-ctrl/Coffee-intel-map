"""
Temporary verification: run the Notícias Agrícolas coffee-news scraper live
(CI only — the site 403s the dev sandbox) and print the assembled items so we
can confirm titles, categories and timestamps before finalizing. Removed once
verified.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

from scraper.sources.noticias_cafe import _scrape


def main():
    print("\n########## NA coffee news scrape ##########")
    items = _scrape()
    print(f"  total items: {len(items)}")
    for it in items:
        print(f"   [{it['category']:7}] {it['pub_date'].isoformat()}  {it['title'][:66]}")
        print(f"      body: {it['body'][:90]!r}")
        print(f"      url : {it['meta']}")


if __name__ == "__main__":
    main()
