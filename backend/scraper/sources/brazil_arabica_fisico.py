"""
brazil_arabica_fisico.py — Brazil Arabica physical market (Tipo 6/7).

Source: noticiasagricolas.com.br "Café Arábica - Mercado Físico (Tipo 6/7)"
    https://www.noticiasagricolas.com.br/cotacoes/cafe/cafe-arabica-mercado-fisico-tipo-6-7[/YYYY-MM-DD]

The page lists one R$/saca-60kg quote per município (Guaxupé/Cooxupé, Varginha/
Minasul, Franca/Cocapec, …). We keep EVERY município quote for research and
derive the single display price as a *trimmed mean* — drop the highest and lowest
quote, average the rest — so an outlier co-op can't skew the number.

The dedicated URL takes a date suffix, so `backfill()` walks past dates to build
history. CEPEA's own site is Cloudflare-walled from CI; this page is plain HTTP.

Outputs frontend/public/data/brazil_arabica_fisico.json:
    {unit, source, updated, history: [{date, trimmed_mean, n, municipios:[{name,price,var}]}]}
The brazil_arabica origin price (origin_prices_history) reads trimmed_mean from here.
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "data" / "brazil_arabica_fisico.json"
BASE = ("https://www.noticiasagricolas.com.br/cotacoes/cafe/"
        "cafe-arabica-mercado-fisico-tipo-6-7")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

_BRL_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
_DATE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def _brl(s: str) -> float | None:
    m = _BRL_RE.search(s or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


def fetch(date_iso: str | None = None, timeout: int = 30) -> tuple[str | None, list[dict]]:
    """Return (fechamento_iso, municipios) for a date (YYYY-MM-DD) or the latest.

    municipios = [{"name", "price" (float R$/saca), "var" (str)}].
    """
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

    municipios: list[dict] = []
    for table in soup.find_all("table"):
        hdr = " ".join(c.get_text(" ", strip=True).lower() for c in table.find_all("th"))
        if "munic" not in hdr or "pre" not in hdr:
            continue
        for tr in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if len(cells) >= 2 and cells[0]:
                price = _brl(cells[1])
                if price is not None:
                    municipios.append({"name": cells[0], "price": price,
                                       "var": cells[2] if len(cells) > 2 else ""})
        if municipios:
            break
    return fech, municipios


def trimmed_mean(prices: list[float]) -> float | None:
    """Drop one min + one max, average the rest. <3 values → plain mean."""
    ps = [p for p in prices if p is not None]
    if not ps:
        return None
    if len(ps) < 3:
        return round(sum(ps) / len(ps), 2)
    core = sorted(ps)[1:-1]
    return round(sum(core) / len(core), 2)


def _entry(fech: str, municipios: list[dict]) -> dict:
    return {
        "date": fech,
        "trimmed_mean": trimmed_mean([m["price"] for m in municipios]),
        "n": len(municipios),
        "municipios": municipios,
    }


def _load() -> dict:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
        d.setdefault("history", [])
        return d
    except Exception:
        return {
            "unit": "BRL/saca_60kg",
            "source": "noticiasagricolas.com.br — Café Arábica Mercado Físico (Tipo 6/7)",
            "display": "trimmed mean (drop highest+lowest município, average the rest)",
            "history": [],
        }


def _save(doc: dict) -> None:
    doc["history"] = sorted(doc["history"], key=lambda e: e["date"])
    doc["updated"] = datetime.now(UTC).isoformat()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def latest_trimmed_mean() -> float | None:
    doc = _load()
    return doc["history"][-1]["trimmed_mean"] if doc.get("history") else None


def export_brazil_arabica_fisico() -> None:
    """Daily: fetch today's físico table and upsert today's entry."""
    try:
        fech, municipios = fetch()
    except Exception as e:  # noqa: BLE001
        print(f"  brazil_arabica_fisico → fetch failed: {type(e).__name__}: {e}")
        return
    if not fech or not municipios:
        print("  brazil_arabica_fisico → no municípios parsed")
        return
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    by_date[fech] = _entry(fech, municipios)
    doc["history"] = list(by_date.values())
    _save(doc)
    print(f"  brazil_arabica_fisico.json → {fech}: {len(municipios)} municípios, "
          f"trimmed mean R$ {by_date[fech]['trimmed_mean']}")


def backfill(start: str, end: str | None = None, delay: float = 0.12) -> None:
    """Walk business days [start, end], upsert each date's físico (deduped by the
    page's actual Fechamento date, so holidays collapse). end defaults to today."""
    end_d = date.fromisoformat(end) if end else date.today()
    doc = _load()
    by_date = {e["date"]: e for e in doc["history"]}
    d = date.fromisoformat(start)
    fetched = 0
    while d <= end_d:
        if d.weekday() < 5:                       # Mon–Fri only
            iso = d.isoformat()
            try:
                fech, municipios = fetch(iso, timeout=20)
                if fech and municipios:
                    by_date[fech] = _entry(fech, municipios)
                    fetched += 1
            except Exception as e:  # noqa: BLE001
                print(f"    {iso}: {type(e).__name__}")
            time.sleep(delay)
        d += timedelta(days=1)
    doc["history"] = list(by_date.values())
    _save(doc)
    print(f"[backfill] {fetched} business-day fetches; history now "
          f"{len(doc['history'])} dates {doc['history'][0]['date']}..{doc['history'][-1]['date']}")


def seed_origin_history() -> None:
    """Rebuild origin_prices_history.json → brazil_arabica.history from the físico
    trimmed-mean series (one-time backfill; daily runs then append forward)."""
    oph = ROOT / "frontend" / "public" / "data" / "origin_prices_history.json"
    doc = _load()
    points = [{"date": e["date"], "price": e["trimmed_mean"]}
              for e in doc["history"] if e.get("trimmed_mean") is not None]
    d = json.loads(oph.read_text(encoding="utf-8"))
    slot = d["origins"].setdefault("brazil_arabica", {})
    slot["history"] = points
    oph.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[seed] brazil_arabica.history ← {len(points)} points "
          f"({points[0]['date']}..{points[-1]['date']})" if points else "[seed] no points")


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "daily"
    if cmd == "backfill":
        backfill(sys.argv[2] if len(sys.argv) > 2 else "2023-01-02",
                 sys.argv[3] if len(sys.argv) > 3 else None)
    elif cmd == "seed-origin":
        seed_origin_history()
    else:
        export_brazil_arabica_fisico()
