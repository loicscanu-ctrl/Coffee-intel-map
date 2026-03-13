import os
# Override DB URL before any project code is imported
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, engine, SessionLocal

@pytest.fixture
def db():
    """In-process session for model tests."""
    Base.metadata.create_all(engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
    Base.metadata.drop_all(engine)

@pytest.fixture
def scraper_db():
    """
    Resets scraper/db.py's cached engine so it picks up the conftest DATABASE_URL.
    Creates tables, yields, then drops tables and resets cache.
    """
    import scraper.db as _scraper_db
    _scraper_db._engine = None
    _scraper_db._Session = None
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    _scraper_db._engine = None
    _scraper_db._Session = None
