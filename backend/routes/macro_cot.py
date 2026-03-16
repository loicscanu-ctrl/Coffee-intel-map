# backend/routes/macro_cot.py
from datetime import date as DateType, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import CommodityCot, CommodityPrice
from scraper.sources.macro_cot import COMMODITY_SPECS

router = APIRouter(prefix="/api/macro-cot", tags=["macro-cot"])


def _to_contract_value(price: float, spec: dict) -> float:
    """All price_unit variants resolve to price × contract_unit (all already in USD per unit)."""
    return price * spec["contract_unit"]


def _compute_exposures(mm_long: int, mm_short: int, mm_spread: int,
                       close_price: Optional[float], spec: dict) -> dict:
    initial_margin = (mm_long + mm_short) * spec["margin_outright_usd"] \
                   + mm_spread             * spec["margin_spread_usd"]

    if close_price is None:
        return {
            "gross_exposure_usd": None,
            "net_exposure_usd":   None,
            "initial_margin_usd": initial_margin,
        }

    cv = _to_contract_value(close_price, spec)
    return {
        "gross_exposure_usd": (mm_long + mm_short) * cv,
        "net_exposure_usd":   (mm_long - mm_short) * cv,
        "initial_margin_usd": initial_margin,
    }


@router.get("")
def get_macro_cot(
    after: Optional[str] = Query(None, description="ISO date lower bound YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
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
