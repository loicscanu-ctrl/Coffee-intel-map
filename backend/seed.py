import json
import os
from database import SessionLocal, engine, Base
from models import NewsItem, CountryIntel, Factory

SEED_DIR = os.path.join(os.path.dirname(__file__), "seed")

def seed_countries(db):
    path = os.path.join(SEED_DIR, "countries.json")
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return
    with open(path) as f:
        data = json.load(f)
    for name, info in data.get("countries", {}).items():
        existing = db.query(CountryIntel).filter_by(name=name).first()
        if existing:
            continue
        db.add(CountryIntel(
            name=name,
            type=info.get("type", "producer"),
            lat=info["lat"],
            lng=info["lng"],
            data=info,
        ))
    db.commit()

def seed_factories(db):
    path = os.path.join(SEED_DIR, "factories.json")
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return
    with open(path) as f:
        data = json.load(f)
    for fac in data.get("factories", []):
        existing = db.query(Factory).filter_by(name=fac.get("n", "")).first()
        if existing:
            continue
        if not fac.get("l"):
            continue
        db.add(Factory(
            name=fac.get("n", ""),
            company=fac.get("c", ""),
            capacity=fac.get("cap", ""),
            lat=fac["l"][0],
            lng=fac["l"][1],
        ))
    db.commit()

def seed_news(db):
    path = os.path.join(SEED_DIR, "global.json")
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return
    with open(path) as f:
        data = json.load(f)
    intel = data.get("globalIntel", {})

    category_map = {
        "supply": "supply",
        "demand": "demand",
        "stocks": "general",
        "futures": "general",
    }

    for section, category in category_map.items():
        for item in intel.get(section, []):
            existing = db.query(NewsItem).filter_by(title=item.get("t", "")).first()
            if existing:
                continue
            loc = item.get("loc")
            db.add(NewsItem(
                title=item.get("t", ""),
                body=item.get("v", ""),
                source=item.get("source", ""),
                category=category,
                lat=loc[0] if loc else None,
                lng=loc[1] if loc else None,
                tags=[section],
            ))

    for alert in intel.get("alerts", []):
        existing = db.query(NewsItem).filter_by(title=alert.get("t", "")).first()
        if existing:
            continue
        loc = alert.get("loc")
        db.add(NewsItem(
            title=alert.get("t", ""),
            body=alert.get("v", ""),
            source=alert.get("source", ""),
            category="supply",
            lat=loc[0] if loc else None,
            lng=loc[1] if loc else None,
            tags=["alert"],
        ))
    db.commit()

PRICE_SEEDS = [
    {"title": "USD/IDR FX Rate – seed", "body": "USD/IDR FX Rate price: 16280",  "tags": ["fx", "indonesia"]},
    {"title": "USD/HNL FX Rate – seed", "body": "USD/HNL FX Rate price: 24.75",  "tags": ["fx", "honduras"]},
    {"title": "USD/BRL FX Rate – seed", "body": "USD/BRL FX Rate price: 5.87",   "tags": ["fx", "brazil"]},
    {"title": "USD/VND FX Rate – seed", "body": "USD/VND FX Rate price: 25380",  "tags": ["fx", "vietnam"]},
]

def seed_prices(db):
    for item in PRICE_SEEDS:
        if db.query(NewsItem).filter_by(title=item["title"]).first():
            continue
        db.add(NewsItem(
            title=item["title"],
            body=item["body"],
            source="Seed (Barchart pending)",
            category="general",
            tags=item["tags"],
        ))
    db.commit()

def run_seed():
    db = SessionLocal()
    try:
        seed_countries(db)
        seed_factories(db)
        seed_news(db)
        seed_prices(db)
        print("Seed complete")
    finally:
        db.close()
