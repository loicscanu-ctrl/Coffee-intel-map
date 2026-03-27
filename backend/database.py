import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://coffee:coffee@localhost:5432/coffee_intel")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # test connection before use, reconnects if stale
    pool_recycle=300,     # recycle connections every 5 min (Supabase cuts at ~10 min idle)
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
