"""
open_direction.py
Daily next-session direction classifier for ICE Robusta (RC), with an
exact additive (SHAP-style) decomposition of the latest prediction.

Background
==========
The Signals tab's "Open Price Direction" panel was a hand-coded mock: a
SHAP waterfall with frozen numbers and a "MOCK DATA" banner. The original
design targeted the first 30 minutes after the ICE RC open and labelled
observations with a López-de-Prado triple-barrier scheme — but that needs
an intraday RC tick feed we don't have.

This module makes the panel LIVE by reformulating the same idea on the
data we DO ship daily:

  * 5y of RC + KC front-month daily settles (contract_prices_archive.json)
  * Daily EUR/USD, USD/BRL, and the US Dollar Index (DXY) from Stooq
    (same free CSV source robusta_factors.py already uses for DXY), with
    a fallback to the shipped fx_history.json when Stooq is unreachable.

The label is still a triple barrier — just applied to the DAILY RC path
instead of an intraday one: from each day, an upper and lower price
barrier (±k·σ) race against a vertical H-day time barrier. Up if the
upper is hit first, Down if the lower is hit first, UNDEFINED (abstain)
if the time barrier is reached first. Abstention is a feature, not a bug:
when neither price barrier is touched in H days the move wasn't
decisive, and forcing a call there is how you manufacture false
confidence.

Why logistic regression (and why the SHAP is exact, not approximated)
=====================================================================
We fit an ordinary logistic regression on standardised features. For a
logistic model the SHAP value of feature i is *closed-form exact* in the
log-odds (margin) space:

    margin(x)   = β0 + Σ βi · zi              (zi = standardised feature)
    base_margin = β0                          (E[zi] = 0 by construction)
    φi          = βi · zi
    Σ φi        = margin(x) − base_margin      (exactly)

So the waterfall is mathematically exact: the per-feature bars sum to the
gap between the base log-odds and the prediction's log-odds with zero
residual. No Shapley sampling, no `shap` dependency (which matters for the
lightweight GitHub-Actions deploy), no tree-SHAP approximation error. The
endpoints are reported in BOTH margin units (where the bars are additive)
and probability units (via the sigmoid) so the UI can show "Bullish 43%"
while keeping an honest additive chart underneath.

Output (merged into quant_report.json under "open_direction") — see the
schema in `_unavailable` / the bottom of `run` for the exact shape.

Methodology paper: docs/research/open-price-direction-methodology.md
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

_ROOT       = Path(__file__).resolve().parents[3]
_ARCHIVE    = _ROOT / "data" / "contract_prices_archive.json"
_FX_HISTORY = _ROOT / "frontend" / "public" / "data" / "fx_history.json"

# ── Triple-barrier hyper-parameters ──────────────────────────────────────────
# H = horizon in trading days the vertical (time) barrier sits at.
# K = barrier half-width in units of the trailing daily-return σ.
# These pin "what counts as a decisive move": ±1σ over a trading week.
_BARRIER_H = 5
_BARRIER_K = 1.0
_VOL_WINDOW = 20          # trailing window for the per-day σ estimate
_KC_TO_USD_PER_MT = 22.0462   # KC ¢/lb → USD/MT
_MIN_DEFINED = 80         # need at least this many labelled (non-abstain) rows
_STOOQ_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; coffee-intel/1.0)"}

# Display metadata per feature: the order + human label + raw-value formatter.
# var_name is the stable key surfaced to the frontend / methodology doc.
_FEATURE_SPECS = [
    ("rc_ret_1d",     "RC 1-Day Return",        lambda v: f"{v*100:+.2f}%"),
    ("eurusd_ret_1d", "EUR/USD Daily Return",   lambda v: f"{v*100:+.2f}%"),
    ("dxy_ret_1d",    "DXY Daily Return",       lambda v: f"{v*100:+.2f}%"),
    ("kc_rc_gap_z",   "New York Price Gap (z)", lambda v: f"{v:+.2f}σ"),
    ("usdbrl_ret_1d", "USD/BRL Daily Return",   lambda v: f"{v*100:+.2f}%"),
]
_FEATURE_KEYS = [k for k, _, _ in _FEATURE_SPECS]


def _unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason}


# ── Price-archive loading ────────────────────────────────────────────────────

def _front_series(archive_market: dict) -> "pd.Series | None":
    """Front-month daily settle series from one side of the archive.

    Each day maps {contract_symbol: {"price": float}}. The front month is the
    contract with the nearest expiry; the archive lists contracts in expiry
    order, so the first key per day is the front. We read its price.
    """
    dates, prices = [], []
    for day in sorted(archive_market.keys()):
        contracts = archive_market[day]
        if not isinstance(contracts, dict) or not contracts:
            continue
        first_sym = next(iter(contracts))
        rec = contracts.get(first_sym) or {}
        px = rec.get("price")
        if px is None:
            continue
        try:
            dates.append(pd.Timestamp(day))
            prices.append(float(px))
        except (ValueError, TypeError):
            continue
    if not prices:
        return None
    return pd.Series(prices, index=pd.DatetimeIndex(dates)).sort_index()


def _load_prices() -> "tuple[pd.Series, pd.Series] | None":
    """(rc_front, kc_front) daily settle series, or None if archive missing."""
    if not _ARCHIVE.exists():
        return None
    try:
        arch = json.loads(_ARCHIVE.read_text(encoding="utf-8"))
    except Exception:
        return None
    rc = _front_series(arch.get("robusta") or {})
    kc = _front_series(arch.get("arabica") or {})
    if rc is None or kc is None:
        return None
    return rc, kc


# ── FX loading: Stooq daily, fallback to shipped fx_history ──────────────────

def _fetch_stooq_daily(symbol: str) -> "pd.Series | None":
    """Daily close series from Stooq for `symbol` (e.g. 'eurusd', 'usdbrl',
    'dx.f'). Free CSV, no auth. Returns None on any failure."""
    url = f"https://stooq.com/q/d/l/?s={symbol}&i=d"
    try:
        r = requests.get(url, headers=_STOOQ_HEADERS, timeout=20)
        r.raise_for_status()
        lines = r.text.strip().splitlines()
    except Exception:
        return None
    if len(lines) < 2:
        return None
    dates, closes = [], []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        try:
            dates.append(pd.Timestamp(parts[0]))
            closes.append(float(parts[4]))
        except (ValueError, TypeError):
            continue
    if not closes:
        return None
    return pd.Series(closes, index=pd.DatetimeIndex(dates)).sort_index()


def _fx_from_history(pair_key: str) -> "pd.Series | None":
    """Fallback FX series from the shipped fx_history.json (rolling ~1y).
    pair_key is the JSON key, e.g. 'EURUSD=X' or 'BRL=X'."""
    if not _FX_HISTORY.exists():
        return None
    try:
        doc = json.loads(_FX_HISTORY.read_text(encoding="utf-8"))
    except Exception:
        return None
    p = (doc.get("pairs") or {}).get(pair_key) or {}
    hist = p.get("history") or []
    dates, closes = [], []
    for row in hist:
        d, c = row.get("date"), row.get("close")
        if d is None or c is None:
            continue
        try:
            dates.append(pd.Timestamp(d))
            closes.append(float(c))
        except (ValueError, TypeError):
            continue
    if not closes:
        return None
    return pd.Series(closes, index=pd.DatetimeIndex(dates)).sort_index()


def _load_fx() -> dict:
    """Return {'eurusd': Series, 'usdbrl': Series, 'dxy': Series}.

    Each prefers Stooq (multi-year daily) and falls back to fx_history.json.
    fx_history stores EUR/USD directly (EURUSD=X) and USD/BRL as BRL=X.
    DXY has no fx_history entry, so it's Stooq-or-nothing (the feature drops
    out gracefully if both are missing — see _build_frame).
    """
    eurusd = _fetch_stooq_daily("eurusd") or _fx_from_history("EURUSD=X")
    usdbrl = _fetch_stooq_daily("usdbrl") or _fx_from_history("BRL=X")
    dxy    = _fetch_stooq_daily("dx.f")
    return {"eurusd": eurusd, "usdbrl": usdbrl, "dxy": dxy}


# ── Feature + label construction ─────────────────────────────────────────────

def _zscore_rolling(s: pd.Series, window: int = 52 * 5) -> pd.Series:
    mu = s.rolling(window, min_periods=20).mean()
    sd = s.rolling(window, min_periods=20).std()
    return (s - mu) / sd.replace(0, np.nan)


def _triple_barrier_labels(rc: pd.Series) -> pd.Series:
    """Label each day by which barrier the RC path touches first over the next
    H trading days. 1.0 = up, 0.0 = down, NaN = undefined (time barrier first).

    σ_t is the trailing daily-return std; barriers are price_t·(1 ± K·σ_t).
    """
    rets = rc.pct_change()
    sigma = rets.rolling(_VOL_WINDOW, min_periods=10).std()
    vals = rc.values
    sig = sigma.values
    n = len(vals)
    out = np.full(n, np.nan)
    for t in range(n):
        s = sig[t]
        if not np.isfinite(s) or s <= 0:
            continue
        upper = vals[t] * (1 + _BARRIER_K * s)
        lower = vals[t] * (1 - _BARRIER_K * s)
        hi = min(t + _BARRIER_H, n - 1)
        label = np.nan
        for j in range(t + 1, hi + 1):
            if vals[j] >= upper:
                label = 1.0
                break
            if vals[j] <= lower:
                label = 0.0
                break
        out[t] = label
    return pd.Series(out, index=rc.index)


def _build_frame(rc: pd.Series, kc: pd.Series, fx: dict) -> "tuple[pd.DataFrame, list[str]] | None":
    """Assemble the aligned daily feature+label frame.

    Returns (frame, active_feature_keys). Features whose underlying series is
    entirely missing (e.g. DXY when Stooq is unreachable AND it has no
    fx_history fallback) are DROPPED rather than failing the whole model — a
    4-feature decomposition is still useful and honest. Returns None only when
    so much is missing that nothing can be built (no RC-relative feature at
    all). The two always-available features are rc_ret_1d and kc_rc_gap_z
    (both derived purely from the price archive).
    """
    cols: dict[str, pd.Series] = {"rc": rc}
    active: list[str] = []

    # Always-on: RC's own daily move + the KC−RC arbitrage gap (price-archive
    # only, no external dependency).
    cols["rc_ret_1d"] = rc.pct_change()
    active.append("rc_ret_1d")

    kc_usd = kc * _KC_TO_USD_PER_MT
    gap = (kc_usd - rc).dropna()
    gap_z = _zscore_rolling(gap)
    cols["kc_rc_gap_z"] = gap_z.reindex(rc.index, method="ffill")
    active.append("kc_rc_gap_z")

    # FX-dependent features: include only when the series exists.
    fx_feature_map = [
        ("eurusd_ret_1d", fx.get("eurusd")),
        ("dxy_ret_1d",    fx.get("dxy")),
        ("usdbrl_ret_1d", fx.get("usdbrl")),
    ]
    for key, series in fx_feature_map:
        if series is None:
            continue
        cols[key] = series.reindex(rc.index, method="ffill").pct_change()
        active.append(key)

    if len(active) < 2:
        return None

    frame = pd.DataFrame(cols)
    frame["label"] = _triple_barrier_labels(rc)
    # Order active features per the canonical _FEATURE_KEYS display order.
    active_ordered = [k for k in _FEATURE_KEYS if k in active]
    return frame, active_ordered


# ── Pure-numpy logistic regression (IRLS) ────────────────────────────────────

def _fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 1.0,
                  iters: int = 100, tol: float = 1e-8) -> np.ndarray:
    """Newton-Raphson / IRLS logistic fit with L2 ridge (not penalising the
    intercept). X already includes a leading column of 1s. Returns the
    coefficient vector β (length = X.shape[1]). Pure numpy — no sklearn/scipy
    so the GH-Actions quant step stays dependency-light.
    """
    n, p = X.shape
    beta = np.zeros(p)
    ridge = np.eye(p) * l2
    ridge[0, 0] = 0.0  # don't regularise the intercept
    for _ in range(iters):
        eta = X @ beta
        mu = 1.0 / (1.0 + np.exp(-np.clip(eta, -35, 35)))
        W = mu * (1.0 - mu)
        W = np.clip(W, 1e-6, None)
        # Gradient + Hessian of the penalised log-likelihood.
        grad = X.T @ (y - mu) - ridge @ beta
        H = -(X.T * W) @ X - ridge
        try:
            step = np.linalg.solve(H, grad)
        except np.linalg.LinAlgError:
            break
        beta_new = beta - step
        if np.max(np.abs(beta_new - beta)) < tol:
            beta = beta_new
            break
        beta = beta_new
    return beta


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -35, 35)))


def run(db=None) -> dict:
    """Build features, fit the classifier, and return the live prediction +
    exact SHAP decomposition. `db` is accepted for run_quant symmetry but
    unused — all inputs are file/HTTP based.
    """
    warnings.filterwarnings("ignore")

    prices = _load_prices()
    if prices is None:
        return _unavailable("contract_prices_archive.json missing or unreadable")
    rc, kc = prices

    fx = _load_fx()
    built = _build_frame(rc, kc, fx)
    if built is None:
        return _unavailable("Could not assemble even the price-only features")
    frame, active_keys = built

    feat = frame[active_keys]
    # Rows usable for TRAINING: complete features AND a defined label.
    train = frame.dropna(subset=active_keys + ["label"])
    if len(train) < _MIN_DEFINED:
        return _unavailable(
            f"Only {len(train)} defined training rows (need ≥{_MIN_DEFINED})"
        )

    # The LATEST row we can score: complete features (label is naturally NaN
    # for the most recent H days — that's the live, not-yet-resolved case).
    feat_complete = feat.dropna()
    if feat_complete.empty:
        return _unavailable("No complete feature row to score")
    latest_date = feat_complete.index[-1]
    x_raw = feat_complete.iloc[-1]

    # Standardise on the TRAINING distribution (store μ/σ for the live row).
    mu = train[active_keys].mean()
    sd = train[active_keys].std().replace(0, 1.0)
    Z_train = ((train[active_keys] - mu) / sd).values
    y = train["label"].values.astype(float)

    # Time-series holdout for an honest accuracy read: first 70% train,
    # last 30% test. Then refit on ALL rows for the live coefficients.
    split = int(len(Z_train) * 0.7)
    acc_defined = None
    n_test = 0
    if split >= _MIN_DEFINED // 2 and (len(Z_train) - split) >= 20:
        Xtr = np.column_stack([np.ones(split), Z_train[:split]])
        beta_tr = _fit_logistic(Xtr, y[:split])
        Zte = Z_train[split:]
        Xte = np.column_stack([np.ones(len(Zte)), Zte])
        p_te = 1.0 / (1.0 + np.exp(-np.clip(Xte @ beta_tr, -35, 35)))
        pred = (p_te >= 0.5).astype(float)
        n_test = len(y[split:])
        acc_defined = float((pred == y[split:]).mean())

    # Live fit on everything.
    X_all = np.column_stack([np.ones(len(Z_train)), Z_train])
    beta = _fit_logistic(X_all, y)

    # Standardise the live row with the same μ/σ.
    z_latest = ((x_raw - mu) / sd).values
    base_margin  = float(beta[0])                      # β0 (E[z]=0)
    coefs        = beta[1:]
    phis         = coefs * z_latest                    # exact logistic SHAP
    final_margin = base_margin + float(phis.sum())

    base_prob  = _sigmoid(base_margin)
    final_prob = _sigmoid(final_margin)
    direction  = "Bullish" if final_prob >= 0.5 else "Bearish"

    # Undefined ratio over the FULL feature-complete sample (how often the
    # method abstains): rows with complete features but a NaN (time-barrier)
    # label, excluding the trailing H rows that simply haven't resolved yet.
    resolvable = frame.dropna(subset=active_keys).iloc[:-_BARRIER_H] \
        if len(frame) > _BARRIER_H else frame.dropna(subset=active_keys)
    n_resolvable = len(resolvable)
    n_undef = int(resolvable["label"].isna().sum())
    undefined_ratio = (n_undef / n_resolvable) if n_resolvable else None

    spec_by_key = {k: (label, fmt) for k, label, fmt in _FEATURE_SPECS}
    features_out = []
    for key, raw, phi in zip(active_keys, x_raw.values, phis):
        label, fmt = spec_by_key[key]
        features_out.append({
            "var_name":  key,
            "label":     label,
            "raw_value": float(raw),
            "raw_fmt":   fmt(float(raw)),
            "phi":       float(phi),   # margin (log-odds) units; Σ = gap exactly
        })
    # Show the steepest contributors first (largest |φ|) — matches how a SHAP
    # waterfall is conventionally ordered.
    features_out.sort(key=lambda f: abs(f["phi"]), reverse=True)

    return {
        "available":       True,
        "as_of":           latest_date.strftime("%Y-%m-%d"),
        "scraped_at":      datetime.utcnow().isoformat() + "Z",
        "direction":       direction,
        "base_margin":     base_margin,
        "final_margin":    final_margin,
        "base_prob":       base_prob,    # E[f(x)] as a probability
        "final_prob":      final_prob,   # f(x)
        "prob_up":         final_prob,
        "prob_down":       1.0 - final_prob,
        "features":        features_out,
        "barrier": {
            "horizon_days": _BARRIER_H,
            "k_sigma":      _BARRIER_K,
            "vol_window":   _VOL_WINDOW,
        },
        "model": {
            "kind":            "logistic_regression_l2",
            "active_features": active_keys,
            "n_features":      len(active_keys),
            "n_train":         int(len(Z_train)),
            "test_accuracy":   acc_defined,    # on defined cases, time-holdout
            "n_test":          int(n_test),
            "undefined_ratio": undefined_ratio,
            "n_resolvable":    int(n_resolvable),
            "n_undefined":     int(n_undef),
            "fx_source": {
                "eurusd": "stooq" if _fetch_stooq_marker(fx["eurusd"]) else "fx_history/none",
                "usdbrl": "stooq" if _fetch_stooq_marker(fx["usdbrl"]) else "fx_history/none",
                "dxy":    "stooq" if fx["dxy"] is not None else "none",
            },
        },
    }


def _fetch_stooq_marker(series) -> bool:
    """Heuristic provenance marker: a Stooq daily pull yields ≫400 rows; the
    fx_history fallback yields ≤~365. Used only for the report's debug
    `fx_source` block, never for logic."""
    return series is not None and len(series) > 400


if __name__ == "__main__":
    out = run()
    print(json.dumps(out, indent=2, ensure_ascii=False)[:2000])
