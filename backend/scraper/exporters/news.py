"""News-feed static export."""
import json
from datetime import datetime, timedelta

from models import (
    NewsItem,
)
from scraper.exporters.base import OUT_DIR


def export_news(db) -> None:
    """Publish the recent news feed as a static file so the Map tab's News Feed
    works on the static site (the live /api/news backend isn't deployed)."""
    cutoff = datetime.utcnow() - timedelta(days=90)
    rows = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date >= cutoff)
        .order_by(NewsItem.pub_date.desc())
        .limit(200)
        .all()
    )
    items = [
        {
            "id": r.id,
            "title": r.title,
            "body": r.body,
            "source": r.source,
            "category": r.category,
            "lat": r.lat,
            "lng": r.lng,
            "tags": r.tags or [],
            "meta": r.meta,
            "pub_date": r.pub_date.isoformat() if r.pub_date else None,
        }
        for r in rows
    ]
    (OUT_DIR / "news.json").write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"  news.json → {len(items)} items")
