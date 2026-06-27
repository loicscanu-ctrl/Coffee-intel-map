"""
backfill_sentiment.py
Reconstruct historical sentiment_history.json by re-classifying the editorial
news already stored in the DB, bucketed by publication day. This bootstraps the
net-sentiment trend and its calibration without waiting weeks for live data.

Depth is bounded by how far back editorial (RSS, tag="news") headlines exist in
news_feed — data snapshots and auto-commentary are excluded, same as the live
classifier. Existing history dates are never overwritten, so forward/real days
take precedence over reconstructed ones.

Run where DATABASE_URL + GEMINI_API_KEY are configured:
    cd backend
    python -m scraper.quant_model.backfill_sentiment --days 120 --min-per-day 3
"""

import argparse
import json
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scraper.quant_model.sentiment import _aggregate, _filter_news, classify_headlines

ROOT = Path(__file__).resolve().parents[3]
HIST_PATH = ROOT / "frontend" / "public" / "data" / "sentiment_history.json"


def _bucket_by_day(rows) -> dict[str, list]:
    """Group NewsItem-like rows by their publication day (YYYY-MM-DD)."""
    by_day: dict[str, list] = defaultdict(list)
    for r in rows:
        pub = getattr(r, "pub_date", None)
        if pub is None:
            continue
        by_day[pub.date().isoformat()].append(r)
    return by_day


def _load_history() -> list[dict]:
    if not HIST_PATH.exists():
        return []
    try:
        with open(HIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def run(days: int = 120, min_per_day: int = 3, sleep_s: float = 1.0) -> int:
    from database import SessionLocal
    from models import NewsItem

    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(days=days)
        rows = (
            db.query(NewsItem)
            .filter(NewsItem.pub_date >= cutoff, NewsItem.title.isnot(None))
            .order_by(NewsItem.pub_date.desc())
            .all()
        )
    finally:
        db.close()

    by_day = _bucket_by_day(rows)
    history = _load_history()
    have = {h.get("date") for h in history}

    added = 0
    for day in sorted(by_day):
        if day in have:
            continue  # never clobber an existing (forward/real) day
        news = _filter_news(by_day[day], limit=25)
        if len(news) < min_per_day:
            continue
        try:
            items = classify_headlines(news)
        except Exception as e:  # noqa: BLE001
            print(f"[backfill] {day}: classify failed — {e}", file=sys.stderr)
            continue
        agg = _aggregate(items)
        history.append({
            "date":               day,
            "net_index":          agg["net_index"],
            "overall_sentiment":  agg["overall_sentiment"],
            "overall_confidence": agg["overall_confidence"],
            "bull":               agg["bull_count"],
            "bear":               agg["bear_count"],
            "neutral":            agg["neutral_count"],
            "total":              agg["total"],
        })
        added += 1
        print(f"[backfill] {day}: net {agg['net_index']:+.1f} "
              f"({agg['bull_count']}B/{agg['bear_count']}S/{agg['neutral_count']}N, n={agg['total']})")
        time.sleep(sleep_s)  # be gentle on the API quota

    history.sort(key=lambda h: h.get("date", ""))
    history = history[-365:]
    with open(HIST_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[backfill] added {added} day(s); history now {len(history)} day(s) → {HIST_PATH.name}")
    return added


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Backfill historical news sentiment.")
    ap.add_argument("--days", type=int, default=120, help="look-back window in days")
    ap.add_argument("--min-per-day", type=int, default=3, help="min headlines to score a day")
    ap.add_argument("--sleep", type=float, default=1.0, help="seconds between API calls")
    args = ap.parse_args()
    run(days=args.days, min_per_day=args.min_per_day, sleep_s=args.sleep)
