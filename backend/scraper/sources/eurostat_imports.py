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
        name = partner_labels.get(pcode, pcode)
        latest = max(by_year) if by_year else None
        origins.append({"name": name, "by_year": by_year,
                        "latest_mt": by_year.get(latest) if latest else None})
        for y, v in by_year.items():
            total_by_year[y] = round(total_by_year.get(y, 0.0) + v, 1)
    origins.sort(key=lambda o: o.get("latest_mt") or 0, reverse=True)
    return {"years": years, "origins": origins, "total_by_year": total_by_year}


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

    out = {
        "updated":       now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":        "Eurostat Comext ds-045409 — HS 0901 imports, extra-EU by origin, quantity (100kg→MT)",
        "hts":           PRODUCT,
        "measure":       "quantity_mt",
        "is_seed":       False,
        "years":         parsed["years"],
        "origins":       parsed["origins"],
        "total_by_year": parsed["total_by_year"],
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
