"""News-feed static export."""
from datetime import datetime, timedelta

from models import (
    NewsItem,
)
from scraper.commentary import extract_commentary_from_meta
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import safe_write_json


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
    items = []
    for r in rows:
        item = {
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
        commentary = extract_commentary_from_meta(r.meta)
        if commentary is not None:
            item["commentary"] = commentary
        items.append(item)
    safe_write_json(
        OUT_DIR / "news.json",
        items,
        lambda d: (isinstance(d, list) and len(d) > 0, "empty news feed"),
    )
    n_commentary = sum(1 for it in items if "commentary" in it)
    print(f"  news.json → {len(items)} items ({n_commentary} with commentary)")
