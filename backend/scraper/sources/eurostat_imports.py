"""
eurostat_imports.py — EU coffee imports by country of origin (Eurostat Comext).

Authoritative EU trade data: dataset ds-045409 (EU trade since 1988 by HS2-4-6),
product HS 0901 (coffee), flow 1 (imports), reporter = EU bloc, broken out by
partner (origin), annual, quantity in kg. The EU analogue of the USITC US-by-
origin view.

API (Comext dissemination, JSON-stat):
  https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/ds-045409
  ?format=JSON&freq=A&reporter=<EU>&product=0901&flow=1&indicators=QUANTITY_IN_KG&time=YYYY...
No key required. Egress to ec.europa.eu must be allowed (works in CI).

Output: frontend/public/data/eu_coffee_imports.json (same shape as
us_coffee_imports.json), refreshed by .github/workflows/scraper-eurostat-imports.yml.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path

import requests

log = logging.getLogger(__name__)

BASE = "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/ds-045409"
PRODUCT = "0901"
N_YEARS = 6
REPORTER = "EU27_2020"          # confirmed valid EU-bloc reporter code
INDICATOR = "QUANTITY_IN_100KG"  # the only quantity indicator (units = 100 kg)
KG_PER_UNIT = 100                # 100-kg units → MT = value × 100 / 1000

# EU member geo codes — excluded from "origins" so the view is extra-EU only
# (reporter=EU bloc + intra-EU partner would otherwise show member states).
EU_MEMBERS = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "EL",
    "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI",
    "ES", "SE",
}
# Non-country partner aggregates / blocs to skip.
SKIP_PARTNERS = {
    "EU27_2020", "EU", "EU27", "EU28", "EA", "EA21", "EA20", "EA19", "WORLD",
    "EXT_EU27_2020", "EXT_EU", "INT_EU27_2020", "INTRA_EU", "EXTRA_EU", "TOTAL",
}

OUT_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "eu_coffee_imports.json"

_HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelBot/1.0)", "Accept": "application/json"}


def _fetch(years: list[str]) -> dict:
    """EU-bloc imports of HS 0901 by partner, annual, quantity (100-kg units)."""
    params = [("format", "JSON"), ("freq", "A"), ("reporter", REPORTER),
              ("product", PRODUCT), ("flow", "1"), ("indicators", INDICATOR)]
    params += [("time", y) for y in years]
    try:
        r = requests.get(BASE, params=params, headers=_HEADERS, timeout=60)
        if r.status_code != 200:
            log.info("Eurostat HTTP %s body: %s", r.status_code, r.text[:300])
            return {}
        body = r.json()
        log.info("Eurostat HTTP 200 size=%s nval=%d", body.get("size"), len(body.get("value", {}) or {}))
        return body
    except Exception as e:
        log.error("Eurostat fetch error: %s", e)
        return {}


_RENAME = {"Viet Nam": "Vietnam", "Korea, Republic of": "South Korea",
           "Russian Federation": "Russia", "Tanzania, United Republic of": "Tanzania"}


def clean_name(label: str) -> str:
    """Eurostat partner labels carry verbose parentheticals, e.g.
    "Viet Nam (incl. North Viet Nam 'VD' from 1977)" → "Vietnam"."""
    s = re.sub(r"\s*\(.*", "", str(label)).strip() or str(label)
    return _RENAME.get(s, s)


def parse_jsonstat(body: dict, kg_per_unit: int = KG_PER_UNIT) -> dict:
    """Decode a JSON-stat cube → {years, origins[], total_by_year} in MT.

    `kg_per_unit` converts the raw measure to kg (Comext quantity is in 100-kg
    units). Only `partner` and `time` vary (other dims are pinned). Pure —
    unit-tested."""
    try:
        ids = body["id"]
        sizes = body["size"]
        dims = body["dimension"]
        values = body["value"]
    except (KeyError, TypeError):
        return {"years": [], "origins": [], "total_by_year": {}}
    if not values:
        return {"years": [], "origins": [], "total_by_year": {}}

    # position → code for partner and time
    def pos_to_code(dim: str) -> dict[int, str]:
        idx = dims[dim]["category"]["index"]
        if isinstance(idx, dict):
            return {v: k for k, v in idx.items()}
        return dict(enumerate(idx))

    # Dimension ids vary in case/spelling — find the partner & time dims robustly.
    def find_dim(*cands: str) -> str | None:
        for c in cands:
            if c in ids:
                return c
        for d in ids:
            if any(c in d.lower() for c in cands):
                return d
        return None

    pdim = find_dim("partner")
    tdim = find_dim("time")
    if not pdim or not tdim:
        log.warning("Eurostat parse: partner/time dim not found in ids=%s", ids)
        return {"years": [], "origins": [], "total_by_year": {}}

    partner_codes = pos_to_code(pdim)
    time_codes = pos_to_code(tdim)
    partner_labels = dims.get(pdim, {}).get("category", {}).get("label", {})

    # strides for flat-index decoding (row-major over `ids`)
    strides = [1] * len(ids)
    for i in range(len(ids) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]
    pi = ids.index(pdim)
    ti = ids.index(tdim)

    # Accumulate by YEAR (sum) — handles annual ("2023") and monthly ("2023-01"/
    # "202301") time codes alike via the 4-digit year prefix.
    acc: dict[str, dict[str, float]] = {}
    for flat, val in values.items():
        if val is None:
            continue
        f = int(flat)
        p_pos = (f // strides[pi]) % sizes[pi]
        t_pos = (f // strides[ti]) % sizes[ti]
        pcode = partner_codes.get(p_pos)
        ycode = time_codes.get(t_pos)
        if not pcode or not ycode:
            continue
        if pcode in SKIP_PARTNERS or pcode in EU_MEMBERS:
            continue
        year = str(ycode)[:4]
        try:
            mt = float(val) * kg_per_unit / 1000.0
        except (TypeError, ValueError):
            continue
        d = acc.setdefault(pcode, {})
        d[year] = round(d.get(year, 0.0) + mt, 1)

    years = sorted({int(y) for d in acc.values() for y in d}) if acc else []
    origins = []
    total_by_year: dict[str, float] = {}
    for pcode, by_year in acc.items():
        name = clean_name(partner_labels.get(pcode, pcode))
        latest = max(by_year) if by_year else None
        origins.append({"name": name, "by_year": by_year,
                        "latest_mt": by_year.get(latest) if latest else None})
        for y, v in by_year.items():
            total_by_year[y] = round(total_by_year.get(y, 0.0) + v, 1)
    origins.sort(key=lambda o: o.get("latest_mt") or 0, reverse=True)
    return {"years": years, "origins": origins, "total_by_year": total_by_year}


def _month_code(t: str) -> str | None:
    """Comext monthly time code → 'YYYY-MM' ('202401' / '2024-01' / '2024M01')."""
    digs = re.sub(r"[^0-9]", "", str(t))
    if len(digs) >= 6 and 1 <= int(digs[4:6]) <= 12:
        return f"{digs[:4]}-{digs[4:6]}"
    return None


def _fetch_monthly(last_n: int) -> dict:
    """Recent `last_n` months of monthly EU-bloc HS-0901 imports by partner.
    Uses lastTimePeriod (annual time= doesn't expand to months); large windows
    trip Comext's async 413, so the caller steps the window down."""
    params = [("format", "JSON"), ("freq", "M"), ("reporter", REPORTER),
              ("product", PRODUCT), ("flow", "1"), ("indicators", INDICATOR),
              ("lastTimePeriod", str(last_n))]
    try:
        r = requests.get(BASE, params=params, headers=_HEADERS, timeout=60)
        if r.status_code != 200:
            log.info("Eurostat monthly lastN=%d HTTP %s: %s", last_n, r.status_code, r.text[:160])
            return {}
        body = r.json()
        tdim = body.get("dimension", {}).get("time", {}).get("category", {}).get("index", {})
        log.info("Eurostat monthly lastN=%d size=%s nval=%d times=%s", last_n, body.get("size"),
                 len(body.get("value", {}) or {}), list(tdim)[:3])
        return body
    except Exception as e:
        log.error("Eurostat monthly fetch error lastN=%d: %s", last_n, e)
        return {}


def parse_monthly_total(body: dict) -> dict:
    """Sum extra-EU partners per month → {'YYYY-MM': mt}. (Excludes EU members
    and bloc aggregates, like the annual parse.)"""
    try:
        ids, sizes, dims, values = body["id"], body["size"], body["dimension"], body["value"]
    except (KeyError, TypeError):
        return {}
    if not values:
        return {}

    def pos_to_code(dim: str) -> dict[int, str]:
        idx = dims[dim]["category"]["index"]
        return {v: k for k, v in idx.items()} if isinstance(idx, dict) else dict(enumerate(idx))

    def find_dim(*cands: str) -> str | None:
        for c in cands:
            if c in ids:
                return c
        return next((d for d in ids if any(c in d.lower() for c in cands)), None)

    pdim, tdim = find_dim("partner"), find_dim("time")
    if not pdim or not tdim:
        return {}
    pcodes, tcodes = pos_to_code(pdim), pos_to_code(tdim)
    strides = [1] * len(ids)
    for i in range(len(ids) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]
    pi, ti = ids.index(pdim), ids.index(tdim)

    out: dict[str, float] = {}
    for flat, val in values.items():
        if val is None:
            continue
        f = int(flat)
        pcode = pcodes.get((f // strides[pi]) % sizes[pi])
        tc = tcodes.get((f // strides[ti]) % sizes[ti])
        if not pcode or pcode in SKIP_PARTNERS or pcode in EU_MEMBERS:
            continue
        mk = _month_code(tc) if tc else None
        if not mk:
            continue
        try:
            out[mk] = round(out.get(mk, 0.0) + float(val) * KG_PER_UNIT / 1000.0, 1)
        except (TypeError, ValueError):
            continue
    return dict(sorted(out.items()))


# ── Comtrade EU-bloc (for the EU↔Comtrade reconciliation) ─────────────────────
# Comtrade re-publishes national stats with a lag; for the EU bloc, imports
# "from World" are extra-EU (intra-EU is internal). We pull that here so the UI
# can show the systematic gap vs Eurostat. Kept on this (reliable) workflow as a
# single reporter pull, rather than the throttled 42-country coffee_imports run.
_COMTRADE_REF = "https://comtradeapi.un.org/files/v1/app/reference/Reporters.json"


def _comtrade_eu_total_by_year() -> dict:
    try:
        ref = requests.get(_COMTRADE_REF, headers=_HEADERS, timeout=30)
        ref.raise_for_status()
        rows = ref.json().get("results") or ref.json()
    except Exception as e:
        log.warning("Comtrade EU reporter ref failed: %s", e)
        return {}
    cands = []
    for x in rows:
        code = str(x.get("id") or x.get("reporterCode") or "").strip()
        text = str(x.get("text") or x.get("reporterDesc") or "")
        if code and ("european union" in text.lower() or text.strip() in ("EU", "EU-27", "EU-28", "EU27_2020")):
            cands.append((code, text))
    log.info("Comtrade EU reporter candidates: %s", cands[:6])
    if not cands:
        return {}
    # Prefer the EU27_2020 / newest "European Union" entry.
    cands.sort(key=lambda c: ("27_2020" in c[1], "27" in c[1], "european union" in c[1].lower()), reverse=True)
    eu_code = cands[0][0]
    try:
        from scraper.sources import coffee_imports as ci
        now = datetime.utcnow()
        periods = ",".join(reversed([str(now.year - 1 - i) for i in range(12)]))
        annual = ci.parse_country_rows(ci._comtrade_annual(eu_code, periods))  # noqa: SLF001
        by_year = {str(r["year"]): r["total_mt"] for r in annual if r.get("total_mt")}
        log.info("Comtrade EU-bloc (reporter=%s) → %d years", eu_code, len(by_year))
        return by_year
    except Exception as e:
        log.warning("Comtrade EU-bloc fetch failed: %s", e)
        return {}


def build_eu_coffee_imports(db=None) -> dict:  # noqa: ARG001
    now = datetime.utcnow()
    years = [str(now.year - 1 - i) for i in range(N_YEARS)]
    years = list(reversed(years))

    parsed = parse_jsonstat(_fetch(years))
    log.info("Eurostat → %d origins", len(parsed["origins"]))

    if not parsed["origins"]:
        log.warning("eurostat_imports: no origins parsed; retaining existing file")
        if OUT_PATH.exists():
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))

    # Monthly extra-EU total. Step the window down until Comext returns it
    # synchronously (large windows trigger an async 413).
    monthly: dict[str, float] = {}
    for last_n in (36, 24, 12):
        monthly = parse_monthly_total(_fetch_monthly(last_n))
        log.info("Eurostat monthly lastN=%d → %d points", last_n, len(monthly))
        if monthly:
            break
    monthly = {k: v for k, v in sorted(monthly.items()) if v > 0}
    comtrade_by_year = _comtrade_eu_total_by_year()

    out = {
        "updated":       now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":        "Eurostat Comext ds-045409 — HS 0901 imports, extra-EU by origin, quantity (100kg→MT)",
        "hts":           PRODUCT,
        "measure":       "quantity_mt",
        "is_seed":       False,
        "years":         parsed["years"],
        "origins":       parsed["origins"],
        "total_by_year": parsed["total_by_year"],
        "monthly_total": monthly,
        "comtrade_total_by_year": comtrade_by_year,   # EU-bloc extra-EU, for reconciliation
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("eu_coffee_imports.json written: %d origins", len(parsed["origins"]))
    return out


async def run(page, db=None) -> None:  # noqa: ARG001
    build_eu_coffee_imports(db)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    res = build_eu_coffee_imports()
    print(f"Done. {len(res.get('origins', []))} origins → {OUT_PATH}")
