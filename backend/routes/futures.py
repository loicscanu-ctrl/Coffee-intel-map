import json
from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from contract_dates import calc_fnd as _calc_fnd
from contract_dates import trading_days_to as _trading_days_to
from database import get_db
from models import NewsItem

router = APIRouter()


class OIContract(BaseModel):
    symbol: str
    oi: int
    chg: float


class OIHistoryDay(BaseModel):
    date: str
    contracts: list[OIContract]


class OIFndPoint(BaseModel):
    day: int
    oi: int


class OIFndChartContract(BaseModel):
    symbol: str
    label: str
    fnd: str
    data: list[OIFndPoint]


@router.get("/api/futures/oi-history", response_model=list[OIHistoryDay])
def get_oi_history(
    market: str = Query("robusta", enum=["robusta", "arabica"]),
    days: int = Query(10, ge=1, le=60),
    db: Session = Depends(get_db),
):
    """Return last N days of OI per contract for Robusta or Arabica futures."""
    all_items = (
        db.query(NewsItem)
        .filter(NewsItem.meta.isnot(None))
        .order_by(NewsItem.pub_date.desc())
        .all()
    )

    chain_items = [
        i for i in all_items
        if "futures" in (i.tags or [])
        and "price"   in (i.tags or [])
        and market     in (i.tags or [])
    ][:days]

    result = []
    for item in chain_items:
        try:
            meta     = json.loads(item.meta or "{}")
            date_str = item.title.split("–")[-1].strip() if "–" in item.title else str(item.pub_date)[:10]
            result.append({
                "date": date_str,
                "contracts": [
                    {"symbol": c.get("symbol", ""), "oi": c.get("oi", 0), "chg": c.get("chg", 0)}
                    for c in meta.get("contracts", [])
                ],
            })
        except Exception:
            pass

    return result  # newest first → oldest last


@router.get("/api/futures/oi-fnd-chart", response_model=list[OIFndChartContract])
def get_oi_fnd_chart(
    market: str = Query("robusta", enum=["robusta", "arabica"]),
    db: Session = Depends(get_db),
):
    """Return OI per contract indexed by trading days to FND, for chart plotting."""
    all_items = (
        db.query(NewsItem)
        .filter(NewsItem.meta.isnot(None))
        .order_by(NewsItem.pub_date.asc())
        .all()
    )

    chain_items = [
        i for i in all_items
        if "futures" in (i.tags or [])
        and "price"   in (i.tags or [])
        and market     in (i.tags or [])
    ]

    # Build per-symbol OI series: { "RMK26": [{ "day": -22, "oi": 39446 }, ...] }
    series: dict[str, list] = {}

    for item in chain_items:
        try:
            meta      = json.loads(item.meta or "{}")
            trade_date = date.fromisoformat(
                item.title.split("–")[-1].strip() if "–" in item.title
                else str(item.pub_date)[:10]
            )
            for c in meta.get("contracts", []):
                sym = c.get("symbol", "")
                fnd = _calc_fnd(sym)
                if not fnd:
                    continue
                day_val = _trading_days_to(trade_date, fnd)
                if day_val < -30 or day_val > 0:
                    continue
                if sym not in series:
                    series[sym] = []
                series[sym].append({"day": day_val, "oi": c.get("oi", 0)})
        except Exception:
            pass

    today = date.today()
    current_yr = str(today.year)[-2:]
    prev_yr    = str(today.year - 1)[-2:]
    allowed_years = {current_yr, prev_yr}

    # Include only current and previous year contracts, sorted by FND ascending
    candidates = []
    for sym, points in series.items():
        if sym[-2:] not in allowed_years:
            continue
        fnd = _calc_fnd(sym)
        if not fnd:
            continue
        candidates.append({
            "symbol": sym,
            "label":  sym.replace("RM", "").replace("KC", ""),
            "fnd":    fnd.isoformat(),
            "data":   sorted(points, key=lambda x: x["day"]),
        })

    candidates.sort(key=lambda x: x["fnd"])
    return candidates
