# backend/routes/cot.py
from datetime import date as DateType
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from cot_schema import positions_dict, serialize_cot_row
from database import get_db
from models import CotPosition, CotWeekly

router = APIRouter(prefix="/api/cot", tags=["cot"])


class CotMarketResponse(BaseModel):
    """Per-market CoT data for one week. Field set is locked by
    backend/cot_schema.py; every field is optional because old historical
    weeks may have NULLs from before the field existed in the schema."""

    oi_total:      Optional[int] = None

    # Position OI (all-crop)
    pmpu_long:     Optional[int] = None
    pmpu_short:    Optional[int] = None
    swap_long:     Optional[int] = None
    swap_short:    Optional[int] = None
    swap_spread:   Optional[int] = None
    mm_long:       Optional[int] = None
    mm_short:      Optional[int] = None
    mm_spread:     Optional[int] = None
    other_long:    Optional[int] = None
    other_short:   Optional[int] = None
    other_spread:  Optional[int] = None
    nr_long:       Optional[int] = None
    nr_short:      Optional[int] = None

    # Trader counts (all-crop only)
    t_pmpu_long:    Optional[int] = None
    t_pmpu_short:   Optional[int] = None
    t_swap_long:    Optional[int] = None
    t_swap_short:   Optional[int] = None
    t_swap_spread:  Optional[int] = None
    t_mm_long:      Optional[int] = None
    t_mm_short:     Optional[int] = None
    t_mm_spread:    Optional[int] = None
    t_other_long:   Optional[int] = None
    t_other_short:  Optional[int] = None
    t_other_spread: Optional[int] = None
    t_nr_long:      Optional[int] = None
    t_nr_short:     Optional[int] = None

    # Per-market scalars (joined from the COT Excel "Other" sheet)
    price_ny:       Optional[float] = None
    price_ldn:      Optional[float] = None
    structure_ny:   Optional[float] = None
    structure_ldn:  Optional[float] = None
    exch_oi_ny:     Optional[int]   = None
    exch_oi_ldn:    Optional[int]   = None
    vol_ny:         Optional[int]   = None
    vol_ldn:        Optional[int]   = None
    efp_ny:         Optional[float] = None
    efp_ldn:        Optional[float] = None
    spread_vol_ny:  Optional[float] = None
    spread_vol_ldn: Optional[float] = None


class CotWeekResponse(BaseModel):
    date: str
    ny:   Optional[CotMarketResponse] = None
    ldn:  Optional[CotMarketResponse] = None


@router.get("", response_model=list[CotWeekResponse])
def get_cot(
    response: Response,
    after: Optional[str] = Query(None, description="Exclusive lower bound date YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "public, max-age=300"
    query = db.query(CotWeekly).order_by(CotWeekly.date.asc())
    if after:
        try:
            cutoff = DateType.fromisoformat(after)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'after' date format. Use YYYY-MM-DD.")
        query = query.filter(CotWeekly.date > cutoff)

    weekly_rows = query.all()
    if not weekly_rows:
        return []

    # Bulk-load all CotPosition rows for the requested window in one query so
    # we don't hit N+1. Keyed by (date, market) → {(crop, cat, side): row}.
    pos_rows = (
        db.query(CotPosition)
        .filter(CotPosition.date >= weekly_rows[0].date)
        .all()
    )
    positions_by_week: dict[tuple, dict] = {}
    for p in pos_rows:
        positions_by_week.setdefault((p.date, p.market), {})[(p.crop, p.category, p.side)] = p

    merged: dict[DateType, dict] = {}
    for row in weekly_rows:
        d = row.date
        if d not in merged:
            merged[d] = {"date": d.isoformat(), "ny": None, "ldn": None}
        positions = positions_by_week.get((row.date, row.market))
        merged[d][row.market] = serialize_cot_row(
            row, positions=positions, include_crop_split=False,
        )

    return sorted(merged.values(), key=lambda x: x["date"])
