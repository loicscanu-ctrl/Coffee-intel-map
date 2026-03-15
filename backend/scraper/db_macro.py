# backend/scraper/db_macro.py
# Upsert helpers for commodity_cot and commodity_prices tables.
# Session lifecycle is the CALLER'S responsibility (same pattern as scraper/db.py).

def upsert_commodity_cot(db, symbol: str, report_date, fields: dict) -> None:
    """Insert or update a commodity_cot row.
    fields keys: mm_long, mm_short, mm_spread, oi_total
    """
    from models import CommodityCot
    existing = db.query(CommodityCot).filter_by(date=report_date, symbol=symbol).first()
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
    else:
        db.add(CommodityCot(date=report_date, symbol=symbol, **fields))
    db.commit()


def upsert_commodity_price(db, symbol: str, report_date, close_price_usd: float) -> None:
    """Insert or update a commodity_prices row. Price must already be in USD."""
    from models import CommodityPrice
    existing = db.query(CommodityPrice).filter_by(date=report_date, symbol=symbol).first()
    if existing:
        existing.close_price = close_price_usd
    else:
        db.add(CommodityPrice(date=report_date, symbol=symbol, close_price=close_price_usd))
    db.commit()
