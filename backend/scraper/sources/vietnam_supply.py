"""
vietnam_supply.py — scrape Vietnam coffee export data and fertilizer import context.

Exports source chain (highest priority first):
  1. NSO Vietnam (www.nso.gov.vn) — monthly cadence, ~4-day publication lag.
     URL pattern: /en/data-and-statistics/{YYYY}/03/exports-and-imports-value-by-months-of-{YYYY}/
     The year-archive page hosts one .xlsx per month listing exports by main
     commodity. Coffee is broken out as its own line in tonnes.
  2. ICO historical CSV (www.ico.org/historical/...) — kept as legacy fallback,
     but currently returning 403 from cloud IPs as of 2026-05.
  3. Static snapshot vn_export_destination_port.json — frozen at 2024-08, final
     backstop so the chart never goes completely empty.

Each source is attempted independently; results are merged by month with the
higher-priority source winning. This was rebuilt 2026-05 after the ICO path
silently died ~Sep 2024 and we'd been on the static fallback for 21 months.

Fertilizer imports: same as before — Vietnam GSO / MARD monthly bulletin via
the vn_fertilizer cache, with static metadata as default.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import date, datetime

import requests

logger = logging.getLogger(__name__)

# A real browser UA — government statistics portals (NSO, USDA FAS, ICO) all
# block bare-Python UAs from cloud-provider IP ranges. Use Chrome's string.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.7",
}

_ICO_CSV_URL = (
    "https://www.ico.org/historical/1990%20onwards/CSV/"
    "2b%20-%20Exports%20of%20green%20coffee.csv"
)

_NSO_YEAR_PAGE_TEMPLATES = [
    # Observed pattern (agent's verification, 2026-05):
    "https://www.nso.gov.vn/en/data-and-statistics/{year}/03/exports-and-imports-value-by-months-of-{year}/",
    # Slug variants seen in NSO archives (the trailing month slug varies):
    "https://www.nso.gov.vn/en/data-and-statistics/{year}/01/exports-and-imports-value-by-months-of-{year}/",
    "https://www.nso.gov.vn/en/data-and-statistics/{year}/02/exports-and-imports-value-by-months-of-{year}/",
]

_VIET_NAMES = {"viet nam", "vietnam", "viet-nam"}

# Coffee detection in NSO xlsx — match any cell mentioning coffee in EN or VN
_COFFEE_RX = re.compile(r"\bcoffee\b|\bcà\s*phê\b", re.IGNORECASE)

# ── ICO CSV parser (unchanged) ────────────────────────────────────────────────

def _parse_ico_exports(content: str) -> list[dict]:
    """Parse ICO green coffee export CSV. Returns list of {month, total_k_bags}."""
    reader = csv.DictReader(io.StringIO(content))
    rows   = list(reader)

    country_col = reader.fieldnames[0] if reader.fieldnames else "Country"
    viet_row = next(
        (r for r in rows if r.get(country_col, "").strip().lower() in _VIET_NAMES),
        None,
    )
    if viet_row is None:
        logger.warning("[vietnam_supply] ICO CSV: Vietnam row not found")
        return []

    monthly: list[dict] = []
    for col, val in viet_row.items():
        if col == country_col:
            continue
        col = col.strip()
        m = re.match(r"(\d{4})\s+([A-Za-z]{3})", col)
        if not m:
            continue
        year_str, mon_str = m.group(1), m.group(2)
        try:
            dt = datetime.strptime(f"{year_str} {mon_str}", "%Y %b")
        except ValueError:
            continue
        month_key = f"{dt.year}-{dt.month:02d}"
        try:
            bags_k = float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            continue
        if bags_k <= 0:
            continue
        monthly.append({"month": month_key, "total_k_bags": round(bags_k, 1)})

    return sorted(monthly, key=lambda x: x["month"])


def _fetch_ico_exports() -> list[dict]:
    """Try ICO CSV. Empty list on any failure (HTTP error, parse error)."""
    try:
        resp = requests.get(_ICO_CSV_URL, headers=_HEADERS, timeout=30)
        print(f"  [vn_exports][ICO] HTTP {resp.status_code}, {len(resp.content)} bytes")
        if resp.status_code != 200:
            return []
        return _parse_ico_exports(resp.text)
    except Exception as e:
        print(f"  [vn_exports][ICO] FAILED ({type(e).__name__}): {e}")
        return []


# ── NSO Vietnam scraper ───────────────────────────────────────────────────────

def _parse_nso_xlsx(content: bytes, source_url: str) -> list[dict]:
    """Parse an NSO monthly trade xlsx. Look for a coffee row + month columns.

    NSO's monthly trade workbooks have ~12 columns of monthly values across the
    year. We scan each sheet for a row whose label matches /coffee|cà phê/, then
    read the numeric cells from that row, mapping them to month columns from
    the header row above.

    The actual structure varies by year so we're tolerant: any numeric value
    in a cell whose column header parses as a month name is accepted.
    """
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    out: list[dict] = []

    # Month-name → number lookup, with VN abbreviations included for safety.
    month_map = {m.lower(): i for i, m in enumerate(
        ["", "January", "February", "March", "April", "May", "June",
         "July", "August", "September", "October", "November", "December"]
    ) if m}
    month_map.update({m.lower(): i for i, m in enumerate(
        ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    ) if m})
    month_map.update({f"thg {i}": i for i in range(1, 13)})  # VN: tháng 1..12

    for sheet in wb.worksheets:
        # Detect year hint from filename or sheet title (e.g. "2025" → year=2025)
        year_match = re.search(r"\b(20\d{2})\b", f"{source_url} {sheet.title}")
        year = int(year_match.group(1)) if year_match else date.today().year

        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue

        # Find header row: the one with the most cells that parse as months.
        best_header_idx, best_month_cols = -1, {}
        for idx, row in enumerate(rows[:15]):  # headers typically in first 15 rows
            month_cols: dict[int, int] = {}  # col_idx → month_num
            for col_idx, cell in enumerate(row):
                if cell is None:
                    continue
                key = str(cell).strip().lower()
                if key in month_map:
                    month_cols[col_idx] = month_map[key]
            if len(month_cols) > len(best_month_cols):
                best_header_idx, best_month_cols = idx, month_cols

        if len(best_month_cols) < 3:  # need at least a few months to be useful
            continue

        # Find coffee row(s) below the header
        for row in rows[best_header_idx + 1:]:
            if not row:
                continue
            # Scan first 4 cells for the label match (NSO sometimes indents labels)
            label_cells = [str(c).strip() for c in row[:4] if c is not None]
            if not any(_COFFEE_RX.search(lc) for lc in label_cells):
                continue
            # Found a coffee row — extract monthly values
            for col_idx, month_num in best_month_cols.items():
                if col_idx >= len(row):
                    continue
                val = row[col_idx]
                if val is None:
                    continue
                try:
                    tonnes = float(str(val).replace(",", "").strip())
                except (ValueError, TypeError):
                    continue
                if tonnes <= 0:
                    continue
                # NSO publishes coffee exports in tonnes; convert to thousand 60kg bags.
                k_bags = round(tonnes / 60, 1)
                out.append({
                    "month":        f"{year}-{month_num:02d}",
                    "total_k_bags": k_bags,
                })
            break  # one coffee row per sheet is enough

    return out


def _fetch_nso_year_page(year: int) -> str | None:
    """Try each candidate slug for the year-archive page. Return HTML on success."""
    for tpl in _NSO_YEAR_PAGE_TEMPLATES:
        url = tpl.format(year=year)
        try:
            resp = requests.get(url, headers=_HEADERS, timeout=30)
            print(f"  [vn_exports][NSO] {year} index → HTTP {resp.status_code} ({len(resp.content)}b) {url}")
            if resp.status_code == 200 and "xlsx" in resp.text.lower():
                return resp.text
        except Exception as e:
            print(f"  [vn_exports][NSO] {year} index → {type(e).__name__}: {e}")
    return None


def _fetch_nso_exports() -> list[dict]:
    """Fetch monthly Vietnam coffee exports from NSO Vietnam.

    Walks the current year + previous 2 years of year-archive pages, downloads
    each .xlsx linked from them, and extracts the coffee row.
    """
    current_year = date.today().year
    collected: list[dict] = []

    for year in [current_year, current_year - 1, current_year - 2]:
        html = _fetch_nso_year_page(year)
        if html is None:
            continue

        # Collect all .xlsx URLs from the page
        xlsx_urls = re.findall(
            r'href=["\']((?:https?://)?[^"\'\s>]+\.xlsx?)["\']',
            html, re.IGNORECASE,
        )
        # Normalize relative URLs + dedupe
        norm: list[str] = []
        seen: set[str] = set()
        for u in xlsx_urls:
            if u.startswith("//"):
                u = "https:" + u
            elif u.startswith("/"):
                u = "https://www.nso.gov.vn" + u
            if u not in seen:
                seen.add(u)
                norm.append(u)
        print(f"  [vn_exports][NSO] {year} → {len(norm)} unique xlsx link(s)")

        for xlsx_url in norm:
            try:
                resp = requests.get(xlsx_url, headers=_HEADERS, timeout=60)
                if resp.status_code != 200:
                    print(f"    [NSO] {xlsx_url[-60:]} → HTTP {resp.status_code}")
                    continue
                parsed = _parse_nso_xlsx(resp.content, xlsx_url)
                if parsed:
                    print(f"    [NSO] {xlsx_url[-60:]} → {len(parsed)} month rows")
                    collected.extend(parsed)
            except Exception as e:
                print(f"    [NSO] {xlsx_url[-60:]} → {type(e).__name__}: {e}")

    # Dedupe by month — first observation wins (we walk newest year first)
    by_month: dict[str, dict] = {}
    for r in collected:
        by_month.setdefault(r["month"], r)
    return sorted(by_month.values(), key=lambda r: r["month"])


# ── Static fallback (unchanged) ───────────────────────────────────────────────

def _fetch_static_exports() -> list[dict]:
    """Read monthly_total (MT) from vn_export_destination_port.json → k_bags."""
    import json as _json
    from pathlib import Path as _Path
    port_file = (
        _Path(__file__).resolve().parents[3]
        / "frontend" / "public" / "data" / "vn_export_destination_port.json"
    )
    if not port_file.exists():
        return []
    try:
        data = _json.loads(port_file.read_text(encoding="utf-8"))
        mt_by_month: dict = data.get("monthly_total", {})
        if not mt_by_month:
            return []
        return [
            {"month": m, "total_k_bags": round(mt / 60, 1)}
            for m, mt in sorted(mt_by_month.items())
            if mt and mt > 0
        ]
    except Exception as e:
        print(f"  [vn_exports][static] read failed: {e}")
        return []


# ── Merge + YoY ──────────────────────────────────────────────────────────────

def _compute_yoy(monthly: list[dict]) -> list[dict]:
    """Attach yoy_pct to each row based on the same-month-prior-year value."""
    by_month = {r["month"]: r["total_k_bags"] for r in monthly}
    out: list[dict] = []
    for r in monthly:
        y, mo = r["month"].split("-")
        prev = by_month.get(f"{int(y)-1}-{mo}")
        yoy = round((r["total_k_bags"] - prev) / prev * 100, 1) if prev else None
        out.append({**r, "yoy_pct": yoy})
    return out


def fetch_exports() -> dict | None:
    """Run the source chain and return a merged result.

    Sources in priority order: NSO → ICO → static. The first source that
    contributes a given month wins; remaining sources only fill gaps. We keep
    the last 36 months of merged data, computing YoY across the merged series.
    """
    sources = [
        ("NSO Vietnam",                                   _fetch_nso_exports),
        ("ICO",                                           _fetch_ico_exports),
        ("Vietnam Customs (vn_export_destination_port)",  _fetch_static_exports),
    ]

    by_month: dict[str, dict] = {}  # month → {total_k_bags, source}
    for source_name, fn in sources:
        try:
            rows = fn()
        except Exception as e:
            print(f"  [vn_exports] {source_name} threw {type(e).__name__}: {e}")
            continue
        new_count = 0
        for r in rows:
            if r["month"] not in by_month:
                by_month[r["month"]] = {**r, "_source": source_name}
                new_count += 1
        print(f"  [vn_exports] {source_name} → +{new_count} new months "
              f"({len(rows)} returned, {len(by_month)} total in merge)")

    if not by_month:
        return None

    # Sort, keep last 36 months, compute YoY across the full merged set
    all_months = sorted(by_month.keys())
    full = [{"month": m, "total_k_bags": by_month[m]["total_k_bags"]} for m in all_months]
    full = _compute_yoy(full)
    monthly = full[-36:]

    # Identify which sources actually contributed to the window we shipped
    window_months = {r["month"] for r in monthly}
    sources_used = sorted({
        by_month[m]["_source"] for m in window_months
    })

    return {
        "source":       " + ".join(sources_used),
        "last_updated": monthly[-1]["month"],
        "unit":         "thousand_60kg_bags",
        "monthly":      monthly,
    }


# ── Fertilizer import context (unchanged) ─────────────────────────────────────

def build_fertilizer_context() -> dict:
    """Return fertilizer import context for Vietnam.

    Merges static metadata with scraped monthly data from vn_fertilizer cache
    (written by vn_fertilizer.run() in the monthly scraper workflow).
    """
    import json as _json
    from pathlib import Path as _Path

    _CACHE = _Path(__file__).resolve().parents[2] / "scraper" / "cache" / "vn_fertilizer.json"

    ctx: dict = {
        "source":  "Vietnam Customs (customs.gov.vn) 1n import reports",
        "note":    "Vietnam imports ~4–5Mt/yr fertilizer. Urea mainly from China/Russia; NPK from China; Potash from Canada/Russia via Singapore.",
        "key_suppliers": {
            "urea":  "China (60%), Russia (25%), Middle East (15%)",
            "npk":   "China (80%+)",
            "potash": "Canada/Russia via Singapore",
        },
        "price_sensitivity": "Vietnam urea prices lag global CFR by ~2–4 weeks via China trading channel.",
    }

    try:
        if _CACHE.exists():
            cache = _json.loads(_CACHE.read_text(encoding="utf-8"))
            monthly = cache.get("monthly")
            if monthly:
                ctx["monthly"] = monthly
                ctx["source"] = "Vietnam Customs 1n reports (auto-scraped)"
    except Exception as e:
        logger.warning(f"[vietnam_supply] vn_fertilizer cache read failed: {e}")

    return ctx


# ── Entry point ───────────────────────────────────────────────────────────────

def build_vietnam_supply() -> dict:
    """Build full vietnam_supply dict for JSON output."""
    exports = fetch_exports()
    return {
        "scraped_at":         datetime.utcnow().isoformat() + "Z",
        "country":            "vietnam",
        "exports":            exports,
        "fertilizer_context": build_fertilizer_context(),
    }
