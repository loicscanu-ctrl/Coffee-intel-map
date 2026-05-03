# backend/routes/cot.py
from datetime import date as DateType

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from cot_schema import serialize_cot_row
from database import get_db
from models import CotPosition, CotWeekly

router = APIRouter(prefix="/api/cot", tags=["cot"])


class CotMarketResponse(BaseModel):
    """Per-market CoT data for one week. Field set is locked by
    backend/cot_schema.py; every field is optional because old historical
    weeks may have NULLs from before the field existed in the schema."""

    oi_total:      int | None = None

    # Position OI (all-crop)
    pmpu_long:     int | None = None
    pmpu_short:    int | None = None
    swap_long:     int | None = None
    swap_short:    int | None = None
    swap_spread:   int | None = None
    mm_long:       int | None = None
    mm_short:      int | None = None
    mm_spread:     int | None = None
    other_long:    int | None = None
    other_short:   int | None = None
    other_spread:  int | None = None
    nr_long:       int | None = None
    nr_short:      int | None = None

    # Trader counts (all-crop only)
    t_pmpu_long:    int | None = None
    t_pmpu_short:   int | None = None
    t_swap_long:    int | None = None
    t_swap_short:   int | None = None
    t_swap_spread:  int | None = None
    t_mm_long:      int | None = None
    t_mm_short:     int | None = None
    t_mm_spread:    int | None = None
    t_other_long:   int | None = None
    t_other_short:  int | None = None
    t_other_spread: int | None = None
    t_nr_long:      int | None = None
    t_nr_short:     int | None = None

    # Per-market scalars (joined from the COT Excel "Other" sheet)
    price_ny:       float | None = None
    price_ldn:      float | None = None
    structure_ny:   float | None = None
    structure_ldn:  float | None = None
    exch_oi_ny:     int | None   = None
    exch_oi_ldn:    int | None   = None
    vol_ny:         int | None   = None
    vol_ldn:        int | None   = None
    efp_ny:         float | None = None
    efp_ldn:        float | None = None
    spread_vol_ny:  float | None = None
    spread_vol_ldn: float | None = None


class CotWeekResponse(BaseModel):
    date: str
    ny:   CotMarketResponse | None = None
    ldn:  CotMarketResponse | None = None


@router.get("", response_model=list[CotWeekResponse])
def get_cot(
    response: Response,
    after: str | None = Query(None, description="Exclusive lower bound date YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "public, max-age=300"
    query = db.query(CotWeekly).order_by(CotWeekly.date.asc())
    if after:
        try:
            cutoff = DateType.fromisoformat(after)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'after' date format. Use YYYY-MM-DD.") from None
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
