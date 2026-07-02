"""
open_direction_log.py — pre-open runner for the Robusta open-price-direction
model: ONE prediction per session, TWO artifacts.

Runs at 03:00 UTC (Mon–Fri). Each run:

  1. RESOLVES any still-pending history rows whose session has since traded
     (fills the realized overnight gap + hit/miss; roll days become "void").
     Resolution is decoupled from prediction so the record stays honest — a
     prediction is written before its outcome exists and never edited except
     to attach the actual.
  2. Calls open_direction.run() ONCE for the upcoming session and writes:
       • an append-only row in open_direction_history.json  (the track record)
       • quant_report.json["open_direction"]                (the Macro panel)
     Both artifacts therefore always show the same prediction.

On first run (no history file) it seeds the record with the same model's
walk-forward backtest so the calendar isn't empty — those rows are tagged
source="backtest"; live rows are source="live".

Model + target spec: see open_direction.py and
docs/research/open-price-direction-findings.md.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scraper.quant_model import open_direction as _od

_ROOT     = Path(__file__).resolve().parents[3]
_HISTORY  = _ROOT / "frontend" / "public" / "data" / "open_direction_history.json"
_QUANT    = _ROOT / "frontend" / "public" / "data" / "quant_report.json"

_SEED_FEATURES = ["kc_after_rc_diff", "days_since_roll"]


def _row(date_str: str, prob_up: float, source: str,
         factors: "list[dict] | None" = None) -> dict:
    ab = abs(prob_up - 0.5) < _od._ABSTAIN_BAND
    out = {
        "date": date_str,
        "prob_up": round(prob_up, 4),
        "direction": "Abstain" if ab else ("Bullish" if prob_up >= 0.5 else "Bearish"),
        "actual_gap_pct": None, "actual_dir": None, "hit": None,
        "status": "pending", "source": source,
    }
    if factors:
        out["factors"] = factors
    return out


def _payload_factors(payload: dict) -> list[dict]:
    """Compact per-feature attribution stored with every prediction (item 3b):
    exact SHAP φᵢ + raw value per feature. Cheap to store now, impossible to
    reconstruct later — enables 'which feature has been earning' on live data."""
    return [{
        "var_name":  f["var_name"],
        "raw_value": round(float(f["raw_value"]), 6),
        "raw_fmt":   f.get("raw_fmt"),
        "phi":       round(float(f["phi"]), 4),
    } for f in (payload.get("features") or [])]


def _seed(frame: "pd.DataFrame") -> list[dict]:
    """Walk-forward backtest → resolved rows (source='backtest'), same model.
    Each row carries its per-feature φ (same exact-SHAP identity as live rows)."""
    d = frame.dropna(subset=["y"] + _SEED_FEATURES)
    X = d[_SEED_FEATURES].values
    y = d["y"].values.astype(float)
    gap = d["gap"].values
    out: list[dict] = []
    b = mu = sd = None
    for i in range(_od._MIN_TRAIN, len(d)):
        if (i - _od._MIN_TRAIN) % _od._WF_STEP == 0 or b is None:
            Xtr = X[:i]
            mu = Xtr.mean(0); sd = Xtr.std(0); sd[sd == 0] = 1.0
            b = _od._fit_logistic(np.column_stack([np.ones(i), (Xtr - mu) / sd]), y[:i])
        z = (X[i] - mu) / sd
        p = _od._sigmoid(float(np.r_[1.0, z] @ b))
        factors = [{
            "var_name":  k,
            "raw_value": round(float(X[i][j]), 6),
            "phi":       round(float(b[1 + j] * z[j]), 4),
        } for j, k in enumerate(_SEED_FEATURES)]
        r = _row(d.index[i].strftime("%Y-%m-%d"), p, "backtest", factors=factors)
        r["actual_gap_pct"] = round(float(gap[i]) * 100, 3)
        r["actual_dir"] = "Up" if y[i] > 0 else "Down"
        r["hit"] = None if r["direction"] == "Abstain" else bool((p >= 0.5) == (y[i] > 0))
        r["status"] = "resolved"
        out.append(r)
    return out


def _ensure_seed_factors(history: list[dict], frame: "pd.DataFrame") -> list[dict]:
    """One-time backfill: if the backtest seed predates per-row factor logging
    OR an abstain-band retune (stored Abstain labels inconsistent with the
    current band), regenerate the backtest rows — they are deterministic from
    data + model spec. LIVE rows are never touched: they are the append-only
    forward record."""
    bt = [r for r in history if r.get("source") == "backtest"]
    band_stale = any(
        (r.get("direction") == "Abstain") != (abs(r.get("prob_up", 0.5) - 0.5) < _od._ABSTAIN_BAND)
        for r in bt
    )
    if not bt or (all(r.get("factors") for r in bt) and not band_stale):
        return history
    live = [r for r in history if r.get("source") == "live"]
    regenerated = _seed(frame)
    live_dates = {r["date"] for r in live}
    merged = [r for r in regenerated if r["date"] not in live_dates] + live
    merged.sort(key=lambda r: r["date"])
    print(f"[open_dir_log] backfilled factors: regenerated {len(regenerated)} "
          f"backtest rows (live rows untouched: {len(live)})")
    return merged


# ── Live drift monitoring (item 3a) ──────────────────────────────────────────

_ROLL_WINDOW  = 60    # graded acted live rows in the rolling window
_COLD_MIN_N   = 20    # need at least this many before a cold-streak call
_COLD_BELOW   = 0.50  # rolling hit-rate under this ⇒ cold streak


def _track_stats(history: list[dict]) -> dict:
    """Rolling live performance for the payload + brief: the model's own
    monitoring. Only ACTED (non-abstain) resolved live rows are graded."""
    graded = [r for r in history
              if r.get("source") == "live" and r.get("status") == "resolved"
              and r.get("hit") is not None]
    window = graded[-_ROLL_WINDOW:]
    hit_all = (sum(1 for r in graded if r["hit"]) / len(graded)) if graded else None
    hit_win = (sum(1 for r in window if r["hit"]) / len(window)) if window else None
    cold = bool(len(window) >= _COLD_MIN_N and hit_win is not None
                and hit_win < _COLD_BELOW)
    return {
        "live_graded":         len(graded),
        "live_hit_rate":       round(hit_all, 4) if hit_all is not None else None,
        "rolling_hit_rate":    round(hit_win, 4) if hit_win is not None else None,
        "rolling_n":           len(window),
        "cold_streak":         cold,
    }


def _resolve(history: list[dict], frame: "pd.DataFrame") -> int:
    resolved = 0
    for r in history:
        if r.get("status") != "pending":
            continue
        d = pd.Timestamp(r["date"])
        if d not in frame.index:
            continue                      # session hasn't traded yet
        g = frame.at[d, "gap"]
        if pd.isna(g):
            r["status"] = "void"          # roll day / missing bar — not gradable
            continue
        g = float(g); up = g > 0
        r["actual_gap_pct"] = round(g * 100, 3)
        r["actual_dir"] = "Up" if up else "Down"
        r["hit"] = None if r["direction"] == "Abstain" else bool(
            (r["prob_up"] >= 0.5) == up)
        r["status"] = "resolved"
        resolved += 1
    return resolved


def _write_quant_report(payload: dict) -> None:
    """Merge the panel payload into quant_report.json without touching the
    other sections (mirrors run_quant's merge-into-existing pattern)."""
    existing: dict = {}
    if _QUANT.exists():
        try:
            existing = json.loads(_QUANT.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
    existing["open_direction"] = payload
    _QUANT.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


def run() -> None:
    frame = _od.build_dataset()
    if frame is None:
        print("[open_dir_log] no intraday data — skipping")
        return

    history: list[dict] = []
    if _HISTORY.exists():
        try:
            history = json.loads(_HISTORY.read_text(encoding="utf-8"))
        except Exception:
            history = []
    if not history:
        history = _seed(frame)
        print(f"[open_dir_log] seeded {len(history)} backtest rows")
    else:
        history = _ensure_seed_factors(history, frame)

    resolved = _resolve(history, frame)

    payload = _od.run()
    added = 0
    if payload.get("available"):
        target = payload["for_session"]
        if target not in {r["date"] for r in history}:
            history.append(_row(target, float(payload["prob_up"]), "live",
                                factors=_payload_factors(payload)))
            added = 1
        payload["track"] = _track_stats(history)
        _write_quant_report(payload)
        print(f"[open_dir_log] prediction for {target}: {payload['direction']} "
              f"p_up={payload['prob_up']:.3f} → history + quant_report")
    else:
        print(f"[open_dir_log] model unavailable: {payload.get('reason')} — "
              "history resolved only, panel payload left untouched")

    history.sort(key=lambda r: r["date"])
    _HISTORY.write_text(json.dumps(history, indent=1), encoding="utf-8")

    live = [r for r in history if r["source"] == "live" and r["status"] == "resolved"]
    graded = [r["hit"] for r in live if r["hit"] is not None]
    tail = (f" | live graded={len(graded)} hit-rate={np.mean(graded):.1%}"
            if graded else "")
    print(f"[open_dir_log] rows={len(history)} resolved+{resolved} pred+{added}{tail}")


if __name__ == "__main__":
    run()
