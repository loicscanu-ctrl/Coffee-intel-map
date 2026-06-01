#!/usr/bin/env python3
"""
compute_weather_analogs.py — weather-analog forecast for Brazilian arabica.

Reads daily weather history (1995-present) and ranks past years by similarity
to the current year's growing-cycle weather signature. For each analog, looks
up next-year coffee production change so the trader sees:

    "Top 5 analogs: 1999 (-12%), 2014 (-7%), 2002 (-44%), 2008 (+31%), 2017 (+34%)
     → ensemble suggests +0.4% next-year arabica production (high dispersion)"

Phenology stages — Brazilian arabica (Cerrado / Sul de Minas profile):

    Stage 1 — Pre-flowering build  (Aug-Sep): break dormancy, prime buds
    Stage 2 — Flowering            (Oct-Nov): pollination + initial set
    Stage 3 — Fruit fill           (Dec-Feb): grand expansion phase
    Stage 4 — Maturation           (Mar-May): bean filling, dries down toward harvest

Each stage produces a (rain_total_mm, mean_temp_C) signature. A "year"'s full
signature is the 8-element vector concatenated across stages. We z-score every
component against the 1995..(current-1) population, then take Euclidean
distance between the current year and each historical year. Top 5 closest =
analogs.

The current year is the in-progress crop-growth window. On 2026-06-01, that
window covers Aug 2025 - May 2026 (the just-completed cycle producing the
2026 harvest), since flowering for the 2027 crop hasn't begun yet. We work
with whatever stages have completed — partial-stage signatures get the
current-year-distance treatment but contribute less to the ranking.

Output: frontend/public/data/weather_analogs_brazil.json
Run nightly from workflow 1.10 (after fetch_origin_weather completes).
"""
from __future__ import annotations

import datetime as dt
import json
import math
import statistics
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HISTORY_PATH = REPO_ROOT / "backend" / "seed" / "weather_history" / "brazil.json"
OUT_PATH     = REPO_ROOT / "frontend" / "public" / "data" / "weather_analogs_brazil.json"

sys.path.insert(0, str(REPO_ROOT / "backend"))
from seed.brazil_arabica_production import BRAZIL_ARABICA_PRODUCTION, yoy_change_pct

# (stage_name, calendar_months_inclusive) — months are 1-based.
# Months > 12 use the next calendar year (the "pre-flowering" stage of the
# 2026 crop is Aug-Sep 2025, while flowering is Oct-Nov 2025 — different
# calendar years but the same crop cycle).
PHENOLOGY: list[tuple[str, list[int]]] = [
    ("pre_flowering", [8, 9]),       # Aug-Sep of crop_year - 1
    ("flowering",     [10, 11]),     # Oct-Nov of crop_year - 1
    ("fruit_fill",    [12, 1, 2]),   # Dec (crop_year - 1) through Feb (crop_year)
    ("maturation",    [3, 4, 5]),    # Mar-May of crop_year
]

# Number of analogs to surface.
N_ANALOGS = 5

# Production-weight the per-province rain/temp into a country-level signature.
# Pulled from the seed config in build_origin_weather.py to keep this script
# standalone (no chart-JSON dependency).
PROD_WEIGHTS_BR = {
    "Sul de Minas":   900,
    "Cerrado":        600,
    "Espírito Santo": 210,   # arabica share only (Caparaó) — conilon excluded
    "Paraná":         100,
}


def _stage_window(stage_months: list[int], crop_year: int) -> list[tuple[int, int]]:
    """For a crop-year (harvest year), return [(calendar_year, month), ...]
    covering the stage's calendar months. Months 8-12 belong to crop_year-1,
    months 1-5 to crop_year. The wrap from Dec → Jan inside fruit_fill is
    handled by inspecting the month number."""
    out = []
    for m in stage_months:
        cal_year = crop_year - 1 if m >= 8 else crop_year
        out.append((cal_year, m))
    return out


def _aggregate_stage(reg_hist: dict, crop_year: int, stage_months: list[int],
                     ) -> tuple[float | None, float | None]:
    """Sum rain + mean temp across the stage's days. Returns (None, None) if
    fewer than 80% of the stage's days have data (so a partial month doesn't
    skew the analog)."""
    total_rain = 0.0
    temp_sum = 0.0
    n_rain = 0
    n_temp = 0
    expected_days = 0
    for cal_year, month in _stage_window(stage_months, crop_year):
        # Days-in-month with leap-year tolerance.
        if month == 2:
            dim = 29 if cal_year % 4 == 0 and (cal_year % 100 != 0 or cal_year % 400 == 0) else 28
        elif month in (1, 3, 5, 7, 8, 10, 12):
            dim = 31
        else:
            dim = 30
        expected_days += dim
        for d in range(1, dim + 1):
            v = reg_hist.get(f"{cal_year}-{month:02d}-{d:02d}")
            if not v:
                continue
            if v.get("rain") is not None:
                total_rain += v["rain"]
                n_rain += 1
            if v.get("tmean") is not None:
                temp_sum += v["tmean"]
                n_temp += 1
    coverage = n_rain / expected_days if expected_days else 0
    if coverage < 0.80:
        return None, None
    return round(total_rain, 1), round(temp_sum / n_temp, 2) if n_temp else None


def build_country_signature(history: dict, crop_year: int,
                            ) -> list[tuple[str, float | None, float | None]]:
    """Prod-weighted (rain, temp) signature per phenology stage for crop_year.
    Returns list of (stage_name, rain_weighted_mm, temp_weighted_C). Either
    component may be None if not enough coverage."""
    out = []
    for stage_name, months in PHENOLOGY:
        rain_sum = 0.0
        rain_w_total = 0
        temp_sum = 0.0
        temp_w_total = 0
        for prov_name, weight in PROD_WEIGHTS_BR.items():
            reg_hist = history["regions"].get(prov_name, {})
            r, t = _aggregate_stage(reg_hist, crop_year, months)
            if r is not None:
                rain_sum += r * weight
                rain_w_total += weight
            if t is not None:
                temp_sum += t * weight
                temp_w_total += weight
        rain_w = round(rain_sum / rain_w_total, 1) if rain_w_total else None
        temp_w = round(temp_sum / temp_w_total, 2) if temp_w_total else None
        out.append((stage_name, rain_w, temp_w))
    return out


def _zscores(values: list[float]) -> list[float]:
    """Mean-0, std-1 transform. Returns 0s for a constant-valued series."""
    m = statistics.fmean(values)
    s = statistics.pstdev(values)
    if s == 0:
        return [0.0] * len(values)
    return [(v - m) / s for v in values]


def main() -> int:
    history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    today = dt.date.today()
    # The "current" crop-cycle = harvest in May-Sep of today.year. So the
    # weather window is Aug today.year-1 → May today.year. If we're past Aug
    # of this year, flowering for NEXT year's crop has started, so we also
    # publish a "next cycle" view.
    cur_crop_year = today.year
    if today.month >= 8:
        cur_crop_year = today.year + 1

    # Compute signatures for every year where the crop cycle is plausibly
    # contained in the history (1996 onwards, since 1995-08 is the earliest
    # stage-1 start the seed supports).
    all_years = sorted({y for prov in history["regions"].values()
                          for y in {int(k[:4]) for k in prov}})
    candidate_years = [y for y in all_years if 1996 <= y <= cur_crop_year]
    if cur_crop_year not in candidate_years:
        candidate_years.append(cur_crop_year)

    signatures: dict[int, list] = {
        y: build_country_signature(history, y) for y in candidate_years
    }

    # Flatten to 8-dim vectors. Years where any stage is None get a partial
    # vector — we'll only use complete-vector years as historical analogs.
    # The current year is allowed to be partial.
    feature_names = []
    for stage_name, _ in PHENOLOGY:
        feature_names.append(f"{stage_name}_rain")
        feature_names.append(f"{stage_name}_temp")

    def flatten(sig: list) -> list[float | None]:
        out: list[float | None] = []
        for _, r, t in sig:
            out.append(r); out.append(t)
        return out

    flat: dict[int, list[float | None]] = {y: flatten(s) for y, s in signatures.items()}

    # Historical-only complete vectors (for z-scoring + ranking)
    historical_years = [y for y in candidate_years
                        if y < cur_crop_year and all(v is not None for v in flat[y])]
    if not historical_years:
        print("[analogs] no complete historical signatures — bailing", file=sys.stderr)
        return 1

    # z-score each feature across the historical population.
    feature_zscores: dict[int, dict[str, float]] = {}
    feature_means: dict[str, float] = {}
    feature_stds:  dict[str, float] = {}
    for i, fname in enumerate(feature_names):
        vals = [flat[y][i] for y in historical_years]  # type: ignore[misc]
        feature_means[fname] = round(statistics.fmean(vals), 2)
        feature_stds[fname]  = round(statistics.pstdev(vals), 2)
        zs = _zscores(vals)
        for y, z in zip(historical_years, zs):
            feature_zscores.setdefault(y, {})[fname] = round(z, 3)

    # Current-year z-scores: use the historical mean/std to project current.
    cur_flat = flat.get(cur_crop_year)
    if cur_flat is None:
        print("[analogs] current year missing from candidates", file=sys.stderr)
        return 1
    cur_z: dict[str, float | None] = {}
    for i, fname in enumerate(feature_names):
        v = cur_flat[i]
        if v is None:
            cur_z[fname] = None
            continue
        s = feature_stds[fname]
        cur_z[fname] = round((v - feature_means[fname]) / s, 3) if s else 0.0

    # Distance: Euclidean on the available (non-None) features. Years with
    # all features present + at least one current-year feature present can
    # be ranked.
    distances: list[tuple[int, float, int]] = []
    for y in historical_years:
        sq = 0.0
        used = 0
        for fname in feature_names:
            cz = cur_z[fname]
            hz = feature_zscores[y][fname]
            if cz is None:
                continue
            sq += (cz - hz) ** 2
            used += 1
        if used == 0:
            continue
        distances.append((y, math.sqrt(sq / used), used))
    distances.sort(key=lambda x: x[1])

    # Top-N analogs, each annotated with both same-cycle and lag-1 crop info.
    # Two interpretations of "analog crop outcome":
    #   • Same cycle: the weather we observed (Aug Y-1 → May Y) actually
    #     produced the year-Y harvest. Most direct read for forecasting
    #     THIS year's crop.
    #   • Lag-1:      what the FOLLOWING crop (year Y+1) did — captures the
    #     biennial cycle (a heavy year drains reserves → next year drops).
    #     This is what the user's "1999 weather → 2000 crop" example points to.
    top_analogs = []
    for analog_year, dist, used in distances[:N_ANALOGS]:
        same_yoy = yoy_change_pct(analog_year)         # analog vs analog-1
        next_yoy = yoy_change_pct(analog_year + 1)     # analog+1 vs analog
        top_analogs.append({
            "year": analog_year,
            "distance": round(dist, 3),
            "features_compared": used,
            # Same-cycle: this is the crop that the analog's weather produced.
            "same_cycle_crop_year": analog_year,
            "same_cycle_production_kbags": BRAZIL_ARABICA_PRODUCTION.get(analog_year),
            "same_cycle_yoy_pct": same_yoy,
            # Lag-1: the next crop after the analog (biennial lookahead).
            "next_crop_year": analog_year + 1,
            "next_crop_production_kbags": BRAZIL_ARABICA_PRODUCTION.get(analog_year + 1),
            "next_crop_yoy_pct": next_yoy,
            "stages": [
                {"name": n, "rain_mm": r, "temp_c": t}
                for (n, r, t) in signatures[analog_year]
            ],
        })

    # Ensemble forecasts. Compute one for each interpretation so the chart
    # can show both side-by-side and the trader picks which lens matters.
    def _ensemble(values: list[float]) -> dict | None:
        clean = [v for v in values if v is not None]
        if not clean:
            return None
        return {
            "mean_pct":   round(statistics.fmean(clean), 1),
            "median_pct": round(statistics.median(clean), 1),
            "stdev_pct":  round(statistics.pstdev(clean), 1) if len(clean) > 1 else 0.0,
            "n":          len(clean),
            "min_pct":    round(min(clean), 1),
            "max_pct":    round(max(clean), 1),
        }
    ensemble_same = _ensemble([a["same_cycle_yoy_pct"] for a in top_analogs])
    ensemble_next = _ensemble([a["next_crop_yoy_pct"] for a in top_analogs])

    out_doc = {
        "_schema": "v1",
        "_note": ("Brazilian arabica weather-analog forecast. Top-N past years ranked "
                  "by Euclidean distance on z-scored (rain, temp) signatures per "
                  "phenology stage. next_crop_yoy_pct = the actual y/y production "
                  "change that followed each analog's weather pattern."),
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "origin": "brazil_arabica",
        "current_crop_year": cur_crop_year,
        "phenology": [{"name": n, "months": m} for (n, m) in PHENOLOGY],
        "feature_means": feature_means,
        "feature_stds":  feature_stds,
        "current_year_signature": [
            {"name": n, "rain_mm": r, "temp_c": t}
            for (n, r, t) in signatures[cur_crop_year]
        ],
        "current_year_z": cur_z,
        "top_analogs": top_analogs,
        "ensemble_same_cycle": ensemble_same,   # 2026-crop forecast (direct)
        "ensemble_lag_one":    ensemble_next,   # 2027-crop forecast (biennial)
        "historical_signatures": [
            {
                "year": y,
                "stages": [
                    {"name": n, "rain_mm": r, "temp_c": t}
                    for (n, r, t) in signatures[y]
                ],
                "production_kbags": BRAZIL_ARABICA_PRODUCTION.get(y),
            }
            for y in historical_years
        ],
        "production_seed_note": (
            "BRAZIL_ARABICA_PRODUCTION is an APPROXIMATE seed from USDA PSD "
            "historical figures (rounded). Replace with real CONAB safra data "
            "for production accuracy."
        ),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[analogs] wrote {OUT_PATH} — {len(top_analogs)} analogs")
    if ensemble_same:
        print(f"  same-cycle ensemble: {ensemble_same['mean_pct']:+.1f}% "
              f"(median {ensemble_same['median_pct']:+.1f}%, "
              f"range [{ensemble_same['min_pct']:+.1f}, {ensemble_same['max_pct']:+.1f}])")
    if ensemble_next:
        print(f"  lag-1 ensemble:      {ensemble_next['mean_pct']:+.1f}% "
              f"(median {ensemble_next['median_pct']:+.1f}%, "
              f"range [{ensemble_next['min_pct']:+.1f}, {ensemble_next['max_pct']:+.1f}])")
    return 0


if __name__ == "__main__":
    sys.exit(main())
