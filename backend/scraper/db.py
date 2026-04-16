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
    if "futures" in tags and "price" in tags and item.get("source"):
        # Futures chain: keep history — only replace same-date entry (title includes date)
        (db.query(NewsItem)
           .filter(NewsItem.title == item["title"])
           .delete(synchronize_session=False))
        db.commit()
    elif replace_tags.intersection(tags) and item.get("source"):
        # Other price items: replace by source + title prefix (no history needed)
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


def migrate_cot_weekly_columns():
    """Add any missing columns to cot_weekly (safe to run repeatedly)."""
    engine = _get_engine()
    from sqlalchemy import text
    new_cols = [
        ("pmpu_long_old", "INTEGER"), ("pmpu_short_old", "INTEGER"),
        ("swap_long_old", "INTEGER"), ("swap_short_old", "INTEGER"), ("swap_spread_old", "INTEGER"),
        ("mm_long_old", "INTEGER"),   ("mm_short_old", "INTEGER"),   ("mm_spread_old", "INTEGER"),
        ("other_long_old", "INTEGER"),("other_short_old", "INTEGER"),("other_spread_old", "INTEGER"),
        ("nr_long_old", "INTEGER"),   ("nr_short_old", "INTEGER"),
        ("pmpu_long_other", "INTEGER"),("pmpu_short_other", "INTEGER"),
        ("swap_long_other", "INTEGER"),("swap_short_other", "INTEGER"),("swap_spread_other", "INTEGER"),
        ("mm_long_other", "INTEGER"),  ("mm_short_other", "INTEGER"), ("mm_spread_other", "INTEGER"),
        ("other_long_other", "INTEGER"),("other_short_other", "INTEGER"),("other_spread_other", "INTEGER"),
        ("nr_long_other", "INTEGER"),  ("nr_short_other", "INTEGER"),
    ]
    with engine.connect() as conn:
        for col, col_type in new_cols:
            try:
                conn.execute(text(
                    f"ALTER TABLE cot_weekly ADD COLUMN IF NOT EXISTS {col} {col_type}"
                ))
                conn.commit()
            except Exception as e:
                print(f"[db] migrate col {col}: {e}")


def upsert_cot_weekly(market: str, report_date, fields: dict):
    from models import CotWeekly
    db = get_session()
    try:
        existing = db.query(CotWeekly).filter_by(date=report_date, market=market).first()
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            db.add(CotWeekly(date=report_date, market=market, **fields))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def create_farmer_economics_tables():
    """Create WeatherSnapshot and FertilizerImport tables if they don't exist."""
    from database import Base
    from models import WeatherSnapshot, FertilizerImport
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[
        WeatherSnapshot.__table__,
        FertilizerImport.__table__,
    ])
    print("[db] farmer_economics tables created/verified")
