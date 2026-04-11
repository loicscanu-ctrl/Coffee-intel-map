"""
COT backtest v3 — extended approaches from research literature.

New approaches beyond v2 (baseline, prop_oi, price_065, price_cal):
  5. Momentum ridge regression (Mapping speculative trading paper, ScienceDirect 2023):
       ΔMM(t) = Σ_k [β_k × r(t-k)] for k=1..K, ridge regression
       MM_net(t) = MM_net(t-1) + ΔMM_hat(t)
  6. Volatility-scaled momentum (CTA replication, AQR/Baltas style):
       signal(t) = EWMA(r, span=8) / realized_vol(t, 13wk)
       MM_net(t) = MM_net(t-1) + α × signal(t)  [α calibrated by OLS]
  7. Hybrid: Proportional OI + calibrated momentum
       MM_net(t) = MM_net(t-1) × OI(t)/OI(t-1) + β × momentum_signal(t)

Focus: all 5 categories, compare against v2 best (prop_oi / baseline).
"""

import json, math, statistics

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
WARMUP = 104   # 2-year rolling calibration window
LAGS   = 12    # momentum: 12 weeks of past returns
RIDGE  = 1e5   # ridge lambda (L2 penalty)
EWMA_SPAN = 8  # fast EWMA span (weeks) for vol-scaled signal
VOL_WIN   = 13 # weeks for realized vol

# ── helpers ───────────────────────────────────────────────────────────────────

def ridge_beta(X, y, lam=RIDGE):
    """Ridge OLS: beta = (X'X + lam*I)^-1 X'y — solved via dot products (no numpy)."""
    n, p = len(y), len(X[0])
    # X'X
    XtX = [[sum(X[i][j]*X[i][k] for i in range(n)) for k in range(p)] for j in range(p)]
    # X'y
    Xty = [sum(X[i][j]*y[i] for i in range(n)) for j in range(p)]
    # Add ridge penalty
    for j in range(p):
        XtX[j][j] += lam
    # Solve via Cholesky / Gaussian elimination
    # Simple Gaussian elimination (p is small: 12)
    A = [row[:] + [Xty[j]] for j, row in enumerate(XtX)]
    for col in range(p):
        pivot = A[col][col]
        if abs(pivot) < 1e-15:
            continue
        for row in range(p):
            if row == col:
                continue
            factor = A[row][col] / pivot
            for k in range(p + 1):
                A[row][k] -= factor * A[col][k]
    return [A[j][p] / A[j][j] if abs(A[j][j]) > 1e-15 else 0.0 for j in range(p)]

def ols_scalar(xs, ys):
    n = len(xs)
    if n < 5: return 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    cov = sum((xs[i]-mx)*(ys[i]-my) for i in range(n))/n
    var = sum((xs[i]-mx)**2 for i in range(n))/n
    return cov/var if var > 1e-12 else 0.0

def ewma(values, span):
    """Exponentially weighted moving average of the last len(values) values."""
    alpha = 2 / (span + 1)
    result = values[0]
    for v in values[1:]:
        result = alpha * v + (1 - alpha) * result
    return result

def realized_vol(returns, window):
    if len(returns) < 2:
        return 1.0
    r = returns[-window:]
    mean = sum(r)/len(r)
    var  = sum((x-mean)**2 for x in r)/len(r)
    return math.sqrt(var) if var > 0 else 1.0

def metrics(errs):
    n = len(errs)
    abs_e = [abs(e) for e in errs]
    mae  = sum(abs_e)/n
    rmse = math.sqrt(sum(e**2 for e in errs)/n)
    bias = sum(errs)/n
    s = sorted(abs_e)
    p50 = s[n//2]
    p90 = s[int(0.9*n)]
    return mae, rmse, bias, p50, p90

def r2(act, pred):
    m = sum(act)/len(act)
    ss_tot = sum((a-m)**2 for a in act)
    ss_res = sum((a-p)**2 for a,p in zip(act,pred))
    return 1-ss_res/ss_tot if ss_tot > 1e-10 else 0.0

def dir_acc(actual_chgs, pred_chgs):
    hits = [1 if a*p > 0 else 0 for a,p in zip(actual_chgs, pred_chgs) if a != 0]
    return 100*sum(hits)/len(hits) if hits else 0.0

# ── backtest ──────────────────────────────────────────────────────────────────

results = {}

for cat in CATS:
    # Reference: best from v2
    errs_baseline, errs_prop, errs_mom, errs_volscale, errs_hybrid = [], [], [], [], []
    act_all = []
    pred_baseline_all, pred_prop_all, pred_mom_all, pred_vol_all, pred_hybrid_all = [], [], [], [], []

    for t in range(WARMUP, len(rows)):
        prev = rows[t-1]
        curr = rows[t]
        actual   = curr[cat]
        net_prev = prev[cat]
        oi_prev  = prev["oi"]
        oi_curr  = curr["oi"]
        d_net    = actual - net_prev

        # ── Baseline & Prop OI (reference, same as v2) ──────────────────────
        pred_b    = net_prev
        pred_prop = net_prev * oi_curr / oi_prev if oi_prev != 0 else net_prev

        # ── Price returns history ────────────────────────────────────────────
        prices = [rows[i]["price"] for i in range(t-WARMUP, t+1)]
        rets   = [(prices[i]-prices[i-1])/prices[i-1] for i in range(1, len(prices))]
        # rets[0] = oldest return, rets[-1] = most recent (current week)

        # ── 5. Momentum ridge regression ────────────────────────────────────
        # Build training set: for each training week τ in [WARMUP-lag..WARMUP-1]
        # X[τ] = past LAGS returns up to τ-1
        # y[τ] = Δnet at τ
        train_nets  = [rows[t - WARMUP + i][cat] for i in range(len(rets)+1)]
        train_dnet  = [train_nets[i] - train_nets[i-1] for i in range(1, len(train_nets))]
        # Build X matrix: each row = last LAGS returns ending at that index
        X_train, y_train = [], []
        for tau in range(LAGS, len(rets) - 1):
            # Features: returns[tau-LAGS..tau-1] (past returns, not using current week)
            row_x = rets[tau - LAGS: tau]
            X_train.append(row_x)
            y_train.append(train_dnet[tau])

        if len(X_train) >= LAGS + 5:
            betas = ridge_beta(X_train, y_train, lam=RIDGE)
            # Predict: use last LAGS returns (rets[-LAGS:] = most recent, ending at previous week)
            feat = rets[-LAGS-1:-1]  # returns leading up to current week
            d_mom = sum(betas[k]*feat[k] for k in range(LAGS))
        else:
            d_mom = 0.0

        pred_mom = net_prev + d_mom

        # ── 6. Volatility-scaled EWMA momentum ──────────────────────────────
        # signal = EWMA(rets, span=8) over training window
        # scale by vol; fit OLS alpha on training set
        def vol_signal(r_series, ewma_span, vol_window):
            if len(r_series) < vol_window + 1:
                return 0.0
            sig  = ewma(r_series[-ewma_span:], ewma_span)
            vol  = realized_vol(r_series, vol_window)
            return sig / vol if vol > 1e-8 else 0.0

        train_signals = []
        train_dnet_vs = []
        for tau in range(VOL_WIN, len(rets) - 1):
            sig = vol_signal(rets[:tau], EWMA_SPAN, VOL_WIN)
            train_signals.append(sig)
            train_dnet_vs.append(train_dnet[tau])

        alpha_vol = ols_scalar(train_signals, train_dnet_vs) if len(train_signals) > 5 else 0.0
        current_signal = vol_signal(rets[:-1], EWMA_SPAN, VOL_WIN)
        pred_volscale  = net_prev + alpha_vol * current_signal

        # ── 7. Hybrid: Prop OI + vol-scaled momentum ────────────────────────
        oi_delta  = (oi_curr - oi_prev) / oi_prev if oi_prev != 0 else 0.0
        prop_adj  = net_prev * oi_curr / oi_prev if oi_prev != 0 else net_prev
        # Calibrate hybrid: ΔNet ~ ΔNet_prop + α × signal
        prop_residuals   = [train_nets[i] - (train_nets[i-1] * rows[t - WARMUP + i]["oi"] / rows[t - WARMUP + i - 1]["oi"])
                            for i in range(1, len(train_nets))
                            if rows[t - WARMUP + i - 1]["oi"] != 0]
        hybrid_signals   = []
        hybrid_y         = []
        for tau in range(VOL_WIN, min(len(prop_residuals), len(train_signals))):
            sig = vol_signal(rets[:tau], EWMA_SPAN, VOL_WIN)
            hybrid_signals.append(sig)
            hybrid_y.append(prop_residuals[tau])
        alpha_hyb = ols_scalar(hybrid_signals, hybrid_y) if len(hybrid_signals) > 5 else 0.0
        pred_hybrid = prop_adj + alpha_hyb * current_signal

        # ── Accumulate ───────────────────────────────────────────────────────
        errs_baseline.append(actual - pred_b)
        errs_prop.append(actual - pred_prop)
        errs_mom.append(actual - pred_mom)
        errs_volscale.append(actual - pred_volscale)
        errs_hybrid.append(actual - pred_hybrid)
        act_all.append(actual)
        pred_baseline_all.append(pred_b)
        pred_prop_all.append(pred_prop)
        pred_mom_all.append(pred_mom)
        pred_vol_all.append(pred_volscale)
        pred_hybrid_all.append(pred_hybrid)

    # ── Summarise ─────────────────────────────────────────────────────────────
    def da(preds):
        chgs_pred = [preds[i]-pred_baseline_all[i] for i in range(len(preds))]
        chgs_act  = [act_all[i]-pred_baseline_all[i] for i in range(len(act_all))]
        return dir_acc(chgs_act, chgs_pred)

    rows_summary = [
        ("Baseline (v2)",   errs_baseline, pred_baseline_all),
        ("Prop OI (v2)",    errs_prop,     pred_prop_all),
        ("Momentum ridge",  errs_mom,      pred_mom_all),
        ("Vol-scaled EWMA", errs_volscale, pred_vol_all),
        ("Hybrid Prop+Mom", errs_hybrid,   pred_hybrid_all),
    ]

    print(f"\n{'='*75}")
    print(f"  {cat.upper()}")
    print(f"  {'Approach':<22} {'MAE':>6} {'RMSE':>6} {'Bias':>6} {'P50':>6} {'P90':>6} {'R2':>7} {'DirAcc':>7}")
    results[cat] = {}
    for name, errs, preds in rows_summary:
        mae, rmse, bias, p50, p90 = metrics(errs)
        r2v = r2(act_all, preds)
        chgs_pred = [preds[i]-pred_baseline_all[i] for i in range(len(preds))]
        chgs_act  = [act_all[i]-pred_baseline_all[i] for i in range(len(act_all))]
        diracc = dir_acc(chgs_act, chgs_pred)
        flag = ""
        results[cat][name] = {"mae": round(mae), "rmse": round(rmse), "bias": round(bias),
                               "p50": round(p50), "p90": round(p90), "r2": round(r2v,4), "dir_acc": round(diracc,1)}
        print(f"  {name:<22} {round(mae):>6,} {round(rmse):>6,} {round(bias):>+6,} {round(p50):>6,} {round(p90):>6,} {round(r2v,4):>7.4f} {round(diracc,1):>6.1f}%{flag}")

    # Mark best
    best_mae = min(results[cat][n]["mae"] for n,_,_ in rows_summary)
    for name, _, _ in rows_summary:
        if results[cat][name]["mae"] == best_mae:
            results[cat][name]["best"] = True
            print(f"  >>> Best: {name} (MAE {best_mae:,})")

print("\n\n=== COMPACT COMPARISON vs v2 best ===")
v2_best = {"mm":"Prop OI (v2)","pmpu":"Baseline (v2)","swap":"Baseline (v2)","other":"Prop OI (v2)","nr":"Prop OI (v2)"}
for cat in CATS:
    baseline_mae = results[cat]["Baseline (v2)"]["mae"]
    v2_mae       = results[cat][v2_best[cat]]["mae"]
    print(f"\n  {cat.upper():5s}  baseline={baseline_mae:,}  v2_best={v2_mae:,} ({v2_best[cat]})")
    for name in ["Momentum ridge","Vol-scaled EWMA","Hybrid Prop+Mom"]:
        mae  = results[cat][name]["mae"]
        delta = (mae - v2_mae) / v2_mae * 100
        better = "BETTER" if delta < -0.5 else ("WORSE" if delta > 0.5 else "≈same")
        print(f"         {name:<22} MAE={mae:>5,}  vs v2_best {delta:+.1f}%  {better}")
