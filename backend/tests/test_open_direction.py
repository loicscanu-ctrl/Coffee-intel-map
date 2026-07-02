"""Tests for the open-price-direction model (overnight-gap spec).

Covers the sanity gates agreed in docs/research/open-price-direction-findings.md:
  * DST regression — the Chicago→London bar anchoring stays correct in summer,
    winter AND the few weeks when the US and UK switch on different dates.
  * Payload invariants — exact SHAP additivity, prob consistency, abstain band.
  * No-lookahead — every feature in row t is prior-session information.
  * Roll handling — roll days are unlabelled and resolve to "void", never graded.
  * Log lifecycle — seed → pending prediction → resolve, idempotent re-runs.
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scraper.fetch_intraday_kc_rc import _parse_csv_to_london          # noqa: E402
from scraper.quant_model import open_direction as od                   # noqa: E402
from scraper.quant_model import open_direction_log as odl              # noqa: E402


# ── DST regression on the bar anchoring ──────────────────────────────────────
# Barchart stamps bars in America/Chicago; the 17:30-London price is the CLOSE
# of the bar that STARTS 17:15 London. London↔Chicago is 6h apart almost all
# year, but 5h during the spring/fall weeks when the US has switched and the
# UK hasn't (or vice versa). A hardcoded +6h would misread those weeks.

@pytest.mark.parametrize("chicago_ts,expected_london_date,expected_bar", [
    ("2025-07-16 11:15", "2025-07-16", "17:15"),  # summer: BST/CDT, 6h apart
    ("2025-01-15 11:15", "2025-01-15", "17:15"),  # winter: GMT/CST, 6h apart
    ("2025-10-29 12:15", "2025-10-29", "17:15"),  # mismatch week: UK switched
                                                   # (GMT), US not yet (CDT) → 5h
])
def test_dst_bar_anchoring(chicago_ts, expected_london_date, expected_bar):
    csv = f"{chicago_ts},15,100.0,101.0,99.0,100.5,1200"
    out = _parse_csv_to_london(csv)
    assert expected_london_date in out, out
    assert expected_bar in out[expected_london_date], out[expected_london_date]
    assert out[expected_london_date][expected_bar]["close"] == 100.5


def test_dst_mismatch_week_would_break_a_fixed_offset():
    # The same London bar (17:15 start) sits at a DIFFERENT Chicago wall-clock
    # in the mismatch week (12:15) than in summer/winter (11:15) — proving a
    # fixed offset can't work and tz-aware conversion is required.
    summer = _parse_csv_to_london("2025-07-16 11:15,16,1,1,1,1,0")
    mismatch = _parse_csv_to_london("2025-10-29 11:15,29,1,1,1,1,0")
    assert "17:15" in summer["2025-07-16"]
    assert "17:15" not in mismatch.get("2025-10-29", {})   # 11:15 CT = 16:15 London


# ── synthetic intraday dataset with a planted, learnable signal ──────────────

def _make_rows(n=330, seed=7, roll_every=40):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2024-01-02", periods=n)
    rows, rc_close, kc = [], 4000.0, 300.0
    kc_after_prev = 0.0
    for i, d in enumerate(dates):
        sym = f"RC{chr(65 + i // roll_every)}"
        # planted signal: today's gap follows yesterday's NY-after-close move
        gap = 0.6 * kc_after_prev + rng.normal(0, 0.002)
        rc_open = rc_close * (1 + gap)
        kc_after = float(rng.normal(0, 0.006))
        kc_1730 = kc * (1 + rng.normal(0, 0.001))
        rows.append({
            "date": d.strftime("%Y-%m-%d"),
            "rc_symbol": sym, "kc_symbol": "KCA",
            "rc_open_first": round(rc_open, 2),
            "rc_open_0915":  round(rc_open * (1 + rng.normal(0, 0.001)), 2),
            "rc_last_1730":  round(rc_close * (1 + rng.normal(0, 0.003)), 2),
            "kc_last_1730":  round(kc_1730, 2),
            "kc_last_1830":  round(kc_1730 * (1 + kc_after), 2),
            "rc_settle": None, "kc_settle": None,
        })
        rc_close = rows[-1]["rc_last_1730"]
        kc_after_prev = kc_after
    return rows


@pytest.fixture
def synthetic_env(tmp_path, monkeypatch):
    intraday = tmp_path / "intraday.json"
    intraday.write_text(json.dumps(_make_rows()), encoding="utf-8")
    history = tmp_path / "history.json"
    quant = tmp_path / "quant_report.json"
    quant.write_text(json.dumps({"currency_index": {"scraped_at": "x"}}), encoding="utf-8")
    monkeypatch.setattr(od, "_INTRADAY", intraday)
    monkeypatch.setattr(od, "_FX_SNAPS", tmp_path / "absent.json")
    monkeypatch.setattr(odl, "_HISTORY", history)
    monkeypatch.setattr(odl, "_QUANT", quant)
    return {"intraday": intraday, "history": history, "quant": quant}


def test_payload_invariants(synthetic_env):
    p = od.run()
    assert p["available"], p.get("reason")
    # exact SHAP additivity
    assert abs(sum(f["phi"] for f in p["features"])
               - (p["final_margin"] - p["base_margin"])) < 1e-9
    # prob consistency + direction/abstain coherence
    assert abs(p["prob_up"] + p["prob_down"] - 1.0) < 1e-12
    if abs(p["prob_up"] - 0.5) < p["target"]["abstain_band"]:
        assert p["direction"] == "Abstain"
    else:
        assert p["direction"] == ("Bullish" if p["prob_up"] >= 0.5 else "Bearish")
    # the planted signal must be learnable out-of-sample
    assert p["model"]["edge"] is not None and p["model"]["edge"] > 0.05
    # for_session is the next business day after the last data day
    assert p["for_session"] > p["as_of"]


def test_no_lookahead_alignment(synthetic_env):
    frame = od.build_dataset()
    rows = json.loads(synthetic_env["intraday"].read_text())
    by_date = {r["date"]: r for r in rows}
    dates = sorted(by_date)
    for t_prev, t in [(dates[10], dates[11]), (dates[100], dates[101])]:
        prev = by_date[t_prev]
        expected = prev["kc_last_1830"] / prev["kc_last_1730"] - 1.0
        got = frame.at[pd.Timestamp(t), "kc_after_rc_diff"]
        assert abs(got - expected) < 1e-12
    # live vector uses the LAST row's (unshifted) kc_after
    p = od.run()
    last = by_date[dates[-1]]
    live_kc = next(f for f in p["features"] if f["var_name"] == "kc_after_rc_diff")
    assert abs(live_kc["raw_value"] - (last["kc_last_1830"] / last["kc_last_1730"] - 1.0)) < 1e-12


def test_roll_days_unlabelled(synthetic_env):
    frame = od.build_dataset()
    rolls = frame[frame["_roll"]]
    assert len(rolls) >= 5
    assert rolls["gap"].isna().all() and rolls["y"].isna().all()


def test_log_lifecycle(synthetic_env):
    rows = json.loads(synthetic_env["intraday"].read_text())
    # run on truncated data → seeds + one pending live prediction
    synthetic_env["intraday"].write_text(json.dumps(rows[:-1]), encoding="utf-8")
    odl.run()
    h = json.loads(synthetic_env["history"].read_text())
    dates = [r["date"] for r in h]
    assert len(dates) == len(set(dates))
    pend = [r for r in h if r["status"] == "pending"]
    assert len(pend) == 1 and pend[0]["source"] == "live"
    assert pend[0]["date"] == rows[-1]["date"]     # predicts the withheld session
    # idempotent re-run: no duplicate prediction
    odl.run()
    h2 = json.loads(synthetic_env["history"].read_text())
    assert len(h2) == len(h)
    # the withheld session's data arrives → pending resolves with the actual
    synthetic_env["intraday"].write_text(json.dumps(rows), encoding="utf-8")
    odl.run()
    h3 = json.loads(synthetic_env["history"].read_text())
    resolved = next(r for r in h3 if r["date"] == rows[-1]["date"])
    assert resolved["status"] == "resolved"
    assert resolved["actual_dir"] in ("Up", "Down")
    assert resolved["hit"] in (True, False, None)
    # panel payload written alongside, other sections preserved
    q = json.loads(synthetic_env["quant"].read_text())
    assert q["open_direction"]["available"] and "currency_index" in q
    # the history row and the panel payload came from the SAME prediction
    new_pend = [r for r in h3 if r["status"] == "pending"]
    assert len(new_pend) == 1
    assert new_pend[0]["date"] == q["open_direction"]["for_session"]
    assert abs(new_pend[0]["prob_up"] - round(q["open_direction"]["prob_up"], 4)) < 1e-9
