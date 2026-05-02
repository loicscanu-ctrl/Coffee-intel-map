from typing import Any, Optional

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import NewsItem

router = APIRouter(prefix="/api/news", tags=["news"])


class NewsItemResponse(BaseModel):
    id: int
    title: str
    body: Optional[str] = None
    source: Optional[str] = None
    category: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    tags: Optional[list[str]] = None
    meta: Optional[Any] = None
    pub_date: Optional[str] = None


@router.get("", response_model=list[NewsItemResponse])
def get_news(
    response: Response,
    category: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "public, max-age=300"
    q = db.query(NewsItem)
    if category:
        q = q.filter(NewsItem.category == category)
    items = q.order_by(NewsItem.pub_date.desc()).limit(limit).all()
    return [
        {
            "id": item.id,
            "title": item.title,
            "body": item.body,
            "source": item.source,
            "category": item.category,
            "lat": item.lat,
            "lng": item.lng,
            "tags": item.tags,
            "meta": item.meta,
            "pub_date": item.pub_date.isoformat() if item.pub_date else None,
        }
        for item in items
    ]
