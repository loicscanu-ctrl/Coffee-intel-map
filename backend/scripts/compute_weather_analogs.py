#!/usr/bin/env python3
"""
compute_weather_analogs.py — hedge-fund-grade weather-analog forecast for
Brazilian arabica.

For each phenology stage of the in-progress growing cycle, builds a feature
vector (rain anomaly, temp anomaly, ENSO ONI), z-scores against the
historical population (1996+), then finds the closest past years by
Mahalanobis distance. Each analog is annotated with what actually happened
to the crop, both in the same-cycle and the lag-1 sense.

Method summary:

  Phenology stages (Brazilian arabica, Cerrado/Sul de Minas profile):
    pre-flowering   Aug-Sep    bud break + dormancy break
    flowering       Oct-Nov    pollination + initial set
    fruit-fill      Dec-Feb    grand expansion
    maturation      Mar-May    bean filling + dry-down toward harvest

  Features per stage (5):
    rain_total_mm       prod-weighted across 4 Brazil arabica provinces
    mean_temp_C         prod-weighted
    rain_anom_pct       (rain - 10Y-stage-mean) / 10Y-stage-mean × 100
    temp_anom_C         temp - 10Y-stage-mean
    oni_avg             3-mo ONI averaged across stage months (NOAA CPC)

  Total signature dimensionality: 5 × 4 = 20.

  Detrending: production gets fitted to log(prod) ~ a + b·year, residual
  series used downstream so "1999 vs 2024 yields" aren't confused by the
  +800k bags/decade secular trend. Detrended y/y = analog's residual y/y
  is what the ensemble averages.

  Distance metric: MAHALANOBIS with empirical covariance from historical
  population. Falls back to z-scored Euclidean if covariance is singular
  (rare; only on extremely sparse history). Mahalanobis accounts for
  inter-feature correlation (rain ↔ ENSO ↔ temp) so we don't double-count
  the same underlying signal.

  Bootstrap: 1000 resamples of the top-5 analogs (with replacement) →
  empirical 95% CI on the ensemble forecast.

  Backtest: walk-forward. For each year Y in [2005, cur-1], rebuild the
  analog engine using only years strictly < Y, predict Y's detrended y/y,
  compare to actual. Reports RMSE + directional hit-rate vs two naives:
    naive_zero:   "next year y/y = 0%"
    naive_persist: "next year y/y = previous y/y"

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

# numpy is needed for Mahalanobis. Already a transitive dep through scipy
# (installed in workflow 1.10 for SPI), so no env change required.
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
HISTORY_PATH   = REPO_ROOT / "backend" / "seed" / "weather_history" / "brazil.json"
PROD_SEED_PATH = REPO_ROOT / "backend" / "seed" / "brazil_arabica_production.json"
ONI_PATH       = REPO_ROOT / "backend" / "seed" / "oni_history_full.json"
OUT_PATH       = REPO_ROOT / "frontend" / "public" / "data" / "weather_analogs_brazil.json"

# Load production seed as plain JSON to avoid the backend/seed/__init__.py
# namespace collision with backend/seed.py (used by main.py's SEED_ON_STARTUP).
_PROD_DOC = json.loads(PROD_SEED_PATH.read_text(encoding="utf-8"))
BRAZIL_ARABICA_PRODUCTION: dict[int, int] = {
    int(k): int(v) for k, v in _PROD_DOC["production_kbags"].items()
}

# ONI history: NOAA CPC 3-month running mean of Niño-3.4 SST anomaly,
# anchored on the centre month. > +0.5°C sustained = El Niño, < -0.5°C = La Niña.
_ONI_DOC = json.loads(ONI_PATH.read_text(encoding="utf-8"))
ONI_BY_YM: dict[tuple[int, int], float] = {
    (r["year"], r["month"]): float(r["value"]) for r in _ONI_DOC["oni"]
}

# (stage_name, calendar_months_inclusive) — months are 1-based. Months 8-12
# belong to crop_year-1, months 1-5 to crop_year.
PHENOLOGY: list[tuple[str, list[int]]] = [
    ("pre_flowering", [8, 9]),
    ("flowering",     [10, 11]),
    ("fruit_fill",    [12, 1, 2]),
    ("maturation",    [3, 4, 5]),
]

# Prod weights for the 4 Brazil arabica provinces (arabica share only —
# Espírito Santo's conilon excluded). Matches build_origin_weather.py's
# brazil block.
PROD_WEIGHTS_BR = {
    "Sul de Minas":   900,
    "Cerrado":        600,
    "Espírito Santo": 210,
    "Paraná":         100,
}

N_ANALOGS = 5
N_BOOTSTRAP = 1000
BACKTEST_START = 2005  # First year we have ≥9 prior years to fit on.

FEATURE_NAMES_PER_STAGE = ("rain_mm", "temp_c", "rain_anom_pct", "temp_anom_c", "oni_avg")


# ── Per-stage feature extraction ─────────────────────────────────────────────

def _stage_window(stage_months: list[int], crop_year: int) -> list[tuple[int, int]]:
    """[(calendar_year, month), ...] covering the stage's months for crop_year."""
    return [(crop_year - 1 if m >= 8 else crop_year, m) for m in stage_months]


def _aggregate_stage(reg_hist: dict, crop_year: int, stage_months: list[int],
                     ) -> tuple[float | None, float | None]:
    """(rain_total_mm, mean_temp_C) per-province for one stage of crop_year.
    Returns (None, None) when coverage < 80% (partial month rejection)."""
    total_rain = 0.0
    temp_sum = 0.0
    n_rain = 0
    n_temp = 0
    expected_days = 0
    for cal_year, month in _stage_window(stage_months, crop_year):
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
    return round(total_rain, 1), (round(temp_sum / n_temp, 2) if n_temp else None)


def _oni_for_stage(stage_months: list[int], crop_year: int) -> float | None:
    """Average NOAA ONI across the stage's months. Returns None if any month
    is missing (ONI history starts 1980)."""
    vals = []
    for cal_year, month in _stage_window(stage_months, crop_year):
        v = ONI_BY_YM.get((cal_year, month))
        if v is None:
            return None
        vals.append(v)
    return round(sum(vals) / len(vals), 3) if vals else None


def build_country_signature(history: dict, crop_year: int) -> list[dict]:
    """Per-stage country-level signature (prod-weighted rain + temp + ONI).
    Returns [{name, rain_mm, temp_c, oni_avg}, ...]."""
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
        out.append({
            "name": stage_name,
            "rain_mm": round(rain_sum / rain_w_total, 1) if rain_w_total else None,
            "temp_c":  round(temp_sum / temp_w_total, 2) if temp_w_total else None,
            "oni_avg": _oni_for_stage(months, crop_year),
        })
    return out


def signature_to_vector(sig: list[dict], stage_norms: dict[str, dict]) -> list[float | None]:
    """Flatten signature to a 20-dim feature vector.
    stage_norms[stage_name] = {"rain_mean": x, "temp_mean": y} (from 10Y env)."""
    vec: list[float | None] = []
    for s in sig:
        sn = stage_norms.get(s["name"], {})
        rain = s["rain_mm"]
        temp = s["temp_c"]
        oni  = s["oni_avg"]
        rain_anom = (
            ((rain - sn["rain_mean"]) / sn["rain_mean"] * 100)
            if rain is not None and sn.get("rain_mean") else None
        )
        temp_anom = (
            (temp - sn["temp_mean"])
            if temp is not None and sn.get("temp_mean") is not None else None
        )
        vec.extend([rain, temp, rain_anom, temp_anom, oni])
    return vec


# ── Detrending production data ───────────────────────────────────────────────

def _detrend_log_production(years: list[int], prod: list[int]) -> dict[int, float]:
    """Fit log(prod) ~ a + b·year, return per-year residual (detrended log
    production). The y/y of these residuals strips out the long-run yield
    growth so analog comparisons stay apples-to-apples across decades."""
    if len(years) < 5:
        return {y: 0.0 for y in years}
    xs = np.array(years, dtype=float)
    ys = np.log(np.array(prod, dtype=float))
    b, a = np.polyfit(xs, ys, 1)
    fitted = a + b * xs
    resid = ys - fitted
    return {int(y): float(r) for y, r in zip(years, resid)}


def _detrended_yoy_pct(year: int, detrended: dict[int, float]) -> float | None:
    """Detrended y/y change in %, computed in residual log-space then back
    to a comparable percentage. resid_y - resid_{y-1} ≈ d/dt log(prod/trend),
    so multiplying by 100 gives a percentage interpretation that's comparable
    across decades."""
    if year not in detrended or (year - 1) not in detrended:
        return None
    return round((detrended[year] - detrended[year - 1]) * 100, 1)


# ── Mahalanobis distance ─────────────────────────────────────────────────────

def _mahalanobis_setup(historical_vectors: list[list[float]]) -> tuple[np.ndarray, np.ndarray]:
    """Returns (mean_vec, inv_cov_matrix). Falls back to identity covariance
    if the empirical covariance is singular (very sparse history)."""
    X = np.array(historical_vectors, dtype=float)
    mu = X.mean(axis=0)
    cov = np.cov(X.T)
    # Add tiny ridge (1e-6 × variance) to keep the matrix invertible even
    # when two features are highly collinear.
    cov = cov + np.eye(cov.shape[0]) * np.diag(cov).mean() * 1e-4
    try:
        inv_cov = np.linalg.inv(cov)
    except np.linalg.LinAlgError:
        inv_cov = np.eye(cov.shape[0])
    return mu, inv_cov


def _mahalanobis_dist(x: list[float], y: list[float], inv_cov: np.ndarray) -> float:
    delta = np.array(x, dtype=float) - np.array(y, dtype=float)
    sq = float(delta @ inv_cov @ delta)
    return math.sqrt(max(sq, 0.0))


# ── Bootstrap CI on ensemble forecast ────────────────────────────────────────

def _bootstrap_ci(values: list[float], n_resamples: int = N_BOOTSTRAP,
                   ) -> tuple[float, float] | None:
    """95% empirical CI on the mean of `values`. None for empty input."""
    if not values:
        return None
    rng = np.random.default_rng(seed=42)  # Stable for reproducible nightly runs.
    arr = np.array(values, dtype=float)
    samples = rng.choice(arr, size=(n_resamples, len(arr)), replace=True)
    means = samples.mean(axis=1)
    lo = float(np.percentile(means, 2.5))
    hi = float(np.percentile(means, 97.5))
    return round(lo, 1), round(hi, 1)


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

def _backtest(history: dict, stage_norms: dict[str, dict],
              all_signatures: dict[int, list[dict]],
              detrended_prod: dict[int, float]) -> dict | None:
    """Leave-one-out walk-forward skill assessment. For each year Y in
    [BACKTEST_START, cur-1] that has a complete signature AND production
    data, refit the analog engine using only years < Y, predict Y's
    detrended y/y, compare to actual. Reports model RMSE + hit rate vs
    two naive baselines."""
    eligible = sorted(
        y for y in all_signatures
        if y >= BACKTEST_START
        and y in detrended_prod
        and (y - 1) in detrended_prod
        and all(v is not None for v in signature_to_vector(all_signatures[y], stage_norms))
    )
    if len(eligible) < 5:
        return None
    rows = []
    for target in eligible:
        train_years = [y for y in all_signatures if y < target
                        and all(v is not None for v in signature_to_vector(all_signatures[y], stage_norms))]
        if len(train_years) < 8:
            continue
        train_vecs = [signature_to_vector(all_signatures[y], stage_norms) for y in train_years]
        _, inv_cov = _mahalanobis_setup(train_vecs)  # type: ignore[arg-type]
        target_vec = signature_to_vector(all_signatures[target], stage_norms)
        distances = sorted(
            ((y, _mahalanobis_dist(target_vec, v, inv_cov)) for y, v in zip(train_years, train_vecs)),  # type: ignore[arg-type]
            key=lambda x: x[1],
        )
        # Ensemble forecast = mean of top-N analogs' detrended y/y to year+1.
        analog_yoys = []
        for ay, _ in distances[:N_ANALOGS]:
            yoy = _detrended_yoy_pct(ay, detrended_prod)
            if yoy is not None:
                analog_yoys.append(yoy)
        if not analog_yoys:
            continue
        pred = statistics.fmean(analog_yoys)
        actual = _detrended_yoy_pct(target, detrended_prod)
        if actual is None:
            continue
        rows.append((target, pred, actual))
    if not rows:
        return None

    preds   = np.array([r[1] for r in rows])
    actuals = np.array([r[2] for r in rows])
    rmse_model = float(np.sqrt(np.mean((preds - actuals) ** 2)))

    # Naive 1: y/y = 0 every year.
    rmse_zero = float(np.sqrt(np.mean(actuals ** 2)))

    # Naive 2: y/y = previous y/y (persistence — captures biennial autocorrelation).
    persist_preds = []
    persist_actuals = []
    for target, _, actual in rows:
        prev_yoy = _detrended_yoy_pct(target - 1, detrended_prod)
        if prev_yoy is None:
            continue
        persist_preds.append(prev_yoy)
        persist_actuals.append(actual)
    rmse_persist = (
        float(np.sqrt(np.mean((np.array(persist_preds) - np.array(persist_actuals)) ** 2)))
        if persist_preds else None
    )

    # Directional hit rate: fraction of years where sign(pred) == sign(actual).
    # Zero-naive's directional hit rate is undefined (sign(0) is meaningless)
    # so it's not reported; only model vs persistence is comparable here.
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


# ── Stage normals (10Y env) — needed for anomaly features ────────────────────

def _stage_normals(all_signatures: dict[int, list[dict]],
                    range_years: list[int]) -> dict[str, dict]:
    """For each stage, compute the 10Y rolling mean of rain + temp across
    range_years. Used to compute the anomaly features (rain_anom_pct,
    temp_anom_c) in the signature vector."""
    norms: dict[str, dict] = {}
    for stage_name, _ in PHENOLOGY:
        rains = []
        temps = []
        for y in range_years:
            sig = all_signatures.get(y)
            if not sig:
                continue
            s = next((x for x in sig if x["name"] == stage_name), None)
            if not s:
                continue
            if s["rain_mm"] is not None:
                rains.append(s["rain_mm"])
            if s["temp_c"] is not None:
                temps.append(s["temp_c"])
        norms[stage_name] = {
            "rain_mean": round(sum(rains) / len(rains), 1) if rains else None,
            "temp_mean": round(sum(temps) / len(temps), 2) if temps else None,
        }
    return norms


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    today = dt.date.today()
    cur_crop_year = today.year + 1 if today.month >= 8 else today.year

    # Build signatures for every candidate year (raw stage values).
    all_years = sorted({y for prov in history["regions"].values()
                          for y in {int(k[:4]) for k in prov}})
    candidate_years = [y for y in all_years if 1996 <= y <= cur_crop_year]
    if cur_crop_year not in candidate_years:
        candidate_years.append(cur_crop_year)
    all_signatures: dict[int, list[dict]] = {
        y: build_country_signature(history, y) for y in candidate_years
    }

    # 10Y rolling normals for the anomaly features. Window = [cur-10, cur-1].
    norm_window = [y for y in candidate_years if cur_crop_year - 10 <= y < cur_crop_year]
    stage_norms = _stage_normals(all_signatures, norm_window)

    # Detrended production residuals — strip secular yield growth.
    prod_years = sorted(BRAZIL_ARABICA_PRODUCTION)
    prod_vals  = [BRAZIL_ARABICA_PRODUCTION[y] for y in prod_years]
    detrended  = _detrend_log_production(prod_years, prod_vals)

    # Historical population for distance: years strictly < current with
    # a fully-populated signature vector.
    historical_years = [
        y for y in candidate_years if y < cur_crop_year
        and all(v is not None for v in signature_to_vector(all_signatures[y], stage_norms))
    ]
    if len(historical_years) < 5:
        print("[analogs] insufficient historical signatures (<5)", file=sys.stderr)
        return 1

    historical_vecs = [signature_to_vector(all_signatures[y], stage_norms) for y in historical_years]

    # Mahalanobis covariance from the historical population.
    _, inv_cov = _mahalanobis_setup(historical_vecs)  # type: ignore[arg-type]

    # Current year's vector (may have None entries for incomplete stages).
    cur_vec = signature_to_vector(all_signatures[cur_crop_year], stage_norms)
    # Drop the None positions for distance computation; rebuild a smaller
    # inv_cov for the dimensions that are present.
    present_mask = [v is not None for v in cur_vec]
    if not any(present_mask):
        print("[analogs] current year has no complete stage features", file=sys.stderr)
        return 1
    present_idx = [i for i, p in enumerate(present_mask) if p]
    cur_vec_present = [cur_vec[i] for i in present_idx]
    cov_present_inv = np.linalg.inv(
        np.linalg.inv(inv_cov)[np.ix_(present_idx, present_idx)]
    )

    distances = []
    for y, vec in zip(historical_years, historical_vecs):
        sub = [vec[i] for i in present_idx]
        d = _mahalanobis_dist(cur_vec_present, sub, cov_present_inv)
        distances.append((y, d, len(present_idx)))
    distances.sort(key=lambda x: x[1])

    # Top-N analogs annotated with both production lenses.
    top_analogs = []
    for analog_year, dist, used in distances[:N_ANALOGS]:
        same_yoy_raw  = (
            round((BRAZIL_ARABICA_PRODUCTION[analog_year] - BRAZIL_ARABICA_PRODUCTION[analog_year - 1])
                  / BRAZIL_ARABICA_PRODUCTION[analog_year - 1] * 100, 1)
            if analog_year in BRAZIL_ARABICA_PRODUCTION
            and analog_year - 1 in BRAZIL_ARABICA_PRODUCTION else None
        )
        next_yoy_raw  = (
            round((BRAZIL_ARABICA_PRODUCTION[analog_year + 1] - BRAZIL_ARABICA_PRODUCTION[analog_year])
                  / BRAZIL_ARABICA_PRODUCTION[analog_year] * 100, 1)
            if analog_year + 1 in BRAZIL_ARABICA_PRODUCTION
            and analog_year in BRAZIL_ARABICA_PRODUCTION else None
        )
        same_yoy_det  = _detrended_yoy_pct(analog_year, detrended)
        next_yoy_det  = _detrended_yoy_pct(analog_year + 1, detrended)
        top_analogs.append({
            "year": analog_year,
            "distance": round(dist, 3),
            "features_compared": used,
            "same_cycle_crop_year": analog_year,
            "same_cycle_production_kbags": BRAZIL_ARABICA_PRODUCTION.get(analog_year),
            "same_cycle_yoy_pct": same_yoy_raw,
            "same_cycle_yoy_detrended_pct": same_yoy_det,
            "next_crop_year": analog_year + 1,
            "next_crop_production_kbags": BRAZIL_ARABICA_PRODUCTION.get(analog_year + 1),
            "next_crop_yoy_pct": next_yoy_raw,
            "next_crop_yoy_detrended_pct": next_yoy_det,
            "stages": all_signatures[analog_year],
        })

    # Ensemble forecasts on detrended y/y (the comparable-across-decades view).
    ensemble_same = _ensemble_stats([a["same_cycle_yoy_detrended_pct"] for a in top_analogs])
    ensemble_next = _ensemble_stats([a["next_crop_yoy_detrended_pct"] for a in top_analogs])

    # Walk-forward backtest for credibility.
    backtest = _backtest(history, stage_norms, all_signatures, detrended)

    out_doc = {
        "_schema": "v2",
        "_note": ("Brazilian arabica weather-analog forecast. Mahalanobis distance on "
                  "20-dim (rain, temp, rain anomaly, temp anomaly, ONI) × 4 phenology "
                  "stages. Detrended production residuals for cross-decade comparison. "
                  "Walk-forward backtest for skill assessment."),
        "generated_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "origin": "brazil_arabica",
        "current_crop_year": cur_crop_year,
        "phenology": [{"name": n, "months": m} for (n, m) in PHENOLOGY],
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
                "production_kbags": BRAZIL_ARABICA_PRODUCTION.get(y),
                "detrended_residual": round(detrended.get(y, 0.0), 4),
            }
            for y in historical_years
        ],
        "production_seed_note": _PROD_DOC.get("_source"),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Stdout summary for the cron log.
    print(f"[analogs] wrote {OUT_PATH}")
    print(f"  top {len(top_analogs)} analogs (Mahalanobis distance, 20-dim signature):")
    for a in top_analogs:
        marker = ""
        if a["same_cycle_yoy_detrended_pct"] is not None:
            marker = f"  detrended y/y: same={a['same_cycle_yoy_detrended_pct']:+.1f}%"
            if a["next_crop_yoy_detrended_pct"] is not None:
                marker += f", lag1={a['next_crop_yoy_detrended_pct']:+.1f}%"
        print(f"    {a['year']}: d={a['distance']:.3f}  prod={a['same_cycle_production_kbags']}k{marker}")
    if ensemble_same:
        ci = f" CI95 [{ensemble_same.get('ci95_lo'):+.1f}, {ensemble_same.get('ci95_hi'):+.1f}]" if ensemble_same.get("ci95_lo") is not None else ""
        print(f"  ensemble same-cycle (detrended): {ensemble_same['mean_pct']:+.1f}%{ci}")
    if ensemble_next:
        ci = f" CI95 [{ensemble_next.get('ci95_lo'):+.1f}, {ensemble_next.get('ci95_hi'):+.1f}]" if ensemble_next.get("ci95_lo") is not None else ""
        print(f"  ensemble lag-1     (detrended): {ensemble_next['mean_pct']:+.1f}%{ci}")
    if backtest:
        print(f"  backtest ({backtest['n_years']} years, {backtest['first_year']}-{backtest['last_year']}): "
              f"RMSE model={backtest['rmse_model']}, naive_zero={backtest['rmse_naive_zero']}"
              + (f", persist={backtest['rmse_naive_persist']}" if backtest['rmse_naive_persist'] else ""))
        print(f"           hit rate model={backtest['hit_rate_model']:.2f}"
              + (f", persist={backtest['hit_rate_persist']:.2f}" if backtest['hit_rate_persist'] else ""))
        if backtest.get("skill_vs_zero_pct") is not None:
            print(f"           skill vs zero-naive: {backtest['skill_vs_zero_pct']:+.1f}%")
        if backtest.get("skill_vs_persist_pct") is not None:
            print(f"           skill vs persistence: {backtest['skill_vs_persist_pct']:+.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
