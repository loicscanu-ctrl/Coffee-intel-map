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
from scraper.validate_export import safe_write_json

ROOT     = Path(__file__).resolve().parents[3]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "quant_report.json"


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

    existing["sentiment"]       = sent
    existing["robusta_factors"] = factors
    existing["scraped_at"]      = datetime.utcnow().isoformat() + "Z"

    safe_write_json(
        OUT_PATH, existing,
        lambda d: (d.get("sentiment") is not None and d.get("robusta_factors") is not None,
                   "missing sentiment or robusta_factors"),
    )

    print(f"Saved → {OUT_PATH}")


if __name__ == "__main__":
    main()
