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
  * The Coffee Currency Index (CCI) — our own coffee-trade-weighted basket
    of producer vs consumer currencies — reconstructed from the component
    FX pairs in fx_history.json with the SAME weights + orientation as the
    published index (fetch_currency_index.py). This is the currency axis
    instead of the generic dollar index: the CCI is coffee-relevant
    (higher = origin currencies strengthening = bullish coffee), needs no
    extra network call, and works wherever the rest of the quant step does.

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

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Coffee Currency Index weights + orientation, reused verbatim from the CCI
# module so the model's CCI feature stays in lock-step with the published
# index (no second copy of the weights to drift). Importing these is
# side-effect-free (the fetch logic is guarded behind __main__).
from scraper.quant_model.fetch_currency_index import (  # noqa: E402
    EXPORTERS,
    IMPORTERS,
    _strength_sign,
)

_ROOT       = Path(__file__).resolve().parents[3]
_ARCHIVE    = _ROOT / "data" / "contract_prices_archive.json"
_FX_HISTORY = _ROOT / "frontend" / "public" / "data" / "fx_history.json"
_KC_AT_RC_CLOSE = _ROOT / "frontend" / "public" / "data" / "kc_at_rc_close_history.json"

# The kc_after_rc_diff feature only turns on once enough captured days overlap
# the training window — see capture_kc_at_rc_close.py (forward-accumulating).
_MIN_KC_RC_OVERLAP = 40

# ── Triple-barrier hyper-parameters ──────────────────────────────────────────
# H = horizon in trading days the vertical (time) barrier sits at.
# K = barrier half-width in units of the trailing daily-return σ.
# These pin "what counts as a decisive move": ±1σ over a trading week.
_BARRIER_H = 5
_BARRIER_K = 1.0
_VOL_WINDOW = 20          # trailing window for the per-day σ estimate
_KC_TO_USD_PER_MT = 22.0462   # KC ¢/lb → USD/MT
_MIN_DEFINED = 80         # need at least this many labelled (non-abstain) rows
_CCI_Z_WINDOW = 120       # rolling window for the CCI level z-score

# Display metadata per feature: the order + human label + raw-value formatter.
# var_name is the stable key surfaced to the frontend / methodology doc.
#
# The currency axis is the Coffee Currency Index (CCI) — a coffee-trade-weighted
# basket of producer (export) vs consumer (import) currencies — NOT the dollar
# index. Higher CCI = origin currencies strengthening vs USD = origin costs up
# in USD terms = bullish coffee. This replaces the old EUR/USD + DXY + USD/BRL
# trio with one coffee-relevant pair of features (the index's daily move and how
# stretched its level is), removing the DXY dependency entirely.
#
# kc_after_rc_diff is the New-York-only move in the ~1h AFTER London robusta
# closes (KC settle vs KC at 17:30 London) — a leading indicator for robusta's
# next open. It's forward-accumulating (captured daily by
# capture_kc_at_rc_close.py), so it's the last feature and only activates once
# enough captured days overlap the training window.
_FEATURE_SPECS = [
    ("rc_ret_1d",       "RC 1-Day Return",          lambda v: f"{v*100:+.2f}%"),
    ("cci_ret_1d",      "Coffee Currency Index Δ",  lambda v: f"{v*100:+.2f}%"),
    ("cci_z",           "Coffee Currency Index (z)", lambda v: f"{v:+.2f}σ"),
    ("kc_rc_gap_z",     "New York Price Gap (z)",   lambda v: f"{v:+.2f}σ"),
    ("kc_after_rc_diff", "NY after RC-Close Move",  lambda v: f"{v*100:+.2f}%"),
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


# ── Coffee Currency Index (CCI) — coffee-trade-weighted FX basket ────────────
# Built from the same component pairs in fx_history.json the published CCI uses,
# with identical weights + strength orientation (imported from the CCI module).
# Replaces the dollar-centric EUR/USD + DXY + USD/BRL features with one
# coffee-relevant currency axis. fx_history.json is produced by the CCI
# workflow via a GitHub-Actions-reachable CDN FX API (jsdelivr), so this needs
# no extra network call and works wherever the rest of the quant step does.

def _fx_history_pairs() -> dict:
    """All per-pair daily close series from fx_history.json, keyed by ticker
    (e.g. 'BRL=X'). Empty dict on any failure."""
    if not _FX_HISTORY.exists():
        return {}
    try:
        doc = json.loads(_FX_HISTORY.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, pd.Series] = {}
    for ticker, p in (doc.get("pairs") or {}).items():
        dates, closes = [], []
        for row in p.get("history") or []:
            d, c = row.get("date"), row.get("close")
            if d is None or c is None:
                continue
            try:
                dates.append(pd.Timestamp(d))
                closes.append(float(c))
            except (ValueError, TypeError):
                continue
        if closes:
            out[ticker] = pd.Series(closes, index=pd.DatetimeIndex(dates)).sort_index()
    return out


def _compute_cci_index() -> "pd.Series | None":
    """Reconstruct the daily Coffee Currency Index level series (base 100) from
    the fx_history component pairs.

    Mirrors fetch_currency_index._compute_index_series exactly: each pair's
    daily return is normalised to a USD-strength return via _strength_sign(),
    exporters add (+w) and importers subtract (−w), and the weighted ΔI is
    accumulated from a base of 100. Higher index = producer currencies
    strengthening vs USD. Returns None if no component pairs are available.
    """
    pairs = _fx_history_pairs()
    if not pairs:
        return None
    returns = {t: s.pct_change() for t, s in pairs.items()}
    df = pd.DataFrame(returns).dropna(how="all")
    if df.empty:
        return None
    delta_i = pd.Series(0.0, index=df.index)
    used = 0
    for ticker, _name, w in EXPORTERS:
        if ticker in df.columns:
            delta_i += df[ticker].fillna(0) * (w * _strength_sign(ticker))
            used += 1
    for ticker, _name, w in IMPORTERS:
        if ticker in df.columns:
            delta_i += df[ticker].fillna(0) * (-w * _strength_sign(ticker))
            used += 1
    if used == 0:
        return None
    return (1 + delta_i).cumprod() * 100.0


def _load_kc_at_rc_close() -> "pd.Series | None":
    """{date → KC front-month price at 17:30 London} from the forward-captured
    history (capture_kc_at_rc_close.py). None when the file is absent/empty —
    the feature simply stays off until enough days accumulate."""
    if not _KC_AT_RC_CLOSE.exists():
        return None
    try:
        rows = json.loads(_KC_AT_RC_CLOSE.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(rows, list) or not rows:
        return None
    dates, vals = [], []
    for r in rows:
        d, v = r.get("date"), r.get("kc_at_rc_close")
        if d is None or v is None:
            continue
        try:
            dates.append(pd.Timestamp(d))
            vals.append(float(v))
        except (ValueError, TypeError):
            continue
    if not vals:
        return None
    return pd.Series(vals, index=pd.DatetimeIndex(dates)).sort_index()


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


def _build_frame(rc: pd.Series, kc: pd.Series, cci: "pd.Series | None",
                 kc_at_rc_close: "pd.Series | None" = None) -> "tuple[pd.DataFrame, list[str]] | None":
    """Assemble the aligned daily feature+label frame.

    Returns (frame, active_feature_keys). Optional features (CCI, the
    NY-after-RC-close move) are DROPPED rather than failing the whole model
    when their inputs are unavailable — the two price-archive-only features
    (rc_ret_1d, kc_rc_gap_z) keep it alive. Returns None only when even those
    can't be built.
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

    # Coffee Currency Index features (when fx_history yields the index):
    #   cci_ret_1d — the index's daily move (origin-vs-consumer currency shift)
    #   cci_z      — how stretched the index level is (rolling z-score)
    if cci is not None and not cci.empty:
        cci_re = cci.reindex(rc.index, method="ffill")
        cols["cci_ret_1d"] = cci_re.pct_change()
        cci_mu = cci_re.rolling(_CCI_Z_WINDOW, min_periods=20).mean()
        cci_sd = cci_re.rolling(_CCI_Z_WINDOW, min_periods=20).std()
        cols["cci_z"] = (cci_re - cci_mu) / cci_sd.replace(0, np.nan)
        active.extend(["cci_ret_1d", "cci_z"])

    # NY-after-RC-close move: KC's daily settle vs KC at 17:30 London (the
    # robusta close). Positive = New York rallied in the hour after London
    # robusta stopped trading → robusta tends to gap up next open. Only
    # included when enough captured days overlap the price archive, since this
    # series is forward-accumulating (no historical intraday backfill).
    if kc_at_rc_close is not None and not kc_at_rc_close.empty:
        kc_close_aligned = kc.reindex(kc_at_rc_close.index)   # KC settle on the same dates
        diff = (kc_close_aligned / kc_at_rc_close) - 1.0
        diff = diff.dropna()
        if len(diff.index.intersection(rc.index)) >= _MIN_KC_RC_OVERLAP:
            # No ffill: a same-day diff only makes sense on days we actually
            # captured. Days without a capture stay NaN and are excluded from
            # training rows (dropna in run()), so the feature is used only
            # where it's real.
            cols["kc_after_rc_diff"] = diff.reindex(rc.index)
            active.append("kc_after_rc_diff")

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

    cci = _compute_cci_index()
    kc_at_rc_close = _load_kc_at_rc_close()
    built = _build_frame(rc, kc, cci, kc_at_rc_close)
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
            "currency_axis":   "coffee_currency_index",
            "cci_available":   cci is not None and not cci.empty,
            "kc_after_rc_active": "kc_after_rc_diff" in active_keys,
        },
    }


if __name__ == "__main__":
    out = run()
    print(json.dumps(out, indent=2, ensure_ascii=False)[:2000])
