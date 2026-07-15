"""
Diagnostic probe — locate the correct "Café Arábica 4/5 - B3 - pregão regular"
table on the noticiasagricolas B3 page (the first probe grabbed a generic
Soja/Milho/Café/Boi futures widget by mistake). Dumps every table with its
preceding heading + header + first rows, plus raw context around "4/5" and
"pregão".

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
B3 = "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-arabica-4-5-b3-prego-regular"


def get(url: str):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html", "Accept-Language": "pt-BR,pt;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode("utf-8", "replace")


def main() -> None:
    from bs4 import BeautifulSoup
    for suffix in ("", "/2026-07-14", "/2026-01-15"):
        url = B3 + suffix
        print(f"\n{'='*70}\n[B3] {url}")
        try:
            st, html = get(url)
        except Exception as e:  # noqa: BLE001
            print(f"   HTTP error: {type(e).__name__}: {e}")
            continue
        soup = BeautifulSoup(html, "html.parser")
        print(f"   HTTP {st}  {len(html)} bytes")
        for i, table in enumerate(soup.find_all("table")):
            head = table.find_previous(["h1", "h2", "h3", "caption"])
            label = head.get_text(" ", strip=True)[:70] if head else "?"
            hdr = [c.get_text(' ', strip=True) for c in table.find_all('th')]
            rows = table.find_all("tr")
            print(f"\n   [table {i}] heading={label!r}  header={hdr}  rows={len(rows)}")
            for tr in rows[:4]:
                cells = [c.get_text(' ', strip=True) for c in tr.find_all(['td','th'])]
                if cells:
                    print(f"       {cells}")
        # raw context around key phrases
        for kw in ("4/5", "Pregão", "pregão", "Fechamento"):
            idx = html.find(kw)
            if idx >= 0:
                print(f"\n   raw around {kw!r}: {re.sub(r'\\s+',' ',html[idx-60:idx+180])!r}")


if __name__ == "__main__":
    main()
