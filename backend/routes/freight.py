# backend/routes/freight.py
from datetime import date, timedelta
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from database import get_db
from models import FreightRate

router = APIRouter(prefix="/api/freight", tags=["freight"])

# Route config: id, from, to, FBX index, multiplier, is_proxy
ROUTE_CONFIG = [
    ("vn-eu",  "Ho Chi Minh", "Rotterdam",   "FBX11", 1.00, False),
    ("vn-ham", "Ho Chi Minh", "Hamburg",     "FBX11", 1.02, False),
    ("vn-us",  "Ho Chi Minh", "Los Angeles", "FBX01", 1.00, False),
    ("br-eu",  "Santos",      "Rotterdam",   "FBX11", 0.58, True),
    ("co-eu",  "Cartagena",   "Rotterdam",   "FBX11", 0.55, True),
    ("et-eu",  "Djibouti",    "Rotterdam",   "FBX11", 0.70, True),
    ("br-us",  "Santos",      "New York",    "FBX03", 0.45, True),
]

CHART_ROUTES = {"vn-eu", "br-eu", "vn-us", "et-eu"}


def _latest_rate(db: Session, index_code: str) -> FreightRate | None:
    return (
        db.query(FreightRate)
        .filter(FreightRate.index_code == index_code)
        .order_by(FreightRate.date.desc())
        .first()
    )


def _prev_rate(db: Session, index_code: str) -> FreightRate | None:
    cutoff = date.today() - timedelta(days=7)
    return (
        db.query(FreightRate)
        .filter(FreightRate.index_code == index_code, FreightRate.date < cutoff)
        .order_by(FreightRate.date.desc())
        .first()
    )


def _history_rows(db: Session, index_code: str, days: int = 84) -> list[FreightRate]:
    cutoff = date.today() - timedelta(days=days)
    return (
        db.query(FreightRate)
        .filter(FreightRate.index_code == index_code, FreightRate.date >= cutoff)
        .order_by(FreightRate.date.asc())
        .all()
    )


@router.get("")
def get_freight(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    indices = {cfg[3] for cfg in ROUTE_CONFIG}
    latest = {idx: _latest_rate(db, idx) for idx in indices}
    prev   = {idx: _prev_rate(db, idx)   for idx in indices}

    if all(v is None for v in latest.values()):
        return {"updated": date.today().isoformat(), "routes": [], "history": []}

    routes = []
    for route_id, from_, to, index, mult, is_proxy in ROUTE_CONFIG:
        latest_row = latest.get(index)
        if latest_row is None:
            continue
        prev_row = prev.get(index)
        rate = round(latest_row.rate * mult)
        prev_rate = round(prev_row.rate * mult) if prev_row else rate
        routes.append({
            "id":    route_id,
            "from":  from_,
            "to":    to,
            "rate":  rate,
            "prev":  prev_rate,
            "unit":  "USD/FEU",
            "proxy": is_proxy,
        })

    fbx11_rows = _history_rows(db, "FBX11")
    fbx01_rows = _history_rows(db, "FBX01")

    history_by_date: dict[str, dict] = {}
    for row in fbx11_rows:
        d = row.date.isoformat()
        if d not in history_by_date:
            history_by_date[d] = {"date": d}
        history_by_date[d]["vn-eu"] = round(row.rate * 1.00)
        history_by_date[d]["br-eu"] = round(row.rate * 0.58)
        history_by_date[d]["et-eu"] = round(row.rate * 0.70)
    for row in fbx01_rows:
        d = row.date.isoformat()
        if d not in history_by_date:
            history_by_date[d] = {"date": d}
        history_by_date[d]["vn-us"] = round(row.rate * 1.00)

    history = sorted(history_by_date.values(), key=lambda x: x["date"])

    updated = max(
        (r.date for r in latest.values() if r is not None),
        default=date.today()
    ).isoformat()

    return {"updated": updated, "routes": routes, "history": history}
