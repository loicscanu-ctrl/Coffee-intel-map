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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
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
    Base.metadata.create_all(bind=engine)
    from seed import run_seed
    run_seed()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/stocks")
def get_stocks(db: Session = Depends(get_db)):
    stocks = db.query(CertifiedStock).order_by(CertifiedStock.date.asc()).all()
    return [{"date": s.date.isoformat(), "value": s.value} for s in stocks]
