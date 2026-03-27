import json
import re
from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from models import NewsItem

router = APIRouter()

LETTER_TO_MONTH = {
    "F":1,"G":2,"H":3,"J":4,"K":5,"M":6,
    "N":7,"Q":8,"U":9,"V":10,"X":11,"Z":12
}

def _first_business_day(year: int, month: int) -> date:
    d = date(year, month, 1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d

def _subtract_business_days(d: date, n: int) -> date:
    remaining = n
    while remaining > 0:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            remaining -= 1
    return d

def _calc_fnd(symbol: str):
    m = re.match(r'^(KC|RM|RC)([FGHJKMNQUVXZ])(\d{2})$', symbol, re.I)
    if not m:
        return None
    product, letter, yr = m.group(1), m.group(2).upper(), int(m.group(3))
    month_num = LETTER_TO_MONTH.get(letter)
    if not month_num:
        return None
    days_before = 7 if product.upper() == "KC" else 4
    fbdm = _first_business_day(2000 + yr, month_num)
    return _subtract_business_days(fbdm, days_before)

def _trading_days_to(d1: date, fnd: date) -> int:
    """Signed trading days from d1 to fnd (negative = before FND)."""
    if d1 >= fnd:
        return 0
    count = 0
    cur = d1
    while cur < fnd:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            count += 1
    return -count  # negative = days remaining before FND


@router.get("/api/futures/oi-history")
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


@router.get("/api/futures/oi-fnd-chart")
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
