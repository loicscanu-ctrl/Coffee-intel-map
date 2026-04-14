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
        "ref_date":  date,          # date data is valid for
        "arabica":   int,           # cumulative arabica bags (month-to-date)
        "conillon":  int,           # cumulative conillon bags (month-to-date)
        "prev_arabica":  int | None, # previous month final arabica total
        "prev_conillon": int | None,
        "prev_ym":   str | None,    # "YYYY-MM" of previous month
      }
    """
    # Strip scripts/styles then convert to plain text
    clean = re.sub(r'<(script|style)[^>]*>.*?</(script|style)>', '',
                   html, flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r'<[^>]+>', ' ', clean)
    text  = re.sub(r'\s+', ' ', clean).strip()

    # ── Reference date ────────────────────────────────────────────────────────
    # "Informações recebidas até: 13/04/2026"
    date_m = re.search(r'recebidas\s+at[eé]:\s*(\d{2})/(\d{2})/(\d{4})', text, re.IGNORECASE)
    if not date_m:
        raise ValueError("Could not find reference date on page")
    ref_date = date(int(date_m.group(3)), int(date_m.group(2)), int(date_m.group(1)))
    print(f"  Reference date: {ref_date}")

    # ── Current month block ───────────────────────────────────────────────────
    # The page has three sections for current month:
    #   1. Emissão de Certificados de Origem  ← this is export REGISTRATION
    #   2. Unidades de Despachos Aduaneiros
    #   3. Unidades de Embarques Marítimos
    # We want section 1 (Certificates of Origin = registrations).
    #
    # Each section has a TOTAIS row with 12 numbers:
    #   arabica_dia conillon_dia soluvel_dia total_dia
    #   arabica_acum conillon_acum soluvel_acum total_acum
    #   arabica_prev conillon_prev soluvel_prev total_prev

    # Find first TOTAIS after "Certificados de Origem"
    cert_idx = text.find("Certificados de Origem")
    if cert_idx < 0:
        cert_idx = 0  # fallback to start

    totais_m = re.search(
        r'TOTAIS\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+'  # movimento do dia
        r'([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+'            # acumulado
        r'([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)',               # mês anterior
        text[cert_idx:],
        re.IGNORECASE
    )
    if not totais_m:
        raise ValueError("Could not find TOTAIS row for Certificados de Origem")

    arabica_acum  = _parse_int_br(totais_m.group(5))
    conillon_acum = _parse_int_br(totais_m.group(6))
    prev_arab     = _parse_int_br(totais_m.group(9))
    prev_coni     = _parse_int_br(totais_m.group(10))
    print(f"  Acumulado  — Arabica: {arabica_acum:,}  Conillon: {conillon_acum:,}")
    print(f"  Mês Anterior — Arabica: {prev_arab:,}  Conillon: {prev_coni:,}")

    # Previous month year-month
    prev_month = ref_date.month - 1 or 12
    prev_year  = ref_date.year if ref_date.month > 1 else ref_date.year - 1
    prev_ym    = f"{prev_year}-{prev_month:02d}"

    # ── Previous month FULL accumulation (from "Mês Anterior" tab section) ───
    # After the current month tables, the page repeats with the prior month tab.
    # We look for a second TOTAIS row with MUCH larger acumulado values.
    # Strategy: find all TOTAIS matches and take the one whose acumulado >
    # the current month's (since prev month is complete).
    prev_acum_arab  = prev_arab   # fallback: use what was in current month's prev column
    prev_acum_coni  = prev_coni

    # Look for the previous month section explicitly
    prev_section_m = re.search(
        r'Mar[cç]o|Fevereiro|Janeiro|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro'
        r'\s+\d{4}.*?TOTAIS\s+'
        r'[\d\.]+\s+[\d\.]+\s+[\d\.]+\s+[\d\.]+\s+'
        r'([\d\.]+)\s+([\d\.]+)',
        text[cert_idx + 500:],  # skip current month
        re.IGNORECASE | re.DOTALL
    )
    if prev_section_m and prev_section_m.group(1) and prev_section_m.group(2):
        try:
            prev_acum_arab = _parse_int_br(prev_section_m.group(1))
            prev_acum_coni = _parse_int_br(prev_section_m.group(2))
            print(f"  Prev month full — Arabica: {prev_acum_arab:,}  Conillon: {prev_acum_coni:,}")
        except Exception:
            pass  # keep fallback values

    return {
        "ref_date":      ref_date,
        "arabica":       arabica_acum,
        "conillon":      conillon_acum,
        "prev_ym":       prev_ym,
        "prev_arabica":  prev_acum_arab,
        "prev_conillon": prev_acum_coni,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    today = date.today()
    print("=== Cecafe daily registration scraper (public, no login) ===")

    # 1. Load existing JSON
    existing: dict = {"updated": "", "arabica": {}, "conillon": {}}
    if OUT_PATH.exists():
        try:
            raw_json = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            existing["arabica"]  = raw_json.get("arabica",  {})
            existing["conillon"] = raw_json.get("conillon", {})
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
    if ym not in existing["arabica"]:
        existing["arabica"][ym]  = {}
    if ym not in existing["conillon"]:
        existing["conillon"][ym] = {}

    existing["arabica"][ym][day]  = parsed["arabica"]
    existing["conillon"][ym][day] = parsed["conillon"]
    print(f"\n[3] Stored {ym} day {day}: arabica={parsed['arabica']:,}  conillon={parsed['conillon']:,}")

    # 5. Also store previous month final total (for day 31/30/28 as endpoint)
    prev_ym   = parsed["prev_ym"]
    prev_year, prev_mo = map(int, prev_ym.split("-"))
    import calendar
    last_day = str(calendar.monthrange(prev_year, prev_mo)[1])

    if prev_ym not in existing["arabica"]:
        existing["arabica"][prev_ym]  = {}
    if prev_ym not in existing["conillon"]:
        existing["conillon"][prev_ym] = {}

    # Only store if not already present (don't overwrite richer data)
    if last_day not in existing["arabica"][prev_ym]:
        existing["arabica"][prev_ym][last_day]  = parsed["prev_arabica"]
        existing["conillon"][prev_ym][last_day] = parsed["prev_conillon"]
        print(f"  Stored {prev_ym} day {last_day} (final): arabica={parsed['prev_arabica']:,}  conillon={parsed['prev_conillon']:,}")

    # 6. Save
    existing["updated"] = ref.isoformat()
    OUT_PATH.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWritten -> {OUT_PATH}  ({OUT_PATH.stat().st_size:,} bytes)")
    months_a = sorted(existing["arabica"].keys())
    print(f"Months stored: {months_a}")


if __name__ == "__main__":
    main()
