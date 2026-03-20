from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from database import get_db
from models import CountryIntel, Factory

router = APIRouter(prefix="/api/map", tags=["map"])

@router.get("/countries")
def get_countries(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    countries = db.query(CountryIntel).all()
    return [{"name": c.name, "type": c.type, "lat": c.lat, "lng": c.lng, "data": c.data} for c in countries]

@router.get("/factories")
def get_factories(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=300"
    factories = db.query(Factory).all()
    return [{"name": f.name, "company": f.company, "capacity": f.capacity, "lat": f.lat, "lng": f.lng} for f in factories]
