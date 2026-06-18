"""dane_colombia_exports.py — DANE foreign-trade coffee exports.

DANE (Departamento Administrativo Nacional de Estadística) publishes a
monthly XLS annex on its Comercio Exterior page covering exports keyed
by NANDINA subpartida (10-digit Colombian extension of HS-2022). For
coffee that means chapter 0901, with the two volume-relevant lines:

    0901.11.10.00 — Café sin tostar, sin descafeinar, suave lavado
    0901.11.90.00 — Café sin tostar, sin descafeinar, los demás

URL pattern (verified during recon — predictable, M+1 to M+2 cadence):

    https://www.dane.gov.co/files/operaciones/EXPORTACIONES/
      anex-EXPORTACIONES-{mmm}{yyyy}.xls

…where `{mmm}` is the lowercase Spanish 3-letter month
("ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"),
e.g. `anex-EXPORTACIONES-mar2026.xls` for March 2026 exports (published
around 7 May 2026).

Output (frontend/public/data/colombia_supply.json's `exports.monthly`):

  {
    "month": "YYYY-MM",
    "total_t":          63_000.0,    # tons, all coffee chapter 0901
    "total_k_bags":     1050.0,      # converted to thousand 60-kg bags
    "by_nandina": [
      {"code": "0901.11.10.00", "tons": 49_100.0, "fob_usd": 312_000_000.0},
      {"code": "0901.11.90.00", "tons": 13_900.0, "fob_usd": 88_000_000.0}
    ],
    "_source_xls": "https://.../anex-EXPORTACIONES-mar2026.xls"
  }

DANE's XLS is the legacy BIFF format (.xls, not .xlsx); we read with
xlrd. Multi-sheet workbook — coffee usually appears on a "Por
Subpartida" sheet inside a chapter cross-tab; we scan every sheet and
match rows whose first column starts with "0901".

⚠ Geo-fence risk — DANE may serve a custom 403 with header
`x-deny-reason: host_not_allowed` to non-Colombia IPs. If that happens
from GitHub Actions, the operator should route through the existing
Cloudflare Worker proxy (cf-worker/bps-proxy.js). The scraper fails
loudly (exit 1) so CI surfaces the WAF block instead of writing nothing.

Cadence: 7th–15th of M+2 (e.g., March data uploaded early May). Workflow
polls daily from the 7th.

Usage
-----
    cd backend
    python -m scraper.sources.dane_colombia_exports             # preview latest 3 months
    python -m scraper.sources.dane_colombia_exports --write     # parse + write
    python -m scraper.sources.dane_colombia_exports --month 2026-03   # one specific month
    python -m scraper.sources.dane_colombia_exports --history 12      # last N months
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR  = ROOT / "frontend" / "public" / "data"
CACHE_DIR = ROOT / "backend"  / "scraper" / "cache" / "dane"
OUT_PATH  = DATA_DIR / "colombia_supply.json"

DANE_BASE = "https://www.dane.gov.co/files/operaciones/EXPORTACIONES"

SPANISH_MONTH_ABBR = {
    1: "ene",  2: "feb",  3: "mar",  4: "abr",  5: "may",  6: "jun",
    7: "jul",  8: "ago",  9: "sep", 10: "oct", 11: "nov", 12: "dic",
}

# Two NANDINA lines DANE uses for green coffee. 0901.11.10.00 covers the
# washed-arabica "suave lavado" line that dominates Colombian exports;
# 0901.11.90.00 is the "demás" catch-all (mostly unwashed / naturals /
# non-suave). Together they represent ≥99% of chapter 0901 by volume.
COFFEE_NANDINA = {
    "0901111000": "Café sin tostar, sin descafeinar — suave lavado",
    "0901119000": "Café sin tostar, sin descafeinar — los demás",
}

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/vnd.ms-excel,application/octet-stream,*/*;q=0.8",
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.7",
    "Referer": "https://www.dane.gov.co/index.php/estadisticas-por-tema/comercio-internacional/exportaciones",
}

# 60 kg per bag (FAO/ICO convention) — convert tons to thousand 60-kg bags.
KG_PER_BAG = 60.0


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class NandinaRow:
    code:    str
    tons:    float | None = None
    fob_usd: float | None = None


@dataclass
class MonthlyEntry:
    month:           str                          # "YYYY-MM"
    total_t:         float | None = None          # tons, sum of coffee NANDINAs
    total_k_bags:    float | None = None          # = total_t / 60
    by_nandina:      list[dict] = field(default_factory=list)
    source_xls:      str  = ""
    parser_version:  str  = "v1"


# ── URL helpers ─────────────────────────────────────────────────────────────


def _url_for(year: int, month: int) -> str:
    mmm = SPANISH_MONTH_ABBR[month]
    return f"{DANE_BASE}/anex-EXPORTACIONES-{mmm}{year}.xls"


def _recent_months(n: int) -> list[tuple[int, int]]:
    """Return the most recent N (year, month) pairs starting from (today − 2 months).
    DANE publishes M+1 to M+2, so today − 2 is the safest first attempt."""
    today = date.today()
    # Start two months back (we expect M+2 cadence on the slow end).
    y, m = today.year, today.month - 2
    while m <= 0:
        m += 12
        y -= 1
    pairs: list[tuple[int, int]] = []
    for _ in range(n):
        pairs.append((y, m))
        m -= 1
        if m <= 0:
            m = 12
            y -= 1
    return pairs


# ── HTTP fetching ───────────────────────────────────────────────────────────


# Sentinel return values so the caller can tell a "not yet published" 404
# apart from a probable WAF block — useful for the log summary at the end.
_FETCH_NOT_FOUND = "not_found"
_FETCH_BLOCKED   = "blocked"


def _fetch_xls(url: str, *, timeout: int = 60) -> bytes | str:
    """Download one XLS. Returns raw bytes on 200, a sentinel string on
    any error (so the caller can distinguish 404 from a probable WAF
    block). DANE has been known to 403 non-Colombia IPs; we log and
    fall through so the runner walks the rest of the calendar instead of
    crashing."""
    try:
        resp = requests.get(url, headers=_BROWSER_HEADERS, timeout=timeout)
    except requests.RequestException as e:
        logger.warning(f"[dane] GET {url} → request error: {e}")
        return _FETCH_BLOCKED
    if resp.status_code == 404:
        logger.info(f"[dane] {url} → 404 (file not yet published)")
        return _FETCH_NOT_FOUND
    if resp.status_code != 200:
        deny = resp.headers.get("x-deny-reason", "")
        snippet = (resp.text or "")[:200] if resp.text else ""
        logger.warning(
            f"[dane] GET {url} → HTTP {resp.status_code}"
            + (f" (x-deny-reason: {deny})" if deny else "")
            + f": {snippet}"
        )
        return _FETCH_BLOCKED
    return resp.content


# ── XLS parsing ─────────────────────────────────────────────────────────────


def _normalize_code(raw: object) -> str | None:
    """Reduce a NANDINA cell to its bare 10-digit form, e.g. '0901.11.10.00'
    or '901111000' or '0901111000' → '0901111000'. Handles xlrd's habit
    of returning numeric cells as floats (901111000.0) by coercing to int
    first so the trailing '.0' doesn't get swept into the digit string."""
    if raw is None:
        return None
    if isinstance(raw, float):
        # 901111000.0 → "901111000" (not "9011110000")
        if not raw.is_integer():
            return None
        s = str(int(raw))
    else:
        s = re.sub(r"\D", "", str(raw))
    if not s:
        return None
    # DANE sometimes drops the leading zero on numeric cells (901… instead
    # of 0901…); pad back to 10.
    if len(s) == 9:
        s = "0" + s
    if len(s) != 10:
        return None
    return s


def _cell_number(raw: object) -> float | None:
    """DANE numbers ship as floats in the XLS but occasionally arrive as
    strings with thousands separators when the cell was force-formatted."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if not s:
        return None
    # Colombian locale: dot=thousands, comma=decimal.
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_xls(xls_bytes: bytes) -> list[NandinaRow]:
    """Scan every sheet for rows whose first column is a chapter-0901
    NANDINA. Tons live in a "Toneladas" / "Peso Neto" column and FOB USD
    in a "Valor FOB" / "USD" column — column headers vary between
    annexes, so we detect by header text on a per-sheet basis."""
    try:
        import xlrd  # type: ignore
    except ImportError:
        logger.error("[dane] xlrd not installed — `pip install xlrd==1.2.0`")
        return []

    try:
        wb = xlrd.open_workbook(file_contents=xls_bytes)
    except Exception as e:                           # noqa: BLE001
        logger.warning(f"[dane] xlrd open failed: {e}")
        return []

    rows: list[NandinaRow] = []
    for sheet in wb.sheets():
        if sheet.nrows < 2:
            continue
        # Find header row — DANE sometimes puts up to ~5 title rows before
        # the column headers. Look for a row mentioning "NANDINA" /
        # "Subpartida" together with "Toneladas" or "Peso".
        header_row_idx = None
        for r in range(min(sheet.nrows, 12)):
            line = " ".join(
                str(sheet.cell_value(r, c)) for c in range(sheet.ncols)
            ).lower()
            if (("nandina" in line or "subpartida" in line)
                and ("tonelad" in line or "peso" in line or "kilogr" in line)):
                header_row_idx = r
                break
        if header_row_idx is None:
            continue

        # Column index resolution.
        headers = [str(sheet.cell_value(header_row_idx, c)).lower()
                   for c in range(sheet.ncols)]
        code_col = next(
            (i for i, h in enumerate(headers) if "nandina" in h or "subpartida" in h),
            0,
        )
        tons_col = None
        for i, h in enumerate(headers):
            if "tonelad" in h or ("peso" in h and "neto" in h):
                tons_col = i
                break
        if tons_col is None:
            # No tons column on this sheet (might be a value-only summary).
            continue
        fob_col = next((i for i, h in enumerate(headers) if "fob" in h), None)

        for r in range(header_row_idx + 1, sheet.nrows):
            raw_code = sheet.cell_value(r, code_col)
            code = _normalize_code(raw_code)
            if not code or not code.startswith("0901"):
                continue
            if code not in COFFEE_NANDINA:
                # Other 0901 lines (decaf, roasted, husks/skins, extracts) —
                # not part of the green-coffee export total. Keep them out.
                continue
            tons = _cell_number(sheet.cell_value(r, tons_col))
            fob  = _cell_number(sheet.cell_value(r, fob_col)) if fob_col is not None else None
            rows.append(NandinaRow(code=code, tons=tons, fob_usd=fob))
    return rows


def _format_code(code10: str) -> str:
    """0901111000 → 0901.11.10.00"""
    return f"{code10[0:4]}.{code10[4:6]}.{code10[6:8]}.{code10[8:10]}"


def build_entry(year: int, month: int, source_url: str, rows: list[NandinaRow]) -> MonthlyEntry | None:
    """Aggregate two NANDINA rows into one monthly entry. None if neither
    coffee line was found — better to drop the month than ship a zero."""
    if not rows:
        return None
    total_t = sum((r.tons or 0.0) for r in rows)
    if total_t <= 0:
        return None
    return MonthlyEntry(
        month=         f"{year:04d}-{month:02d}",
        total_t=       round(total_t, 1),
        total_k_bags=  round(total_t * 1000.0 / KG_PER_BAG / 1000.0, 1),
        by_nandina=[
            {
                "code":    _format_code(r.code),
                "tons":    round(r.tons, 1) if r.tons is not None else None,
                "fob_usd": round(r.fob_usd, 0) if r.fob_usd is not None else None,
            }
            for r in rows
        ],
        source_xls=    source_url,
        parser_version="v1",
    )


# ── orchestration ───────────────────────────────────────────────────────────


def _load_existing() -> dict:
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("[dane] existing colombia_supply.json unreadable — starting fresh")
    return {}


def _merge_into_supply(monthly: list[MonthlyEntry]) -> dict:
    """Merge new monthly rows over whatever's already in colombia_supply.json.
    Preserve the USDA `annual` block, weather, ENSO, fnc_price subtrees,
    and any FNC-derived monthly rows whose month we didn't overwrite."""
    doc = _load_existing()
    existing_exports = doc.get("exports") or {}
    existing_monthly = existing_exports.get("monthly") or []

    by_month: dict[str, dict] = {row.get("month"): row for row in existing_monthly if row.get("month")}
    for e in monthly:
        # DANE rows are richer than FNC (NANDINA breakdown + FOB USD), so
        # we let DANE win when both are present for the same month.
        existing = by_month.get(e.month, {})
        merged = {**existing, **{k: v for k, v in asdict(e).items() if v is not None}}
        by_month[e.month] = merged

    monthly_out = sorted(by_month.values(), key=lambda r: r.get("month") or "")
    last_updated = monthly_out[-1].get("month") if monthly_out else (existing_exports.get("last_updated") or "")

    new_exports = {
        "source":       existing_exports.get("source") or "DANE Comercio Exterior — monthly NANDINA annexes",
        "last_updated": last_updated,
        "unit":         "thousand 60-kg bags",
        "monthly":      monthly_out,
        "annual":       existing_exports.get("annual") or [],
    }
    out = dict(doc)
    out["country"] = "colombia"
    out["scraped_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    out["exports"] = new_exports
    return out


def _persist(doc: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _parse_month_arg(s: str) -> tuple[int, int]:
    m = re.match(r"^(20\d{2})[-/](\d{1,2})$", s)
    if not m:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM, got {s!r}")
    yr, mo = int(m.group(1)), int(m.group(2))
    if not 1 <= mo <= 12:
        raise argparse.ArgumentTypeError(f"invalid month {mo}")
    return yr, mo


def run(*, write: bool, months: list[tuple[int, int]]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    entries: list[MonthlyEntry] = []
    not_found = 0
    blocked = 0
    parse_empty = 0
    for year, month in months:
        url = _url_for(year, month)
        cache_path = CACHE_DIR / f"anex-EXPORTACIONES-{SPANISH_MONTH_ABBR[month]}{year}.xls"
        if cache_path.exists():
            xls_bytes: bytes | str = cache_path.read_bytes()
            logger.info(f"[dane] {year}-{month:02d}: cache hit")
        else:
            xls_bytes = _fetch_xls(url)
            if xls_bytes == _FETCH_NOT_FOUND:
                not_found += 1
                continue
            if xls_bytes == _FETCH_BLOCKED:
                blocked += 1
                continue
            cache_path.write_bytes(xls_bytes)  # type: ignore[arg-type]

        rows = parse_xls(xls_bytes)  # type: ignore[arg-type]
        entry = build_entry(year, month, url, rows)
        if entry:
            entries.append(entry)
            print(
                f"[dane] {entry.month}: {entry.total_t:,.0f} t "
                f"= {entry.total_k_bags:,.1f} k-bags "
                f"({len(entry.by_nandina)} NANDINA lines)"
            )
        else:
            parse_empty += 1
            print(f"[dane] {year}-{month:02d}: 0 coffee rows extracted")

    if not entries:
        logger.error(
            f"[dane] FATAL: parsed 0 months (404s={not_found}, "
            f"blocked={blocked}, parse-empty={parse_empty}). "
            "A `blocked > 0` count usually means runner IP is not Colombia "
            "— route through the Cloudflare Worker proxy."
        )
        return 1

    if write:
        doc = _merge_into_supply(entries)
        _persist(doc)
        print(f"[dane] wrote {OUT_PATH} ({len(entries)} monthly rows merged)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write",  action="store_true", help="Persist parsed JSON")
    ap.add_argument(
        "--month", type=_parse_month_arg, action="append", metavar="YYYY-MM",
        help="Specific month(s) to fetch; repeatable. Default: last 3 published.",
    )
    ap.add_argument(
        "--history", type=int, default=3,
        help="When --month is not given, fetch the last N months (default 3).",
    )
    args = ap.parse_args()

    months = args.month if args.month else _recent_months(args.history)
    return run(write=args.write, months=months)


if __name__ == "__main__":
    sys.exit(main())
