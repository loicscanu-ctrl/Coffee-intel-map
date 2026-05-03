"""
Extended COT backtest — richer evaluation metrics.
Adds: bias, error percentiles, directional accuracy, conditional MAE by regime,
rolling MAE over time, and improvement-over-baseline stats.
"""

import json
import math

with open("../../frontend/public/data/cot.json") as f:
    raw = json.load(f)

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
            skip = True; break
        nets[cat] = l - s
    if skip:
        continue
    rows.append({"date": r["date"], "oi": oi, "price": price, **nets})

CATS   = ["mm", "pmpu", "swap", "other", "nr"]
WARMUP = 104

def ols_beta(xs, ys):
    n = len(xs)
    if n < 10: return 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    cov = sum((xs[i]-mx)*(ys[i]-my) for i in range(n))/n
    var = sum((xs[i]-mx)**2 for i in range(n))/n
    return cov/var if var > 1e-10 else 0.0

def pct(arr, p):
    s = sorted(arr)
    idx = p/100*(len(s)-1)
    lo, hi = int(idx), min(int(idx)+1, len(s)-1)
    return s[lo] + (s[hi]-s[lo])*(idx-lo)

def r2(act, pred):
    m = sum(act)/len(act)
    ss_tot = sum((a-m)**2 for a in act)
    ss_res = sum((a-p)**2 for a,p in zip(act,pred))
    return 1 - ss_res/ss_tot if ss_tot > 1e-10 else 0.0

results = {}

for cat in CATS:
    errs_b, errs_p, errs_065, errs_cal = [], [], [], []
    act_all, pred_b_all, pred_p_all, pred_065_all, pred_cal_all = [], [], [], [], []

    # For regime analysis
    regime_errs = {ap: {"uu":[],"ud":[],"du":[],"dd":[]} for ap in ["baseline","prop_oi","price_065","price_cal"]}

    # For rolling MAE (store weekly, compute rolling later)
    week_errs = {"date":[], "baseline":[], "prop_oi":[], "price_065":[], "price_cal":[]}

    dir_hits = {"baseline":[], "prop_oi":[], "price_065":[], "price_cal":[]}

    for t in range(WARMUP, len(rows)):
        prev, curr = rows[t-1], rows[t]
        actual   = curr[cat]
        net_prev = prev[cat]
        oi_prev, oi_curr = prev["oi"], curr["oi"]
        p_prev, p_curr   = prev["price"], curr["price"]
        d_oi    = oi_curr - oi_prev
        sign_p  = 1 if p_curr >= p_prev else -1
        price_up = p_curr >= p_prev
        oi_up    = oi_curr >= oi_prev
        regime   = ("u" if price_up else "d") + ("u" if oi_up else "d")

        pred_b   = net_prev
        pred_p   = net_prev * oi_curr / oi_prev if oi_prev != 0 else net_prev
        pred_065 = net_prev + 0.65 * d_oi * sign_p

        window = rows[t-WARMUP:t]
        xs = [(window[i]["oi"]-window[i-1]["oi"]) * (1 if window[i]["price"]>=window[i-1]["price"] else -1)
              for i in range(1, len(window))]
        ys = [window[i][cat]-window[i-1][cat] for i in range(1, len(window))]
        beta_cal = ols_beta(xs, ys)
        pred_cal = net_prev + beta_cal * d_oi * sign_p

        preds = {"baseline": pred_b, "prop_oi": pred_p, "price_065": pred_065, "price_cal": pred_cal}

        for ap, pred in preds.items():
            err = actual - pred
            if ap == "baseline":    errs_b.append(err)
            elif ap == "prop_oi":   errs_p.append(err)
            elif ap == "price_065": errs_065.append(err)
            elif ap == "price_cal": errs_cal.append(err)

            regime_errs[ap][regime].append(abs(err))

            # Directional accuracy: did prediction correctly predict sign of change from prev?
            d_act  = actual - net_prev
            d_pred = pred   - net_prev
            if d_act != 0:
                dir_hits[ap].append(1 if (d_act > 0) == (d_pred > 0) else 0)

            week_errs[ap].append(abs(err))

        week_errs["date"].append(curr["date"])
        act_all.append(actual)
        pred_b_all.append(pred_b)
        pred_p_all.append(pred_p)
        pred_065_all.append(pred_065)
        pred_cal_all.append(pred_cal)

    # Summarise
    def summarise(errs, act, pred):
        n = len(errs)
        abs_errs = [abs(e) for e in errs]
        return {
            "n":     n,
            "mae":   round(sum(abs_errs)/n),
            "rmse":  round(math.sqrt(sum(e**2 for e in errs)/n)),
            "bias":  round(sum(errs)/n),          # mean signed error
            "p25":   round(pct(abs_errs, 25)),
            "p50":   round(pct(abs_errs, 50)),
            "p75":   round(pct(abs_errs, 75)),
            "p90":   round(pct(abs_errs, 90)),
            "r2":    round(r2(act, pred), 4),
        }

    def dir_acc(hits): return round(100*sum(hits)/len(hits),1) if hits else 0

    def regime_summary(ap):
        return {k: round(sum(v)/len(v)) if v else None
                for k, v in regime_errs[ap].items()}

    n_weeks = len(errs_b)
    # Rolling 52-week MAE (sampled every 4 weeks for chart density)
    rolling = []
    ROLL = 52
    for i in range(ROLL, n_weeks, 4):
        w_slice = {ap: week_errs[ap][i-ROLL:i] for ap in ["baseline","prop_oi","price_065","price_cal"]}
        rolling.append({
            "date": week_errs["date"][i],
            "baseline":  round(sum(w_slice["baseline"])/ROLL),
            "prop_oi":   round(sum(w_slice["prop_oi"])/ROLL),
            "price_065": round(sum(w_slice["price_065"])/ROLL),
            "price_cal": round(sum(w_slice["price_cal"])/ROLL),
        })

    results[cat] = {
        "baseline":  {**summarise(errs_b,   act_all, pred_b_all),   "dir_acc": dir_acc(dir_hits["baseline"])},
        "prop_oi":   {**summarise(errs_p,   act_all, pred_p_all),   "dir_acc": dir_acc(dir_hits["prop_oi"])},
        "price_065": {**summarise(errs_065, act_all, pred_065_all), "dir_acc": dir_acc(dir_hits["price_065"])},
        "price_cal": {**summarise(errs_cal, act_all, pred_cal_all), "dir_acc": dir_acc(dir_hits["price_cal"])},
        "regime":  {ap: regime_summary(ap) for ap in ["baseline","prop_oi","price_065","price_cal"]},
        "rolling": rolling,
    }

    r = results[cat]
    print(f"\n{'='*70}")
    print(f"  {cat.upper()}")
    print(f"  {'Approach':<16} {'MAE':>6} {'RMSE':>6} {'Bias':>6} {'P50':>6} {'P75':>6} {'P90':>6} {'R2':>7} {'DirAcc':>7}")
    for ap in ["baseline","prop_oi","price_065","price_cal"]:
        m = r[ap]
        flag = " ★" if m["mae"] == min(r[a]["mae"] for a in ["baseline","prop_oi","price_065","price_cal"]) else ""
        print(f"  {ap:<16} {m['mae']:>6,} {m['rmse']:>6,} {m['bias']:>+6,} {m['p50']:>6,} {m['p75']:>6,} {m['p90']:>6,} {m['r2']:>7.4f} {m['dir_acc']:>6.1f}%{flag}")

    print("\n  Regime MAE (baseline | prop_oi | price_065 | price_cal) — price(u/d) × OI(u/d)")
    for regime_key in ["uu","ud","du","dd"]:
        label = {"uu":"Price+ OI+","ud":"Price+ OI-","du":"Price- OI+","dd":"Price- OI-"}[regime_key]
        vals  = [r["regime"][ap][regime_key] for ap in ["baseline","prop_oi","price_065","price_cal"]]
        print(f"    {label:<14} {' | '.join(f'{v:>6,}' if v else '    —' for v in vals)}")

print("\n\n=== JSON (paste into CotBacktestReport.tsx) ===")
# Print only the data needed by the frontend (rolling is long — sample it further)
out = {}
for cat in CATS:
    r = results[cat]
    out[cat] = {
        ap: {k: v for k, v in r[ap].items()}
        for ap in ["baseline","prop_oi","price_065","price_cal"]
    }
    out[cat]["regime"] = r["regime"]
    # Keep rolling for all cats but thin to every 8 weeks for JSON size
    out[cat]["rolling"] = r["rolling"][::2]

print(json.dumps(out, indent=2))
