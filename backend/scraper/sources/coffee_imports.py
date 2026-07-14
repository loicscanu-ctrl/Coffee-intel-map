"""
coffee_imports.py — Coffee import tracker (HS 0901) for consuming countries.

Source: UN Comtrade public preview endpoint (no API key, 500 rows/call), the
same proven access path used by sources/global_fertilizers.py. One call per
reporter covers every HS subcode across every year (partner = World).

HS 0901 breakdown (2017 nomenclature):
  0901    Coffee (total)
  090111  Coffee, not roasted, not decaffeinated   ─┐ green
  090112  Coffee, not roasted, decaffeinated        ─┘
  090121  Coffee, roasted, not decaffeinated        ─┐ roasted
  090122  Coffee, roasted, decaffeinated            ─┘
  090190  Coffee husks/skins & substitutes
Derived series: green = 11+12, roasted = 21+22, decaf = 12+22.

Output: frontend/public/data/coffee_imports.json (committed; refreshed monthly
by .github/workflows/scraper-coffee-imports.yml).
"""

from __future__ import annotations

import json
import logging
import os
import statistics
import time
from datetime import datetime
from pathlib import Path

import requests

from scraper.sources._imports_util import merge_monthly
from scraper.validate_export import safe_write_json

log = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────

HS_CODES = {
    "0901":   "Coffee, total (HS 0901)",
    "090111": "Green, not decaffeinated",
    "090112": "Green, decaffeinated",
    "090121": "Roasted, not decaffeinated",
    "090122": "Roasted, decaffeinated",
    "090190": "Husks, skins & substitutes",
}
CMD_CSV = ",".join(HS_CODES)

# Consuming/importing markets to track — ISO3 (lower) → (display name, UN M49).
# Broad coverage: EU majors, other Europe, North America, East Asia, MENA and a
# few large emerging consumers. Reporters that return nothing are skipped.
COUNTRIES: dict[str, tuple[str, str]] = {
    "usa": ("United States", "842"),
    "deu": ("Germany", "276"),
    "ita": ("Italy", "380"),
    "fra": ("France", "250"),
    "esp": ("Spain", "724"),
    "nld": ("Netherlands", "528"),
    "bel": ("Belgium", "56"),
    "gbr": ("United Kingdom", "826"),
    "swe": ("Sweden", "752"),
    "che": ("Switzerland", "756"),
    "pol": ("Poland", "616"),
    "aut": ("Austria", "40"),
    "prt": ("Portugal", "620"),
    "fin": ("Finland", "246"),
    "nor": ("Norway", "578"),
    "dnk": ("Denmark", "208"),
    "grc": ("Greece", "300"),
    "cze": ("Czechia", "203"),
    "rou": ("Romania", "642"),
    "hun": ("Hungary", "348"),
    "irl": ("Ireland", "372"),
    "can": ("Canada", "124"),
    "jpn": ("Japan", "392"),
    "kor": ("South Korea", "410"),
    "aus": ("Australia", "36"),
    "rus": ("Russia", "643"),
    "tur": ("Turkey", "792"),
    "chn": ("China", "156"),
    "sau": ("Saudi Arabia", "682"),
    "are": ("UAE", "784"),
    "dza": ("Algeria", "12"),
    "mar": ("Morocco", "504"),
    "egy": ("Egypt", "818"),
    "mex": ("Mexico", "484"),
    "phl": ("Philippines", "608"),
    "idn": ("Indonesia", "360"),
    "ind": ("India", "356"),
    "mys": ("Malaysia", "458"),
    "tha": ("Thailand", "764"),
    "ukr": ("Ukraine", "804"),
    "zaf": ("South Africa", "710"),
    "isr": ("Israel", "376"),
}

# Keyless public PREVIEW endpoint (fast). It truncates/returns stale slices for
# some reporters (e.g. Germany → 2014@0); the freshness guard in build() drops
# those rather than surface them. (The authenticated /data/v1 endpoint returns
# complete series but rate-limits hard in batch — it stalled all 42 calls — so
# we stay on the preview, which reliably covers ~20 importer markets.)
COMTRADE_PREVIEW = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
COMTRADE_API_KEY = os.environ.get("COMTRADE_API_KEY", "")  # passed as a header if set

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "coffee_imports.json"

_MONTHLY_TOP_N = 12  # cap monthly fetches to the largest RoW importers (rate limits)


# ── Fetch + parse ──────────────────────────────────────────────────────────────

COMTRADE_MONTHLY = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"

# The public preview endpoint is aggressively rate-limited (HTTP 429) and the
# monthly variant rejects long period lists (HTTP 400 above ~12 periods). Both
# are handled here: cap periods at the call sites, and back off on 429.
_MAX_RETRIES = 2
_BACKOFF_S = (6, 14)   # waits after the 1st / 2nd 429


def _comtrade_fetch(url: str, reporter_code: str, periods_csv: str, *, kind: str) -> list[dict]:
    """Shared Comtrade preview GET (annual or monthly), retrying on HTTP 429
    with a short backoff so transient throttling doesn't drop a reporter."""
    params = {
        "reporterCode": reporter_code,
        "cmdCode":      CMD_CSV,
        "flowCode":     "M",        # imports
        "period":       periods_csv,
        "partnerCode":  "0",        # world aggregate
        "includeDesc":  "true",
    }
    headers = {"Ocp-Apim-Subscription-Key": COMTRADE_API_KEY} if COMTRADE_API_KEY else {}
    for attempt in range(_MAX_RETRIES + 1):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=30)
            if r.status_code == 429 and attempt < _MAX_RETRIES:
                time.sleep(_BACKOFF_S[attempt])
                continue
            r.raise_for_status()
            return r.json().get("data", []) or []
        except Exception as e:
            if attempt < _MAX_RETRIES and "429" in str(e):
                time.sleep(_BACKOFF_S[attempt])
                continue
            log.error("Comtrade %s fetch error reporter=%s: %s", kind, reporter_code, e)
            return []
    return []


def _comtrade_annual(reporter_code: str, periods_csv: str) -> list[dict]:
    """One call: all HS-0901 subcodes × ONE period, imports from World.

    As of July 2026 the keyless preview endpoint enforces "Maximum number of
    periods for preview is 1" — multi-period CSVs now return HTTP 400. Use
    _fetch_periods() to cover a window."""
    return _comtrade_fetch(COMTRADE_PREVIEW, reporter_code, periods_csv, kind="annual")


def _comtrade_monthly(reporter_code: str, periods_csv: str) -> list[dict]:
    """Monthly variant (C/M endpoint) — same 1-period-per-call limit."""
    return _comtrade_fetch(COMTRADE_MONTHLY, reporter_code, periods_csv, kind="monthly")


def _fetch_periods(fetch, reporter_code: str, periods: list[str], *, pause: float = 0.6) -> list[dict]:
    """Fetch each period with its own call (preview limit = 1 period/call) and
    concatenate the rows. Combined with the archive merge in the build, each
    run only needs the recent few periods — history persists in the JSON."""
    rows: list[dict] = []
    for p in periods:
        rows.extend(fetch(reporter_code, p))
        time.sleep(pause)
    return rows


def parse_country_monthly(rows: list[dict]) -> dict:
    """Monthly total (HS 0901) by month → {'YYYY-MM': mt} (kg→MT)."""
    wgt: dict[str, dict[str, float]] = {}
    for d in rows:
        p = str(d.get("period", ""))            # 'YYYYMM'
        if len(p) != 6 or not p.isdigit():
            continue
        nw = d.get("netWgt")
        if nw not in (None, 0):
            wgt.setdefault(f"{p[:4]}-{p[4:6]}", {})[str(d.get("cmdCode", ""))] = float(nw) / 1000.0
    out: dict[str, float] = {}
    for ym, w in wgt.items():
        total = w.get("0901") if "0901" in w else (
            w.get("090111", 0) + w.get("090112", 0) + w.get("090121", 0)
            + w.get("090122", 0) + w.get("090190", 0))
        if total:
            out[ym] = round(total, 1)
    return dict(sorted(out.items()))


def parse_country_rows(rows: list[dict]) -> list[dict]:
    """Fold raw Comtrade rows (one country) into a per-year series.

    Each output row: {year, total_mt, green_mt, roasted_mt, decaf_mt,
    husks_mt, value_usd}. Weights kg→MT; None when a country reports value
    only. Pure function (no I/O) — unit-tested."""
    wgt: dict[int, dict[str, float]] = {}   # year -> cmd -> MT
    val: dict[int, dict[str, float]] = {}   # year -> cmd -> USD
    for d in rows:
        try:
            year = int(d.get("period"))
        except (TypeError, ValueError):
            continue
        cmd = str(d.get("cmdCode", "")).strip()
        if cmd not in HS_CODES:
            continue
        nw = d.get("netWgt")
        pv = d.get("primaryValue")
        if nw not in (None, 0):
            wgt.setdefault(year, {})[cmd] = float(nw) / 1000.0
        if pv not in (None, 0):
            val.setdefault(year, {})[cmd] = float(pv)

    out: list[dict] = []
    for year in sorted(set(wgt) | set(val)):
        w = wgt.get(year, {})
        v = val.get(year, {})
        green   = w.get("090111", 0.0) + w.get("090112", 0.0)
        roasted = w.get("090121", 0.0) + w.get("090122", 0.0)
        decaf   = w.get("090112", 0.0) + w.get("090122", 0.0)
        husks   = w.get("090190", 0.0)
        total   = w.get("0901") if "0901" in w else (green + roasted + husks)
        value   = v.get("0901") if "0901" in v else sum(v.values()) or None
        if not total and not value:
            continue
        out.append({
            "year":       year,
            "total_mt":   round(total, 1) if total else None,
            "green_mt":   round(green, 1) if green else None,
            "roasted_mt": round(roasted, 1) if roasted else None,
            "decaf_mt":   round(decaf, 1) if decaf else None,
            "husks_mt":   round(husks, 1) if husks else None,
            "value_usd":  round(value) if value else None,
        })
    return out


# ── Sanity checks ──────────────────────────────────────────────────────────────

_OUTLIER_LOW = 0.2     # drop years below 20% of the typical level …
_OUTLIER_HIGH = 8.0    # … or above 8× (double-counted / spurious revisions)
_ABS_FLOOR_MT = 500.0  # …and any year under 0.5 kt (clearly incomplete reporting)


def drop_implausible_years(rows: list[dict], iso3: str = "") -> list[dict]:
    """Remove calendar years whose total import volume is implausible for the
    country — partial/incomplete Comtrade reporting (e.g. Italy 2016 at ~8 kt vs
    a ~570 kt norm, or near-zero 0/2/58 MT years), not real collapses.

    The reference level is the median of the *upper half* of non-zero totals, so
    it stays robust even when most years are garbage-low (which would wreck a
    plain median). A year is dropped if it's below 0.5 kt, below 20% of that
    level, or above 8×. Needs ≥4 non-zero years. Pure — unit-tested."""
    nz = sorted(t for t in (r.get("total_mt") for r in rows) if t)
    if len(nz) < 4:
        return rows
    ref = statistics.median(nz[len(nz) // 2:])   # median of the top half
    if ref <= 0:
        return rows
    low, high = max(_ABS_FLOOR_MT, _OUTLIER_LOW * ref), _OUTLIER_HIGH * ref
    kept, dropped = [], []
    for r in rows:
        t = r.get("total_mt")
        if t is not None and (t < low or t > high):
            dropped.append(f"{r['year']}:{round(t)}")
            continue
        kept.append(r)
    if dropped:
        log.warning("coffee_imports: %s dropped %d implausible year(s) (level ~%d MT): %s",
                    iso3 or "?", len(dropped), round(ref), ", ".join(dropped))
    return kept


# ── Build ────────────────────────────────────────────────────────────────────

_RECENT_ANNUAL_YEARS = 3   # per-run annual refresh window (1 call per year)
_RECENT_MONTHS = 3         # per-run monthly refresh window (1 call per month)


def build_coffee_imports(db=None) -> dict:  # noqa: ARG001
    now = datetime.utcnow()
    # Preview limit is 1 period/call (July 2026), so each run refreshes only a
    # recent window and merges into the archived history in the committed JSON
    # — full 12-year series persist there from the pre-limit era.
    recent_years = [str(now.year - 1 - i) for i in range(_RECENT_ANNUAL_YEARS)]
    fresh_cutoff = now.year - 3   # drop reporters whose newest real datum is older

    prev_countries: dict = {}
    if OUT_PATH.exists():
        try:
            prev_countries = json.loads(OUT_PATH.read_text(encoding="utf-8")).get("countries", {})
        except Exception:
            prev_countries = {}

    countries: dict[str, dict] = {}
    stale: list[str] = []
    for iso3, (name, code) in COUNTRIES.items():
        fetched = parse_country_rows(_fetch_periods(_comtrade_annual, code, recent_years))
        # Merge the fresh window into the archived per-year history (new years
        # override same-year revisions; old years persist), THEN sanity-filter.
        by_year = {r["year"]: r for r in (prev_countries.get(iso3) or {}).get("annual", [])}
        for r in fetched:
            if r.get("total_mt") is not None:
                by_year[r["year"]] = r
        annual = drop_implausible_years(sorted(by_year.values(), key=lambda r: r["year"]), iso3)
        real_years = [r["year"] for r in annual if r.get("total_mt") is not None]
        if not real_years:
            log.info("coffee_imports: no usable data for %s", iso3)
            continue
        latest = max(real_years)
        if latest < fresh_cutoff:
            # Stale slice (the preview endpoint does this for some reporters) —
            # exclude rather than surface a misleading old/zero value.
            stale.append(f"{iso3}:{latest}")
            continue
        countries[iso3] = {
            "name":         name,
            "iso3":         iso3.upper(),
            "reporter_code": code,
            "annual":       [r for r in annual if r.get("total_mt") is not None],
            "latest_year":  latest,
        }

    if stale:
        log.warning("coffee_imports: dropped %d stale reporters (latest < %d): %s",
                    len(stale), fresh_cutoff, ", ".join(stale))
    log.info("coffee_imports: kept %d fresh countries", len(countries))

    # Monthly momentum for the rest-of-world importers — recent months only
    # (1 period/call preview limit); history persists via the archive merge
    # below. Skip the US + EU members (served better by USITC / Eurostat) and
    # limit to the largest remaining importers (rate limits).
    eu_members = {"deu", "ita", "fra", "esp", "nld", "bel", "swe", "pol", "aut",
                  "prt", "fin", "dnk", "grc", "cze", "rou", "hun", "irl"}
    skip_monthly = eu_members | {"usa"}
    m_periods = []
    y, m = now.year, now.month
    for _ in range(_RECENT_MONTHS):
        m -= 1
        if m == 0:
            m, y = 12, y - 1
        m_periods.append(f"{y}{m:02d}")
    m_periods = list(reversed(m_periods))

    def _latest_total(c: dict) -> float:
        ly = c.get("latest_year")
        return next((r.get("total_mt") or 0 for r in c["annual"] if r["year"] == ly), 0)

    row_targets = sorted(
        (kv for kv in countries.items() if kv[0] not in skip_monthly),
        key=lambda kv: _latest_total(kv[1]), reverse=True,
    )[:_MONTHLY_TOP_N]
    n_monthly = 0
    for _iso3, c in row_targets:
        mt = parse_country_monthly(_fetch_periods(_comtrade_monthly, c["reporter_code"],
                                                  m_periods, pause=1.5))
        if mt:
            c["monthly_total"] = mt
            n_monthly += 1
    log.info("coffee_imports: monthly added for %d of %d top rest-of-world importers",
             n_monthly, len(row_targets))

    # Archive: the monthly fetch only covers the recent few months, so merge it
    # into the previously-committed history — old months are kept, new/revised
    # ones are added. Without this the RoW monthly series would never grow.
    if prev_countries:
        for iso3, c in countries.items():
            merged = merge_monthly((prev_countries.get(iso3) or {}).get("monthly_total"),
                                   c.get("monthly_total"))
            if merged:
                c["monthly_total"] = merged

    if not countries:
        # Network unavailable (e.g. egress sandbox) — keep any existing file.
        log.warning("coffee_imports: no countries fetched; retaining existing file")
        if OUT_PATH.exists():
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))

    out = {
        "updated":   now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":    "UN Comtrade (public preview, HS 0901, imports from World)",
        "hs_codes":  HS_CODES,
        "is_seed":   False,
        "countries": countries,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(OUT_PATH, out, ensure_ascii=False)
    log.info("coffee_imports.json written: %d countries", len(countries))
    return out


async def run(page, db=None) -> None:  # noqa: ARG001
    """Monthly-scraper entrypoint (page unused — pure API source)."""
    build_coffee_imports(db)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    res = build_coffee_imports()
    print(f"Done. {len(res.get('countries', {}))} countries written → {OUT_PATH}")
