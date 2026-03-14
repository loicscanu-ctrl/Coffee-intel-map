# backend/tests/test_cot_route.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import date
from fastapi.testclient import TestClient
from database import Base, engine, SessionLocal
from models import CotWeekly
import main as app_main


@pytest.fixture(autouse=True)
def reset_tables():
    Base.metadata.create_all(bind=engine)
    yield
    db = SessionLocal()
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


def _seed_row(session, market: str, report_date: date, **kwargs):
    row = CotWeekly(date=report_date, market=market, **kwargs)
    session.add(row)
    session.commit()


def test_empty_db_returns_empty_list(client):
    resp = client.get("/api/cot")
    assert resp.status_code == 200
    assert resp.json() == []


def test_single_ny_row(client, session):
    _seed_row(session, "ny", date(2026, 3, 11),
              oi_total=150000, mm_long=25000, mm_short=12000)
    resp = client.get("/api/cot")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["date"] == "2026-03-11"
    assert data[0]["ny"]["oi_total"] == 150000
    assert data[0]["ny"]["mm_long"] == 25000
    assert data[0]["ldn"] is None


def test_same_date_ny_and_ldn_merged(client, session):
    _seed_row(session, "ny",  date(2026, 3, 11), oi_total=150000)
    _seed_row(session, "ldn", date(2026, 3, 11), oi_total=80000)
    resp = client.get("/api/cot")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["ny"]["oi_total"] == 150000
    assert data[0]["ldn"]["oi_total"] == 80000


def test_ldn_nr_fields_are_null(client, session):
    _seed_row(session, "ldn", date(2026, 3, 11),
              oi_total=80000, t_nr_long=None, t_nr_short=None)
    resp = client.get("/api/cot")
    ldn = resp.json()[0]["ldn"]
    assert ldn["t_nr_long"] is None
    assert ldn["t_nr_short"] is None


def test_after_param_filters_exclusive(client, session):
    _seed_row(session, "ny", date(2026, 3, 4),  oi_total=100000)
    _seed_row(session, "ny", date(2026, 3, 7),  oi_total=110000)
    _seed_row(session, "ny", date(2026, 3, 11), oi_total=120000)
    resp = client.get("/api/cot?after=2026-03-07")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["date"] == "2026-03-11"


def test_rows_sorted_ascending(client, session):
    _seed_row(session, "ny", date(2026, 3, 11), oi_total=120000)
    _seed_row(session, "ny", date(2026, 3, 4),  oi_total=100000)
    resp = client.get("/api/cot")
    dates = [r["date"] for r in resp.json()]
    assert dates == sorted(dates)
