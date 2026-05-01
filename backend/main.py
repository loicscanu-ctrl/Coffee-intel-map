import os
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from database import Base, engine, get_db
from models import CertifiedStock
from routes.news import router as news_router
from routes.map import router as map_router
from routes.freight import router as freight_router
from routes.cot import router as cot_router
from routes.macro_cot import router as macro_cot_router
from routes.futures import router as futures_router

app = FastAPI(title="Coffee Intel API")

_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # API is read-only; pinning verbs avoids accidentally widening surface area.
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(news_router)
app.include_router(map_router)
app.include_router(freight_router)
app.include_router(cot_router)
app.include_router(macro_cot_router)
app.include_router(futures_router)

@app.on_event("startup")
def startup():
    # create_all is idempotent and only adds missing tables, so it's safe to
    # leave on. Seeding, however, is one-shot data insertion — gate it so
    # production deployments don't waste startup time re-running upserts.
    Base.metadata.create_all(bind=engine)
    if os.getenv("SEED_ON_STARTUP", "1") == "1":
        from seed import run_seed
        run_seed()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/stocks")
def get_stocks(db: Session = Depends(get_db)):
    stocks = db.query(CertifiedStock).order_by(CertifiedStock.date.asc()).all()
    return [{"date": s.date.isoformat(), "value": s.value} for s in stocks]
