# backend/tests/test_freight_route.py
# Note: conftest.py sets DATABASE_URL=sqlite before this file is imported
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import main as app_main
from database import Base, SessionLocal, engine
from models import FreightRate


@pytest.fixture(autouse=True)
def reset_tables():
    """Create tables before each test; clean freight_rates rows after."""
    Base.metadata.create_all(bind=engine)
    yield
    db = SessionLocal()
    db.query(FreightRate).delete()
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


def _seed_fbx(session, index_code: str, days: int = 20, base_rate: float = 3000.0):
    """Insert `days` daily records ending today. i=0 is oldest, i=days-1 is today."""
    today = date.today()
    for i in range(days):
        d = today - timedelta(days=days - 1 - i)
        session.add(FreightRate(index_code=index_code, date=d, rate=base_rate - i * 10))
    session.commit()


def test_freight_returns_seven_routes(client, session):
    _seed_fbx(session, "FBX11", days=20, base_rate=3000)
    _seed_fbx(session, "FBX01", days=20, base_rate=4000)
    _seed_fbx(session, "FBX03", days=20, base_rate=3500)
    resp = client.get("/api/freight")
    assert resp.status_code == 200
    assert len(resp.json()["routes"]) == 7


def test_multiplier_applied(client, session):
    """br-eu rate should be FBX11 latest rate * 0.58."""
    _seed_fbx(session, "FBX11", days=10, base_rate=3000)
    _seed_fbx(session, "FBX01", days=10, base_rate=4000)
    _seed_fbx(session, "FBX03", days=10, base_rate=3500)
    resp = client.get("/api/freight")
    routes = {r["id"]: r for r in resp.json()["routes"]}
    # i=9 is today: rate = 3000 - 9*10 = 2910
    assert routes["br-eu"]["rate"] == round(2910 * 0.58)


def test_prev_fallback_when_no_old_data(client, session):
    """When no data older than 7 days exists, prev equals rate."""
    _seed_fbx(session, "FBX11", days=5, base_rate=3000)
    _seed_fbx(session, "FBX01", days=5, base_rate=4000)
    _seed_fbx(session, "FBX03", days=5, base_rate=3500)
    resp = client.get("/api/freight")
    vn_eu = next(r for r in resp.json()["routes"] if r["id"] == "vn-eu")
    assert vn_eu["prev"] == vn_eu["rate"]


def test_history_has_chart_routes(client, session):
    """History array contains date + keys for the 4 chart routes."""
    _seed_fbx(session, "FBX11", days=20, base_rate=3000)
    _seed_fbx(session, "FBX01", days=20, base_rate=4000)
    _seed_fbx(session, "FBX03", days=20, base_rate=3500)
    resp = client.get("/api/freight")
    history = resp.json()["history"]
    assert len(history) > 0
    for key in ("date", "vn-eu", "br-eu", "vn-us", "et-eu"):
        assert key in history[0]


def test_empty_db_returns_empty_routes(client):
    """Empty DB returns empty routes and history without crashing."""
    resp = client.get("/api/freight")
    assert resp.status_code == 200
    assert resp.json()["routes"] == []
    assert resp.json()["history"] == []
