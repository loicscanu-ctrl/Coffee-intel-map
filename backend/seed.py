import json
import os
import re

from database import SessionLocal
from models import CountryIntel, Factory, NewsItem

SEED_DIR = os.path.join(os.path.dirname(__file__), "seed")

# Matches the leading "Xk" or "X.Xk" capacity prefix on factory descriptions.
# Examples: "300k, The largest…" → 300.0; "15.6k, …" → 15.6; "0.5k, Geisha…" → 0.5.
_CAP_KT_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*k\b", re.IGNORECASE)


def _parse_cap_kt(cap: str | None) -> float | None:
    if not cap:
        return None
    m = _CAP_KT_RE.match(cap)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None

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
        if not fac.get("l"):
            continue
        name = fac.get("n", "")
        new_type = fac.get("t") or None
        cap_str = fac.get("cap", "")
        new_cap_kt = _parse_cap_kt(cap_str)
        existing = db.query(Factory).filter_by(name=name).first()
        if existing:
            # Allow re-seeding to backfill columns added in later schema
            # revisions on rows inserted by an older build. Other fields are
            # treated as immutable to avoid clobbering manual DB edits.
            if existing.type is None and new_type is not None:
                existing.type = new_type
            if existing.cap_kt is None and new_cap_kt is not None:
                existing.cap_kt = new_cap_kt
            continue
        db.add(Factory(
            name=name,
            company=fac.get("c", ""),
            capacity=cap_str,
            type=new_type,
            cap_kt=new_cap_kt,
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
