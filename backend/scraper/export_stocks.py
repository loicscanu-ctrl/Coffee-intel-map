"""
export_stocks.py
Reads DB and writes frontend/public/data/demand_stocks.json.

Sections:
  ecf    — European Coffee Federation port stocks (monthly series)
  japan  — AJCA Japan coffee imports + stocks (monthly series)
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models import NewsItem

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def export_stocks(db) -> None:
    # 1. ECF European stocks
    ecf_out = None
    try:
        ecf_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "ECF")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if ecf_item:
            meta = json.loads(ecf_item.meta or "{}")
            monthly = meta.get("monthly", [])
            latest_bags = meta.get("latest_bags", 0)
            ecf_out = {
                "source":       "ECF",
                "last_updated": meta.get("as_of", str(ecf_item.pub_date)[:10]),
                "monthly":      monthly,
                "latest_bags":  latest_bags,
                "latest_m_bags": round(latest_bags / 1_000_000, 2) if latest_bags else None,
            }
    except Exception as e:
        print(f"  [stocks] ECF section error: {e}")

    # 2. Japan AJCA imports
    japan_out = None
    try:
        ajca_item = (
            db.query(NewsItem)
            .filter(NewsItem.source == "AJCA")
            .order_by(NewsItem.pub_date.desc())
            .first()
        )
        if ajca_item:
            meta = json.loads(ajca_item.meta or "{}")
            japan_out = {
                "source":          "AJCA",
                "last_updated":    meta.get("period", str(ajca_item.pub_date)[:7]),
                "monthly_imports": meta.get("monthly_imports", []),
                "latest_mt":       meta.get("latest_mt"),
                "latest_bags":     meta.get("latest_bags"),
            }
    except Exception as e:
        print(f"  [stocks] Japan section error: {e}")

    result = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "ecf":   ecf_out,
        "japan": japan_out,
    }

    path = OUT_DIR / "demand_stocks.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  demand_stocks.json -> ecf:{ecf_out is not None} japan:{japan_out is not None}")


def main():
    print("Exporting demand stocks JSON...")
    db = SessionLocal()
    try:
        export_stocks(db)
    finally:
        db.close()
    print("Done")


if __name__ == "__main__":
    main()
