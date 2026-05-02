# backend/tests/test_cot_route.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import date
from fastapi.testclient import TestClient
from database import Base, engine, SessionLocal
from models import CotPosition, CotWeekly
import main as app_main


@pytest.fixture(autouse=True)
def reset_tables():
    Base.metadata.create_all(bind=engine)
    yield
    db = SessionLocal()
    db.query(CotPosition).delete()
    db.query(CotWeekly).delete()
    db.commit()
    db.close()


@pytest.fixture
def client():
    with TestClient(app_main.app) as c:
        yield c


@pytest.fixture
def session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _seed_week(session, market: str, report_date: date,
               positions: dict | None = None, **scalars):
    """Seed a CotWeekly marker row plus optional CotPosition rows.

    positions is a dict like {("all","mm","long"): (oi, traders)} — same
    shape as serialize_cot_row's positions= parameter.
    """
    session.add(CotWeekly(date=report_date, market=market, **scalars))
    if positions:
        for (crop, cat, side), value in positions.items():
            if isinstance(value, tuple):
                oi, traders = value
            else:
                oi, traders = value, None
            session.add(CotPosition(
                date=report_date, market=market,
                crop=crop, category=cat, side=side,
                oi=oi, traders=traders,
            ))
    session.commit()


def test_empty_db_returns_empty_list(client):
    resp = client.get("/api/cot")
    assert resp.status_code == 200
    assert resp.json() == []


def test_single_ny_row(client, session):
    _seed_week(session, "ny", date(2026, 3, 11),
               oi_total=150_000,
               positions={
                   ("all", "mm", "long"):  (25_000, None),
                   ("all", "mm", "short"): (12_000, None),
               })
    resp = client.get("/api/cot")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["date"]            == "2026-03-11"
    assert data[0]["ny"]["oi_total"]  == 150_000
    assert data[0]["ny"]["mm_long"]   == 25_000
    assert data[0]["ny"]["mm_short"]  == 12_000
    assert data[0]["ldn"] is None


def test_same_date_ny_and_ldn_merged(client, session):
    _seed_week(session, "ny",  date(2026, 3, 11), oi_total=150_000)
    _seed_week(session, "ldn", date(2026, 3, 11), oi_total=80_000)
    resp = client.get("/api/cot")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["ny"]["oi_total"]  == 150_000
    assert data[0]["ldn"]["oi_total"] == 80_000


def test_missing_position_fields_are_null(client, session):
    """LDN rows historically have null t_nr_long / t_nr_short. With the
    narrow schema, "missing" just means no CotPosition row for that key."""
    _seed_week(session, "ldn", date(2026, 3, 11), oi_total=80_000)
    ldn = client.get("/api/cot").json()[0]["ldn"]
    assert ldn["t_nr_long"]  is None
    assert ldn["t_nr_short"] is None
    assert ldn["mm_long"]    is None


def test_after_param_filters_exclusive(client, session):
    _seed_week(session, "ny", date(2026, 3, 4),  oi_total=100_000)
    _seed_week(session, "ny", date(2026, 3, 7),  oi_total=110_000)
    _seed_week(session, "ny", date(2026, 3, 11), oi_total=120_000)
    resp = client.get("/api/cot?after=2026-03-07")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["date"] == "2026-03-11"


def test_rows_sorted_ascending(client, session):
    _seed_week(session, "ny", date(2026, 3, 11), oi_total=120_000)
    _seed_week(session, "ny", date(2026, 3, 4),  oi_total=100_000)
    resp = client.get("/api/cot")
    dates = [r["date"] for r in resp.json()]
    assert dates == sorted(dates)


def test_after_param_invalid_date_returns_400(client):
    resp = client.get("/api/cot?after=not-a-date")
    assert resp.status_code == 400
