"""
usitc_imports.py — US coffee imports by country of origin (USITC DataWeb v2).

Authoritative US trade data: HS/HTS 0901 (coffee), Imports for Consumption,
quantity (first unit of quantity = kg), annual, broken out by partner country.
This is the unique angle vs the Comtrade importer-totals already in the tab —
it shows which ORIGINS supply the US.

API: POST {base}/api/v2/report2/runReport with a DataWeb "query object" (see
the basicQuery template below, copied from the official API guide). Auth is a
bearer token in USITC_API_KEY. NB: DataWeb's TLS chain trips verification, so
the official examples use verify=False — we mirror that.

Output: frontend/public/data/us_coffee_imports.json (committed; refreshed by
.github/workflows/scraper-usitc-imports.yml).
"""

from __future__ import annotations

import copy
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path

import requests

log = logging.getLogger(__name__)

BASE_URL = "https://datawebws.usitc.gov/dataweb"
RUN_REPORT = BASE_URL + "/api/v2/report2/runReport"
API_KEY = os.environ.get("USITC_API_KEY", "")

HTS = "0901"             # coffee
MEASURE = "CONS_FIR_UNIT_QUANT"   # Imports-for-Consumption, first unit of qty (kg)
N_YEARS = 6

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "us_coffee_imports.json"

# Query template — verbatim from the USITC DataWeb API guide ("basicQuery").
BASIC_QUERY: dict = {
    "savedQueryName": "", "savedQueryDesc": "", "isOwner": True, "runMonthly": False,
    "reportOptions": {"tradeType": "Import", "classificationSystem": "HTS"},
    "searchOptions": {
        "MiscGroup": {
            "districts": {"aggregation": "Aggregate District", "districtGroups": {"userGroups": []},
                          "districts": [], "districtsExpanded": [{"name": "All Districts", "value": "all"}],
                          "districtsSelectType": "all"},
            "importPrograms": {"aggregation": None, "importPrograms": [], "programsSelectType": "all"},
            "extImportPrograms": {"aggregation": "Aggregate CSC", "extImportPrograms": [],
                                  "extImportProgramsExpanded": [], "programsSelectType": "all"},
            "provisionCodes": {"aggregation": "Aggregate RPCODE", "provisionCodesSelectType": "all",
                               "rateProvisionCodes": [], "rateProvisionCodesExpanded": []},
        },
        "commodities": {
            "aggregation": "Aggregate Commodities", "codeDisplayFormat": "YES",
            "commodities": [], "commoditiesExpanded": [], "commoditiesManual": "",
            "commodityGroups": {"systemGroups": [], "userGroups": []},
            "commoditySelectType": "all", "granularity": "2",
            "groupGranularity": None, "searchGranularity": None,
        },
        "componentSettings": {
            "dataToReport": ["CONS_FIR_UNIT_QUANT"], "scale": "1",
            "timeframeSelectType": "fullYears", "years": ["2022", "2023"],
            "startDate": None, "endDate": None, "startMonth": None, "endMonth": None,
            "yearsTimeline": "Annual",
        },
        "countries": {
            "aggregation": "Aggregate Countries", "countries": [],
            "countriesExpanded": [{"name": "All Countries", "value": "all"}],
            "countriesSelectType": "all", "countryGroups": {"systemGroups": [], "userGroups": []},
        },
    },
    "sortingAndDataFormat": {
        "DataSort": {"columnOrder": [], "fullColumnOrder": [], "sortOrder": []},
        "reportCustomizations": {"exportCombineTables": False, "showAllSubtotal": True,
                                 "subtotalRecords": "", "totalRecords": "20000", "exportRawData": False},
    },
}


# Candidate values for the commodity-selection "tab" (DataWeb rejects unknown
# ones with a step-4 validation error). Tried in order until one returns data.
COMMODITY_SELECT_TYPES = ["list", "search", "manual", "specific", "number"]


def build_query(years: list[str], commodity_select_type: str = "list",
                timeline: str = "Annual", break_countries: bool = True) -> dict:
    """Coffee (HTS 0901) imports for consumption, quantity. `timeline` is
    Annual or Monthly; `break_countries` splits partners into rows (else the
    US total)."""
    q = copy.deepcopy(BASIC_QUERY)
    q["reportOptions"]["tradeType"] = "Import"            # Imports for Consumption
    q["reportOptions"]["classificationSystem"] = "HTS"
    cs = q["searchOptions"]["componentSettings"]
    cs["dataToReport"] = [MEASURE]
    cs["years"] = years
    cs["yearsTimeline"] = timeline
    cs["timeframeSelectType"] = "fullYears"
    # Filter to HTS-4 0901 (coffee), aggregated to one commodity line.
    com = q["searchOptions"]["commodities"]
    com["commoditySelectType"] = commodity_select_type
    com["commodities"] = [HTS]
    com["commoditiesManual"] = HTS
    com["commoditiesExpanded"] = [{"name": HTS, "value": HTS}]
    com["granularity"] = "4"
    com["aggregation"] = "Aggregate Commodities"
    q["searchOptions"]["countries"]["aggregation"] = (
        "Break Out Countries" if break_countries else "Aggregate Countries")
    return q


# ── Response helpers (mirror the doc's getColumns / getData) ─────────────────

def _get_columns(column_groups, cols=None):
    cols = [] if cols is None else cols
    for group in column_groups:
        if isinstance(group, dict) and "columns" in group:
            _get_columns(group["columns"], cols)
        elif isinstance(group, dict) and "label" in group:
            cols.append(group["label"])
        elif isinstance(group, list):
            _get_columns(group, cols)
    return cols


def _get_rows(rows_new):
    return [[f.get("value") for f in row.get("rowEntries", [])] for row in rows_new]


def _num(v):
    if v is None:
        return None
    s = str(v).replace(",", "").strip()
    if s in ("", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


_TOTAL_LABELS = {"total", "grand total", "all countries", "world"}

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}
_MONTHS_ABBR = {m[:3]: i for m, i in _MONTHS.items()}


def _month_key(label: str) -> str | None:
    """Normalise a USITC time-column label to 'YYYY-MM' (or None if not monthly).
    Handles '2024-01', '202401', 'Jan 2024', 'January 2024', '2024 January'."""
    s = str(label).strip()
    m = re.match(r"^(\d{4})[-/ ]?(\d{2})$", s)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    toks = re.split(r"[\s,/-]+", s.lower())
    yr = next((t for t in toks if re.fullmatch(r"\d{4}", t)), None)
    mo = next((_MONTHS.get(t) or _MONTHS_ABBR.get(t[:3]) for t in toks
               if t[:3] in _MONTHS_ABBR), None)
    return f"{yr}-{mo:02d}" if yr and mo else None


def parse_monthly(resp: dict) -> dict:
    """USITC monthly report → {'YYYY-MM': mt}. kg→MT.

    DataWeb returns a cross-tab: each row is a year (in a 'Year' column) and the
    month columns are bare names ('January', …). Falls back to 'Mon YYYY'-style
    labels if a future layout uses those. Logs the raw columns for diagnosis."""
    try:
        table = resp["dto"]["tables"][0]
        cols = _get_columns(table["column_groups"])
        rows = _get_rows(table["row_groups"][0]["rowsNew"])
    except (KeyError, IndexError, TypeError):
        return {}
    low = [str(c).strip().lower() for c in cols]
    year_idx = low.index("year") if "year" in low else None
    name_months = [(i, _MONTHS.get(lc) or _MONTHS_ABBR.get(lc[:3]))
                   for i, lc in enumerate(low) if lc in _MONTHS or lc[:3] in _MONTHS_ABBR]
    log.info("USITC monthly columns=%s → year_idx=%s, %d month cols",
             cols[:6], year_idx, len(name_months))

    by_month: dict[str, float] = {}
    if year_idx is not None and name_months:
        for row in rows:
            ym = re.match(r"(\d{4})", str(row[year_idx]).strip()) if year_idx < len(row) else None
            if not ym:
                continue
            for idx, mo in name_months:
                kg = _num(row[idx]) if (mo and idx < len(row)) else None
                if kg:   # 0 / blank ⇒ month not yet reported — skip
                    key = f"{ym.group(1)}-{mo:02d}"
                    by_month[key] = round(by_month.get(key, 0.0) + kg / 1000.0, 1)
    else:   # fallback: 'Jan 2024' / '2024-01' style columns
        month_cols = [(i, _month_key(c)) for i, c in enumerate(cols) if _month_key(c)]
        for row in rows:
            for idx, mk in month_cols:
                kg = _num(row[idx]) if idx < len(row) else None
                if kg:
                    by_month[mk] = round(by_month.get(mk, 0.0) + kg / 1000.0, 1)
    return dict(sorted(by_month.items()))


def parse_monthly_by_origin(resp: dict) -> dict:
    """USITC monthly report broken out by country → {origin: {'YYYY-MM': mt}}.

    Same cross-tab as parse_monthly (a 'Year' column + bare month-name columns)
    but with an extra leading country column, one block of rows per origin."""
    try:
        table = resp["dto"]["tables"][0]
        cols = _get_columns(table["column_groups"])
        rows = _get_rows(table["row_groups"][0]["rowsNew"])
    except (KeyError, IndexError, TypeError):
        return {}
    low = [str(c).strip().lower() for c in cols]
    year_idx = low.index("year") if "year" in low else None
    name_months = [(i, _MONTHS.get(lc) or _MONTHS_ABBR.get(lc[:3]))
                   for i, lc in enumerate(low) if lc in _MONTHS or lc[:3] in _MONTHS_ABBR]
    month_idxs = {i for i, _ in name_months}
    # Origin column: first column that is neither Year, a month, nor a 4-digit year.
    origin_idx = next((i for i, lc in enumerate(low)
                       if i != year_idx and i not in month_idxs and not re.fullmatch(r"\d{4}", lc)), 0)
    if year_idx is None or not name_months:
        return {}

    out: dict[str, dict[str, float]] = {}
    for row in rows:
        if origin_idx >= len(row):
            continue
        name = str(row[origin_idx]).strip()
        if not name or name.lower() in _TOTAL_LABELS:
            continue
        ym = re.match(r"(\d{4})", str(row[year_idx]).strip()) if year_idx < len(row) else None
        if not ym:
            continue
        for idx, mo in name_months:
            kg = _num(row[idx]) if (mo and idx < len(row)) else None
            if kg:   # 0 / blank ⇒ not yet reported
                key = f"{ym.group(1)}-{mo:02d}"
                d = out.setdefault(name, {})
                d[key] = round(d.get(key, 0.0) + kg / 1000.0, 1)
    return {n: dict(sorted(m.items())) for n, m in out.items()}


def parse_report(resp: dict) -> dict:
    """USITC report JSON → {years, origins[], total_by_year}. Quantities kg→MT.

    Pure (no I/O) — unit-tested. Handles the dto.tables[0] shape from the API."""
    try:
        table = resp["dto"]["tables"][0]
        cols = _get_columns(table["column_groups"])
        rows = _get_rows(table["row_groups"][0]["rowsNew"])
    except (KeyError, IndexError, TypeError):
        return {"years": [], "origins": [], "total_by_year": {}}

    # Year columns are the 4-digit labels; the first non-year column is the country.
    year_cols = [(i, int(c)) for i, c in enumerate(cols) if str(c).isdigit() and len(str(c)) == 4]
    years = [y for _, y in year_cols]

    origins: list[dict] = []
    total_by_year: dict[str, float] = {}
    for row in rows:
        if not row:
            continue
        name = str(row[0]).strip()
        by_year: dict[str, float] = {}
        for idx, yr in year_cols:
            kg = _num(row[idx]) if idx < len(row) else None
            if kg is not None:
                by_year[str(yr)] = round(kg / 1000.0, 1)   # kg → MT
        if not by_year:
            continue
        if name.lower() in _TOTAL_LABELS:
            for y, v in by_year.items():
                total_by_year[y] = v
            continue
        latest = max(by_year) if by_year else None
        origins.append({"name": name, "by_year": by_year,
                        "latest_mt": by_year.get(latest) if latest else None})

    if not total_by_year:   # derive the total if the API didn't emit a total row
        for o in origins:
            for y, v in o["by_year"].items():
                total_by_year[y] = round(total_by_year.get(y, 0.0) + v, 1)

    origins.sort(key=lambda o: o.get("latest_mt") or 0, reverse=True)
    return {"years": years, "origins": origins, "total_by_year": total_by_year}


# ── Fetch + build ────────────────────────────────────────────────────────────

def _run_report(query: dict) -> dict:
    if not API_KEY:
        log.error("USITC_API_KEY not set — cannot query DataWeb")
        return {}
    headers = {"Content-Type": "application/json; charset=utf-8",
               "Authorization": "Bearer " + API_KEY}
    try:
        requests.packages.urllib3.disable_warnings()   # noqa: SLF001
        r = requests.post(RUN_REPORT, headers=headers, json=query, timeout=90, verify=False)
        log.info("USITC runReport HTTP %s (%d bytes)", r.status_code, len(r.content))
        r.raise_for_status()
        body = r.json()
        # Diagnostic: when the parsed result is empty the body is usually a
        # validation message or an empty table — surface it in the logs.
        if len(r.content) < 2000:
            log.info("USITC runReport raw body: %s", r.text[:1500])
        return body
    except Exception as e:
        log.error("USITC runReport failed: %s", e)
        return {}


def _fetch_parsed(years: list[str]) -> dict:
    """Try each candidate commodity-select tab until one returns data, logging
    the validation error for the ones that fail."""
    for st in COMMODITY_SELECT_TYPES:
        resp = _run_report(build_query(years, st))
        dto = resp.get("dto") or {}
        errors = dto.get("errors") or []
        tables = dto.get("tables") or []
        log.info("commodity selectType=%s → tables=%d errors=%s", st, len(tables), errors)
        if tables and not errors:
            parsed = parse_report(resp)
            if parsed["origins"]:
                log.info("commodity selectType=%s WORKS (%d origins)", st, len(parsed["origins"]))
                return parsed
    return {"years": [], "origins": [], "total_by_year": {}}


_N_MONTHLY_YEARS = 4   # recent-window depth for the monthly national total


def build_us_coffee_imports(db=None) -> dict:  # noqa: ARG001
    now = datetime.utcnow()
    years = [str(now.year - 1 - i) for i in range(N_YEARS)]
    parsed = _fetch_parsed(list(reversed(years)))

    if not parsed["origins"]:
        log.warning("usitc_imports: no origins parsed; retaining existing file")
        if OUT_PATH.exists():
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))

    # Monthly national total (recent window) for the momentum/trend view.
    m_years = [str(now.year - i) for i in range(_N_MONTHLY_YEARS)]
    monthly = parse_monthly(_run_report(
        build_query(list(reversed(m_years)), timeline="Monthly", break_countries=False)))
    log.info("usitc_imports: %d monthly points (%s … %s)", len(monthly),
             next(iter(monthly), "—"), next(reversed(monthly), "—") if monthly else "—")

    # Monthly broken out by origin (recent window) — powers the monthly heatmap.
    monthly_origins = parse_monthly_by_origin(_run_report(
        build_query(list(reversed(m_years)), timeline="Monthly", break_countries=True)))
    log.info("usitc_imports: monthly-by-origin for %d origins", len(monthly_origins))

    out = {
        "updated":        now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":         "USITC DataWeb — HTS 0901, Imports for Consumption, quantity (kg→MT)",
        "hts":            HTS,
        "measure":        "quantity_mt",
        "is_seed":        False,
        "years":          parsed["years"],
        "origins":        parsed["origins"],
        "total_by_year":  parsed["total_by_year"],
        "monthly_total":  monthly,            # {"YYYY-MM": mt} US total
        "monthly_origins": monthly_origins,   # {origin: {"YYYY-MM": mt}}
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("us_coffee_imports.json written: %d origins, %d monthly pts",
             len(parsed["origins"]), len(monthly))
    return out


async def run(page, db=None) -> None:  # noqa: ARG001
    build_us_coffee_imports(db)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    res = build_us_coffee_imports()
    print(f"Done. {len(res.get('origins', []))} origins → {OUT_PATH}")
