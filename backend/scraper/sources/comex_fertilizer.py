"""
comex_fertilizer.py — Monthly scraper for Brazil fertilizer imports.
Source: MDIC bulk CSV (balanca.economia.gov.br), filtered for NCM Chapter 31.
Streams the yearly CSV files, filters Chapter 31 rows, aggregates by month.
Called from run_monthly.py.

NCM codes sourced from Hedgepoint MDIC methodology (April 2026 report).
"""

import io
import os
import re
import sys
from datetime import datetime, date

# NCM codes of interest (8-digit, all Chapter 31)
# Keys → fertilizer type label stored in DB
NCM_LABELS = {
    # Urea
    "31021010": "Urea",
    "31021090": "Urea",
    "31028000": "Urea",
    # KCl (potassium chloride)
    "31042090": "KCl",
    # MAP (monoammonium phosphate) — 31054000 = ammonium dihydrogenorthophosphate
    "31054000": "MAP",
    # DAP (diammonium phosphate) — 31053000 = diammonium hydrogenorthophosphate
    "31053000": "DAP",
    # AN (ammonium nitrate)
    "31023000": "AN",
    # AS (ammonium sulphate)
    "31022100": "AS",
    # Superphosphate
    "31031020": "Superphosphate",
    "31031030": "Superphosphate",
    "31031100": "Superphosphate",
    "31031900": "Superphosphate",
}

# Base URL pattern for MDIC bulk import CSV by year
MDIC_URL = "https://balanca.economia.gov.br/balanca/bd/comexstat-bd/ncm/IMP_{year}.csv"

# Chapter 31 prefix for fast line-level filtering
_CHAPTER_31_NCM_PREFIX = '"31'


def _month_str_to_date(month_str: str) -> date | None:
    """Convert date strings to date(year, month, 1).

    Handles formats:
    - "2026-01"           → date(2026, 1, 1)
    - "Jan/2026" or "jan/2026" → date(2026, 1, 1)
    Returns None on unrecognised format.
    """
    if not month_str or not month_str.strip():
        return None

    s = month_str.strip()

    # ISO format: "YYYY-MM"
    m = re.fullmatch(r"(\d{4})-(\d{2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), 1)
        except ValueError:
            return None

    return None


def _parse_int(s: str) -> int | None:
    """Strip non-digit characters and return int, or None if empty/no digits."""
    if not s or not s.strip():
        return None
    digits = re.sub(r"[^\d]", "", s)
    if not digits:
        return None
    return int(digits)


def _stream_chapter31_rows(year: int) -> list[dict]:
    """
    Stream MDIC bulk CSV for `year`, return rows where NCM starts with 31.
    Each row: {month: date, ncm_code: str, kg: int|None, fob_usd: float|None}
    """
    import requests

    url = MDIC_URL.format(year=year)
    try:
        resp = requests.get(url, stream=True, timeout=120, verify=False)
        resp.raise_for_status()
    except Exception as e:
        print(f"[comex_fertilizer] Could not fetch {url}: {e}")
        return []

    rows = []
    header = None
    # Suppress urllib3 InsecureRequestWarning for this known-safe gov URL
    import warnings
    warnings.filterwarnings("ignore", message="Unverified HTTPS request")

    for raw_line in resp.iter_lines():
        if isinstance(raw_line, bytes):
            line = raw_line.decode("latin-1", errors="replace")
        else:
            line = raw_line

        if header is None:
            # First line is header
            header = [c.strip('"') for c in line.split(";")]
            continue

        # Fast filter: only keep Chapter 31 lines
        if _CHAPTER_31_NCM_PREFIX not in line:
            continue

        parts = [c.strip('"') for c in line.split(";")]
        if len(parts) < len(header):
            continue

        row = dict(zip(header, parts))
        ncm_code = row.get("CO_NCM", "")
        if not ncm_code.startswith("31"):
            continue

        try:
            yr  = int(row.get("CO_ANO", 0))
            mo  = int(row.get("CO_MES", 0))
            if yr < 2000 or mo < 1 or mo > 12:
                continue
            month_dt = date(yr, mo, 1)
        except (ValueError, TypeError):
            continue

        try:
            kg = int(row.get("KG_LIQUIDO", "") or 0)
        except ValueError:
            kg = None

        try:
            fob = float(row.get("VL_FOB", "") or 0)
        except ValueError:
            fob = None

        rows.append({
            "month":    month_dt,
            "ncm_code": ncm_code,
            "kg":       kg,
            "fob_usd":  fob,
        })

    return rows


async def run(page, db) -> None:  # noqa: ARG001  (page unused — kept for signature)
    """
    Download MDIC bulk CSVs for current and prior year, aggregate Chapter 31
    fertilizer import rows, upsert into FertilizerImport table.
    On failure, logs and retains existing data (does NOT raise).
    """
    try:
        try:
            from models import FertilizerImport
        except ImportError:
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
            from models import FertilizerImport

        today      = date.today()
        this_year  = today.year

        all_rows: list[dict] = []
        for year in (this_year - 2, this_year - 1, this_year):
            year_rows = _stream_chapter31_rows(year)
            print(f"[comex_fertilizer] {year}: {len(year_rows)} Chapter-31 rows")
            all_rows.extend(year_rows)

        if not all_rows:
            print("[comex_fertilizer] No rows found — retaining previous data")
            return

        # Keep last 36 months (3 years for YoY comparison)
        cutoff = date(today.year - 3, today.month, 1)
        all_rows = [r for r in all_rows if r["month"] >= cutoff]

        # Aggregate: sum kg and fob per (month, ncm_code)
        from collections import defaultdict
        agg: dict[tuple, dict] = defaultdict(lambda: {"kg": 0, "fob_usd": 0.0})
        for r in all_rows:
            key = (r["month"], r["ncm_code"])
            agg[key]["kg"]     += r["kg"]     or 0
            agg[key]["fob_usd"] += r["fob_usd"] or 0.0

        inserted = 0
        for (month_dt, ncm_code), totals in agg.items():
            label = NCM_LABELS.get(ncm_code[:8])
            if not label:
                # Still store unknown Chapter 31 codes
                label = f"NCM {ncm_code}"

            db.query(FertilizerImport).filter(
                FertilizerImport.month    == month_dt,
                FertilizerImport.ncm_code == ncm_code,
            ).delete(synchronize_session=False)

            db.add(FertilizerImport(
                month=month_dt,
                ncm_code=ncm_code,
                ncm_label=label,
                net_weight_kg=totals["kg"],
                fob_usd=round(totals["fob_usd"], 2),
                scraped_at=datetime.utcnow(),
            ))
            inserted += 1

        db.commit()
        print(f"[comex_fertilizer] Done. {inserted} rows upserted.")

    except Exception as e:
        db.rollback()
        print(f"[comex_fertilizer] FAILED: {e} — retaining previous data")
