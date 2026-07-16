"""
brazil_b3_arabica.py — B3 "Café Arábica 4/5 (Pregão Regular)" close.

Source: noticiasagricolas.com.br
    https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-arabica-4-5-b3-prego-regular[/YYYY-MM-DD]

The page's "Café Arábica 4/5 - B3 (Pregão Regular)" table lists the B3 (BM&F)
arabica futures curve — one row per contract month, priced in US$/saca-60kg. We
keep the whole curve for research and expose the FRONT contract (nearest month,
first row) as the headline B3 4/5 price. The dedicated URL takes a date suffix,
so backfill() walks past dates.

Writes frontend/public/data/brazil_b3_arabica.json:
    {unit, source, updated, history:[{date, front_month, front_price, contracts:[{month,price,var}]}]}
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]          # repo root
OUT = ROOT / "frontend" / "public" / "data" / "brazil_b3_arabica.json"
BASE = ("https://www.noticiasagricolas.com.br/cotacoes/cafe/"
        "cafe-arabica-4-5-b3-prego-regular")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

_NUM_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})*,\d{2}")
_DATE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def _num(s: str) -> float | None:
    m = _NUM_RE.search(s or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def fetch(date_iso: str | None = None, timeout: int = 30) -> tuple[str | None, list[dict]]:
    """Return (fechamento_iso, contracts) — contracts newest-listed first
    (nearest month first). contract = {"month", "price" (US$/saca), "var"}."""
    url = BASE + (f"/{date_iso}" if date_iso else "")
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        html = r.read().decode("utf-8", "replace")

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    fm = re.search(r"Fechamento[:\s]*" + _DATE_RE.pattern, html)
    fech = f"{fm.group(3)}-{fm.group(2)}-{fm.group(1)}" if fm else None

    contracts: list[dict] = []
    for table in soup.find_all("table"):
        hdr = " ".join(c.get_text(" ", strip=True).lower() for c in table.find_all("th"))
        # the target table's header is "Contrato - Mês | Fechamento (US$/sc 60 kg) | Variação"
        if "contrato" not in hdr or "us$" not in hdr:
            continue
        for tr in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) >= 2 and cells[0] and "/" in cells[0]:   # e.g. "Setembro/2026"
                price = _num(cells[1])
                if price is not None:
                    contracts.append({"month": cells[0], "price": price,
                                      "var": cells[2] if len(cells) > 2 else ""})
        if contracts:
            break
    return fech, contracts


def _entry(fech: str, contracts: list[dict]) -> dict:
    front = contracts[0] if contracts else {}
    return {
        "date": fech,
        "front_month": front.get("month"),
        "front_price": front.get("price"),
        "contracts": contracts,
    }


def _load() -> dict:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
        d.setdefault("history", [])
        return d
    except Exception:
        return {
            "unit": "USD/saca_60kg",
            "source": "noticiasagricolas.com.br — Café Arábica 4/5 - B3 (Pregão Regular)",
            "note": "front_price = nearest contract; contracts = full B3 arabica curve",
            "history": [],
        }


def _save(doc: dict) -> None:
    doc["history"] = sorted(doc["history"], key=lambda e: e["date"])
    doc["updated"] = datetime.now(UTC).isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def latest_front_price() -> float | None:
    doc = _load()
    return doc["history"][-1]["front_price"] if doc.get("history") else None


def export_brazil_b3_arabica() -> None:
    """Daily: fetch today's B3 4/5 curve and upsert today's entry."""
    try:
        fech, contracts = fetch()
    except Exception as e:  # noqa: BLE001
        print(f"  brazil_b3_arabica → fetch failed: {type(e).__name__}: {e}")
        return
    if not fech or not contracts:
        print("  brazil_b3_arabica → no contracts parsed")
        return
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    by_date[fech] = _entry(fech, contracts)
    doc["history"] = list(by_date.values())
    _save(doc)
    e = by_date[fech]
    print(f"  brazil_b3_arabica.json → {fech}: front {e['front_month']} "
          f"US$ {e['front_price']} ({len(contracts)} contracts)")


def backfill(start: str, end: str | None = None, delay: float = 0.12) -> None:
    end_d = date.fromisoformat(end) if end else date.today()
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    d = date.fromisoformat(start)
    fetched = 0
    while d <= end_d:
        if d.weekday() < 5:
            try:
                fech, contracts = fetch(d.isoformat(), timeout=20)
                if fech and contracts:
                    by_date[fech] = _entry(fech, contracts)
                    fetched += 1
            except Exception as e:  # noqa: BLE001
                print(f"    {d.isoformat()}: {type(e).__name__}")
            time.sleep(delay)
        d += timedelta(days=1)
    doc["history"] = list(by_date.values())
    _save(doc)
    print(f"[backfill] {fetched} fetches; history now {len(doc['history'])} dates "
          f"{doc['history'][0]['date']}..{doc['history'][-1]['date']}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "backfill":
        backfill(sys.argv[2] if len(sys.argv) > 2 else "2023-06-01",
                 sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        export_brazil_b3_arabica()
