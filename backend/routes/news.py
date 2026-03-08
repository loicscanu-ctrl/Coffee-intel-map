from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from models import NewsItem

router = APIRouter(prefix="/api/news", tags=["news"])

@router.get("")
def get_news(category: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(NewsItem)
    if category:
        q = q.filter(NewsItem.category == category)
    items = q.order_by(NewsItem.pub_date.desc()).all()
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
            "pub_date": item.pub_date.isoformat() if item.pub_date else None,
        }
        for item in items
    ]
