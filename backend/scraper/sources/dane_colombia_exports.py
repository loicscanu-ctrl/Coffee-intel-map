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

from scraper.validate_export import safe_write_json

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR  = ROOT / "frontend" / "public" / "data"
CACHE_DIR = ROOT / "backend"  / "scraper" / "cache" / "dane"
DEBUG_DIR = ROOT / "backend"  / "scraper" / "debug" / "dane"
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


def inspect_xls(xls_bytes: bytes, source_url: str) -> str:
    """Locate coffee-bearing sheets in a 33-Cuadro workbook. Two passes:

      1. Coverage — for every sheet, find rows whose cells contain
         '0901', 'NANDINA', or 'Café'. Tells us WHICH Cuadro carries
         the coffee detail.
      2. Detail — for each hit-bearing sheet, dump the rows around the
         hits (±3 neighbours) so we can read the header structure
         inline.

    Output is a text report we mirror to the job log + upload as a
    workflow artifact."""
    try:
        import xlrd  # type: ignore
    except ImportError:
        return "xlrd not installed"
    try:
        wb = xlrd.open_workbook(file_contents=xls_bytes)
    except Exception as e:                           # noqa: BLE001
        return f"xlrd open failed: {e}"

    # Tokens to search for. ASCII + accented variants since xlrd
    # preserves whatever the workbook stored.
    needles = ("0901", "nandina", "café", "cafe")

    lines: list[str] = [
        f"=== {source_url}",
        f"sheets: {[s.name for s in wb.sheets()]}",
        "",
        "── COVERAGE PASS (sheets with coffee-bearing rows) ──",
    ]
    coffee_sheets: list[tuple[str, list[int]]] = []
    for sheet in wb.sheets():
        hit_rows: list[int] = []
        for r in range(sheet.nrows):
            row_text = " ".join(
                str(sheet.cell_value(r, c)).lower() for c in range(sheet.ncols)
            )
            if any(n in row_text for n in needles):
                hit_rows.append(r)
        if hit_rows:
            coffee_sheets.append((sheet.name, hit_rows))
            lines.append(
                f"  {sheet.name!r}: {len(hit_rows)} coffee-bearing rows "
                f"({hit_rows[:6]}{'…' if len(hit_rows) > 6 else ''})"
            )
    if not coffee_sheets:
        lines.append("  (none — workbook has no 0901/NANDINA/Café anywhere)")
        return "\n".join(lines)

    lines.append("")
    lines.append("── DETAIL DUMP (rows ±3 around each first 5 hits per sheet) ──")
    for name, hit_rows in coffee_sheets:
        sheet = wb.sheet_by_name(name)
        lines.append(
            f"\n── sheet: {name!r}  ({sheet.nrows} rows × {sheet.ncols} cols) ──"
        )
        windows: set[int] = set()
        for r in hit_rows[:5]:
            for d in range(-3, 4):
                if 0 <= r + d < sheet.nrows:
                    windows.add(r + d)
        for r in sorted(windows):
            cells = [str(sheet.cell_value(r, c))[:50] for c in range(sheet.ncols)]
            lines.append(f"  r{r:03d}: " + " | ".join(cells))
    return "\n".join(lines)


def parse_cuadro4_ytd(xls_bytes: bytes) -> dict[str, dict[str, float | str | None]]:
    """Read Cuadro 4 ('Principales productos exportados, según NANDINA')
    and return YTD-through-{title-month} aggregates for every chapter-0901
    NANDINA line. Output keyed by the 10-digit NANDINA code:

      {"0901119000": {"tons": 164473.7, "fob_usd_k": 1394668.2, "desc": "Los demás cafés..."}}

    Cuadro 4 has a stable 8-column layout (verified from the Mar/Apr 2026
    samples mirrored to the workflow log):

      col 0: NANDINA code              (numeric float, leading zero stripped)
      col 1: description               (string)
      col 2: USD k-FOB 2025p YTD       (prior year, same window)
      col 3: USD k-FOB 2026p YTD       (current year, what we want)
      col 4: % share of all exports    (FOB)
      col 5: tons 2025p YTD            (prior year)
      col 6: tons 2026p YTD            (current year, what we want)
      col 7: % share                   (tons)

    Coffee chapter codes are 0901.* — we keep ALL of them and let the
    caller decide which to roll up into the green-coffee headline. Codes
    outside 0901 (extracts/soluble in chapter 2101) are ignored here.
    """
    try:
        import xlrd  # type: ignore
    except ImportError:
        logger.error("[dane] xlrd not installed — `pip install xlrd==1.2.0`")
        return {}

    try:
        wb = xlrd.open_workbook(file_contents=xls_bytes)
    except Exception as e:                           # noqa: BLE001
        logger.warning(f"[dane] xlrd open failed: {e}")
        return {}

    # The "Cuadro 4 " sheet name has a trailing space in some annexes.
    # xlrd preserves it, so match leniently.
    sheet = None
    for s in wb.sheets():
        if s.name.strip().lower() == "cuadro 4":
            sheet = s
            break
    if sheet is None:
        return {}

    out: dict[str, dict[str, float | str | None]] = {}
    for r in range(sheet.nrows):
        raw_code = sheet.cell_value(r, 0)
        code = _normalize_code(raw_code)
        if not code or not code.startswith("0901"):
            continue
        desc = str(sheet.cell_value(r, 1)).strip() if sheet.ncols > 1 else ""
        # Column indices are stable in the recent annexes; if a future
        # annex shifts them we'll catch it via the test that asserts the
        # sample YTD values match.
        tons_ytd = _cell_number(sheet.cell_value(r, 6)) if sheet.ncols > 6 else None
        fob_ytd  = _cell_number(sheet.cell_value(r, 3)) if sheet.ncols > 3 else None
        out[code] = {"tons": tons_ytd, "fob_usd_k": fob_ytd, "desc": desc}
    return out


def _format_code(code10: str) -> str:
    """0901111000 → 0901.11.10.00"""
    return f"{code10[0:4]}.{code10[4:6]}.{code10[6:8]}.{code10[8:10]}"


def build_entry_from_ytd(
    year: int,
    month: int,
    source_url: str,
    ytd_current: dict[str, dict[str, float | str | None]],
    ytd_prior: dict[str, dict[str, float | str | None]] | None,
) -> MonthlyEntry | None:
    """Convert two consecutive Cuadro-4 YTD snapshots into a monthly
    entry: month-N tons = YTD-through-N − YTD-through-(N-1). For
    January, the prior snapshot is treated as zero.

    Returns None when no coffee NANDINA rows survive the diff
    (zero/negative tons → unreliable, better to drop the row than ship
    a phantom)."""
    if not ytd_current:
        return None

    nandina_entries: list[dict[str, str | float | None]] = []
    total_t = 0.0
    for code, cur in ytd_current.items():
        cur_tons = cur.get("tons")
        cur_fob  = cur.get("fob_usd_k")
        if not isinstance(cur_tons, (int, float)):
            continue
        if ytd_prior:
            prior = ytd_prior.get(code, {})
            prior_tons = prior.get("tons") if isinstance(prior.get("tons"), (int, float)) else 0.0
            prior_fob  = prior.get("fob_usd_k") if isinstance(prior.get("fob_usd_k"), (int, float)) else 0.0
        else:
            prior_tons = 0.0
            prior_fob  = 0.0
        monthly_tons = float(cur_tons) - float(prior_tons)
        monthly_fob_k = (
            float(cur_fob) - float(prior_fob)
            if isinstance(cur_fob, (int, float)) else None
        )
        if monthly_tons <= 0:
            # A negative or zero diff means the prior YTD was larger —
            # usually a NANDINA reclassification, occasionally a revision.
            # Either way, the value isn't usable as the month's flow.
            continue
        nandina_entries.append({
            "code":    _format_code(code),
            "tons":    round(monthly_tons, 1),
            # FOB USD: Cuadro 4 reports "Miles de dólares FOB" — convert
            # to absolute USD for the JSON consumer.
            "fob_usd": round(monthly_fob_k * 1000.0, 0) if monthly_fob_k is not None else None,
        })
        total_t += monthly_tons

    if not nandina_entries or total_t <= 0:
        return None

    return MonthlyEntry(
        month=         f"{year:04d}-{month:02d}",
        total_t=       round(total_t, 1),
        # 1 ton = 1000 kg; 1 bag = 60 kg → tons → bags = ×1000/60; → k-bags = /1000.
        total_k_bags=  round(total_t * 1000.0 / KG_PER_BAG / 1000.0, 1),
        by_nandina=    nandina_entries,
        source_xls=    source_url,
        parser_version="v2",
    )


# Legacy alias retained for the v1 tests covering the helper-level
# aggregation. New code uses build_entry_from_ytd.
def build_entry(year: int, month: int, source_url: str, rows: list[NandinaRow]) -> MonthlyEntry | None:
    """Aggregate NandinaRow tuples into one MonthlyEntry. Kept for the
    legacy unit tests; the run() path uses build_entry_from_ytd now."""
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
        parser_version="v2",
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
    safe_write_json(OUT_PATH, doc, ensure_ascii=False, trailing_newline=True)


def _parse_month_arg(s: str) -> tuple[int, int]:
    m = re.match(r"^(20\d{2})[-/](\d{1,2})$", s)
    if not m:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM, got {s!r}")
    yr, mo = int(m.group(1)), int(m.group(2))
    if not 1 <= mo <= 12:
        raise argparse.ArgumentTypeError(f"invalid month {mo}")
    return yr, mo


def _prior_month(year: int, month: int) -> tuple[int, int]:
    """(2026, 1) → (2025, 12); (2026, 4) → (2026, 3)."""
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _fetch_ytd(year: int, month: int, *, inspect: bool) -> tuple[dict, str | None, str]:
    """Download (or load from cache) an annex and parse Cuadro 4 YTD.
    Returns (ytd_dict, url, status) where status is "ok"/"not_found"/
    "blocked"/"parse_empty"."""
    url = _url_for(year, month)
    cache_path = CACHE_DIR / f"anex-EXPORTACIONES-{SPANISH_MONTH_ABBR[month]}{year}.xls"
    if cache_path.exists():
        xls_bytes: bytes | str = cache_path.read_bytes()
        logger.info(f"[dane] {year}-{month:02d}: cache hit")
    else:
        xls_bytes = _fetch_xls(url)
        if xls_bytes == _FETCH_NOT_FOUND:
            return {}, url, "not_found"
        if xls_bytes == _FETCH_BLOCKED:
            return {}, url, "blocked"
        cache_path.write_bytes(xls_bytes)  # type: ignore[arg-type]

    if inspect:
        report = inspect_xls(xls_bytes, url)  # type: ignore[arg-type]
        (DEBUG_DIR / f"{year}-{month:02d}.txt").write_text(report, encoding="utf-8")
        print(f"[dane] {year}-{month:02d}: wrote sheet inspection → debug/dane/{year}-{month:02d}.txt")

    ytd = parse_cuadro4_ytd(xls_bytes)  # type: ignore[arg-type]
    if not ytd:
        return {}, url, "parse_empty"
    return ytd, url, "ok"


def run(*, write: bool, months: list[tuple[int, int]], inspect: bool = False) -> int:
    """For each requested month, compute monthly tons as a YTD difference:
        month_N_tons = YTD(N) − YTD(N-1)
    January uses YTD(1) directly (no prior YTD needed). Cuadro 4 of the
    DANE annex reports YTD-through-{title-month}, so two consecutive
    annexes are needed for each non-January monthly value."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if inspect:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    entries: list[MonthlyEntry] = []
    not_found = 0
    blocked = 0
    parse_empty = 0
    for year, month in months:
        ytd_cur, url, status = _fetch_ytd(year, month, inspect=inspect)
        if status == "not_found":
            not_found += 1
            continue
        if status == "blocked":
            blocked += 1
            continue
        if status == "parse_empty":
            parse_empty += 1
            print(f"[dane] {year}-{month:02d}: Cuadro 4 returned 0 coffee NANDINAs")
            continue

        # Prior YTD only needed for non-January months.
        if month == 1:
            ytd_prior = None
        else:
            py, pm = _prior_month(year, month)
            ytd_prior, _, prior_status = _fetch_ytd(py, pm, inspect=inspect)
            if prior_status != "ok":
                # Without the prior YTD we can't compute a monthly diff.
                # Drop the row rather than mis-report YTD as monthly.
                parse_empty += 1
                print(f"[dane] {year}-{month:02d}: prior YTD missing ({prior_status}); skipping")
                continue

        entry = build_entry_from_ytd(year, month, url, ytd_cur, ytd_prior)
        if entry:
            entries.append(entry)
            print(
                f"[dane] {entry.month}: {entry.total_t:,.0f} t "
                f"= {entry.total_k_bags:,.1f} k-bags "
                f"({len(entry.by_nandina)} NANDINA lines)"
            )
        else:
            parse_empty += 1
            print(f"[dane] {year}-{month:02d}: 0 coffee rows after YTD diff")

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
    ap.add_argument(
        "--inspect", action="store_true",
        help="Dump per-sheet header inspection to debug/dane/ for parser iteration.",
    )
    args = ap.parse_args()

    months = args.month if args.month else _recent_months(args.history)
    return run(write=args.write, months=months, inspect=args.inspect)


if __name__ == "__main__":
    sys.exit(main())
