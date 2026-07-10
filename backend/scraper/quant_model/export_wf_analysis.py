"""
export_wf_analysis.py — regenerates the "Prediction vs Reality" walk-forward
analysis that powers the Research-tab article (OpenDirectionRecord.tsx).

Reconstructs, for every session in the intraday dataset, what the CURRENT
model spec would have predicted using only prior data (expanding walk-forward,
same fits as the live 03:07 job: logistic head for direction, ridge head for
magnitude), joins the realized overnight gap in $/t, and emits:

  frontend/public/data/open_direction_wf_analysis.json
    { generated_at, band, n, headline: {...cells with Wilson CIs...},
      buckets: {realized, predicted, confidence}, rows: [...] }

Each row: date, p (prob_up), pred (predicted gap $/t), act (realized gap $/t),
hit, plus the EXACT additive magnitude components (base / kc_after / dsr /
[cci] in $/t — they sum to pred) so the article can "ungroup" any prediction.

Called at the end of the daily open_direction_log run (non-fatal), so the
article tracks the live model spec: band changes, feature activations and new
data all flow through automatically.
"""
from __future__ import annotations

import json
from datetime import datetime
from math import sqrt

import numpy as np
import pandas as pd

from . import open_direction as _od

_OUT = _od._ROOT / "frontend" / "public" / "data" / "open_direction_wf_analysis.json"


def _wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (c - h, c + h)


def _cell(df: "pd.DataFrame") -> dict:
    n = len(df)
    k = int(df["hit"].sum()) if n else 0
    lo, hi = _wilson(k, n)
    cap = float(np.where(df["hit"], df["act"].abs(), -df["act"].abs()).mean()) if n else 0.0
    return {"n": n, "hit": round(k / n, 4) if n else None,
            "ci_lo": round(lo, 3), "ci_hi": round(hi, 3),
            "avg_abs_move": round(float(df["act"].abs().mean()), 1) if n else None,
            "capture": round(cap, 2)}


def _bucket(df: "pd.DataFrame", col: str, edges: list, labels: list[str]) -> list[dict]:
    out = []
    for lo, hi, lab in zip(edges[:-1], edges[1:], labels):
        m = (df[col] >= lo) & (df[col] < hi)
        g = df[m]
        if len(g):
            out.append({"label": lab, "n": int(len(g)), "hit": round(float(g["hit"].mean()), 4)})
    return out


def run(frame: "pd.DataFrame | None" = None) -> int:
    if frame is None:
        frame = _od.build_dataset()
    if frame is None:
        print("[wf_analysis] no dataset — skipped")
        return 0
    feats = _od.active_features(frame)
    d = frame.dropna(subset=["y"] + feats)
    if len(d) < _od._MIN_TRAIN + 30:
        print("[wf_analysis] not enough labelled rows — skipped")
        return 0
    X = d[feats].values
    y = d["y"].values.astype(float)
    g = d["gap"].values.astype(float)
    px = d["rc_close_prev"].values.astype(float)

    rows = []
    b = w = mu = sd = None
    for i in range(_od._MIN_TRAIN, len(d)):
        if (i - _od._MIN_TRAIN) % _od._WF_STEP == 0 or b is None:
            Xtr = X[:i]
            mu = Xtr.mean(0); sd = Xtr.std(0); sd[sd == 0] = 1.0
            Z = (Xtr - mu) / sd
            b = _od._fit_logistic(np.column_stack([np.ones(i), Z]), y[:i])
            w = _od._fit_ridge(Z, g[:i])
        z = (X[i] - mu) / sd
        p = _od._sigmoid(float(np.r_[1.0, z] @ b))
        comps = {"base": round(float(w[0]) * px[i], 1)}
        for j, k in enumerate(feats):
            comps[k] = round(float(w[1 + j] * z[j]) * px[i], 1)
        rows.append({
            "date": d.index[i].strftime("%Y-%m-%d"),
            "p": round(p, 4),
            "pred": round(float(np.r_[1.0, z] @ w) * px[i], 1),
            "act": round(float(g[i]) * px[i], 1),
            "hit": bool((p >= 0.5) == (y[i] > 0)),
            "raw": {k: round(float(X[i][j]), 5) for j, k in enumerate(feats)},
            "comps": comps,
        })

    df = pd.DataFrame([{**r, "conf": abs(r["p"] - 0.5)} for r in rows])
    band = _od._ABSTAIN_BAND
    acted = df[df["conf"] >= band]
    INF = float("inf")
    kc_raw = np.array([abs(r["raw"].get("kc_after_rc_diff", 0.0)) for r in rows])

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "band": band,
        "features": feats,
        "n": len(df),
        "span": [rows[0]["date"], rows[-1]["date"]],
        "headline": {
            "all":       _cell(df),
            "acted":     _cell(acted),                                  # current Undefined rule
            "confident": _cell(df[df["conf"] >= 0.15]),
            "strong":    _cell(df[(df["conf"] >= 0.10) & (df["pred"].abs() >= 10)]),
            "ny_shock":  _cell(df[kc_raw >= 0.008]),
        },
        "buckets": {
            "realized":   _bucket(df.assign(a=df["act"].abs()), "a",
                                  [0, 5, 10, 20, 40, INF],
                                  ["< $5/t", "$5–10", "$10–20", "$20–40", "> $40"]),
            "predicted":  _bucket(df.assign(a=df["pred"].abs()), "a",
                                  [0, 5, 10, 20, INF],
                                  ["< $5/t", "$5–10", "$10–20", "> $20"]),
            "confidence": _bucket(df, "conf",
                                  [0, 0.03, 0.06, 0.10, 0.15, INF],
                                  ["0–3pp", "3–6pp", "6–10pp", "10–15pp", "> 15pp"]),
        },
        "rows": rows,
    }
    _OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    print(f"[wf_analysis] wrote {len(rows)} rows "
          f"({rows[0]['date']} → {rows[-1]['date']}) · acted hit "
          f"{payload['headline']['acted']['hit']}")
    return len(rows)


if __name__ == "__main__":
    run()
