"""
un_wpp_age.py — UN World Population Prospects scraper for 18+ population
("coffee-drinking age") in the 15 demand-tab markets.

Pulls UN Population Data Portal indicator for population by 5-year age
groups (Medium variant projection), filters to age cohorts >= 15, and
estimates the 18+ count for each country across 2000–2050.

Why 18+: matches the user-chosen threshold for the demand-tab age-cohort
panel. UN doesn't publish 18+ directly, so we sum 20+ exactly and add
2/5 of the 15–19 bracket (ages 18–19, assuming uniform distribution).

This source is intended for monthly_scraper because UN WPP only refreshes
every ~2 years. Daily polling would waste bandwidth on a static dataset.

Cache shape:
  {
    "source":       "UN WPP DataPortal API",
    "last_updated": "2026-05-14",
    "countries": {
      "china": {
        "name": "China", "location_id": 156,
        "annual": [{"year": 2000, "pop_18plus": 980000000,
                    "median_age": 30.0}, ...]
      },
      ...
    }
  }
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import logging
import os
from datetime import datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "un_wpp_age.json"

# The UN Population Data Portal API now requires a bearer token — anonymous
# requests get a 401. Register for a free token at
#   https://population.un.org/dataportal/about/dataapi
# and expose it to the scraper via the UN_WPP_TOKEN environment variable
# (in CI, set it as the UN_WPP_TOKEN GitHub Actions secret).
_TOKEN_ENV = "UN_WPP_TOKEN"


def _headers() -> dict[str, str]:
    h = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
    }
    token = os.environ.get(_TOKEN_ENV, "").strip()
    if token:
        # Tolerate the user pasting either the raw token or "Bearer <token>".
        h["Authorization"] = token if token.lower().startswith("bearer ") else f"Bearer {token}"
    return h

# UN M.49 numeric codes
# Master country list — (iso3, display name, UN M49 code). Comprehensive
# coffee-relevant coverage: every notable producing country plus every notable
# consuming market (incl. small ones), grouped by geographic hub so the
# frontend can aggregate. ISO3 is the join key to frontend/lib/countryGroups.ts.
_COUNTRIES = [
    # ── North America ──────────────────────────────────────────────
    ("USA", "United States",  840),
    ("CAN", "Canada",         124),
    ("MEX", "Mexico",         484),
    # ── Nordics ────────────────────────────────────────────────────
    ("SWE", "Sweden",         752),
    ("NOR", "Norway",         578),
    ("DNK", "Denmark",        208),
    ("FIN", "Finland",        246),
    ("ISL", "Iceland",        352),
    # ── Central Europe ─────────────────────────────────────────────
    ("DEU", "Germany",        276),
    ("FRA", "France",         250),
    ("GBR", "United Kingdom",  826),
    ("NLD", "Netherlands",    528),
    ("BEL", "Belgium",         56),
    ("LUX", "Luxembourg",     442),
    ("IRL", "Ireland",        372),
    ("AUT", "Austria",         40),
    ("CHE", "Switzerland",    756),
    ("CZE", "Czechia",        203),
    ("SVK", "Slovakia",       703),
    # ── South Europe ───────────────────────────────────────────────
    ("ITA", "Italy",          380),
    ("ESP", "Spain",          724),
    ("PRT", "Portugal",       620),
    ("GRC", "Greece",         300),
    ("HRV", "Croatia",        191),
    ("SVN", "Slovenia",       705),
    ("SRB", "Serbia",         688),
    ("CYP", "Cyprus",         196),
    ("MLT", "Malta",          470),
    # ── Eastern Europe ─────────────────────────────────────────────
    ("POL", "Poland",         616),
    ("HUN", "Hungary",        348),
    ("ROU", "Romania",        642),
    ("BGR", "Bulgaria",       100),
    ("EST", "Estonia",        233),
    ("LVA", "Latvia",         428),
    ("LTU", "Lithuania",      440),
    ("UKR", "Ukraine",        804),
    # ── Russia & CIS ───────────────────────────────────────────────
    ("RUS", "Russia",         643),
    ("BLR", "Belarus",        112),
    ("KAZ", "Kazakhstan",     398),
    ("AZE", "Azerbaijan",      31),
    ("GEO", "Georgia",        268),
    ("ARM", "Armenia",         51),
    ("UZB", "Uzbekistan",     860),
    ("MDA", "Moldova",        498),
    # ── East Asia ──────────────────────────────────────────────────
    ("CHN", "China",          156),
    ("JPN", "Japan",          392),
    ("KOR", "South Korea",    410),
    ("TWN", "Taiwan",         158),
    ("HKG", "Hong Kong",      344),
    ("MNG", "Mongolia",       496),
    # ── SE Asia & Pacific ──────────────────────────────────────────
    ("IDN", "Indonesia",      360),
    ("VNM", "Vietnam",        704),
    ("THA", "Thailand",       764),
    ("PHL", "Philippines",    608),
    ("MYS", "Malaysia",       458),
    ("SGP", "Singapore",      702),
    ("MMR", "Myanmar",        104),
    ("KHM", "Cambodia",       116),
    ("LAO", "Laos",           418),
    ("TLS", "Timor-Leste",    626),
    ("PNG", "Papua New Guinea", 598),
    ("AUS", "Australia",       36),
    ("NZL", "New Zealand",    554),
    # ── South Asia ─────────────────────────────────────────────────
    ("IND", "India",          356),
    ("PAK", "Pakistan",       586),
    ("BGD", "Bangladesh",      50),
    ("LKA", "Sri Lanka",      144),
    ("NPL", "Nepal",          524),
    # ── Middle East ────────────────────────────────────────────────
    ("TUR", "Turkey",         792),
    ("SAU", "Saudi Arabia",   682),
    ("ARE", "UAE",            784),
    ("QAT", "Qatar",          634),
    ("KWT", "Kuwait",         414),
    ("BHR", "Bahrain",         48),
    ("OMN", "Oman",           512),
    ("YEM", "Yemen",          887),
    ("LBN", "Lebanon",        422),
    ("JOR", "Jordan",         400),
    ("ISR", "Israel",         376),
    ("IRQ", "Iraq",           368),
    ("IRN", "Iran",           364),
    ("SYR", "Syria",          760),
    # ── North Africa ───────────────────────────────────────────────
    ("EGY", "Egypt",          818),
    ("DZA", "Algeria",         12),
    ("MAR", "Morocco",        504),
    ("TUN", "Tunisia",        788),
    ("LBY", "Libya",          434),
    ("SDN", "Sudan",          729),
    # ── Sub-Saharan Africa ─────────────────────────────────────────
    ("ETH", "Ethiopia",       231),
    ("UGA", "Uganda",         800),
    ("KEN", "Kenya",          404),
    ("TZA", "Tanzania",       834),
    ("CIV", "Cote d'Ivoire",  384),
    ("CMR", "Cameroon",       120),
    ("RWA", "Rwanda",         646),
    ("BDI", "Burundi",        108),
    ("COD", "DR Congo",       180),
    ("COG", "Congo",          178),
    ("MDG", "Madagascar",     450),
    ("TGO", "Togo",           768),
    ("GIN", "Guinea",         324),
    ("SLE", "Sierra Leone",   694),
    ("AGO", "Angola",          24),
    ("CAF", "Central African Rep.", 140),
    ("GHA", "Ghana",          288),
    ("NGA", "Nigeria",        566),
    ("ZMB", "Zambia",         894),
    ("ZWE", "Zimbabwe",       716),
    ("MWI", "Malawi",         454),
    ("ZAF", "South Africa",   710),
    ("SEN", "Senegal",        686),
    ("GAB", "Gabon",          266),
    ("LBR", "Liberia",        430),
    # ── Latin America & Caribbean ──────────────────────────────────
    ("BRA", "Brazil",          76),
    ("COL", "Colombia",       170),
    ("HND", "Honduras",       340),
    ("GTM", "Guatemala",      320),
    ("PER", "Peru",           604),
    ("NIC", "Nicaragua",      558),
    ("CRI", "Costa Rica",     188),
    ("SLV", "El Salvador",    222),
    ("ECU", "Ecuador",        218),
    ("VEN", "Venezuela",      862),
    ("BOL", "Bolivia",         68),
    ("PAN", "Panama",         591),
    ("DOM", "Dominican Rep.", 214),
    ("HTI", "Haiti",          332),
    ("CUB", "Cuba",           192),
    ("JAM", "Jamaica",        388),
    ("TTO", "Trinidad & Tobago", 780),
    ("ARG", "Argentina",       32),
    ("CHL", "Chile",          152),
    ("URY", "Uruguay",        858),
    ("PRY", "Paraguay",       600),
]


# ── UN WPP bulk CSV ─────────────────────────────────────────────────────────
# Instead of 134 throttled per-country API calls, download the single bulk
# "population by 5-year age group" CSV (gzipped) and parse it locally. One
# download covers every country/year/age; we keep both-sexes total (PopTotal),
# ages 18+, years 2000-2050, for our country set. WPP CSV values are in
# THOUSANDS, so we scale ×1000 to absolute persons.
_START_YEAR = 2000
_END_YEAR   = 2050
_WANTED_ISO3 = {iso3 for iso3, _n, _m in _COUNTRIES}

# Candidate bulk-file URLs (the exact host path/filename can't be verified from
# the build sandbox, so try several and use whichever responds). Estimates
# (1950-2023) and Medium projection (2024-2100) may be one combined file or two
# split files — we accumulate from all that succeed and dedupe per (iso3,year).
_BULK_BASES = [
    "https://population.un.org/wpp/assets/Excel%20Files/1_Indicators%20(Standard)/CSV_FILES/",
    "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/",
    "https://population.un.org/wpp/Download/Files/1_Indicators%20(Standard)/CSV_FILES/",
]
_BULK_FILES = [
    "WPP2024_PopulationByAge5GroupSex_Medium.csv.gz",
    "WPP2024_PopulationByAge5GroupSex_Medium_1950-2023.csv.gz",
    "WPP2024_PopulationByAge5GroupSex_Medium_2024-2100.csv.gz",
    "WPP2024_PopulationByAge5GroupSex_1950-2023.csv.gz",
    "WPP2024_PopulationByAge5GroupSex_2024-2100.csv.gz",
]


def _pick(row: dict, *names: str):
    """Case-insensitive column lookup across possible header spellings."""
    lower = {k.lower(): v for k, v in row.items()}
    for n in names:
        if n.lower() in lower:
            return lower[n.lower()]
    return None


def _accumulate(url: str, acc: dict, dist: dict, seen: set) -> int:
    """Stream one gzipped CSV and fold its rows into acc[iso3][year] (the 18+
    weighted sum) and dist[iso3][year][age_start] (the full age distribution,
    kept for the whole-population median-age calc). Returns the number of rows
    kept (0 if the file isn't available / not usable)."""
    try:
        r = requests.get(url, headers=_headers(), timeout=120, stream=True)
        if r.status_code != 200:
            logger.info(f"[un_wpp_age] bulk {r.status_code}: {url}")
            return 0
        gz = gzip.GzipFile(fileobj=r.raw)
        reader = csv.DictReader(io.TextIOWrapper(gz, encoding="utf-8-sig"))
    except Exception as e:
        logger.warning(f"[un_wpp_age] bulk fetch failed {url}: {e}")
        return 0

    kept = 0
    for row in reader:
        iso3 = (_pick(row, "ISO3_code", "Iso3", "ISO3") or "").strip().upper()
        if iso3 not in _WANTED_ISO3:
            continue
        variant = str(_pick(row, "Variant") or "").lower()
        if variant and not any(v in variant for v in ("medium", "median", "estimate")):
            continue
        try:
            year = int(float(_pick(row, "Time", "year") or 0))
            age_start = int(float(_pick(row, "AgeGrpStart", "AgeStart") or -1))
            pop_k = float(_pick(row, "PopTotal", "Value") or 0)   # thousands
        except (TypeError, ValueError):
            continue
        if year < _START_YEAR or year > _END_YEAR or age_start < 0:
            continue
        key = (iso3, year, age_start)
        if key in seen:
            continue
        seen.add(key)
        # Full age distribution (all bands) for the median-age computation.
        dist.setdefault(iso3, {}).setdefault(year, {})[age_start] = pop_k
        # 18+ cohort: 15-19 group contributes ages 18-19 = 2/5; every ≥20 is full.
        if age_start >= 15:
            weight = 0.4 if age_start == 15 else 1.0
            acc.setdefault(iso3, {})
            acc[iso3][year] = acc[iso3].get(year, 0.0) + pop_k * weight
        kept += 1

    logger.info(f"[un_wpp_age] bulk OK ({kept} rows kept): {url}")
    return kept


def _median_age(bands: dict[int, float]) -> float | None:
    """Whole-population median age from 5-year age bands ({age_start: pop}).
    Linear interpolation within the band that straddles the 50th percentile."""
    if not bands:
        return None
    total = sum(bands.values())
    if total <= 0:
        return None
    half = total / 2
    cum = 0.0
    for age_start in sorted(bands):
        p = bands[age_start]
        if cum + p >= half:
            frac = (half - cum) / p if p > 0 else 0.0
            return round(age_start + frac * 5, 1)   # 5-yr band width
        cum += p
    return None


def _build_payload() -> dict | None:
    acc: dict[str, dict[int, float]] = {}
    dist: dict[str, dict[int, dict[int, float]]] = {}
    seen: set = set()
    total_kept = 0
    for base in _BULK_BASES:
        for fname in _BULK_FILES:
            total_kept += _accumulate(base + fname, acc, dist, seen)
        if total_kept:
            break   # this base works; no need to try the other host paths

    if not acc:
        logger.warning("[un_wpp_age] no bulk CSV could be downloaded/parsed")
        return None

    countries: dict[str, dict] = {}
    for iso3, name, _m in _COUNTRIES:
        ydata = acc.get(iso3)
        if not ydata:
            logger.warning(f"[un_wpp_age] no data for {iso3}")
            continue
        ddata = dist.get(iso3, {})
        annual = [{"year": y, "pop_18plus": int(round(ydata[y] * 1000)),
                   "median_age": _median_age(ddata.get(y, {}))}
                  for y in sorted(ydata)]
        latest = annual[-1]
        countries[iso3.lower()] = {
            "name":        name,
            "iso3":        iso3,
            "annual":      annual,
            "latest_year": latest["year"],
            "latest_pop":  latest["pop_18plus"],
        }

    if not countries:
        return None
    return {
        "source":       "UN WPP 2024 bulk CSV (5yr age groups, medium variant)",
        "last_updated": datetime.utcnow().date().isoformat(),
        "age_threshold": 18,
        "countries":    countries,
    }


async def run(page, db) -> None:  # noqa: ARG001
    try:
        payload = _build_payload()
        if not payload:
            print("[un_wpp_age] no data fetched — retaining cache")
            return

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

        n = len(payload["countries"])
        print(f"[un_wpp_age] OK: {n}/{len(_COUNTRIES)} countries, 18+ cohort {_START_YEAR}–{_END_YEAR}")

        if db is not None:
            from scraper.db import upsert_news_item
            upsert_news_item(db, {
                "title":    f"UN WPP 18+ Population – {payload['last_updated']}",
                "body":     f"Tracked {n} countries for coffee-drinking-age cohort projection.",
                "source":   "UN WPP",
                "category": "demand",
                "lat":      0.0,
                "lng":      0.0,
                "tags":     ["population", "demand", "un-wpp", "age-cohort"],
                "meta":     json.dumps(payload),
            })
    except Exception as e:
        print(f"[un_wpp_age] FAILED: {e} — retaining cache")


def fetch_latest() -> dict | None:
    if not _CACHE_PATH.exists():
        return None
    try:
        return json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[un_wpp_age] cache read failed: {e}")
        return None
