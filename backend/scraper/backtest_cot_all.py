"""
Full COT backtest — all 5 categories (MM, PMPU, Swap, Other, NR)
Walk-forward, 104-week warm-up, no look-ahead bias.
Outputs JSON-ready results for CotBacktestReport.tsx.
"""

import json, math, statistics

with open("../../frontend/public/data/cot.json") as f:
    raw = json.load(f)

# ── Build sorted rows ─────────────────────────────────────────────────────────
rows = []
for r in sorted(raw, key=lambda x: x["date"]):
    ny = r.get("ny")
    if not ny:
        continue
    oi    = ny.get("oi_total")
    price = ny.get("price_ny")
    if oi is None or price is None:
        continue
    nets = {}
    skip = False
    for cat, lk, sk in [
        ("mm",    "mm_long",    "mm_short"),
        ("pmpu",  "pmpu_long",  "pmpu_short"),
        ("swap",  "swap_long",  "swap_short"),
        ("other", "other_long", "other_short"),
        ("nr",    "nr_long",    "nr_short"),
    ]:
        l, s = ny.get(lk), ny.get(sk)
        if l is None or s is None:
            skip = True
            break
        nets[cat] = l - s
    if skip:
        continue
    rows.append({"date": r["date"], "oi": oi, "price": price, **nets})

CATS  = ["mm", "pmpu", "swap", "other", "nr"]
WARMUP = 104   # 2 years

# ── OLS helper ────────────────────────────────────────────────────────────────
def ols_beta(xs, ys):
    """Simple OLS slope: beta = Cov(x,y) / Var(x). Intercept ignored (anchored on last known)."""
    n = len(xs)
    if n < 10:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((xs[i] - mx) * (ys[i] - my) for i in range(n)) / n
    var = sum((xs[i] - mx) ** 2 for i in range(n)) / n
    return cov / var if var > 1e-10 else 0.0

# ── Metrics ───────────────────────────────────────────────────────────────────
def metrics(errs):
    n   = len(errs)
    mae  = sum(abs(e) for e in errs) / n
    rmse = math.sqrt(sum(e**2 for e in errs) / n)
    return mae, rmse

def r2(actuals, preds):
    mean_a = sum(actuals) / len(actuals)
    ss_tot = sum((a - mean_a)**2 for a in actuals)
    ss_res = sum((a - p)**2 for a, p in zip(actuals, preds))
    return 1 - ss_res / ss_tot if ss_tot > 1e-10 else 0.0

# ── Walk-forward backtest ─────────────────────────────────────────────────────
results = {}   # cat -> {approach -> {mae, rmse, r2, dir_acc}}

for cat in CATS:
    errs_baseline     = []
    errs_prop_oi      = []
    errs_price_065    = []
    errs_price_cal    = []
    act_all           = []
    pred_baseline_all = []
    pred_prop_all     = []
    pred_065_all      = []
    pred_cal_all      = []
    dir_hits_price    = []   # for directional accuracy across all scenarios

    for t in range(WARMUP, len(rows)):
        prev   = rows[t - 1]
        curr   = rows[t]
        actual = curr[cat]

        net_prev  = prev[cat]
        oi_prev   = prev["oi"]
        oi_curr   = curr["oi"]
        p_prev    = prev["price"]
        p_curr    = curr["price"]
        d_oi      = oi_curr - oi_prev
        sign_p    = 1 if p_curr >= p_prev else -1

        # Baseline
        pred_b = net_prev

        # Proportional OI
        pred_prop = net_prev * oi_curr / oi_prev if oi_prev != 0 else net_prev

        # Price-dir β=0.65
        pred_065 = net_prev + 0.65 * d_oi * sign_p

        # Price-dir β=OLS (rolling 2-year window)
        window = rows[t - WARMUP: t]
        xs = [(window[i]["oi"] - window[i-1]["oi"]) * (1 if window[i]["price"] >= window[i-1]["price"] else -1)
              for i in range(1, len(window))]
        ys = [window[i][cat] - window[i-1][cat] for i in range(1, len(window))]
        beta_cal = ols_beta(xs, ys)
        pred_cal = net_prev + beta_cal * d_oi * sign_p

        errs_baseline.append(actual - pred_b)
        errs_prop_oi.append(actual - pred_prop)
        errs_price_065.append(actual - pred_065)
        errs_price_cal.append(actual - pred_cal)
        act_all.append(actual)
        pred_baseline_all.append(pred_b)
        pred_prop_all.append(pred_prop)
        pred_065_all.append(pred_065)
        pred_cal_all.append(pred_cal)

        # Directional: did price-direction predict sign of ΔNet correctly?
        d_net = actual - net_prev
        expected_sign = sign_p  # price up → we expect net to go up for MM, could be reversed for PMPU
        if d_net != 0:
            dir_hits_price.append(1 if (d_net > 0) == (sign_p > 0) else 0)

    mae_b,   rmse_b   = metrics(errs_baseline)
    mae_p,   rmse_p   = metrics(errs_prop_oi)
    mae_065, rmse_065 = metrics(errs_price_065)
    mae_cal, rmse_cal = metrics(errs_price_cal)

    dir_acc = 100 * sum(dir_hits_price) / len(dir_hits_price) if dir_hits_price else 0

    # Mean absolute weekly change
    changes = [abs(rows[i][cat] - rows[i-1][cat]) for i in range(1, len(rows))]
    mean_abs_chg = sum(changes) / len(changes)
    median_chg   = sorted(changes)[len(changes)//2]
    p90_chg      = sorted(changes)[int(len(changes)*0.90)]

    # Autocorrelation lag-1
    vals = [r[cat] for r in rows]
    acf1_cov = sum((vals[i] - sum(vals)/len(vals)) * (vals[i+1] - sum(vals)/len(vals)) for i in range(len(vals)-1)) / (len(vals)-1)
    acf1_var = sum((v - sum(vals)/len(vals))**2 for v in vals) / len(vals)
    acf1 = acf1_cov / acf1_var if acf1_var > 0 else 0

    # Calibrated beta (full-window estimate for reporting)
    all_xs = [(rows[i]["oi"] - rows[i-1]["oi"]) * (1 if rows[i]["price"] >= rows[i-1]["price"] else -1)
              for i in range(1, len(rows))]
    all_ys = [rows[i][cat] - rows[i-1][cat] for i in range(1, len(rows))]
    beta_full = ols_beta(all_xs, all_ys)

    results[cat] = {
        "n_weeks":         len(errs_baseline),
        "mean_abs_chg":    round(mean_abs_chg),
        "median_chg":      round(median_chg),
        "p90_chg":         round(p90_chg),
        "acf1":            round(acf1, 4),
        "beta_calibrated": round(beta_full, 4),
        "dir_acc_price":   round(dir_acc, 1),
        "baseline": {"mae": round(mae_b),   "rmse": round(rmse_b),   "r2": round(r2(act_all, pred_baseline_all), 4)},
        "prop_oi":  {"mae": round(mae_p),   "rmse": round(rmse_p),   "r2": round(r2(act_all, pred_prop_all), 4)},
        "price_065":{"mae": round(mae_065), "rmse": round(rmse_065), "r2": round(r2(act_all, pred_065_all), 4)},
        "price_cal":{"mae": round(mae_cal), "rmse": round(rmse_cal), "r2": round(r2(act_all, pred_cal_all), 4)},
    }

    print(f"\n{'='*60}")
    print(f"  {cat.upper():6s}  (n={results[cat]['n_weeks']}, acf1={results[cat]['acf1']}, β_cal={results[cat]['beta_calibrated']})")
    print(f"  Mean |ΔNet|: {results[cat]['mean_abs_chg']:,}  Median: {results[cat]['median_chg']:,}  P90: {results[cat]['p90_chg']:,}")
    print(f"  Dir acc (price signal): {results[cat]['dir_acc_price']}%")
    print(f"  {'Approach':<20} {'MAE':>8} {'RMSE':>8} {'R²':>8}")
    for ap in ['baseline','prop_oi','price_065','price_cal']:
        m = results[cat][ap]
        flag = " ★" if m['mae'] == min(results[cat][a]['mae'] for a in ['baseline','prop_oi','price_065','price_cal']) else ""
        print(f"  {ap:<20} {m['mae']:>8,} {m['rmse']:>8,} {m['r2']:>8.4f}{flag}")

print("\n\n=== JSON output for frontend ===")
print(json.dumps(results, indent=2))
