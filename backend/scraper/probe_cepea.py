"""
Diagnostic probe #3: nail down the noticiasagricolas.com.br structure so we can
parse the CEPEA/ESALQ Café Arábica (and Conilon) indicator from it.

Probe #1: CEPEA is Cloudflare-walled in CI. Probe #2: BCB coffee series are dead
since 2019, but noticiasagricolas.com.br/cotacoes/cafe returns HTTP 200 via plain
GET and republishes the CEPEA arábica/conilon indicators. This dumps the relevant
HTML + follows the dedicated indicator page so we can see the exact value/date
markup and write a parser.

Pure diagnostic — no DB, no commits. Run via the "Probe: CEPEA" workflow.
"""
from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # → backend/

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
BASE = "https://www.noticiasagricolas.com.br"
CAFE = f"{BASE}/cotacoes/cafe"
PRICE_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def main() -> None:
    from bs4 import BeautifulSoup

    html = get(CAFE)
    print(f"[main] {CAFE}  {len(html)} bytes")
    soup = BeautifulSoup(html, "html.parser")

    # 1) The cotações page renders each indicator as a table with a caption/
    #    heading. Dump every table whose nearby text mentions arábica/robusta.
    print("\n=== tables mentioning arábica / robusta / conilon ===")
    for i, table in enumerate(soup.find_all("table")):
        head = (table.find_previous(["h1", "h2", "h3", "caption", "th"]) or table)
        label = head.get_text(" ", strip=True)[:80]
        ttext = table.get_text(" ", strip=True)
        if re.search(r"ar[aá]bica|robusta|conilon", label + " " + ttext[:120], re.I):
            rows = table.find_all("tr")
            print(f"\n[table {i}] label={label!r}  rows={len(rows)}")
            for r in rows[:4]:
                cells = [c.get_text(' ', strip=True) for c in r.find_all(['td', 'th'])]
                print(f"    {cells}")

    # 2) Dump raw HTML around each 'Arábica' / 'Robusta' occurrence (fallback if
    #    the values aren't in <table>s).
    for kw in ("Arábica", "Arabica", "Robusta", "Conilon"):
        idx = html.find(kw)
        if idx >= 0:
            snippet = re.sub(r"\s+", " ", html[idx-120:idx+360])
            print(f"\n=== raw around {kw!r} ===\n{snippet}")

    # 3) Follow the dedicated CEPEA indicator link(s).
    links = [a["href"] for a in soup.find_all("a", href=True)
             if "indicador-cepea" in a["href"] and "arabica" in a["href"].lower()]
    print(f"\n=== arabica indicator links: {links[:4]} ===")
    if links:
        url = links[0] if links[0].startswith("http") else BASE + links[0]
        try:
            sub = get(url)
            ssoup = BeautifulSoup(sub, "html.parser")
            print(f"[indicator] {url}  {len(sub)} bytes")
            for i, table in enumerate(ssoup.find_all("table")[:2]):
                rows = table.find_all("tr")
                print(f"  [table {i}] rows={len(rows)}")
                for r in rows[:5]:
                    print(f"     {[c.get_text(' ', strip=True) for c in r.find_all(['td','th'])]}")
        except Exception as e:  # noqa: BLE001
            print(f"  indicator fetch failed: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
