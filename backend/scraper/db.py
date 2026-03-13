import os
from datetime import datetime
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://coffee:coffee@localhost:5432/coffee_intel")

_engine = None
_Session = None

def _get_engine():
    global _engine, _Session
    if _engine is None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        _engine = create_engine(DATABASE_URL)
        _Session = sessionmaker(bind=_engine)
    return _engine

def get_session():
    _get_engine()
    return _Session()

def upsert_news_item(db, item: dict):
    from models import NewsItem
    # For price items, replace any existing entry from the same source
    tags = item.get("tags", [])
    replace_tags = {"price", "cot", "futures_chain"}
    if replace_tags.intersection(tags) and item.get("source"):
        # Also match by title prefix to distinguish KC vs RM futures chains
        title_prefix = item["title"].split("–")[0].strip()
        (db.query(NewsItem)
           .filter(NewsItem.source == item["source"],
                   NewsItem.title.like(f"{title_prefix}%"))
           .delete(synchronize_session=False))
        db.commit()
    elif db.query(NewsItem).filter_by(title=item["title"]).first():
        return
    try:
        db.add(NewsItem(
            title=item["title"],
            body=item.get("body", ""),
            source=item.get("source", ""),
            category=item.get("category", "general"),
            lat=item.get("lat"),
            lng=item.get("lng"),
            tags=item.get("tags", []),
            meta=item.get("meta"),
            pub_date=item.get("pub_date", datetime.utcnow()),
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[db] Failed to insert '{item.get('title')}': {e}")

def upsert_freight_rate(index_code: str, rate_date, rate: float):
    from models import FreightRate
    db = get_session()
    try:
        existing = db.query(FreightRate).filter_by(
            index_code=index_code, date=rate_date
        ).first()
        if existing:
            existing.rate = rate
        else:
            db.add(FreightRate(index_code=index_code, date=rate_date, rate=rate))
        db.commit()
    except Exception:
        db.rollback()
        raise  # Let the caller (scraper loop) decide how to handle failures
    finally:
        db.close()
