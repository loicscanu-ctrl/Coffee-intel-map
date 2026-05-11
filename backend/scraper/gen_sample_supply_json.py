"""
gen_sample_supply_json.py
Writes sample colombia/honduras/indonesia_supply.json with realistic
historical export figures so the UI can be previewed before scrapers run.
Data is approximate — replace with real ICO data once scrapers are fixed.
"""
import json
import random
from datetime import date, datetime
from pathlib import Path

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

random.seed(42)

# ── helpers ───────────────────────────────────────────────────────────────────

def _months(n=24):
    """Generate last n YYYY-MM strings ending last month."""
    today = date.today()
    months = []
    yr, mo = today.year, today.month - 1
    if mo == 0:
        mo = 12; yr -= 1
    for _ in range(n):
        months.append(f"{yr}-{mo:02d}")
        mo -= 1
        if mo == 0:
            mo = 12; yr -= 1
    return list(reversed(months))


def _monthly_exports(base_k_bags, seasonal_pattern, months):
    """base_k_bags = annual avg monthly volume in thousands of 60-kg bags."""
    by_month = {}
    for m in months:
        mo = int(m.split("-")[1]) - 1  # 0-indexed
        factor = seasonal_pattern[mo]
        noise = random.uniform(0.92, 1.08)
        val = round(base_k_bags * factor * noise, 1)
        by_month[m] = val

    result = []
    for m in months:
        yr, mo = m.split("-")
        prev_year = f"{int(yr)-1}-{mo}"
        prev = by_month.get(prev_year)
        yoy = round((by_month[m] - prev) / prev * 100, 1) if prev else None
        result.append({"month": m, "total_k_bags": by_month[m], "yoy_pct": yoy})
    return result


# ── Colombia ──────────────────────────────────────────────────────────────────
# ~12-13M bags/year; bimodal: peaks Oct-Jan (main) and Apr-Jun (mitaca)
# ~200-1200k bags/month
_CO_PATTERN = [
    0.75,   # Jan — end of main harvest deliveries
    0.55,   # Feb — off-season
    0.60,   # Mar — pre-mitaca
    0.90,   # Apr — mitaca begins
    1.10,   # May — mitaca peak exports
    1.00,   # Jun — mitaca late
    0.80,   # Jul — transition
    0.70,   # Aug — off-season low
    0.85,   # Sep — early main crop
    1.20,   # Oct — main crop peak
    1.30,   # Nov — main crop peak
    1.10,   # Dec — main crop, year-end surge
]


# ── Honduras ──────────────────────────────────────────────────────────────────
# ~7-8M bags/year; single harvest Oct-Feb; exports peak Feb-Jul
# ~500-800k bags/month
_HND_PATTERN = [
    1.15,   # Jan — harvest well underway
    1.25,   # Feb — export peak
    1.20,   # Mar — export peak
    1.10,   # Apr — post-harvest exports
    1.05,   # May — late exports
    0.90,   # Jun — winding down
    0.70,   # Jul — low
    0.65,   # Aug — low
    0.60,   # Sep — lowest
    0.70,   # Oct — new crop begins
    0.90,   # Nov — harvest accelerating
    1.10,   # Dec — harvest peak
]


# ── Indonesia ─────────────────────────────────────────────────────────────────
# ~10-11M bags/year; robusta-dominant; exports relatively stable
# ~700-900k bags/month
_IDN_PATTERN = [
    0.85,   # Jan
    0.80,   # Feb
    0.90,   # Mar
    1.05,   # Apr — Lampung robusta exports ramp
    1.15,   # May
    1.20,   # Jun — dry season, peak Sumatra harvest exports
    1.20,   # Jul
    1.15,   # Aug
    1.00,   # Sep
    0.95,   # Oct — Java harvest
    0.90,   # Nov
    0.85,   # Dec
]


def _build_colombia():
    months = _months(36)
    monthly = _monthly_exports(900, _CO_PATTERN, months)
    # only keep last 24 for output
    monthly = monthly[-24:]
    return {
        "country":    "colombia",
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "exports": {
            "source":       "ICO (sample data)",
            "last_updated": monthly[-1]["month"],
            "unit":         "thousand 60-kg bags",
            "monthly":      monthly,
        },
        "fnc_price": None,
        "weather":   None,
        "enso":      None,
        "mitaca": {
            "current_phase":       "off-season",
            "harvest_window":      "Apr–Jun",
            "flowering_window":    "Sep–Oct",
            "main_crop_harvest":   "Oct–Jan",
            "main_crop_flowering": "Mar–May",
            "description": (
                "Colombia's unique bimodal rainfall pattern enables two crop cycles per year. "
                "The main crop (cosecha principal) harvests Oct–Jan; "
                "the Mitaca (second crop) harvests Apr–Jun."
            ),
        },
    }


def _build_honduras():
    months = _months(36)
    monthly = _monthly_exports(600, _HND_PATTERN, months)
    monthly = monthly[-24:]
    return {
        "country":    "honduras",
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "exports": {
            "source":       "ICO (sample data)",
            "last_updated": monthly[-1]["month"],
            "unit":         "thousand 60-kg bags",
            "monthly":      monthly,
        },
        "ihcafe_price": None,
        "weather":      None,
        "enso":         None,
        "harvest_cal": {
            "harvest":     "Oct–Feb",
            "flowering":   "Apr–Jun",
            "development": "Jul–Sep",
        },
    }


def _build_indonesia():
    months = _months(36)
    monthly = _monthly_exports(780, _IDN_PATTERN, months)
    monthly = monthly[-24:]
    return {
        "country":    "indonesia",
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "exports": {
            "source":       "ICO (sample data)",
            "last_updated": monthly[-1]["month"],
            "unit":         "thousand 60-kg bags",
            "monthly":      monthly,
        },
        "weather": None,
        "enso":    None,
        "harvest_windows": [
            {"island": "Sumatra (Robusta)", "harvest": "Mar–Aug",  "flowering": "Oct–Dec", "crop": "robusta"},
            {"island": "Sumatra (Arabica)", "harvest": "Oct–Mar",  "flowering": "Apr–Jun", "crop": "arabica"},
            {"island": "Java",              "harvest": "Jul–Sep",  "flowering": "Nov–Jan", "crop": "mixed"},
            {"island": "Sulawesi",          "harvest": "Oct–Mar",  "flowering": "Apr–Jun", "crop": "arabica"},
            {"island": "Flores",            "harvest": "Jun–Sep",  "flowering": "Jan–Mar", "crop": "arabica"},
        ],
        "production_mix": {
            "robusta_pct": 75,
            "arabica_pct": 25,
            "note": "Indonesia is the world's 3rd largest robusta producer.",
            "key_regions": {
                "robusta": ["Lampung", "Java"],
                "arabica": ["Gayo", "Toraja", "Flores"],
            },
        },
    }


# ── Uganda ────────────────────────────────────────────────────────────────────
# ~5-6M bags/year; bimodal: main crop Oct-Feb, fly crop Apr-Jun; robusta-dominant
# ~350-550k bags/month
_UGA_PATTERN = [
    1.15,   # Jan — main crop exports still running
    0.95,   # Feb — end of main crop deliveries
    0.65,   # Mar — transition, low
    0.70,   # Apr — fly crop begins
    1.00,   # May — fly crop peak exports
    1.05,   # Jun — late fly crop
    0.65,   # Jul — off-season low
    0.60,   # Aug — off-season
    0.55,   # Sep — pre-main harvest
    0.85,   # Oct — main crop begins
    1.20,   # Nov — main crop peak
    1.30,   # Dec — main crop peak
]


# ── Ethiopia ──────────────────────────────────────────────────────────────────
# ~7-8M bags/year; 100% arabica; main harvest Oct-Jan, exports peak Mar-Jun
# ~500-700k bags/month
_ETH_PATTERN = [
    1.05,   # Jan — late harvest, exports ramping
    1.15,   # Feb — ECX auction volumes high
    1.20,   # Mar — peak export window
    1.20,   # Apr — peak export window
    1.10,   # May — tapering
    0.95,   # Jun — post-harvest lull
    0.70,   # Jul — low
    0.60,   # Aug — lowest
    0.65,   # Sep — new crop flowering
    0.80,   # Oct — harvest begins
    1.00,   # Nov — harvest ramping
    1.10,   # Dec — harvest peak
]


def _build_uganda():
    months = _months(36)
    monthly = _monthly_exports(430, _UGA_PATTERN, months)
    monthly = monthly[-24:]
    return {
        "country":    "uganda",
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "exports": {
            "source":       "ICO (sample data)",
            "last_updated": monthly[-1]["month"],
            "unit":         "thousand 60-kg bags",
            "monthly":      monthly,
        },
        "ucda_price": None,
        "weather":    None,
        "enso":       None,
        "harvest_cal": {
            "main_crop_harvest":   "Oct-Feb",
            "main_crop_flowering": "Apr-Jun",
            "fly_crop_harvest":    "Apr-Jun",
            "fly_crop_flowering":  "Oct-Dec",
            "description": (
                "Uganda has two crop cycles per year. "
                "Main crop harvests Oct-Feb (robusta & arabica); "
                "fly crop (second crop) harvests Apr-Jun. "
                "75% robusta (Screen 15 benchmark), 25% arabica (Mt Elgon, Rwenzori)."
            ),
        },
        "production_mix": {
            "robusta_pct": 75,
            "arabica_pct": 25,
            "note": "Uganda is Africa's leading robusta exporter. Screen 15 is the benchmark grade.",
            "key_regions": {
                "robusta": ["Kasese", "Masaka", "Mbale"],
                "arabica": ["Mt Elgon", "Rwenzori"],
            },
        },
    }


def _build_ethiopia():
    months = _months(36)
    monthly = _monthly_exports(560, _ETH_PATTERN, months)
    monthly = monthly[-24:]
    return {
        "country":    "ethiopia",
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "exports": {
            "source":       "ICO (sample data)",
            "last_updated": monthly[-1]["month"],
            "unit":         "thousand 60-kg bags",
            "monthly":      monthly,
        },
        "ecx_price": None,
        "weather":   None,
        "enso":      None,
        "harvest_cal": {
            "main_crop_harvest":     "Oct-Jan",
            "main_crop_flowering":   "Feb-Apr",
            "second_crop_harvest":   "Mar-May",
            "second_crop_flowering": "Jun-Aug",
            "description": (
                "Ethiopia has a main harvest from October to January across all major regions. "
                "A smaller second crop harvests March-May in some western regions (Kaffa, Limu). "
                "100% arabica; processing includes natural (Harrar, Sidama) and washed (Yirgacheffe, Limu)."
            ),
        },
        "grade_structure": {
            "grades": [
                {"grade": "Grade 1", "quality": "Specialty",  "defects": "0-3",   "regions": "Yirgacheffe, Sidama"},
                {"grade": "Grade 2", "quality": "Specialty",  "defects": "4-12",  "regions": "Sidama, Limu"},
                {"grade": "Grade 3", "quality": "Premium",    "defects": "13-25", "regions": "Jimma, Harrar"},
                {"grade": "Grade 4", "quality": "Commercial", "defects": "26-45", "regions": "Various"},
            ],
            "processing": {
                "natural_pct": 65,
                "washed_pct":  35,
                "note": "Natural (dry) processing dominates in Harrar and Sidama; washed in Yirgacheffe and Limu.",
            },
        },
    }


def main():
    for name, build_fn in [
        ("colombia_supply.json",  _build_colombia),
        ("honduras_supply.json",  _build_honduras),
        ("indonesia_supply.json", _build_indonesia),
        ("uganda_supply.json",    _build_uganda),
        ("ethiopia_supply.json",  _build_ethiopia),
    ]:
        data = build_fn()
        path = OUT_DIR / name
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        n = len(data["exports"]["monthly"])
        print(f"  {name}: {n} months of sample export data")

    print("Done. Note: data is SAMPLE — update ICO URL to get real figures.")


if __name__ == "__main__":
    main()
