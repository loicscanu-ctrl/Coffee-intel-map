"""
Diagnostic probe for the three noticiasagricolas coffee pages we're wiring:

  A) Brazil Arabica "Mercado Físico (Tipo 6/7)" — multi-município table, with a
     date-in-URL backfill:  /cotacoes/cafe/cafe-arabica-mercado-fisico-tipo-6-7[/YYYY-MM-DD]
  B) B3 "Café Arábica 4/5 pregão regular" — /cotacoes/cafe/cafe-arabica-4-5-b3-prego-regular
  C) Coffee news list — /noticias/cafe/  (titles + links + dates)

Prints structure + the trimmed mean (drop min+max, average the rest) so we can
build the parsers and confirm how far the date backfill reaches.

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
FISICO = "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-arabica-mercado-fisico-tipo-6-7"
B3 = "https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-arabica-4-5-b3-prego-regular"
NEWS = "https://www.noticiasagricolas.com.br/noticias/cafe/"
BRL_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{4})")


def _brl(s: str):
    m = BRL_RE.search(s or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def get(url: str):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html", "Accept-Language": "pt-BR,pt;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode("utf-8", "replace")


def parse_price_table(html: str):
    """Rows [name, price, var] from the first table with a Município/Preço header."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    fm = re.search(r"Fechamento[:\s]*" + DATE_RE.pattern, html)
    fech = fm.group(1) if fm else None
    for table in soup.find_all("table"):
        headers = " ".join(c.get_text(" ", strip=True).lower() for c in table.find_all("th"))
        if "pre" not in headers:
            continue
        rows = []
        for tr in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) >= 2 and cells[0]:
                price = _brl(cells[1])
                if price is not None:
                    rows.append((cells[0], price, cells[2] if len(cells) > 2 else ""))
        if rows:
            return fech, headers, rows
    return fech, None, []


def trimmed_mean(prices):
    if len(prices) < 3:
        return sum(prices) / len(prices) if prices else None
    core = sorted(prices)[1:-1]
    return sum(core) / len(core)


def probe_table(label, url):
    print(f"\n{'='*66}\n[{label}] {url}")
    try:
        st, html = get(url)
    except Exception as e:  # noqa: BLE001
        print(f"   HTTP error: {type(e).__name__}: {e}")
        return
    fech, headers, rows = parse_price_table(html)
    print(f"   HTTP {st}  {len(html)} bytes  Fechamento={fech}  header={headers!r}  rows={len(rows)}")
    for name, price, var in rows:
        print(f"      {name:40} {price:>11,.2f}  {var}")
    if rows:
        print(f"   → trimmed mean = {trimmed_mean([p for _, p, _ in rows]):,.2f}")


def probe_news():
    print(f"\n{'='*66}\n[NEWS] {NEWS}")
    try:
        st, html = get(NEWS)
    except Exception as e:  # noqa: BLE001
        print(f"   HTTP error: {type(e).__name__}: {e}")
        return
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    print(f"   HTTP {st}  {len(html)} bytes")
    # article links under /noticias/cafe/... with a title
    seen = set()
    n = 0
    for a in soup.find_all("a", href=True):
        h = a["href"]
        txt = a.get_text(" ", strip=True)
        if re.search(r"/noticias/cafe/.+\.html", h) and len(txt) > 25 and h not in seen:
            seen.add(h)
            n += 1
            if n <= 12:
                print(f"      {txt[:90]!r}  → {h}")
    print(f"   article-like links: {n}")
    # any dates/times on the page
    times = re.findall(r"\d{2}/\d{2}/\d{4}(?:\s+\d{2}:\d{2})?", html)
    print(f"   date stamps found: {len(times)} (first {times[:6]})")


def main() -> None:
    print("########## A) FÍSICO — today + backfill probes ##########")
    for d in [None, "2026-07-14", "2026-07-13", "2026-06-16",
              "2026-01-15", "2025-07-14", "2024-07-15", "2023-01-16"]:
        probe_table("FISICO", FISICO + (f"/{d}" if d else ""))
    print("\n########## B) B3 café arábica 4/5 ##########")
    probe_table("B3", B3)
    for d in ["2026-07-14", "2026-01-15", "2025-07-14"]:
        probe_table("B3", B3 + f"/{d}")
    print("\n########## C) NEWS ##########")
    probe_news()


if __name__ == "__main__":
    main()
