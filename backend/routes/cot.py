# backend/routes/cot.py
from datetime import date as DateType
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from models import CotWeekly

router = APIRouter(prefix="/api/cot", tags=["cot"])


def _row_to_dict(row: CotWeekly) -> dict:
    return {
        "oi_total":      row.oi_total,
        "pmpu_long":     row.pmpu_long,     "pmpu_short":    row.pmpu_short,
        "swap_long":     row.swap_long,     "swap_short":    row.swap_short,
        "swap_spread":   row.swap_spread,
        "mm_long":       row.mm_long,       "mm_short":      row.mm_short,
        "mm_spread":     row.mm_spread,
        "other_long":    row.other_long,    "other_short":   row.other_short,
        "other_spread":  row.other_spread,
        "nr_long":       row.nr_long,       "nr_short":      row.nr_short,
        "t_pmpu_long":   row.t_pmpu_long,   "t_pmpu_short":  row.t_pmpu_short,
        "t_swap_long":   row.t_swap_long,   "t_swap_short":  row.t_swap_short,
        "t_swap_spread": row.t_swap_spread,
        "t_mm_long":     row.t_mm_long,     "t_mm_short":    row.t_mm_short,
        "t_mm_spread":   row.t_mm_spread,
        "t_other_long":  row.t_other_long,  "t_other_short": row.t_other_short,
        "t_other_spread":row.t_other_spread,
        "t_nr_long":     row.t_nr_long,     "t_nr_short":    row.t_nr_short,
        "price_ny":      row.price_ny,      "price_ldn":     row.price_ldn,
        "structure_ny":  row.structure_ny,  "structure_ldn": row.structure_ldn,
        "exch_oi_ny":    row.exch_oi_ny,    "exch_oi_ldn":   row.exch_oi_ldn,
        "vol_ny":        row.vol_ny,        "vol_ldn":       row.vol_ldn,
        "efp_ny":        row.efp_ny,        "efp_ldn":       row.efp_ldn,
        "spread_vol_ny": row.spread_vol_ny, "spread_vol_ldn":row.spread_vol_ldn,
    }


@router.get("")
def get_cot(
    after: Optional[str] = Query(None, description="Exclusive lower bound date YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    query = db.query(CotWeekly).order_by(CotWeekly.date.asc())
    if after:
        cutoff = DateType.fromisoformat(after)
        query = query.filter(CotWeekly.date > cutoff)

    # Group in Python — too many columns for SQL aggregation
    merged: dict[DateType, dict] = {}
    for row in query.all():
        d = row.date
        if d not in merged:
            merged[d] = {"date": d.isoformat(), "ny": None, "ldn": None}
        merged[d][row.market] = _row_to_dict(row)

    return sorted(merged.values(), key=lambda x: x["date"])
