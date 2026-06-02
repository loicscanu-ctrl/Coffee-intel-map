"""
backfill_japan_stocks.py — Japan green-coffee STOCKS from AJCA's monthly
"コーヒー豆在庫実績調査" (j-zaiko) reports.

Each j-zaiko{YYYYMM}.pdf is a one-page table for calendar year YYYY: rows are
split into 輸入国別 (by ORIGIN: Brazil/Colombia/Indonesia/Vietnam/Central
America/Others) and 地域 (by REGION/port: Keihin/Chukyo/Hanshin), columns are
months 1月…12月, values in metric tonnes. The Dec PDF of a year holds the full
year; the current year's latest PDF holds Jan→current month.

Self-contained flow (like the ECF one): writes a front-end-ready file
    frontend/public/data/japan_stocks.json
with one entry per month carrying by_origin + by_region maps. AJCA blocks the
sandbox (403) but is reachable from the runner — run via
.github/workflows/scraper-japan-stocks.yml.

Usage:
    cd backend
    python -m scraper.backfill_japan_stocks [--debug]
"""
from __future__ import annotations

import io
import json
import re
import sys
from datetime import date
from pathlib import Path

import requests

from scraper.sources.ajca import (
    _COUNTRY_MAP,
    _HEADERS,
    _HUB_URL,
    _collect_pdf_index,
    _latest_pdf_by_kind,
)

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT     = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "ajca.json"
DEBUG_PATH = ROOT / "frontend" / "public" / "data" / "ajca_debug.json"

_UPLOAD_BASE = "https://coffee.ajca.or.jp/wordpress/wp-content/uploads"

ORIGIN_JP = {
    "ブラジル": "Brazil", "コロンビア": "Colombia", "インドネシア": "Indonesia",
    "ベトナム": "Vietnam", "中米": "Central America", "アフリカ": "Africa",
    "その他": "Others",
}
REGION_JP = {"京浜": "Keihin", "中京": "Chukyo", "阪神": "Hanshin"}
_TOTAL_JP = ("合計", "計", "総計")

_ZEN = str.maketrans("０１２３４５６７８９", "0123456789")
_MONTH_COL = re.compile(r"(\d{1,2})\s*月")
_ZAIKO_HREF = re.compile(r'href="(https?://[^"]*/j-zaiko(\d{4})(\d{2})\.pdf)"', re.I)


def _to_t(cell) -> int | None:
    s = re.sub(r"[^\d]", "", str(cell or "").translate(_ZEN))
    return int(s) if s else None


def _jp_to_month(cell) -> int | None:
    m = _MONTH_COL.search(str(cell or "").translate(_ZEN))
    if not m:
        return None
    mo = int(m.group(1))
    return mo if 1 <= mo <= 12 else None


def _classify(label: str) -> tuple[str, str] | None:
    t = re.sub(r"\s+", "", str(label or ""))
    if t in ORIGIN_JP:
        return "origin", ORIGIN_JP[t]
    if t in REGION_JP:
        return "region", REGION_JP[t]
    return None


def parse_zaiko(pdf_bytes: bytes, year: int) -> dict[int, dict]:
    """Parse one j-zaiko PDF → {month: {'origin': {name: t}, 'region': {name: t}}}."""
    import pdfplumber
    out: dict[int, dict] = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for table in (page.extract_tables() or []):
                if not table or len(table) < 2:
                    continue
                # Month columns from the header row.
                header = table[0]
                month_cols = {ci: mo for ci, c in enumerate(header)
                              if (mo := _jp_to_month(c))}
                if not month_cols:
                    continue
                for row in table[1:]:
                    if not row:
                        continue
                    # The item label is the first non-empty, non-group cell.
                    label = next((str(c).strip() for c in row[:2]
                                  if c and _classify(c)), None)
                    cl = _classify(label) if label else None
                    if not cl:
                        continue
                    kind, name = cl
                    for ci, mo in month_cols.items():
                        if ci < len(row):
                            v = _to_t(row[ci])
                            if v is not None:
                                slot = out.setdefault(mo, {"origin": {}, "region": {}})
                                slot[kind][name] = v
    return out


# data-jukyu (需給表) annual rows: "…(YYYY) 期首在庫 生豆輸入 製品輸入 供給計
# 国内消費 輸出量 期末在庫" — 7 figures after a 4-digit year in parentheses.
# Allow a non-numeric label (e.g. 対前年比％ on the latest year) between the
# 4-digit year and the seven figures.
_JUKYU_ROW = re.compile(
    r"\((\d{4})\)[^\d]{0,15}" + r"\s+".join([r"([\d,]+)"] * 7)
)
_YOY_PARENS = re.compile(r"[（(][^）)]*[▲△%][^）)]*[）)]")


def parse_jukyu(pdf_bytes: bytes) -> dict[int, dict]:
    """Annual Japan supply-demand from data-jukyu → {year: {...}} including
    ending stocks. Parses the page text (the table cells merge rows)."""
    import pdfplumber
    out: dict[int, dict] = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    text = _YOY_PARENS.sub("", text.translate(_ZEN))   # drop YoY annotations
    for m in _JUKYU_ROW.finditer(text):
        year = int(m.group(1))
        if not (1990 <= year <= 2100):
            continue
        g = [int(x.replace(",", "")) for x in m.groups()[1:]]
        begin, green_imp, prod_imp, supply, consumption, exports, ending = g
        # Sanity: supply ≈ begin+imports; ending plausible (Japan ~50-200k t).
        if not (10_000 <= ending <= 400_000):
            continue
        out[year] = {
            "year": year,
            "ending_stocks_mt": ending,
            "begin_stocks_mt": begin,
            "green_imports_mt": green_imp,
            "product_imports_mt": prod_imp,
            "consumption_mt": consumption,
            "exports_mt": exports,
        }
    return out


_DATA24_YEAR = re.compile(r"(\d{4})\s*年")


def parse_data24(pdf_bytes: bytes) -> dict[int, dict]:
    """Top-24 origins green-coffee IMPORTS from data-24 → {year: {country: mt}}.
    The table has a rank column then (country, value-in-kg) pairs per year."""
    import pdfplumber
    out: dict[int, dict] = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for table in (page.extract_tables() or []):
                if not table or len(table) < 2:
                    continue
                header = [str(c or "").translate(_ZEN) for c in table[0]]
                ycols = {ci: int(m.group(1))
                         for ci, h in enumerate(header)
                         if (m := _DATA24_YEAR.search(h))}
                if not ycols:
                    continue
                for row in table[1:]:
                    for ci, yr in ycols.items():
                        if ci + 1 >= len(row):
                            continue
                        country = _COUNTRY_MAP.get(re.sub(r"\s+", "", str(row[ci] or "")))
                        kg = _to_t(row[ci + 1])
                        if country and kg and country not in ("Total", "Subtotal"):
                            out.setdefault(yr, {})[country] = int(round(kg / 1000))
    return out


def _hub_html(session: requests.Session) -> str | None:
    try:
        r = session.get(_HUB_URL, timeout=30)
        return r.text if r.status_code == 200 else None
    except Exception as e:
        print(f"  hub fetch error: {e}", file=sys.stderr)
        return None


def discover_urls(session: requests.Session, n_years: int = 9) -> dict[int, list[str]]:
    """Return {data_year: [candidate_urls]}. Current/recent years come from the
    hub; older full-year (Dec) PDFs are constructed from AJCA's filename pattern
    (uploaded ~Jan-Mar of the next year) and probed at fetch time."""
    cands: dict[int, list[str]] = {}
    html = _hub_html(session) or ""
    for m in _ZAIKO_HREF.finditer(html):
        url, yyyy = m.group(1), int(m.group(2))
        cands.setdefault(yyyy, [])
        if url not in cands[yyyy]:
            cands[yyyy].insert(0, url)   # hub link first (most authoritative)
    today = date.today()
    for y in range(today.year, today.year - n_years, -1):
        cands.setdefault(y, [])
        # Full-year PDF = j-zaiko{y}12, uploaded early next year.
        for uy, um in [(y + 1, 1), (y + 1, 2), (y + 1, 3), (y, 12)]:
            cands[y].append(f"{_UPLOAD_BASE}/{uy}/{um:02d}/j-zaiko{y}12.pdf")
        # Current year may only have a partial (latest-month) PDF; probe a few.
        if y == today.year:
            for um in range(today.month, 0, -1):
                uy, umm = (y + (um // 12), (um % 12) + 1)
                cands[y].append(f"{_UPLOAD_BASE}/{uy}/{umm:02d}/j-zaiko{y}{um:02d}.pdf")
    return cands


def _fetch_first(session: requests.Session, urls: list[str]) -> tuple[str, bytes] | None:
    for u in urls:
        try:
            r = session.get(u, timeout=40)
        except requests.RequestException:
            continue
        if r.status_code == 200 and r.content[:4] == b"%PDF" and len(r.content) > 2000:
            return u, r.content
    return None


def main(debug: bool = False) -> None:
    session = requests.Session()
    session.headers.update(_HEADERS)

    cands = discover_urls(session)
    by_period: dict[str, dict] = {}
    debug_dump: dict = {}
    for year in sorted(cands, reverse=True):
        hit = _fetch_first(session, cands[year])
        if not hit:
            print(f"  {year}: no j-zaiko PDF resolved")
            continue
        url, content = hit
        parsed = parse_zaiko(content, year)
        n = 0
        for mo, slot in parsed.items():
            origin = slot["origin"]
            region = slot["region"]
            if not origin and not region:
                continue
            period = f"{year}-{mo:02d}"
            by_period[period] = {
                "period": period,
                "by_origin": origin,
                "by_region": region,
                "total_origin": sum(origin.values()) or None,
                "total_region": sum(region.values()) or None,
                "source_pdf": url,
            }
            n += 1
        print(f"  {year}: {n} months  ({url.rsplit('/', 1)[-1]})")
        if debug:
            debug_dump[str(year)] = {"url": url, "months": sorted(parsed)}

    monthly = [by_period[p] for p in sorted(by_period)]

    idx = _collect_pdf_index(_hub_html(session) or "")

    # ── Supply-demand + annual ending stocks (data-jukyu) ──────────────────────
    supply_demand: list[dict] = []
    jukyu_url = _latest_pdf_by_kind(idx, "data-jukyu")
    if jukyu_url and (hit := _fetch_first(session, [jukyu_url])):
        ann = parse_jukyu(hit[1])
        supply_demand = [ann[y] for y in sorted(ann)]
        print(f"  data-jukyu: {len(supply_demand)} annual years  "
              f"{jukyu_url.rsplit('/', 1)[-1]}")

    # ── Imports by origin, annual top-24 (data-24) ─────────────────────────────
    imports_origin: list[dict] = []
    d24_url = _latest_pdf_by_kind(idx, "data-24")
    if d24_url and (hit := _fetch_first(session, [d24_url])):
        d24 = parse_data24(hit[1])
        imports_origin = [{"year": y, "by_country": d24[y]} for y in sorted(d24)]
        print(f"  data-24: {len(imports_origin)} years  {d24_url.rsplit('/', 1)[-1]}")

    if not monthly and not supply_demand:
        print("ERROR: parsed nothing — not writing ajca.json", file=sys.stderr)
        sys.exit(1)

    latest = monthly[-1] if monthly else {}
    total = latest.get("total_origin") or latest.get("total_region") \
        or (supply_demand[-1]["ending_stocks_mt"] if supply_demand else None)
    annual_stocks = [{"year": r["year"], "ending_stocks_mt": r["ending_stocks_mt"]}
                     for r in supply_demand]
    payload = {
        "source": "AJCA",
        "source_url": _HUB_URL,
        "unit": "metric_tonnes",
        "last_updated": date.today().isoformat(),
        "stocks": {
            "latest_period": latest.get("period"),
            "latest_total_mt": total,
            "monthly": monthly,        # j-zaiko: by_origin + by_region
            "annual": annual_stocks,   # data-jukyu ending stocks
        },
        "supply_demand": supply_demand,   # data-jukyu full annual balance
        "imports_origin": imports_origin,  # data-24 annual by country
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote ajca.json → stocks: {len(monthly)} months + "
          f"{len(annual_stocks)} annual; supply_demand: {len(supply_demand)}; "
          f"imports_origin: {len(imports_origin)} yrs")
    if debug:
        debug_dump["supply_demand_years"] = [r["year"] for r in supply_demand]
        debug_dump["imports_origin_years"] = [r["year"] for r in imports_origin]
        DEBUG_PATH.write_text(json.dumps(debug_dump, ensure_ascii=False, indent=2),
                              encoding="utf-8")
        print(f"  debug → {DEBUG_PATH}")


if __name__ == "__main__":
    main(debug="--debug" in sys.argv)
