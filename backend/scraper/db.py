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


def upsert_cot_price(market: str, report_date, price_field: str, value: float) -> bool:
    """Store a Tuesday settlement price in cot_weekly only if not already set.
    Prices are immutable once recorded — never overwritten by subsequent runs.
    Returns True if written, False if skipped (already set)."""
    from models import CotWeekly
    db = get_session()
    try:
        existing = db.query(CotWeekly).filter_by(date=report_date, market=market).first()
        if existing:
            if getattr(existing, price_field) is not None:
                print(f"[db] {market} {price_field} for {report_date} already set — skipping")
                return False
            setattr(existing, price_field, value)
        else:
            db.add(CotWeekly(date=report_date, market=market, **{price_field: value}))
        db.commit()
        return True
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


def create_physical_prices_table():
    """Create physical_prices table if it doesn't exist."""
    from database import Base
    from models import PhysicalPrice
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[PhysicalPrice.__table__])
    print("[db] physical_prices table created/verified")


def upsert_physical_price(db, *, symbol: str, price: float, currency: str,
                          unit: str, source: str, price_date) -> None:
    from models import PhysicalPrice
    existing = db.query(PhysicalPrice).filter_by(symbol=symbol, price_date=price_date).first()
    if existing:
        existing.price = price
        existing.source = source
    else:
        db.add(PhysicalPrice(
            symbol=symbol, price=price, currency=currency,
            unit=unit, source=source, price_date=price_date,
        ))
    try:
        db.commit()
    except Exception:
        db.rollback()


def create_vn_local_prices_table():
    """Create vn_local_prices table if it doesn't exist."""
    from database import Base
    from models import VnLocalPrice
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[VnLocalPrice.__table__])


def upsert_vn_local_price(prices: dict, recorded_at) -> None:
    """Insert a new VN local price snapshot. Keeps last 60 rows, purges older ones."""
    from models import VnLocalPrice
    db = get_session()
    try:
        db.add(VnLocalPrice(
            recorded_at=recorded_at,
            local_time=prices.get("local_time"),
            prices=prices,
        ))
        db.commit()
        # Purge rows older than the newest 60
        subq = (
            db.query(VnLocalPrice.id)
            .order_by(VnLocalPrice.recorded_at.desc())
            .limit(60)
            .subquery()
        )
        db.query(VnLocalPrice).filter(~VnLocalPrice.id.in_(subq)).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_latest_vn_local_price() -> dict | None:
    """Return the most recently captured VN local prices dict, or None."""
    from models import VnLocalPrice
    db = get_session()
    try:
        row = db.query(VnLocalPrice).order_by(VnLocalPrice.recorded_at.desc()).first()
        if not row:
            return None
        return {"saved_at": row.recorded_at.isoformat() + "Z", **row.prices}
    except Exception:
        return None
    finally:
        db.close()


def extract_physical_price(item: dict) -> dict | None:
    """Parse a news item dict → PhysicalPrice kwargs, or None if not a structured price."""
    import re
    from datetime import date as _date
    import json as _json

    tags = set(item.get("tags", []))
    body = item.get("body", "") or ""
    source = item.get("source", "")
    today = _date.today()

    # FX rates
    if "fx" in tags:
        m = re.search(r"price:\s*([\d.,]+)", body, re.I)
        if not m:
            return None
        rate = float(m.group(1).replace(",", ""))
        sym_map = {
            "brazil": "USD_BRL", "vietnam": "USD_VND", "indonesia": "USD_IDR",
            "honduras": "USD_HNL", "uganda": "USD_UGX",
        }
        for country, sym in sym_map.items():
            if country in tags:
                return dict(symbol=sym, price=rate, currency="USD", unit="rate",
                            source=source, price_date=today)
        return None

    # VN FAQ
    if "price" in tags and "vietnam" in tags and "futures" not in tags:
        m = re.search(r"price:\s*([\d.]+)\s*VND/kg", body, re.I)
        if not m:
            return None
        raw = m.group(1)
        vnd_kg = int(raw.replace(".", "")) if re.match(r"^\d{2,3}\.\d{3}$", raw) else int(float(raw))
        return dict(symbol="VN_FAQ", price=float(vnd_kg), currency="VND", unit="per_kg",
                    source=source, price_date=today)

    # UGA S15
    if "price" in tags and "uganda" in tags and "futures" not in tags:
        m = re.search(r"price:\s*([\d.]+)\s*USD/cwt", body, re.I)
        if not m:
            return None
        return dict(symbol="UGA_S15", price=float(m.group(1)), currency="USD", unit="per_cwt",
                    source=source, price_date=today)

    # CON T7 (Cooabriel — /saca format)
    if "price" in tags and "brazil" in tags and ("conilon" in tags or "robusta" in tags) and "futures" not in tags:
        m = re.search(r"R\$\s*([\d.,]+)/saca", body, re.I)
        if not m:
            return None
        brl_val = float(m.group(1).replace(".", "").replace(",", "."))
        return dict(symbol="CON_T7", price=brl_val, currency="BRL", unit="per_saca",
                    source=source, price_date=today)

    # B3 ICF arabica settlement
    if "futures" in tags and "price" in tags and "arabica" in tags and "b3" in tags:
        m = re.search(r"settlement:\s*([\d.]+)\s*USD/sac", body, re.I)
        if not m:
            return None
        return dict(symbol="B3_ICF", price=float(m.group(1)), currency="USD", unit="per_sac",
                    source=source, price_date=today)

    # KC / RC front month (from meta JSON)
    if "futures" in tags and "price" in tags and "b3" not in tags:
        meta_str = item.get("meta")
        if not meta_str:
            return None
        try:
            front = _json.loads(meta_str).get("contracts", [{}])[0]
            last = front.get("last")
            if last is None:
                return None
            if "arabica" in tags:
                return dict(symbol="KC_FRONT", price=float(last), currency="USD", unit="cts_per_lb",
                            source=source, price_date=today)
            if "robusta" in tags:
                return dict(symbol="RC_FRONT", price=float(last), currency="USD", unit="usd_per_mt",
                            source=source, price_date=today)
        except Exception:
            pass

    return None
