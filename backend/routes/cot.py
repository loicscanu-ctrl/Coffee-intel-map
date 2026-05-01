# backend/routes/cot.py
from datetime import date as DateType
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, Response
from sqlalchemy.orm import Session
from cot_schema import serialize_cot_row
from database import get_db
from models import CotWeekly

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

    merged: dict[DateType, dict] = {}
    for row in query.all():
        d = row.date
        if d not in merged:
            merged[d] = {"date": d.isoformat(), "ny": None, "ldn": None}
        merged[d][row.market] = serialize_cot_row(row, include_crop_split=False)

    return sorted(merged.values(), key=lambda x: x["date"])
