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
# Precise 15-min intraday points (RM + KC) — Barchart-backfilled ~5.7y, plus
# forward-captured going forward. Supersedes the coarse hourly kc_at_rc_close
# for kc_after_rc_diff and adds the robusta overnight-gap feature.
_INTRADAY = _ROOT / "frontend" / "public" / "data" / "intraday_kc_rc_15min.json"

# An intraday-derived feature turns on once enough days overlap the training
# window (both the 15-min source and the legacy hourly fallback).
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
# Two intraday-derived features from the 15-min RM+KC history:
#   kc_after_rc_diff — the New-York-only move in the hour AFTER London robusta
#     closes (KC 18:30 ÷ KC 17:30 − 1). WITHIN-DAY, WITHIN-CONTRACT, so it is
#     immune to contract rolls.
#   rc_overnight_gap — robusta's own overnight gap (RC open ÷ prior RC 17:30
#     close − 1). This is CROSS-DAY, so on a roll day (today's front contract ≠
#     yesterday's) the two prices are different delivery months and the calendar
#     spread would masquerade as a huge gap — those days are EXCLUDED (set NaN)
#     so they never pollute the statistics.
# Both only activate once enough days overlap the training window.
_FEATURE_SPECS = [
    ("rc_ret_1d",        "RC 1-Day Return",          lambda v: f"{v*100:+.2f}%"),
    ("cci_ret_1d",       "Coffee Currency Index Δ",  lambda v: f"{v*100:+.2f}%"),
    ("cci_z",            "Coffee Currency Index (z)", lambda v: f"{v:+.2f}σ"),
    ("kc_rc_gap_z",      "New York Price Gap (z)",   lambda v: f"{v:+.2f}σ"),
    ("kc_after_rc_diff", "NY after RC-Close Move",   lambda v: f"{v*100:+.2f}%"),
    ("rc_overnight_gap", "RC Overnight Gap",         lambda v: f"{v*100:+.2f}%"),
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


def _load_kc_after_rc(kc: "pd.Series") -> "pd.Series | None":
    """{date → kc_after_rc_diff} = the NY-only return from RC close (17:30
    London) to KC settle. Two row shapes are supported in the history file:

      * backfill rows carry the diff directly (`kc_after_rc_diff`) — computed
        within a single intraday series so the contract level cancels;
      * forward-capture rows carry the 17:30 price (`kc_at_rc_close`), and we
        derive the diff as KC_settle / price − 1 using the same-day archive
        settle. (acaphe's front ≈ the archive front, so this stays single-
        contract in practice — unlike Yahoo's continuous series, which is why
        the backfill stores the diff pre-computed.)

    Returns None when the file is absent/empty — the feature stays off until
    enough days accumulate.
    """
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
        d = r.get("date")
        if d is None:
            continue
        try:
            ts = pd.Timestamp(d)
        except (ValueError, TypeError):
            continue
        diff = r.get("kc_after_rc_diff")
        if diff is None:
            price = r.get("kc_at_rc_close")
            if price is None or ts not in kc.index:
                continue
            try:
                diff = float(kc.loc[ts]) / float(price) - 1.0
            except (ValueError, TypeError, ZeroDivisionError):
                continue
        try:
            vals.append(float(diff))
            dates.append(ts)
        except (ValueError, TypeError):
            continue
    if not vals:
        return None
    return pd.Series(vals, index=pd.DatetimeIndex(dates)).sort_index()


def _load_intraday() -> "pd.DataFrame | None":
    """Two roll-aware features from intraday_kc_rc_15min.json (15-min RM+KC):

      kc_after_rc_diff = kc_last_1830 / kc_last_1730 − 1
        The NY-only move in the hour after London robusta closes. Within-day,
        within the same KC contract → immune to rolls.

      rc_overnight_gap = rc_open_first / rc_last_1730.shift(1) − 1
        Robusta's overnight gap from yesterday's 17:30 close to today's open.
        CROSS-DAY → on a roll day (rc_symbol today ≠ yesterday) the two prices
        are different delivery months; that calendar spread would show up as a
        spurious gap, so those days are EXCLUDED (NaN) — never polluting the
        stats. (Reported via `roll_days_excluded` in the model block.)

    Returns a DataFrame indexed by date with both columns (+ `_rc_roll`), or
    None if the file is absent/empty. Days missing the needed prices are NaN.
    """
    if not _INTRADAY.exists():
        return None
    try:
        rows = json.loads(_INTRADAY.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(rows, list) or not rows:
        return None

    recs = []
    for r in rows:
        d = r.get("date")
        if not d:
            continue
        try:
            ts = pd.Timestamp(d)
        except (ValueError, TypeError):
            continue
        recs.append((ts, r))
    if not recs:
        return None
    recs.sort(key=lambda x: x[0])
    idx = pd.DatetimeIndex([t for t, _ in recs])

    def col(key):
        out = []
        for _, r in recs:
            v = r.get(key)
            try:
                out.append(float(v) if v is not None else np.nan)
            except (ValueError, TypeError):
                out.append(np.nan)
        return pd.Series(out, index=idx)

    kc_1730 = col("kc_last_1730")
    kc_1830 = col("kc_last_1830")
    rc_1730 = col("rc_last_1730")
    rc_open = col("rc_open_first")
    rc_sym  = pd.Series([r.get("rc_symbol") for _, r in recs], index=idx)

    # Within-day NY move (roll-immune).
    kc_after = (kc_1830 / kc_1730 - 1.0).where((kc_1730 > 0) & kc_1830.notna())

    # Cross-day RC overnight gap; exclude roll days (contract changed vs prior).
    prev_rc_1730 = rc_1730.shift(1)
    prev_sym     = rc_sym.shift(1)
    is_roll      = rc_sym.ne(prev_sym) & prev_sym.notna()
    rc_gap = (rc_open / prev_rc_1730 - 1.0).where(
        (prev_rc_1730 > 0) & rc_open.notna() & (~is_roll)
    )

    df = pd.DataFrame({
        "kc_after_rc_diff": kc_after,
        "rc_overnight_gap": rc_gap,
        "_rc_roll":         is_roll.fillna(False),
    }, index=idx)
    return df


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
                 intraday: "pd.DataFrame | None" = None) -> "tuple[pd.DataFrame, list[str]] | None":
    """Assemble the aligned daily feature+label frame.

    Returns (frame, active_feature_keys). Optional features (CCI, the intraday
    NY-after-RC-close move + RC overnight gap) are DROPPED rather than failing
    the whole model when their inputs are unavailable — the two price-archive-
    only features (rc_ret_1d, kc_rc_gap_z) keep it alive. Returns None only when
    even those can't be built.
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

    # Intraday features (15-min RM+KC): the NY-after-RC-close move and robusta's
    # overnight gap. Each is added independently when it has enough overlap with
    # the price-archive index. No ffill — only real days contribute; missing /
    # roll-excluded days stay NaN and drop out of training (dropna in run()).
    if intraday is not None and not intraday.empty:
        for key in ("kc_after_rc_diff", "rc_overnight_gap"):
            if key not in intraday.columns:
                continue
            s = intraday[key].dropna()
            if len(s.index.intersection(rc.index)) >= _MIN_KC_RC_OVERLAP:
                cols[key] = s.reindex(rc.index)
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

    cci = _compute_cci_index()
    # Prefer the precise 15-min intraday source; fall back to the coarse hourly
    # kc_at_rc_close history (kc_after_rc_diff only) when intraday isn't present.
    intraday = _load_intraday()
    if intraday is None:
        legacy = _load_kc_after_rc(kc)
        intraday = (legacy.to_frame("kc_after_rc_diff")
                    if legacy is not None and not legacy.empty else None)
    n_roll_excluded = int(intraday["_rc_roll"].sum()) if (
        intraday is not None and "_rc_roll" in intraday.columns) else 0
    built = _build_frame(rc, kc, cci, intraday)
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

    # ── USD/ton ruler + price-gap detail ─────────────────────────────────────
    # Each factor is also quantified in robusta USD/MT so the magnitudes are
    # comparable on one dollar ruler. For the four return/level features the
    # USD/MT is the move expressed on the latest robusta price (the common
    # ruler); for the New-York Price Gap it's the LITERAL gap (KC$/MT − RC$/MT).
    def _at(series, dt):
        try:
            v = series.reindex([dt], method="ffill").iloc[0]
            return float(v) if pd.notna(v) else None
        except Exception:
            return None

    rc_px  = _at(rc, latest_date)                                   # robusta USD/MT
    kc_px  = _at(kc, latest_date)                                   # arabica ¢/lb
    kc_usd = kc_px * _KC_TO_USD_PER_MT if kc_px is not None else None

    # Price-gap components, written down: KC$/MT, RC$/MT, the gap, and the
    # rolling mean/std the z-score is built from (260-day window, see _build_frame).
    gap_series = (kc * _KC_TO_USD_PER_MT - rc).dropna()
    g_mu = gap_series.rolling(52 * 5, min_periods=20).mean()
    g_sd = gap_series.rolling(52 * 5, min_periods=20).std()
    gap_raw  = _at(gap_series, latest_date)
    gap_mean = _at(g_mu, latest_date)
    gap_std  = _at(g_sd, latest_date)
    gap_detail = None
    if None not in (kc_usd, rc_px, gap_raw):
        gap_detail = {
            "kc_usd_per_mt":       round(kc_usd, 1),
            "rc_usd_per_mt":       round(rc_px, 1),
            "gap_usd_per_mt":      round(gap_raw, 1),
            "gap_mean_usd_per_mt": round(gap_mean, 1) if gap_mean is not None else None,
            "gap_std_usd_per_mt":  round(gap_std, 1) if gap_std is not None else None,
            "formula": "gap = KC(¢/lb × 22.0462) − RC, in USD/MT; z-scored over a 260-day rolling window",
        }

    # CCI level %-deviation from its rolling mean (for the cci_z USD/MT ruler).
    cci_pct_dev = None
    if cci is not None and not cci.empty:
        cci_re = cci.reindex(rc.index, method="ffill")
        cci_lvl = _at(cci_re, latest_date)
        cci_m   = _at(cci_re.rolling(_CCI_Z_WINDOW, min_periods=20).mean(), latest_date)
        if cci_lvl is not None and cci_m:
            cci_pct_dev = (cci_lvl - cci_m) / cci_m

    def _usd_per_ton(key: str, raw: float) -> "float | None":
        if rc_px is None:
            return None
        if key == "kc_rc_gap_z":
            # The two z-score (level) features report their DEVIATION from the
            # rolling mean in USD/MT — comparable to the daily-move factors and
            # to each other. The literal gap level lives in `detail`.
            if gap_raw is None or gap_mean is None:
                return None
            return round(gap_raw - gap_mean, 1)
        if key == "cci_z":
            return round(cci_pct_dev * rc_px, 1) if cci_pct_dev is not None else None
        # Return-type features (rc_ret_1d, rc_overnight_gap, cci_ret_1d,
        # kc_after_rc_diff): the % move on the robusta price = USD/MT magnitude.
        return round(raw * rc_px, 1)

    spec_by_key = {k: (label, fmt) for k, label, fmt in _FEATURE_SPECS}
    features_out = []
    for key, raw, phi in zip(active_keys, x_raw.values, phis):
        label, fmt = spec_by_key[key]
        item = {
            "var_name":    key,
            "label":       label,
            "raw_value":   float(raw),
            "raw_fmt":     fmt(float(raw)),
            "usd_per_ton": _usd_per_ton(key, float(raw)),
            "phi":         float(phi),   # margin (log-odds) units; Σ = gap exactly
        }
        if key == "kc_rc_gap_z" and gap_detail is not None:
            item["detail"] = gap_detail
        features_out.append(item)
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
            "kc_after_rc_active":   "kc_after_rc_diff" in active_keys,
            "rc_overnight_active":  "rc_overnight_gap" in active_keys,
            "intraday_source":      "barchart_15min" if _INTRADAY.exists() else "hourly_fallback",
            "roll_days_excluded":   n_roll_excluded,
        },
    }


if __name__ == "__main__":
    out = run()
    print(json.dumps(out, indent=2, ensure_ascii=False)[:2000])
