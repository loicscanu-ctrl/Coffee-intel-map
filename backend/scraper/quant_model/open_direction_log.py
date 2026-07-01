"""
open_direction_log.py — append-only track record for the Robusta open-price-
direction model (Stage 1 of the live rollout).

Runs pre-open (03:00 UTC, Mon–Fri). Each run:

  1. RESOLVES any still-pending predictions whose session has since traded
     (fills the realized overnight gap + hit/miss). Resolution is decoupled
     from prediction so the record stays honest — a prediction is written
     before its outcome exists and never edited except to attach the actual.
  2. EMITS a fresh prediction for the upcoming session from the locked, proven
     feature set (`kc_after_rc_diff` + `days_since_roll`; `cci_overnight` joins
     later once its snapshots accumulate), with an abstain band on low
     confidence.

On first run (no history file) it seeds the record with the walk-forward
backtest so the calendar isn't empty — those rows are tagged source="backtest";
live rows are source="live". The model is identical in both, so the series is
continuous.

Target: direction of the overnight gap = RC first-bar open ÷ prior 17:30-London
close − 1 (roll days excluded). See docs/research/open-price-direction-findings.md.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ROOT      = Path(__file__).resolve().parents[3]
_INTRADAY  = _ROOT / "frontend" / "public" / "data" / "intraday_kc_rc_15min.json"
_HISTORY   = _ROOT / "frontend" / "public" / "data" / "open_direction_history.json"

_FEATURES  = ["kc_after", "dsr"]
_ABSTAIN   = 0.03      # |prob_up − 0.5| below this → no directional call
_MIN_TRAIN = 252       # need ~1y of resolved history before we predict


# ── data assembly ────────────────────────────────────────────────────────────

def _build_frame() -> "pd.DataFrame | None":
    """Per-session frame: date index with y (up-gap label), kc_after, dsr, gap.

    The last row is the most recently *traded* session; its `y`/`gap` are known.
    Roll days carry NaN gap/label (excluded from training + never graded).
    """
    if not _INTRADAY.exists():
        return None
    rows = json.loads(_INTRADAY.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        return None
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    for c in ("rc_open_first", "rc_last_1730", "kc_last_1730", "kc_last_1830"):
        df[c] = pd.to_numeric(df.get(c), errors="coerce")

    prev_close = df["rc_last_1730"].shift(1)
    prev_sym   = df["rc_symbol"].shift(1)
    roll       = df["rc_symbol"].ne(prev_sym) & prev_sym.notna()
    gap = (df["rc_open_first"] / prev_close - 1.0).where(
        (prev_close > 0) & df["rc_open_first"].notna() & (~roll))

    kc_after = (df["kc_last_1830"] / df["kc_last_1730"] - 1.0).where(df["kc_last_1730"] > 0).shift(1)

    # days since the last front-month roll (past-only, no look-ahead)
    dsr = np.zeros(len(df)); c = 0
    for i, is_roll in enumerate(roll.values):
        c = 0 if is_roll else c + 1
        dsr[i] = c

    return pd.DataFrame({
        "gap": gap,
        "y":   (gap > 0).astype(float).where(gap.notna()),
        "kc_after": kc_after,
        "dsr": dsr,
    }, index=df.index)


# ── logistic (numpy IRLS + L2, intercept unpenalised) ────────────────────────

def _fit(X: np.ndarray, y: np.ndarray, l2: float = 1.0, it: int = 60) -> np.ndarray:
    n, k = X.shape
    Xb = np.column_stack([np.ones(n), X]); b = np.zeros(k + 1)
    P = np.eye(k + 1) * l2; P[0, 0] = 0
    for _ in range(it):
        p = 1 / (1 + np.exp(-np.clip(Xb @ b, -30, 30)))
        W = np.clip(p * (1 - p), 1e-6, None)
        try:
            step = np.linalg.solve(Xb.T @ (Xb * W[:, None]) + P, Xb.T @ (p - y) + P @ b)
        except np.linalg.LinAlgError:
            break
        b -= step
        if np.max(np.abs(step)) < 1e-8:
            break
    return b


def _prob(b, mu, sd, x) -> float:
    z = np.r_[1.0, (np.asarray(x, float) - mu) / sd] @ b
    return float(1 / (1 + np.exp(-np.clip(z, -30, 30))))


def _row(date, prob_up, source) -> dict:
    ab = abs(prob_up - 0.5) < _ABSTAIN
    return {
        "date": pd.Timestamp(date).strftime("%Y-%m-%d"),
        "prob_up": round(prob_up, 4),
        "direction": "Abstain" if ab else ("Bullish" if prob_up >= 0.5 else "Bearish"),
        "actual_gap_pct": None, "actual_dir": None, "hit": None,
        "status": "pending", "source": source,
    }


# ── walk-forward seed (first run only) ───────────────────────────────────────

def _seed(frame: "pd.DataFrame") -> list[dict]:
    d = frame.dropna(subset=["y"] + _FEATURES)
    X = d[_FEATURES].values; y = d["y"].values; gap = d["gap"].values
    out = []; b = mu = sd = None
    for i in range(_MIN_TRAIN, len(d)):
        if (i - _MIN_TRAIN) % 5 == 0 or b is None:
            Xtr = X[:i]; mu = Xtr.mean(0); sd = Xtr.std(0); sd[sd == 0] = 1
            b = _fit((Xtr - mu) / sd, y[:i])
        p = _prob(b, mu, sd, X[i])
        r = _row(d.index[i], p, "backtest")
        r["actual_gap_pct"] = round(float(gap[i]) * 100, 3)
        r["actual_dir"] = "Up" if y[i] > 0 else "Down"
        r["hit"] = None if r["direction"] == "Abstain" else bool((p >= 0.5) == (y[i] > 0))
        r["status"] = "resolved"
        out.append(r)
    return out


# ── run ──────────────────────────────────────────────────────────────────────

def run() -> None:
    frame = _build_frame()
    if frame is None:
        print("[open_dir_log] no intraday data — skipping"); return

    history = json.loads(_HISTORY.read_text(encoding="utf-8")) if _HISTORY.exists() else None
    if not history:
        history = _seed(frame)
        print(f"[open_dir_log] seeded {len(history)} backtest rows")

    by_date = frame  # date-indexed
    # 1) resolve pending rows whose session has since traded (non-roll gap known)
    resolved = 0
    for r in history:
        if r["status"] != "pending":
            continue
        d = pd.Timestamp(r["date"])
        if d in by_date.index and pd.notna(by_date.at[d, "gap"]):
            g = float(by_date.at[d, "gap"]); up = g > 0
            r["actual_gap_pct"] = round(g * 100, 3)
            r["actual_dir"] = "Up" if up else "Down"
            r["hit"] = None if r["direction"] == "Abstain" else bool(
                (r["prob_up"] >= 0.5) == up)
            r["status"] = "resolved"; resolved += 1
        elif d in by_date.index and pd.isna(by_date.at[d, "gap"]):
            r["status"] = "void"   # roll / no gradable session

    # 2) emit a prediction for the next session (features from the last traded day)
    d = frame.dropna(subset=["y"] + _FEATURES)
    last = frame.dropna(subset=_FEATURES).iloc[-1]
    next_date = np.busday_offset(frame.index[-1].date(), 1, roll="forward")
    have_dates = {r["date"] for r in history}
    added = 0
    if str(next_date) not in have_dates and len(d) >= _MIN_TRAIN:
        X = d[_FEATURES].values; mu = X.mean(0); sd = X.std(0); sd[sd == 0] = 1
        b = _fit((X - mu) / sd, d["y"].values)
        # dsr for the upcoming session = last observed + 1 (unless a roll lands, rare)
        feats = [last["kc_after"], last["dsr"] + 1]
        p = _prob(b, mu, sd, feats)
        history.append(_row(next_date, p, "live")); added = 1

    _HISTORY.write_text(json.dumps(history, indent=1), encoding="utf-8")
    live = [r for r in history if r["source"] == "live" and r["status"] == "resolved"]
    graded = [r["hit"] for r in live if r["hit"] is not None]
    if graded:
        print(f"[open_dir_log] rows={len(history)} resolved+{resolved} pred+{added} "
              f"| live graded={len(graded)} hit-rate={np.mean(graded):.1%}")
    else:
        print(f"[open_dir_log] rows={len(history)} resolved+{resolved} pred+{added}")


if __name__ == "__main__":
    run()
