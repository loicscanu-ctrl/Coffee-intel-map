#!/usr/bin/env python3
"""
compute_weather_analogs.py — weather-analog forecasting for all 3 robusta /
arabica producing regions where we have enough data: Brazil arabica,
Vietnam robusta, Indonesia robusta. Same architecture per origin, different
phenology + production seed.

Per-stage signature (6 features × 4 stages = 24 dim):
    rain_mm         prod-weighted total
    temp_c          prod-weighted mean
    rain_anom_pct   (rain - 10Y mean) / 10Y mean × 100
    spi_z           z-score of stage rain across historical population
    spei_z          z-score of stage (rain - et0) across historical population
    oni_avg         NOAA CPC 3-mo Niño-3.4 anomaly averaged over stage

Distance: Mahalanobis on z-scored historical features (with ridge), Top-N
closest. Detrended (log-linear) production y/y for cross-decade comparison.
Walk-forward backtest for skill assessment. Bootstrap 95% CI on ensemble.

Output: frontend/public/data/weather_analogs_{origin}.json
"""
from __future__ import annotations

import datetime as dt
import json
import math
import statistics
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
HISTORY_DIR = REPO_ROOT / "backend" / "seed" / "weather_history"
SEED_DIR    = REPO_ROOT / "backend" / "seed"
OUT_DIR     = REPO_ROOT / "frontend" / "public" / "data"
ONI_PATH    = SEED_DIR / "oni_history_full.json"

# ONI history: NOAA CPC 3-month running mean of Niño-3.4 SST anomaly.
_ONI_DOC = json.loads(ONI_PATH.read_text(encoding="utf-8"))
ONI_BY_YM: dict[tuple[int, int], float] = {
    (r["year"], r["month"]): float(r["value"]) for r in _ONI_DOC["oni"]
}

# Per-origin configuration. Phenology stages are (name, [calendar_months]);
# months ≥ 8 belong to crop_year - 1, months < 8 to crop_year, for the
# southern-hemisphere flows (Brazil + Indonesia south of equator). Vietnam
# robusta has a different alignment — its harvest peak straddles the
# year boundary (Nov-Jan), so its stages stay in calendar-year-Y for the
# crop being harvested in Nov Y.
ORIGIN_CONFIGS = {
    "brazil_arabica": {
        "label": "Brazil arabica",
        "history_file":   "brazil.json",
        "prod_seed_file": "brazil_arabica_production.json",
        "out_file":       "weather_analogs_brazil.json",
        # Brazilian arabica: harvest May-Sep of year Y, weather Aug Y-1 → May Y.
        "phenology": [
            ("pre_flowering", [8, 9]),       # Aug-Sep of (Y-1)
            ("flowering",     [10, 11]),     # Oct-Nov of (Y-1)
            ("fruit_fill",    [12, 1, 2]),   # Dec (Y-1) — Feb (Y)
            ("maturation",    [3, 4, 5]),    # Mar-May of (Y)
        ],
        "stage_anchor": "southern_hemisphere",  # months ≥ 8 → Y-1
        # Production weights (arabica share only; Espírito Santo's conilon excluded).
        "prod_weights": {
            "Sul de Minas":   900,
            "Cerrado":        600,
            "Espírito Santo": 210,
            "Paraná":         100,
        },
    },
    "vietnam_robusta": {
        "label": "Vietnam robusta",
        "history_file":   "vn.json",
        "prod_seed_file": "vietnam_robusta_production.json",
        "out_file":       "weather_analogs_vietnam.json",
        # Vietnam robusta Central Highlands: harvest Nov-Jan of marketing
        # year Y → Y+1. The weather window driving that crop is roughly
        # Dec(Y-1) for pre-flowering rain trigger through Oct(Y) maturation.
        # We key the analog by harvest-start year (Nov Y = crop_year Y).
        "phenology": [
            ("pre_flowering", [12, 1]),  # Dec (Y-1) — Jan (Y): dry-rest
            ("flowering",     [2, 3]),   # Feb-Mar (Y): bloom triggered by post-dry rain
            ("fruit_fill",    [4, 5, 6, 7]),  # Apr-Jul (Y): main wet season
            ("maturation",    [8, 9, 10]),    # Aug-Oct (Y): rain tapers, prep for harvest
        ],
        "stage_anchor": "calendar_year",  # month 12 → Y-1, rest → Y
        # USDA AEKI 2024 regional weights (robusta share — Vietnam is ~95%
        # robusta so use total prod for all 5 regions).
        "prod_weights": {
            "Dak Lak":  480,
            "Lam Dong": 580,
            "Dak Nong": 500,
            "Gia Lai":  320,
            "Kon Tum":  120,
        },
    },
    "indonesia_robusta": {
        "label": "Indonesia robusta",
        "history_file":   "indonesia.json",
        "prod_seed_file": "indonesia_robusta_production.json",
        "out_file":       "weather_analogs_indonesia.json",
        # Indonesia robusta (Lampung-dominant, Sumatra southern): harvest
        # May-Aug Y. Weather window: Sep(Y-1) through Apr(Y). Equatorial
        # so seasonality is less pronounced, but Lampung does have a clear
        # dry-wet cycle.
        "phenology": [
            ("pre_flowering", [9, 10]),    # Sep-Oct (Y-1): post-dry recovery
            ("flowering",     [11, 12]),   # Nov-Dec (Y-1): wet-season trigger
            ("fruit_fill",    [1, 2, 3]),  # Jan-Mar (Y): peak monsoon
            ("maturation",    [4]),         # Apr (Y): single-month dry-down toward harvest
        ],
        "stage_anchor": "southern_hemisphere",  # months ≥ 8 → Y-1
        # Robusta share only — Indonesia has both, the analog framework
        # treats robusta-dominant Lampung + Java's robusta + Toraja's small share.
        "prod_weights": {
            "Lampung": 350,   # robusta-dominant
            "Java":    80,    # robusta-dominant on Java
            # Gayo/Toraja/Flores are arabica — excluded here so the signature
            # tracks the robusta-producing weather actually.
        },
    },
}

N_ANALOGS = 5
N_BOOTSTRAP = 1000
BACKTEST_START = 2005


def _dim(year: int, month: int) -> int:
    if month == 2:
        return 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28
    if month in (1, 3, 5, 7, 8, 10, 12):
        return 31
    return 30


def _stage_window(stage_months: list[int], crop_year: int, anchor: str) -> list[tuple[int, int]]:
    """For a crop-year (harvest year), return [(calendar_year, month), ...]
    covering the stage's calendar months.
    anchor == "southern_hemisphere": months ≥ 8 belong to crop_year-1.
    anchor == "calendar_year":       month 12 belongs to crop_year-1, rest to crop_year."""
    out = []
    for m in stage_months:
        if anchor == "southern_hemisphere":
            cy = crop_year - 1 if m >= 8 else crop_year
        elif anchor == "calendar_year":
            cy = crop_year - 1 if m == 12 else crop_year
        else:
            cy = crop_year
        out.append((cy, m))
    return out


def _aggregate_stage(reg_hist: dict, crop_year: int, stage_months: list[int],
                     anchor: str) -> tuple[float | None, float | None, float | None]:
    """Returns (rain_total_mm, mean_temp_C, et0_total_mm) for one province
    in one stage. Rejects when rain coverage < 80% of expected days."""
    total_rain = 0.0
    temp_sum = 0.0
    et0_total = 0.0
    n_rain = n_temp = n_et0 = 0
    expected_days = 0
    for cal_year, month in _stage_window(stage_months, crop_year, anchor):
        dim = _dim(cal_year, month)
        expected_days += dim
        for d in range(1, dim + 1):
            v = reg_hist.get(f"{cal_year}-{month:02d}-{d:02d}")
            if not v:
                continue
            if v.get("rain") is not None:
                total_rain += v["rain"]; n_rain += 1
            if v.get("tmean") is not None:
                temp_sum += v["tmean"]; n_temp += 1
            if v.get("et0") is not None:
                et0_total += v["et0"]; n_et0 += 1
    coverage = n_rain / expected_days if expected_days else 0
    if coverage < 0.80:
        return None, None, None
    return (
        round(total_rain, 1),
        round(temp_sum / n_temp, 2) if n_temp else None,
        round(et0_total, 1) if n_et0 / expected_days >= 0.80 else None,
    )


def _oni_for_stage(stage_months: list[int], crop_year: int, anchor: str) -> float | None:
    vals = []
    for cal_year, month in _stage_window(stage_months, crop_year, anchor):
        v = ONI_BY_YM.get((cal_year, month))
        if v is None:
            return None
        vals.append(v)
    return round(sum(vals) / len(vals), 3) if vals else None


def build_country_signature(history: dict, crop_year: int,
                            phenology, anchor: str,
                            prod_weights: dict[str, int]) -> list[dict]:
    """Per-stage prod-weighted (rain, temp, et0, ONI) for the country."""
    out = []
    for stage_name, months in phenology:
        rain_sum = temp_sum = et0_sum = 0.0
        rain_w = temp_w = et0_w = 0
        for prov_name, weight in prod_weights.items():
            reg_hist = history["regions"].get(prov_name, {})
            r, t, e = _aggregate_stage(reg_hist, crop_year, months, anchor)
            if r is not None:
                rain_sum += r * weight; rain_w += weight
            if t is not None:
                temp_sum += t * weight; temp_w += weight
            if e is not None:
                et0_sum += e * weight; et0_w += weight
        out.append({
            "name": stage_name,
            "rain_mm": round(rain_sum / rain_w, 1) if rain_w else None,
            "temp_c":  round(temp_sum / temp_w, 2) if temp_w else None,
            "et0_mm":  round(et0_sum / et0_w, 1) if et0_w else None,
            "oni_avg": _oni_for_stage(months, crop_year, anchor),
        })
    return out


# ── Feature engineering: enrich raw signature with anomalies, SPI, SPEI ──

def enrich_signature(sig: list[dict], stage_norms: dict[str, dict]) -> list[dict]:
    """Add rain_anom_pct, spi_z, spei_z, temp_anom_c to each stage entry.
    stage_norms[name] = {rain_mean, rain_std, temp_mean, water_balance_mean,
    water_balance_std} computed across the historical population."""
    enriched = []
    for s in sig:
        sn = stage_norms.get(s["name"], {})
        rain = s.get("rain_mm")
        temp = s.get("temp_c")
        et0  = s.get("et0_mm")
        rain_anom = (
            ((rain - sn["rain_mean"]) / sn["rain_mean"] * 100)
            if rain is not None and sn.get("rain_mean") else None
        )
        # SPI (proxy): z-score of stage rain across historical population.
        # Proper gamma-fit SPI requires scipy, but z-score on log-rain is a
        # close-enough approximation for analog ranking + display.
        spi_z = (
            ((rain - sn["rain_mean"]) / sn["rain_std"])
            if rain is not None and sn.get("rain_std") else None
        )
        # SPEI: z-score of (rain - et0). When et0 missing, fall back to None.
        wb = (rain - et0) if rain is not None and et0 is not None else None
        spei_z = (
            ((wb - sn["wb_mean"]) / sn["wb_std"])
            if wb is not None and sn.get("wb_std") else None
        )
        temp_anom = (
            (temp - sn["temp_mean"])
            if temp is not None and sn.get("temp_mean") is not None else None
        )
        enriched.append({
            **s,
            "rain_anom_pct": round(rain_anom, 1) if rain_anom is not None else None,
            "temp_anom_c":   round(temp_anom, 2) if temp_anom is not None else None,
            "spi_z":         round(spi_z,  3) if spi_z  is not None else None,
            "spei_z":        round(spei_z, 3) if spei_z is not None else None,
        })
    return enriched


def signature_to_vector(sig: list[dict]) -> list[float | None]:
    """Flatten enriched signature → 24-dim feature vector for distance metric.
    Order per stage: rain_mm, temp_c, rain_anom_pct, spi_z, spei_z, oni_avg."""
    vec: list[float | None] = []
    for s in sig:
        vec.extend([
            s.get("rain_mm"),
            s.get("temp_c"),
            s.get("rain_anom_pct"),
            s.get("spi_z"),
            s.get("spei_z"),
            s.get("oni_avg"),
        ])
    return vec


def _stage_population_stats(all_signatures: dict[int, list[dict]],
                            range_years: list[int]) -> dict[str, dict]:
    """Mean + std of stage rain, temp, and water-balance across the 10Y
    rolling normal window. Drives the anomaly + SPI + SPEI features."""
    norms: dict[str, dict] = {}
    stage_names = [s["name"] for s in next(iter(all_signatures.values()))]
    for stage_name in stage_names:
        rains, temps, wbs = [], [], []
        for y in range_years:
            sig = all_signatures.get(y)
            if not sig:
                continue
            s = next((x for x in sig if x["name"] == stage_name), None)
            if not s:
                continue
            if s.get("rain_mm") is not None:
                rains.append(s["rain_mm"])
            if s.get("temp_c") is not None:
                temps.append(s["temp_c"])
            if s.get("rain_mm") is not None and s.get("et0_mm") is not None:
                wbs.append(s["rain_mm"] - s["et0_mm"])
        norms[stage_name] = {
            "rain_mean": round(statistics.fmean(rains), 1) if rains else None,
            "rain_std":  round(statistics.pstdev(rains), 1) if len(rains) > 1 else None,
            "temp_mean": round(statistics.fmean(temps), 2) if temps else None,
            "temp_std":  round(statistics.pstdev(temps), 2) if len(temps) > 1 else None,
            "wb_mean":   round(statistics.fmean(wbs), 1) if wbs else None,
            "wb_std":    round(statistics.pstdev(wbs), 1) if len(wbs) > 1 else None,
        }
    return norms


# ── Detrending ───────────────────────────────────────────────────────────────

def _detrend_log_production(prod: dict[int, int]) -> dict[int, float]:
    years = sorted(prod)
    if len(years) < 5:
        return {y: 0.0 for y in years}
    xs = np.array(years, dtype=float)
    ys = np.log(np.array([prod[y] for y in years], dtype=float))
    b, a = np.polyfit(xs, ys, 1)
    fitted = a + b * xs
    return {int(y): float(yy - ff) for y, yy, ff in zip(years, ys, fitted)}


def _detrended_yoy_pct(year: int, detrended: dict[int, float]) -> float | None:
    if year not in detrended or (year - 1) not in detrended:
        return None
    return round((detrended[year] - detrended[year - 1]) * 100, 1)


# ── Mahalanobis distance ─────────────────────────────────────────────────────

def _mahalanobis_setup(historical_vectors: list[list[float]]) -> np.ndarray:
    X = np.array(historical_vectors, dtype=float)
    cov = np.cov(X.T)
    cov = cov + np.eye(cov.shape[0]) * np.diag(cov).mean() * 1e-4
    try:
        return np.linalg.inv(cov)
    except np.linalg.LinAlgError:
        return np.eye(cov.shape[0])


def _mahalanobis_dist(x: list[float], y: list[float], inv_cov: np.ndarray) -> float:
    delta = np.array(x, dtype=float) - np.array(y, dtype=float)
    sq = float(delta @ inv_cov @ delta)
    return math.sqrt(max(sq, 0.0))


def _bootstrap_ci(values: list[float], n_resamples: int = N_BOOTSTRAP,
                   ) -> tuple[float, float] | None:
    if not values:
        return None
    rng = np.random.default_rng(seed=42)
    arr = np.array(values, dtype=float)
    samples = rng.choice(arr, size=(n_resamples, len(arr)), replace=True)
    means = samples.mean(axis=1)
    return round(float(np.percentile(means, 2.5)), 1), round(float(np.percentile(means, 97.5)), 1)


def _ensemble_stats(values: list[float | None]) -> dict | None:
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    ci = _bootstrap_ci(clean)
    return {
        "mean_pct":   round(statistics.fmean(clean), 1),
        "median_pct": round(statistics.median(clean), 1),
        "stdev_pct":  round(statistics.pstdev(clean), 1) if len(clean) > 1 else 0.0,
        "n":          len(clean),
        "min_pct":    round(min(clean), 1),
        "max_pct":    round(max(clean), 1),
        "ci95_lo":    ci[0] if ci else None,
        "ci95_hi":    ci[1] if ci else None,
    }


# ── Walk-forward backtest ────────────────────────────────────────────────────

def _backtest(all_signatures: dict[int, list[dict]],
              detrended: dict[int, float],
              candidate_years: list[int]) -> dict | None:
    """For each year Y in [BACKTEST_START, cur-1] with complete signature
    AND production data, refit using only years < Y, predict, compare."""
    eligible = sorted(y for y in candidate_years if y >= BACKTEST_START
                      and y in detrended and (y - 1) in detrended)
    if len(eligible) < 5:
        return None
    rows = []
    for target in eligible:
        train_years = sorted(y for y in candidate_years
                              if y < target
                              and all(v is not None for v in signature_to_vector(all_signatures[y])))
        if len(train_years) < 8:
            continue
        train_vecs = [signature_to_vector(all_signatures[y]) for y in train_years]
        inv_cov = _mahalanobis_setup(train_vecs)  # type: ignore[arg-type]
        target_vec = signature_to_vector(all_signatures[target])
        if any(v is None for v in target_vec):
            continue
        distances = sorted(
            ((y, _mahalanobis_dist(target_vec, v, inv_cov)) for y, v in zip(train_years, train_vecs)),  # type: ignore[arg-type]
            key=lambda x: x[1],
        )
        analog_yoys = [
            _detrended_yoy_pct(ay, detrended)
            for ay, _ in distances[:N_ANALOGS]
        ]
        analog_yoys = [y for y in analog_yoys if y is not None]
        if not analog_yoys:
            continue
        pred = statistics.fmean(analog_yoys)
        actual = _detrended_yoy_pct(target, detrended)
        if actual is None:
            continue
        rows.append((target, pred, actual))
    if not rows:
        return None

    preds   = np.array([r[1] for r in rows])
    actuals = np.array([r[2] for r in rows])
    rmse_model = float(np.sqrt(np.mean((preds - actuals) ** 2)))
    rmse_zero  = float(np.sqrt(np.mean(actuals ** 2)))

    persist_preds, persist_actuals = [], []
    for target, _, actual in rows:
        prev = _detrended_yoy_pct(target - 1, detrended)
        if prev is not None:
            persist_preds.append(prev)
            persist_actuals.append(actual)
    rmse_persist = (
        float(np.sqrt(np.mean((np.array(persist_preds) - np.array(persist_actuals)) ** 2)))
        if persist_preds else None
    )

    hit_model = float(np.mean(np.sign(preds) == np.sign(actuals)))
    hit_persist = (
        float(np.mean(np.sign(np.array(persist_preds)) == np.sign(np.array(persist_actuals))))
        if persist_preds else None
    )

    return {
        "n_years": len(rows),
        "first_year": int(rows[0][0]),
        "last_year": int(rows[-1][0]),
        "rmse_model":   round(rmse_model, 2),
        "rmse_naive_zero":    round(rmse_zero, 2),
        "rmse_naive_persist": round(rmse_persist, 2) if rmse_persist else None,
        "hit_rate_model":    round(hit_model, 3),
        "hit_rate_persist":  round(hit_persist, 3) if hit_persist else None,
        "skill_vs_zero_pct": round((1 - rmse_model / rmse_zero) * 100, 1) if rmse_zero else None,
        "skill_vs_persist_pct": (
            round((1 - rmse_model / rmse_persist) * 100, 1)
            if rmse_persist else None
        ),
        "per_year_predictions": [
            {"year": int(y), "pred_pct": round(p, 1), "actual_pct": round(a, 1)}
            for y, p, a in rows
        ],
    }


# ── Per-origin runner ────────────────────────────────────────────────────────

def run_for_origin(origin_key: str, cfg: dict) -> int:
    """Execute the analog engine for one origin config."""
    history_path = HISTORY_DIR / cfg["history_file"]
    if not history_path.exists():
        print(f"[{origin_key}] no history file at {history_path} — skipping", file=sys.stderr)
        return 0

    history = json.loads(history_path.read_text(encoding="utf-8"))
    prod_doc = json.loads((SEED_DIR / cfg["prod_seed_file"]).read_text(encoding="utf-8"))
    prod = {int(k): int(v) for k, v in prod_doc["production_kbags"].items()}

    today = dt.date.today()
    cur_crop_year = today.year + 1 if today.month >= 8 else today.year

    all_years = sorted({y for prov in history["regions"].values()
                          for y in {int(k[:4]) for k in prov}})
    candidate_years = [y for y in all_years if 1996 <= y <= cur_crop_year]
    if cur_crop_year not in candidate_years:
        candidate_years.append(cur_crop_year)

    raw_signatures = {
        y: build_country_signature(history, y, cfg["phenology"], cfg["stage_anchor"], cfg["prod_weights"])
        for y in candidate_years
    }

    # 10Y rolling window for the population stats.
    norm_window = [y for y in candidate_years if cur_crop_year - 10 <= y < cur_crop_year]
    stage_norms = _stage_population_stats(raw_signatures, norm_window)

    all_signatures = {
        y: enrich_signature(sig, stage_norms) for y, sig in raw_signatures.items()
    }

    detrended = _detrend_log_production(prod)

    historical_years = [
        y for y in candidate_years if y < cur_crop_year
        and all(v is not None for v in signature_to_vector(all_signatures[y]))
    ]
    if len(historical_years) < 5:
        print(f"[{origin_key}] insufficient historical signatures ({len(historical_years)})", file=sys.stderr)
        return 1

    historical_vecs = [signature_to_vector(all_signatures[y]) for y in historical_years]
    inv_cov_full = _mahalanobis_setup(historical_vecs)  # type: ignore[arg-type]

    cur_vec = signature_to_vector(all_signatures[cur_crop_year])
    present_idx = [i for i, v in enumerate(cur_vec) if v is not None]
    if not present_idx:
        print(f"[{origin_key}] current year has no features yet", file=sys.stderr)
        return 1
    cov_full = np.linalg.inv(inv_cov_full)
    cov_present_inv = np.linalg.inv(cov_full[np.ix_(present_idx, present_idx)])
    cur_present = [cur_vec[i] for i in present_idx]

    distances = []
    for y, vec in zip(historical_years, historical_vecs):
        sub = [vec[i] for i in present_idx]
        d = _mahalanobis_dist(cur_present, sub, cov_present_inv)
        distances.append((y, d, len(present_idx)))
    distances.sort(key=lambda x: x[1])

    top_analogs = []
    for analog_year, dist, used in distances[:N_ANALOGS]:
        same_yoy_raw = (
            round((prod[analog_year] - prod[analog_year - 1]) / prod[analog_year - 1] * 100, 1)
            if analog_year in prod and analog_year - 1 in prod else None
        )
        next_yoy_raw = (
            round((prod[analog_year + 1] - prod[analog_year]) / prod[analog_year] * 100, 1)
            if analog_year + 1 in prod and analog_year in prod else None
        )
        top_analogs.append({
            "year": analog_year,
            "distance": round(dist, 3),
            "features_compared": used,
            "same_cycle_crop_year": analog_year,
            "same_cycle_production_kbags": prod.get(analog_year),
            "same_cycle_yoy_pct": same_yoy_raw,
            "same_cycle_yoy_detrended_pct": _detrended_yoy_pct(analog_year, detrended),
            "next_crop_year": analog_year + 1,
            "next_crop_production_kbags": prod.get(analog_year + 1),
            "next_crop_yoy_pct": next_yoy_raw,
            "next_crop_yoy_detrended_pct": _detrended_yoy_pct(analog_year + 1, detrended),
            "stages": all_signatures[analog_year],
        })

    ensemble_same = _ensemble_stats([a["same_cycle_yoy_detrended_pct"] for a in top_analogs])
    ensemble_next = _ensemble_stats([a["next_crop_yoy_detrended_pct"] for a in top_analogs])

    backtest = _backtest(all_signatures, detrended, historical_years)

    out_doc = {
        "_schema": "v3",
        "_note": (f"{cfg['label']} weather-analog forecast. Mahalanobis on 24-dim "
                  "(rain, temp, rain_anom, SPI z, SPEI z, ONI) × 4 phenology stages. "
                  "Detrended production residuals. Walk-forward backtest. "
                  "Bootstrap 95% CI on ensemble."),
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "origin": origin_key,
        "origin_label": cfg["label"],
        "current_crop_year": cur_crop_year,
        "phenology": [{"name": n, "months": m} for (n, m) in cfg["phenology"]],
        "stage_normals_10y": stage_norms,
        "current_year_signature": all_signatures[cur_crop_year],
        "top_analogs": top_analogs,
        "ensemble_same_cycle":  ensemble_same,
        "ensemble_lag_one":     ensemble_next,
        "backtest": backtest,
        "historical_signatures": [
            {
                "year": y,
                "stages": all_signatures[y],
                "production_kbags": prod.get(y),
                "detrended_residual": round(detrended.get(y, 0.0), 4),
            }
            for y in historical_years
        ],
        "production_seed_note": prod_doc.get("_replace_when"),
    }
    out_path = OUT_DIR / cfg["out_file"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[{origin_key}] wrote {out_path}")
    print(f"  top {len(top_analogs)} analogs:")
    for a in top_analogs:
        det = f" detrended y/y: same={a['same_cycle_yoy_detrended_pct']:+.1f}%" if a['same_cycle_yoy_detrended_pct'] is not None else ""
        print(f"    {a['year']}: d={a['distance']:.3f}{det}")
    if ensemble_same:
        ci = f" CI95 [{ensemble_same.get('ci95_lo'):+.1f}, {ensemble_same.get('ci95_hi'):+.1f}]" if ensemble_same.get("ci95_lo") is not None else ""
        print(f"  ensemble same-cycle: {ensemble_same['mean_pct']:+.1f}%{ci}")
    if backtest:
        print(f"  backtest ({backtest['n_years']} years): RMSE model={backtest['rmse_model']}, "
              f"vs zero={backtest['rmse_naive_zero']}, vs persist={backtest['rmse_naive_persist']}; "
              f"hit rate={backtest['hit_rate_model']:.2f}")
    return 0


def main() -> int:
    rc = 0
    for origin_key, cfg in ORIGIN_CONFIGS.items():
        rc |= run_for_origin(origin_key, cfg)
    return rc


if __name__ == "__main__":
    sys.exit(main())
