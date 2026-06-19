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
import time
from datetime import datetime
from pathlib import Path

import requests

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

# Endpoints: the keyless public PREVIEW truncates/returns stale slices for some
# reporters (e.g. Germany came back as 2014@0). The authenticated DATA endpoint
# returns complete series — used automatically when COMTRADE_API_KEY is set
# (free key at comtradedeveloper.un.org).
COMTRADE_PREVIEW = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
COMTRADE_AUTH    = "https://comtradeapi.un.org/data/v1/get/C/A/HS"
COMTRADE_API_KEY = os.environ.get("COMTRADE_API_KEY", "")

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "coffee_imports.json"

_N_YEARS = 12   # annual history depth


# ── Fetch + parse ──────────────────────────────────────────────────────────────

def _comtrade_annual(reporter_code: str, periods_csv: str) -> list[dict]:
    """One call: all HS-0901 subcodes × all periods, imports from World.
    Uses the authenticated endpoint when a key is configured, else the preview."""
    params = {
        "reporterCode": reporter_code,
        "cmdCode":      CMD_CSV,
        "flowCode":     "M",        # imports
        "period":       periods_csv,
        "partnerCode":  "0",        # world aggregate
        "includeDesc":  "true",
    }
    if COMTRADE_API_KEY:
        url, headers = COMTRADE_AUTH, {"Ocp-Apim-Subscription-Key": COMTRADE_API_KEY}
    else:
        url, headers = COMTRADE_PREVIEW, {}
    try:
        r = requests.get(url, params=params, headers=headers, timeout=40)
        r.raise_for_status()
        return r.json().get("data", []) or []
    except Exception as e:
        log.error("Comtrade fetch error reporter=%s: %s", reporter_code, e)
        return []


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


# ── Build ────────────────────────────────────────────────────────────────────

def build_coffee_imports(db=None) -> dict:  # noqa: ARG001
    now = datetime.utcnow()
    years = [str(now.year - 1 - i) for i in range(_N_YEARS)]   # last N complete years
    periods_csv = ",".join(reversed(years))
    fresh_cutoff = now.year - 3   # drop reporters whose newest real datum is older

    log.info("coffee_imports: endpoint=%s", "AUTH" if COMTRADE_API_KEY else "PREVIEW (keyless)")
    countries: dict[str, dict] = {}
    stale: list[str] = []
    for iso3, (name, code) in COUNTRIES.items():
        annual = parse_country_rows(_comtrade_annual(code, periods_csv))
        # latest year that actually carries a total volume
        real_years = [r["year"] for r in annual if r.get("total_mt") is not None]
        if not real_years:
            log.info("coffee_imports: no usable data for %s", iso3)
            time.sleep(0.4)
            continue
        latest = max(real_years)
        if latest < fresh_cutoff:
            # Stale slice (the preview endpoint does this for some reporters) —
            # exclude rather than surface a misleading old/zero value.
            stale.append(f"{iso3}:{latest}")
            time.sleep(0.4)
            continue
        countries[iso3] = {
            "name":         name,
            "iso3":         iso3.upper(),
            "reporter_code": code,
            "annual":       [r for r in annual if r.get("total_mt") is not None],
            "latest_year":  latest,
        }
        time.sleep(0.4)   # be gentle on the endpoint

    if stale:
        log.warning("coffee_imports: dropped %d stale reporters (latest < %d): %s",
                    len(stale), fresh_cutoff, ", ".join(stale))
    log.info("coffee_imports: kept %d fresh countries", len(countries))

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
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("coffee_imports.json written: %d countries", len(countries))
    return out


async def run(page, db=None) -> None:  # noqa: ARG001
    """Monthly-scraper entrypoint (page unused — pure API source)."""
    build_coffee_imports(db)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    res = build_coffee_imports()
    print(f"Done. {len(res.get('countries', {}))} countries written → {OUT_PATH}")
