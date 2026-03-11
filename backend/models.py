from datetime import datetime, date
from sqlalchemy import String, Float, DateTime, Text, JSON, Date, Integer
from sqlalchemy.orm import Mapped, mapped_column
from database import Base

class NewsItem(Base):
    __tablename__ = "news_feed"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(200), nullable=True)
    category: Mapped[str] = mapped_column(String(50))  # supply, demand, macro, general
    lat: Mapped[float] = mapped_column(Float, nullable=True)
    lng: Mapped[float] = mapped_column(Float, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    meta: Mapped[str] = mapped_column(Text, nullable=True)
    pub_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class CountryIntel(Base):
    __tablename__ = "country_intel"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    type: Mapped[str] = mapped_column(String(20))  # producer / consumer
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Factory(Base):
    __tablename__ = "factories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    company: Mapped[str] = mapped_column(String(200), nullable=True)
    capacity: Mapped[str] = mapped_column(String(500), nullable=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)

class CertifiedStock(Base):
    __tablename__ = "certified_stocks"

    date: Mapped[date] = mapped_column(Date, primary_key=True, index=True)
    value: Mapped[int] = mapped_column(Integer)
