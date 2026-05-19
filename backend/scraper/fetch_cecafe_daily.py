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
from datetime import date
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
    Tolerates:
      * Footnote markers after numbers ("123.456*", "123.456¹") — Cecafe
        occasionally annotates retroactive corrections this way.
      * 8-column variant (no Mês Anterior block) — fallback for layouts
        where the prior-month column is dropped during the cross-year
        transition. prev_* fields are set to None in that case.
      * Variable whitespace / non-breaking spaces between cells.
    """
    # Strip scripts/styles then convert to plain text
    clean = re.sub(r'<(script|style)[^>]*>.*?</(script|style)>', '',
                   html, flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r'<[^>]+>', ' ', clean)
    # Normalise non-breaking spaces + Brazilian footnote markers before
    # collapsing whitespace, so the TOTAIS regex sees a stable token stream.
    clean = clean.replace("\xa0", " ").replace("&nbsp;", " ")
    text  = re.sub(r'\s+', ' ', clean).strip()

    # ── Reference date ────────────────────────────────────────────────────────
    date_m = re.search(r'recebidas\s+at[eé]:\s*(\d{2})/(\d{2})/(\d{4})', text, re.IGNORECASE)
    if not date_m:
        idx = text.lower().find('recebidas')
        snippet = text[max(0, idx - 40): idx + 200] if idx >= 0 else text[:400]
        raise ValueError(
            "Could not find reference date on page. "
            f"Page-text excerpt: ...{snippet!r}..."
        )
    ref_date = date(int(date_m.group(3)), int(date_m.group(2)), int(date_m.group(1)))
    print(f"  Reference date: {ref_date}")

    # ── TOTAIS row for Certificados de Origem ────────────────────────────────
    cert_idx = text.find("Certificados de Origem")
    if cert_idx < 0:
        cert_idx = 0

    # Number pattern — Brazilian thousands ("123.456") with optional trailing
    # footnote marker (*, ¹-⁹, †). Used by both 12-col and 8-col fallback.
    _NUM = r'([\d\.]+)[\*¹²³⁴⁵⁶⁷⁸⁹†]?'
    _SEP = r'\s+'

    # Primary: 12-number row (dia + acum + Mês Anterior).
    totais_12 = re.compile(
        r'TOTAIS' + _SEP + (_NUM + _SEP) * 11 + _NUM,
        re.IGNORECASE,
    )
    # Fallback: 8-number row (dia + acum only — no Mês Anterior block).
    totais_8 = re.compile(
        r'TOTAIS' + _SEP + (_NUM + _SEP) * 7 + _NUM,
        re.IGNORECASE,
    )

    body = text[cert_idx:]
    totais_m = totais_12.search(body)
    prev_arab: int | None = None
    prev_coni: int | None = None
    prev_solv: int | None = None

    if totais_m:
        arabica_acum  = _parse_int_br(totais_m.group(5))
        conillon_acum = _parse_int_br(totais_m.group(6))
        soluvel_acum  = _parse_int_br(totais_m.group(7))
        prev_arab     = _parse_int_br(totais_m.group(9))
        prev_coni     = _parse_int_br(totais_m.group(10))
        prev_solv     = _parse_int_br(totais_m.group(11))
    else:
        # Fallback: 8 columns means Mês Anterior was dropped. Keep going so
        # the current-month line still records — prev_* stay None.
        totais_m = totais_8.search(body)
        if not totais_m:
            # Dump a body snippet around the most likely TOTAIS location so the
            # CI log shows what's actually on the page, not just a generic
            # "could not find" message. Most-likely location: just after the
            # "Certificados de Origem" anchor.
            snippet = body[:1200].replace("\n", " ")
            raise ValueError(
                f"Could not find TOTAIS row for Certificados de Origem "
                f"(tried 12-col and 8-col patterns). Body snippet (1.2kb): "
                f"{snippet!r}"
            )
        print("  [parse] WARNING: fell back to 8-column layout (no Mês Anterior)")
        arabica_acum  = _parse_int_br(totais_m.group(5))
        conillon_acum = _parse_int_br(totais_m.group(6))
        soluvel_acum  = _parse_int_br(totais_m.group(7))

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
        # Dump the fetched HTML to a debug file so the next CI run's
        # artefact upload preserves it for offline inspection. Without this
        # the only signal was "Could not find TOTAIS" with no way to see
        # what's actually on the page — which is exactly the position the
        # cecafe_daily scraper has been in since 2026-05-15.
        debug_path = OUT_DIR.parent / "debug" / "cecafe_daily_last_failed.html"
        try:
            debug_path.parent.mkdir(parents=True, exist_ok=True)
            debug_path.write_text(html, encoding="utf-8")
            print(f"  saved page HTML to {debug_path}  ({len(html):,} chars)")
        except Exception as write_err:
            print(f"  (could not save debug HTML: {write_err})")
        print(f"  ERROR: {e}")
        # Retain existing JSON unchanged. Exit non-zero so the workflow's
        # retry loop / failure-alert path fires, but the JSON file still has
        # the last good data — frontend keeps rendering instead of showing
        # an empty chart.
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
