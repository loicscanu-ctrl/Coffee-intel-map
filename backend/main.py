from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import Base, engine
from routes.news import router as news_router
from routes.map import router as map_router

app = FastAPI(title="Coffee Intel API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(news_router)
app.include_router(map_router)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    from seed import run_seed
    run_seed()

@app.get("/health")
def health():
    return {"status": "ok"}
