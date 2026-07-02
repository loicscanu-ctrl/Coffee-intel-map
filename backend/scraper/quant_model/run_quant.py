"""
run_quant.py
Orchestrate sentiment + robusta factor model → quant_report.json.
Preserves existing currency_index section.

Usage:
    cd backend
    python -m scraper.quant_model.run_quant
"""

import json
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from database import SessionLocal
from scraper.quant_model import sentiment as sentiment_mod
from scraper.quant_model import robusta_factors as factors_mod
from scraper.quant_model import calibration as calibration_mod
from scraper.validate_export import safe_write_json

ROOT      = Path(__file__).resolve().parents[3]
OUT_PATH  = ROOT / "frontend" / "public" / "data" / "quant_report.json"
HIST_PATH = ROOT / "frontend" / "public" / "data" / "sentiment_history.json"


def _append_sentiment_history(sent: dict) -> None:
    """Append today's sentiment snapshot to a rolling daily history so the UI can
    chart the net-sentiment trend. One record per day (re-running replaces the
    same date); keeps ~1 year. No-op when the section is unavailable."""
    if not sent.get("available"):
        return
    date = (sent.get("scraped_at", "") or "")[:10]
    if not date:
        return
    record = {
        "date":               date,
        "net_index":          sent.get("net_index", 0.0),
        "overall_sentiment":  sent.get("overall_sentiment", "Neutral"),
        "overall_confidence": sent.get("overall_confidence", 50.0),
        "bull":               sent.get("bull_count", 0),
        "bear":               sent.get("bear_count", 0),
        "neutral":            sent.get("neutral_count", 0),
        "total":              sent.get("total", 0),
    }
    history: list = []
    if HIST_PATH.exists():
        try:
            with open(HIST_PATH, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = []
    history = [h for h in history if h.get("date") != date]
    history.append(record)
    history.sort(key=lambda h: h.get("date", ""))
    history = history[-365:]
    safe_write_json(HIST_PATH, history,
                    lambda d: (isinstance(d, list), "sentiment history not a list"),
                    indent=None, ensure_ascii=False, separators=(",", ":"))
    print(f"  Sentiment history → {len(history)} days ({HIST_PATH.name})")


def main() -> None:
    db = SessionLocal()
    try:
        # Each sub-model is isolated: a transient failure (Gemini quota, a
        # network blip, etc.) becomes an {available: False} section instead of
        # crashing the whole step — so the workflow's Robusta step stops
        # hard-failing. CCI + fx_history are already committed beforehand, and
        # the freshness check (1.5) still flags a persistently-stale report.
        print("Running sentiment analysis...")
        try:
            sent = sentiment_mod.run(db)
        except Exception as e:  # noqa: BLE001
            sent = {"available": False, "reason": f"sentiment crashed: {e}"}
        if sent.get("available"):
            print(f"  Sentiment: {sent['overall_sentiment']} ({sent['overall_confidence']}%) — {sent['total']} headlines")
        else:
            print(f"  Sentiment unavailable: {sent.get('reason')}")

        print("Running robusta factor model...")
        try:
            factors = factors_mod.run(db)
        except Exception as e:  # noqa: BLE001
            factors = {"available": False, "reason": f"robusta crashed: {e}"}
        if factors.get("available"):
            pred = factors.get("prediction", {})
            model = factors.get("model", {})
            print(f"  Robusta: {pred.get('direction')} ΔP={pred.get('delta_p')} R²={model.get('r_squared')} n={model.get('n_obs')}")
        else:
            print(f"  Robusta factors unavailable: {factors.get('reason')}")

        # NOTE: the open-direction classifier is no longer computed here. It
        # fires pre-open (03:00 UTC) in open_direction_log.py, which owns both
        # the track record and quant_report.json["open_direction"] — this
        # evening run just preserves whatever that job last wrote (see the
        # merge below, which never touches the key).

        # Record today's sentiment snapshot, then calibrate the accumulated
        # history against realized KC/RC moves (needs the DB → runs while open).
        _append_sentiment_history(sent)
        print("Calibrating sentiment vs realized price moves...")
        try:
            calib = calibration_mod.run(db)
        except Exception as e:  # noqa: BLE001
            calib = {"available": False, "reason": f"calibration crashed: {e}"}
        if calib.get("available"):
            ar = calib.get("markets", {}).get("arabica", {})
            print(f"  Calibration: KC hit-rate {ar.get('hit_rate')}% corr {ar.get('corr')} (n={ar.get('n')})")
        else:
            print(f"  Calibration: {calib.get('reason')}")
    finally:
        db.close()

    # Merge into existing quant_report.json (preserve currency_index)
    existing: dict = {}
    if OUT_PATH.exists():
        try:
            with open(OUT_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            pass

    existing["sentiment"]             = sent
    existing["robusta_factors"]       = factors
    # existing["open_direction"] intentionally NOT set — owned by the 03:00
    # open_direction_log job; preserved via the merge-into-existing pattern.
    existing["sentiment_calibration"] = calib
    existing["scraped_at"]            = datetime.utcnow().isoformat() + "Z"

    safe_write_json(
        OUT_PATH, existing,
        lambda d: (d.get("sentiment") is not None and d.get("robusta_factors") is not None,
                   "missing sentiment or robusta_factors"),
    )

    print(f"Saved → {OUT_PATH}")


if __name__ == "__main__":
    main()
