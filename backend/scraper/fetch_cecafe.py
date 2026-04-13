"""
fetch_cecafe.py
Fetches the latest Cecafe monthly export report zip and writes
frontend/public/data/cecafe.json with:

  - series: full monthly volume time series from 1990 (xlsx)
  - by_country: YTD monthly breakdown by destination country (PDF), current year
  - by_country_prev: same for previous year (from Dec zip of prev year)

URL pattern:
  https://www.cecafe.com.br/site/wp-content/uploads/graficos/relatorio_exp_{month_pt}_{year}.zip

Run:
    cd backend
    python -m scraper.fetch_cecafe
"""
import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import date, datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("openpyxl not installed — run: pip install openpyxl")
    sys.exit(1)
try:
    import pdfplumber
except ImportError:
    print("pdfplumber not installed — run: pip install pdfplumber")
    sys.exit(1)

MONTHS_PT = {
    1: "janeiro", 2: "fevereiro", 3: "marco",    4: "abril",
    5: "maio",    6: "junho",     7: "julho",     8: "agosto",
    9: "setembro",10: "outubro",  11: "novembro", 12: "dezembro",
}

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ── HTTP fetch ────────────────────────────────────────────────────────────────

def _cecafe_url(year: int, month: int) -> str:
    return (
        f"https://www.cecafe.com.br/site/wp-content/uploads/graficos/"
        f"relatorio_exp_{MONTHS_PT[month]}_{year}.zip"
    )


def _fetch_zip(year: int, month: int) -> bytes | None:
    url = _cecafe_url(year, month)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        print(f"  OK {MONTHS_PT[month]} {year} ({len(data):,} bytes)")
        return data
    except Exception as e:
        print(f"  MISS {MONTHS_PT[month]} {year}: {e}")
        return None


def _find_latest(start_year: int, start_month: int, max_back: int = 6):
    """Walk back from start_month until a zip downloads successfully."""
    y, m = start_year, start_month
    for _ in range(max_back):
        raw = _fetch_zip(y, m)
        if raw:
            return y, m, raw
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return None, None, None


# ── Volume xlsx ───────────────────────────────────────────────────────────────

def _extract_volume_series(raw_zip: bytes) -> list[dict]:
    """Extract VOLUME (SACAS) sheet → full monthly time series."""
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as z:
        xlsx_name = next(
            (n for n in z.namelist() if n.endswith(".xlsx") and "Volume" in n), None
        )
        if not xlsx_name:
            raise ValueError("Volume xlsx not found in zip")
        with z.open(xlsx_name) as f:
            wb = openpyxl.load_workbook(io.BytesIO(f.read()), data_only=True)

    ws = wb["VOLUME (SACAS)"]
    records = []
    for row in ws.iter_rows(values_only=True):
        if not isinstance(row[0], datetime):
            continue
        dt, conillon, arabica, verde, torrado, soluvel, industrializado, total = row[:8]
        records.append({
            "date":            dt.strftime("%Y-%m"),
            "conillon":        int(conillon        or 0),
            "arabica":         int(arabica         or 0),
            "total_verde":     int(verde            or 0),
            "torrado":         int(torrado          or 0),
            "soluvel":         int(soluvel          or 0),
            "total_industria": int(industrializado  or 0),
            "total":           int(total            or 0),
        })
    return records


# ── Country PDF ───────────────────────────────────────────────────────────────

def _parse_int_br(s: str) -> int:
    """Parse Brazilian number format: '391.970' → 391970."""
    return int(s.replace(".", "").replace(",", ""))


def _extract_country_volumes(raw_zip: bytes, year: int) -> dict:
    """
    Parse PaisDestino_mensal_volume_acumulado{YY}.pdf.
    Each row has 12 month columns + 1 total; only filled months are non-zero.
    Header line tells us which month indices map to real dates.
    """
    yy = str(year)[-2:]
    pdf_name = f"PaisDestino_mensal_volume_acumulado{yy}.pdf"

    with zipfile.ZipFile(io.BytesIO(raw_zip)) as z:
        if pdf_name not in z.namelist():
            print(f"  Country PDF not found: {pdf_name}")
            return {}
        with z.open(pdf_name) as f:
            pdf_bytes = f.read()

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    # Header line: "01/2026 02/2026 / / / / / / / / / / TOTAL"
    # Detect which column indices have a real month label
    header_match = re.search(r"^([\d/\s]+TOTAL)", full_text, re.MULTILINE)
    if not header_match:
        print(f"  Could not detect header in country PDF for {year}")
        return {}

    header_tokens = header_match.group(1).split()
    month_columns: dict[int, str] = {}  # col_index -> "YYYY-MM"
    col = 0
    for tok in header_tokens:
        m = re.match(r"^(\d{2})/(\d{4})$", tok)
        if m:
            month_str = f"{m.group(2)}-{m.group(1)}"
            month_columns[col] = month_str
            col += 1
        elif tok == "/":
            col += 1
        # "TOTAL" is not a data column

    months_present = list(month_columns.values())
    n_cols = 12  # always 12 month columns + 1 total in this PDF

    # Parse data lines: COUNTRY  num num ... num (13 numbers: 12 months + total)
    num_pat = r"\d+(?:\.\d+)*"
    country_data: dict[str, dict[str, int]] = {}

    SKIP = {"TOTAL", "OUTROS", "Exporta"}

    for line in full_text.split("\n"):
        line = line.strip()
        if not line:
            continue
        # Must start with an uppercase letter and contain numbers
        m = re.match(r"^([A-Z][A-Z0-9\s\.\(\)\-\/\']+?)\s+((?:" + num_pat + r"\s+){" + str(n_cols) + r"}" + num_pat + r")\s*$", line)
        if not m:
            continue
        country = m.group(1).strip()
        if any(country.startswith(s) for s in SKIP) or len(country) < 2:
            continue
        numbers = re.findall(num_pat, m.group(2))
        if len(numbers) < n_cols + 1:
            continue

        monthly = {}
        for col_idx, month_str in month_columns.items():
            val = _parse_int_br(numbers[col_idx])
            if val > 0:
                monthly[month_str] = val
        if monthly:
            country_data[country] = monthly

    print(f"  Parsed {len(country_data)} countries for {year} ({', '.join(months_present)})")
    return {"months": months_present, "countries": country_data}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    today = date.today()
    print("=== Cecafe export scraper ===")

    # Latest available month
    print("\n[1] Finding latest monthly report...")
    y, m, raw = _find_latest(today.year, today.month)
    if not raw:
        print("ERROR: could not fetch any Cecafe zip")
        sys.exit(1)
    report_label = f"{MONTHS_PT[m].capitalize()} {y}"

    # Full volume time series (xlsx)
    print("\n[2] Extracting volume series (xlsx)...")
    series = _extract_volume_series(raw)
    print(f"  {len(series)} months ({series[0]['date']} to {series[-1]['date']})")

    # Country breakdown — current year
    print(f"\n[3] Extracting country volumes for {y}...")
    country_current = _extract_country_volumes(raw, y)

    # Country breakdown — previous year (fetch Dec of prev year)
    prev_year = y - 1
    print(f"\n[4] Fetching previous year ({prev_year} Dec) for country comparison...")
    _, _, raw_prev = _find_latest(prev_year, 12, max_back=3)
    country_prev = {}
    if raw_prev:
        country_prev = _extract_country_volumes(raw_prev, prev_year)

    out = {
        "source":        "Cecafe",
        "report":        report_label,
        "updated":       today.isoformat(),
        "unit":          "bags_60kg",
        "series":        series,
        "by_country":    country_current,
        "by_country_prev": country_prev,
    }

    path = OUT_DIR / "cecafe.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"\nWritten → {path}  ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
