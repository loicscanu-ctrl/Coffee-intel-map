from typing import Any
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from models import CountryIntel, Factory

router = APIRouter(prefix="/api/map", tags=["map"])


class CountryOut(BaseModel):
    name: str
    type: str | None
    lat: float
    lng: float
    data: Any | None = None


class FactoryOut(BaseModel):
    name: str
    company: str | None
    capacity: str | None
    lat: float
    lng: float


@router.get("/countries", response_model=list[CountryOut])
def get_countries(response: Response, db: Session = Depends(get_db)) -> list[CountryOut]:
    response.headers["Cache-Control"] = "public, max-age=300"
    countries = db.query(CountryIntel).all()
    return [
        CountryOut(name=c.name, type=c.type, lat=c.lat, lng=c.lng, data=c.data)
        for c in countries
    ]


@router.get("/factories", response_model=list[FactoryOut])
def get_factories(response: Response, db: Session = Depends(get_db)) -> list[FactoryOut]:
    response.headers["Cache-Control"] = "public, max-age=300"
    factories = db.query(Factory).all()
    return [
        FactoryOut(
            name=f.name,
            company=f.company,
            capacity=f.capacity,
            lat=f.lat,
            lng=f.lng,
        )
        for f in factories
    ]
