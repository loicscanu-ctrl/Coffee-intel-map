# backend/routes/macro_cot.py
from datetime import date as DateType, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import CommodityCot, CommodityPrice
from scraper.sources.macro_cot import COMMODITY_SPECS

router = APIRouter(prefix="/api/macro-cot", tags=["macro-cot"])


class MacroCotEntry(BaseModel):
    symbol: str
    sector: str
    name: str
    mm_long: int
    mm_short: int
    mm_spread: int
    oi_total: int
    close_price: Optional[float] = None
    gross_exposure_usd: Optional[float] = None
    net_exposure_usd: Optional[float] = None


class MacroCotWeekResponse(BaseModel):
    date: str
    commodities: list[MacroCotEntry]


def _to_contract_value(price: float, spec: dict) -> float:
    """All price_unit variants resolve to price × contract_unit.
    Prices stored in commodity_prices are always in USD per base unit — proxy-sourced
    prices are converted at scrape time, so the formula is uniform across all symbols.
    """
    return price * spec["contract_unit"]


def _compute_exposures(mm_long: int, mm_short: int, mm_spread: int,
                       close_price: Optional[float], spec: dict) -> dict:
    if close_price is None:
        return {
            "gross_exposure_usd": None,
            "net_exposure_usd":   None,
        }

    cv = _to_contract_value(close_price, spec)
    return {
        "gross_exposure_usd": (mm_long + mm_short) * cv,
        "net_exposure_usd":   (mm_long - mm_short) * cv,
    }


@router.get("", response_model=list[MacroCotWeekResponse])
def get_macro_cot(
    response: Response,
    after: Optional[str] = Query(None, description="Exclusive lower bound date YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "public, max-age=300"
    if after:
        try:
            cutoff = DateType.fromisoformat(after)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'after' date. Use YYYY-MM-DD.")
    else:
        cutoff = DateType.today() - timedelta(weeks=52)

    cot_rows = (db.query(CommodityCot)
                  .filter(CommodityCot.date > cutoff)
                  .order_by(CommodityCot.date.asc())
                  .all())

    # Build price lookup {(date, symbol): close_price}
    price_rows = (db.query(CommodityPrice)
                    .filter(CommodityPrice.date > cutoff)
                    .all())
    price_map = {(p.date, p.symbol): p.close_price for p in price_rows}

    # Per-symbol latest available price — used as fallback when exact date is missing
    # (e.g. robusta price stored for a different date than the COT report date)
    symbol_latest: dict[str, tuple[DateType, float]] = {}
    for p in price_rows:
        if p.close_price is not None:
            if p.symbol not in symbol_latest or p.date > symbol_latest[p.symbol][0]:
                symbol_latest[p.symbol] = (p.date, p.close_price)

    # Group by date
    weeks: dict[DateType, list] = {}
    for row in cot_rows:
        spec = COMMODITY_SPECS.get(row.symbol)
        if spec is None:
            continue  # unknown symbol — skip

        mm_long   = row.mm_long   or 0
        mm_short  = row.mm_short  or 0
        mm_spread = row.mm_spread or 0
        close_price = price_map.get((row.date, row.symbol))
        if close_price is None:
            # Fallback: nearest available price within 14 days
            latest = symbol_latest.get(row.symbol)
            if latest and abs((row.date - latest[0]).days) <= 14:
                close_price = latest[1]

        exposures = _compute_exposures(mm_long, mm_short, mm_spread, close_price, spec)

        entry = {
            "symbol":   row.symbol,
            "sector":   spec["sector"],
            "name":     spec["name"],
            "mm_long":  mm_long,
            "mm_short": mm_short,
            "mm_spread": mm_spread,
            "oi_total": row.oi_total or 0,
            "close_price": close_price,
            **exposures,
        }
        weeks.setdefault(row.date, []).append(entry)

    return [
        {"date": d.isoformat(), "commodities": weeks[d]}
        for d in sorted(weeks.keys())
    ]
