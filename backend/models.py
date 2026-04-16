from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Float, DateTime, Text, JSON, Date, Integer, UniqueConstraint
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

class FreightRate(Base):
    __tablename__ = "freight_rates"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    index_code: Mapped[str]      = mapped_column(String(10), nullable=False)
    date:       Mapped[date]     = mapped_column(Date, nullable=False)
    rate:       Mapped[float]    = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("index_code", "date", name="uq_freight_index_date"),)


class CotWeekly(Base):
    __tablename__ = "cot_weekly"

    id:     Mapped[int]  = mapped_column(primary_key=True)
    date:   Mapped[date] = mapped_column(Date, nullable=False, index=True)
    market: Mapped[str]  = mapped_column(String(3), nullable=False)  # "ny" | "ldn"

    # CoT OI fields
    oi_total:     Mapped[int | None] = mapped_column(Integer)
    pmpu_long:    Mapped[int | None] = mapped_column(Integer)
    pmpu_short:   Mapped[int | None] = mapped_column(Integer)
    swap_long:    Mapped[int | None] = mapped_column(Integer)
    swap_short:   Mapped[int | None] = mapped_column(Integer)
    swap_spread:  Mapped[int | None] = mapped_column(Integer)
    mm_long:      Mapped[int | None] = mapped_column(Integer)
    mm_short:     Mapped[int | None] = mapped_column(Integer)
    mm_spread:    Mapped[int | None] = mapped_column(Integer)
    other_long:   Mapped[int | None] = mapped_column(Integer)
    other_short:  Mapped[int | None] = mapped_column(Integer)
    other_spread: Mapped[int | None] = mapped_column(Integer)
    nr_long:      Mapped[int | None] = mapped_column(Integer)
    nr_short:     Mapped[int | None] = mapped_column(Integer)

    # Trader count fields
    t_pmpu_long:    Mapped[int | None] = mapped_column(Integer)
    t_pmpu_short:   Mapped[int | None] = mapped_column(Integer)
    t_swap_long:    Mapped[int | None] = mapped_column(Integer)
    t_swap_short:   Mapped[int | None] = mapped_column(Integer)
    t_swap_spread:  Mapped[int | None] = mapped_column(Integer)
    t_mm_long:      Mapped[int | None] = mapped_column(Integer)
    t_mm_short:     Mapped[int | None] = mapped_column(Integer)
    t_mm_spread:    Mapped[int | None] = mapped_column(Integer)
    t_other_long:   Mapped[int | None] = mapped_column(Integer)
    t_other_short:  Mapped[int | None] = mapped_column(Integer)
    t_other_spread: Mapped[int | None] = mapped_column(Integer)
    t_nr_long:      Mapped[int | None] = mapped_column(Integer)  # NY only; None for LDN
    t_nr_short:     Mapped[int | None] = mapped_column(Integer)  # NY only; None for LDN

    # Old/Other crop split — NY (CFTC Arabica) only; None for LDN (Robusta has no split)
    pmpu_long_old:    Mapped[int | None] = mapped_column(Integer)
    pmpu_short_old:   Mapped[int | None] = mapped_column(Integer)
    swap_long_old:    Mapped[int | None] = mapped_column(Integer)
    swap_short_old:   Mapped[int | None] = mapped_column(Integer)
    swap_spread_old:  Mapped[int | None] = mapped_column(Integer)
    mm_long_old:      Mapped[int | None] = mapped_column(Integer)
    mm_short_old:     Mapped[int | None] = mapped_column(Integer)
    mm_spread_old:    Mapped[int | None] = mapped_column(Integer)
    other_long_old:   Mapped[int | None] = mapped_column(Integer)
    other_short_old:  Mapped[int | None] = mapped_column(Integer)
    other_spread_old: Mapped[int | None] = mapped_column(Integer)
    nr_long_old:      Mapped[int | None] = mapped_column(Integer)
    nr_short_old:     Mapped[int | None] = mapped_column(Integer)

    pmpu_long_other:    Mapped[int | None] = mapped_column(Integer)
    pmpu_short_other:   Mapped[int | None] = mapped_column(Integer)
    swap_long_other:    Mapped[int | None] = mapped_column(Integer)
    swap_short_other:   Mapped[int | None] = mapped_column(Integer)
    swap_spread_other:  Mapped[int | None] = mapped_column(Integer)
    mm_long_other:      Mapped[int | None] = mapped_column(Integer)
    mm_short_other:     Mapped[int | None] = mapped_column(Integer)
    mm_spread_other:    Mapped[int | None] = mapped_column(Integer)
    other_long_other:   Mapped[int | None] = mapped_column(Integer)
    other_short_other:  Mapped[int | None] = mapped_column(Integer)
    other_spread_other: Mapped[int | None] = mapped_column(Integer)
    nr_long_other:      Mapped[int | None] = mapped_column(Integer)
    nr_short_other:     Mapped[int | None] = mapped_column(Integer)

    # From Other sheet (joined by report date)
    price_ny:       Mapped[float | None] = mapped_column(Float)
    price_ldn:      Mapped[float | None] = mapped_column(Float)
    structure_ny:   Mapped[float | None] = mapped_column(Float)
    structure_ldn:  Mapped[float | None] = mapped_column(Float)
    exch_oi_ny:     Mapped[int | None]   = mapped_column(Integer)
    exch_oi_ldn:    Mapped[int | None]   = mapped_column(Integer)
    vol_ny:         Mapped[int | None]   = mapped_column(Integer)
    vol_ldn:        Mapped[int | None]   = mapped_column(Integer)
    efp_ny:         Mapped[float | None] = mapped_column(Float)
    efp_ldn:        Mapped[float | None] = mapped_column(Float)
    spread_vol_ny:  Mapped[float | None] = mapped_column(Float)
    spread_vol_ldn: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("date", "market", name="uq_cot_date_market"),
    )


class CommodityCot(Base):
    __tablename__ = "commodity_cot"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    date:       Mapped[date]     = mapped_column(Date, nullable=False, index=True)
    symbol:     Mapped[str]      = mapped_column(String(20), nullable=False)
    mm_long:    Mapped[int | None] = mapped_column(Integer)
    mm_short:   Mapped[int | None] = mapped_column(Integer)
    mm_spread:  Mapped[int | None] = mapped_column(Integer)
    oi_total:   Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("date", "symbol", name="uq_commodity_cot_date_symbol"),)


class CommodityPrice(Base):
    __tablename__ = "commodity_prices"

    id:          Mapped[int]        = mapped_column(primary_key=True)
    date:        Mapped[date]       = mapped_column(Date, nullable=False, index=True)
    symbol:      Mapped[str]        = mapped_column(String(20), nullable=False)
    close_price: Mapped[float | None] = mapped_column(Float)
    currency:    Mapped[str]        = mapped_column(String(3), nullable=False, default="USD")
    created_at:  Mapped[datetime]   = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("date", "symbol", name="uq_commodity_price_date_symbol"),)


class WeatherSnapshot(Base):
    __tablename__ = "weather_snapshots"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    region:     Mapped[str]      = mapped_column(String(100), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    daily_data: Mapped[list]     = mapped_column(JSON, default=list)


class FertilizerImport(Base):
    __tablename__ = "fertilizer_imports"

    id:            Mapped[int]           = mapped_column(primary_key=True)
    month:         Mapped[date]          = mapped_column(Date, nullable=False)
    ncm_code:      Mapped[str]           = mapped_column(String(20), nullable=False)
    ncm_label:     Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    net_weight_kg: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fob_usd:       Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    scraped_at:    Mapped[datetime]      = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("month", "ncm_code", name="uq_fert_import_month_ncm"),)
