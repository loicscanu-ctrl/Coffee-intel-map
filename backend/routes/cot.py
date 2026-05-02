# backend/routes/cot.py
from datetime import date as DateType
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, Response
from sqlalchemy.orm import Session
from cot_schema import positions_dict, serialize_cot_row
from database import get_db
from models import CotPosition, CotWeekly

router = APIRouter(prefix="/api/cot", tags=["cot"])


@router.get("")
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
