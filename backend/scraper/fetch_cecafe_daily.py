"""
fetch_cecafe_daily.py
Scrapes Cecafe's public daily export summary page (no login required) and
appends today's cumulative registration data to cecafe_daily.json.

Page: https://www.cecafe.com.br/dados-estatisticos/exportacoes-brasileiras/resumo-diario/

The page shows:
  - Current month: today's daily movement + month-to-date accumulation
  - Previous month: full-month totals

We record the "Acumulado" (month-to-date) value for today's day number,
building up a day-by-day curve for each month as the scraper runs daily.

Run:
    cd backend
    python -m scraper.fetch_cecafe_daily

Output: frontend/public/data/cecafe_daily.json
  {
    "updated": "YYYY-MM-DD",
    "arabica":  { "YYYY-MM": { "1": bags, "2": bags, ... } },
    "conillon": { "YYYY-MM": { "1": bags, "2": bags, ... } }
  }
"""
import gzip
import http.cookiejar
import json
import re
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path

ROOT     = Path(__file__).resolve().parents[2]
OUT_DIR  = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_PATH = OUT_DIR / "cecafe_daily.json"

DAILY_URL = "https://www.cecafe.com.br/dados-estatisticos/exportacoes-brasileiras/resumo-diario/"


# ── Fetch ─────────────────────────────────────────────────────────────────────

def _fetch_page() -> str:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [
        ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
        ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
        ("Accept-Language", "pt-BR,pt;q=0.9"),
        ("Accept-Encoding", "gzip, deflate"),
        ("Connection", "keep-alive"),
    ]
    resp = opener.open(DAILY_URL, timeout=20)
    raw = resp.read()
    try:
        return gzip.decompress(raw).decode("utf-8", errors="ignore")
    except Exception:
        return raw.decode("utf-8", errors="ignore")


# ── Parse ─────────────────────────────────────────────────────────────────────

def _parse_int_br(s: str) -> int:
    return int(s.replace(".", "").replace(",", "").strip())


def _parse_page(html: str) -> dict:
    """
    Returns:
      {
        "ref_date":      date,   # date shown on page ("Informações recebidas até")
        "arabica":       int,    # current month cumulative arabica bags
        "conillon":      int,    # current month cumulative conilon bags
        "soluvel":       int,    # current month cumulative soluvel bags
        "prev_ym":       str,    # "YYYY-MM" of previous month
        "prev_arabica":  int,    # same-day cumulative arabica last month
        "prev_conillon": int,    # same-day cumulative conilon last month
        "prev_soluvel":  int,    # same-day cumulative soluvel last month
      }

    The TOTAIS row for "Emissão de Certificados de Origem" has 12 numbers:
      [1] arabica_dia  [2] conillon_dia  [3] soluvel_dia  [4] total_dia
      [5] arabica_acum [6] conillon_acum [7] soluvel_acum [8] total_acum
      [9] arabica_prev [10] conillon_prev [11] soluvel_prev [12] total_prev

    Columns 9-11 are "Mês Anterior" = same-day cumulative for prior month.
    """
    # Strip scripts/styles then convert to plain text
    clean = re.sub(r'<(script|style)[^>]*>.*?</(script|style)>', '',
                   html, flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r'<[^>]+>', ' ', clean)
    text  = re.sub(r'\s+', ' ', clean).strip()

    # ── Reference date ────────────────────────────────────────────────────────
    date_m = re.search(r'recebidas\s+at[eé]:\s*(\d{2})/(\d{2})/(\d{4})', text, re.IGNORECASE)
    if not date_m:
        raise ValueError("Could not find reference date on page")
    ref_date = date(int(date_m.group(3)), int(date_m.group(2)), int(date_m.group(1)))
    print(f"  Reference date: {ref_date}")

    # ── TOTAIS row for Certificados de Origem ────────────────────────────────
    cert_idx = text.find("Certificados de Origem")
    if cert_idx < 0:
        cert_idx = 0

    totais_m = re.search(
        r'TOTAIS\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+'  # dia: arabica conilon soluvel total
        r'([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+'            # acum: arabica conilon soluvel total
        r'([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)',               # prev: arabica conilon soluvel total
        text[cert_idx:],
        re.IGNORECASE
    )
    if not totais_m:
        raise ValueError("Could not find TOTAIS row for Certificados de Origem")

    arabica_acum  = _parse_int_br(totais_m.group(5))
    conillon_acum = _parse_int_br(totais_m.group(6))
    soluvel_acum  = _parse_int_br(totais_m.group(7))
    prev_arab     = _parse_int_br(totais_m.group(9))
    prev_coni     = _parse_int_br(totais_m.group(10))
    prev_solv     = _parse_int_br(totais_m.group(11))

    print(f"  Acumulado    — Arabica: {arabica_acum:,}  Conilon: {conillon_acum:,}  Soluvel: {soluvel_acum:,}")
    print(f"  Mês Anterior — Arabica: {prev_arab:,}  Conilon: {prev_coni:,}  Soluvel: {prev_solv:,}")

    prev_month = ref_date.month - 1 or 12
    prev_year  = ref_date.year if ref_date.month > 1 else ref_date.year - 1
    prev_ym    = f"{prev_year}-{prev_month:02d}"

    return {
        "ref_date":      ref_date,
        "arabica":       arabica_acum,
        "conillon":      conillon_acum,
        "soluvel":       soluvel_acum,
        "prev_ym":       prev_ym,
        "prev_arabica":  prev_arab,
        "prev_conillon": prev_coni,
        "prev_soluvel":  prev_solv,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    today = date.today()
    print("=== Cecafe daily registration scraper (public, no login) ===")

    # 1. Load existing JSON
    existing: dict = {"updated": "", "arabica": {}, "conillon": {}, "soluvel": {}}
    if OUT_PATH.exists():
        try:
            raw_json = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            existing["arabica"]  = raw_json.get("arabica",  {})
            existing["conillon"] = raw_json.get("conillon", {})
            existing["soluvel"]  = raw_json.get("soluvel",  {})
        except Exception:
            pass

    # 2. Fetch page
    print(f"\n[1] Fetching {DAILY_URL}...")
    html = _fetch_page()
    print(f"  Page size: {len(html):,} chars")

    # 3. Parse
    print("\n[2] Parsing data...")
    try:
        parsed = _parse_page(html)
    except ValueError as e:
        print(f"  ERROR: {e}")
        sys.exit(1)

    ref   = parsed["ref_date"]
    ym    = f"{ref.year}-{ref.month:02d}"
    day   = str(ref.day)

    # 4. Merge current month data
    for key in ("arabica", "conillon", "soluvel"):
        if ym not in existing[key]:
            existing[key][ym] = {}

    existing["arabica"][ym][day]  = parsed["arabica"]
    existing["conillon"][ym][day] = parsed["conillon"]
    existing["soluvel"][ym][day]  = parsed["soluvel"]
    print(f"\n[3] Stored {ym} day {day}: arabica={parsed['arabica']:,}  conilon={parsed['conillon']:,}  soluvel={parsed['soluvel']:,}")

    # 5. Store previous month same-day cumulative (Mês Anterior = same-day last month)
    prev_ym = parsed["prev_ym"]

    for key in ("arabica", "conillon", "soluvel"):
        if prev_ym not in existing[key]:
            existing[key][prev_ym] = {}

    existing["arabica"][prev_ym][day]  = parsed["prev_arabica"]
    existing["conillon"][prev_ym][day] = parsed["prev_conillon"]
    existing["soluvel"][prev_ym][day]  = parsed["prev_soluvel"]
    print(f"  Stored {prev_ym} day {day} (same-day): arabica={parsed['prev_arabica']:,}  conilon={parsed['prev_conillon']:,}  soluvel={parsed['prev_soluvel']:,}")

    # 6. Save
    existing["updated"] = ref.isoformat()
    OUT_PATH.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWritten -> {OUT_PATH}  ({OUT_PATH.stat().st_size:,} bytes)")
    months_a = sorted(existing["arabica"].keys())
    print(f"Months stored: {months_a}")


if __name__ == "__main__":
    main()
