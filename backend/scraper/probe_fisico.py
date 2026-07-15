"""
Diagnostic probe: the Brazil Arabica "Mercado Físico (Tipo 6/7)" page on
noticiasagricolas — confirm table structure, the date-in-URL backfill, and how
far back the history goes.

URL pattern: /cotacoes/cafe/cafe-arabica-mercado-fisico-tipo-6-7[/YYYY-MM-DD]

For each probed date we print: HTTP status, the "Fechamento" date, every
município row (name, price, var), the count, and the trimmed mean (drop min+max,
average the rest) — exactly the display value we'll compute.

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
BASE = "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-arabica-mercado-fisico-tipo-6-7"
BRL_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{4})")


def _brl(s: str):
    m = BRL_RE.search(s or "")
    return float(m.group(1).replace(".", "").replace(",", ".")) if m else None


def get(url: str):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html", "Accept-Language": "pt-BR,pt;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode("utf-8", "replace")


def parse(html: str):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    # "Fechamento: 14/07/2026"
    fech = None
    fm = re.search(r"Fechamento[:\s]*" + DATE_RE.pattern, html)
    if fm:
        fech = fm.group(1)
    rows = []
    for table in soup.find_all("table"):
        headers = " ".join(c.get_text(" ", strip=True).lower() for c in table.find_all("th"))
        if "munic" not in headers or "pre" not in headers:
            continue
        for tr in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) >= 2:
                price = _brl(cells[1])
                if price is not None and cells[0]:
                    var = cells[2] if len(cells) > 2 else ""
                    rows.append((cells[0], price, var))
        if rows:
            break
    return fech, rows


def trimmed_mean(prices: list[float]):
    if len(prices) < 3:
        return sum(prices) / len(prices) if prices else None
    s = sorted(prices)
    core = s[1:-1]  # drop one min + one max
    return sum(core) / len(core)


def probe(date_str: str | None):
    url = BASE + (f"/{date_str}" if date_str else "")
    print(f"\n{'='*66}\n[probe] {url}")
    try:
        st, html = get(url)
    except Exception as e:  # noqa: BLE001
        print(f"   HTTP error: {type(e).__name__}: {e}")
        return
    fech, rows = parse(html)
    print(f"   HTTP {st}  {len(html)} bytes  Fechamento={fech}  municipios={len(rows)}")
    for name, price, var in rows:
        print(f"      {name:38} {price:>10,.2f}  {var}")
    if rows:
        tm = trimmed_mean([p for _, p, _ in rows])
        print(f"   → trimmed mean (drop min+max) = {tm:,.2f}")


def main() -> None:
    # today (no date) + backfill probes across increasing lookback
    for d in [None, "2026-07-14", "2026-07-13", "2026-06-16",
              "2026-01-15", "2025-07-14", "2024-07-15", "2023-01-16", "2021-06-01"]:
        probe(d)


if __name__ == "__main__":
    main()
