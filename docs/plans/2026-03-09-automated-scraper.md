# Automated Daily Scraper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone Docker scraper service that fetches coffee market data from ~25 sources daily and stores them as `NewsItem` records in the shared PostgreSQL database.

**Architecture:** A separate `scraper` Docker Compose service runs `backend/scraper/main.py` on startup and every 24 hours thereafter. It connects to the same PostgreSQL DB as the backend and inserts `NewsItem` rows, deduplicating by title. Each source is scraped independently via Playwright so JS-rendered pages work.

**Tech Stack:** Python 3.12, Playwright (chromium), SQLAlchemy 2.0, psycopg2, deep-translator, pytest, pytest-asyncio

---

## Country Coordinate Lookup

Used by all sources to set lat/lng on NewsItems:

```python
COUNTRY_COORDS = {
    "brazil":     (-14.235, -51.925),
    "vietnam":    (14.058, 108.277),
    "indonesia":  (-0.789, 113.921),
    "honduras":   (15.200, -86.242),
    "uganda":     (1.373, 32.290),
    "colombia":   (4.571, -74.297),
    "eu":         (50.850, 4.352),
    "japan":      (36.204, 138.253),
    "usa":        (37.090, -95.713),
    "global":     (0.0, 0.0),
}
```

---

### Task 1: Scraper infrastructure

**Files:**
- Create: `backend/scraper/__init__.py`
- Create: `backend/scraper/requirements.txt`
- Create: `backend/Dockerfile.scraper`
- Modify: `docker-compose.yml`

**Step 1: Create scraper requirements file**

```
# backend/scraper/requirements.txt
sqlalchemy==2.0.36
psycopg2-binary==2.9.10
playwright==1.44.0
deep-translator==1.11.4
pytest==8.2.2
pytest-asyncio==0.23.7
```

**Step 2: Create Dockerfile.scraper**

```dockerfile
# backend/Dockerfile.scraper
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

COPY scraper/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium

COPY models.py database.py ./
COPY scraper/ ./scraper/

CMD ["python", "-m", "scraper.main"]
```

**Step 3: Create empty `__init__.py`**

```python
# backend/scraper/__init__.py
```

**Step 4: Add scraper service to docker-compose.yml**

Add after the `frontend` service block:

```yaml
  scraper:
    build:
      context: ./backend
      dockerfile: Dockerfile.scraper
    environment:
      DATABASE_URL: postgresql://coffee:coffee@db:5432/coffee_intel
    depends_on:
      - db
    restart: on-failure
```

**Step 5: Verify docker-compose config parses**

```bash
docker compose config --quiet
```

Expected: no errors printed.

**Step 6: Commit**

```bash
git add backend/scraper/__init__.py backend/scraper/requirements.txt backend/Dockerfile.scraper docker-compose.yml
git commit -m "feat: add scraper service infrastructure"
```

---

### Task 2: DB upsert helper

**Files:**
- Create: `backend/scraper/db.py`
- Create: `backend/scraper/tests/__init__.py`
- Create: `backend/scraper/tests/test_db.py`

**Step 1: Write failing test**

```python
# backend/scraper/tests/test_db.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

import pytest
from unittest.mock import MagicMock, patch
from scraper.db import upsert_news_item

def make_db():
    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = None
    return db

def test_upsert_inserts_new_item():
    db = make_db()
    upsert_news_item(db, {
        "title": "ICE Arabica – 2026-03-09",
        "body": "Settlement: 220.50 USc/lb",
        "source": "Barchart",
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": ["futures", "arabica"],
    })
    db.add.assert_called_once()
    db.commit.assert_called_once()

def test_upsert_skips_duplicate():
    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = MagicMock()  # exists
    upsert_news_item(db, {
        "title": "ICE Arabica – 2026-03-09",
        "body": "Settlement: 220.50 USc/lb",
        "source": "Barchart",
        "category": "general",
        "lat": 0.0,
        "lng": 0.0,
        "tags": ["futures", "arabica"],
    })
    db.add.assert_not_called()
```

**Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest scraper/tests/test_db.py -v
```

Expected: `ModuleNotFoundError: No module named 'scraper.db'`

**Step 3: Implement db.py**

```python
# backend/scraper/db.py
import os
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from models import NewsItem

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://coffee:coffee@localhost:5432/coffee_intel")
engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

def get_session():
    return Session()

def upsert_news_item(db, item: dict):
    existing = db.query(NewsItem).filter_by(title=item["title"]).first()
    if existing:
        return
    db.add(NewsItem(
        title=item["title"],
        body=item.get("body", ""),
        source=item.get("source", ""),
        category=item.get("category", "general"),
        lat=item.get("lat"),
        lng=item.get("lng"),
        tags=item.get("tags", []),
        pub_date=datetime.utcnow(),
    ))
    db.commit()
```

**Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest scraper/tests/test_db.py -v
```

Expected: 2 PASSED

**Step 5: Commit**

```bash
git add backend/scraper/db.py backend/scraper/tests/__init__.py backend/scraper/tests/test_db.py
git commit -m "feat: add scraper db upsert helper with tests"
```

---

### Task 3: Translation wrapper

**Files:**
- Create: `backend/scraper/translate.py`
- Create: `backend/scraper/tests/test_translate.py`

**Step 1: Write failing test**

```python
# backend/scraper/tests/test_translate.py
from unittest.mock import patch, MagicMock
from scraper.translate import translate_to_english

def test_translate_english_passthrough():
    # English text should return unchanged without calling translator
    result = translate_to_english("Coffee prices rise", "en")
    assert result == "Coffee prices rise"

def test_translate_portuguese():
    with patch("scraper.translate.GoogleTranslator") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.translate.return_value = "Coffee price today"
        mock_cls.return_value = mock_instance

        result = translate_to_english("Preço do café hoje", "pt")
        assert result == "Coffee price today"
        mock_cls.assert_called_once_with(source="pt", target="en")

def test_translate_returns_original_on_failure():
    with patch("scraper.translate.GoogleTranslator") as mock_cls:
        mock_cls.side_effect = Exception("network error")
        result = translate_to_english("Preço do café hoje", "pt")
        assert result == "Preço do café hoje"
```

**Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest scraper/tests/test_translate.py -v
```

Expected: `ModuleNotFoundError: No module named 'scraper.translate'`

**Step 3: Implement translate.py**

```python
# backend/scraper/translate.py
from deep_translator import GoogleTranslator

def translate_to_english(text: str, source_lang: str) -> str:
    """Translate text to English. Returns original text on any failure."""
    if not text or source_lang == "en":
        return text
    try:
        return GoogleTranslator(source=source_lang, target="en").translate(text)
    except Exception:
        return text
```

**Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest scraper/tests/test_translate.py -v
```

Expected: 3 PASSED

**Step 5: Commit**

```bash
git add backend/scraper/translate.py backend/scraper/tests/test_translate.py
git commit -m "feat: add translation wrapper with tests"
```

---

### Task 4: Source base class + Barchart (ICE futures & FX)

**Files:**
- Create: `backend/scraper/sources/__init__.py`
- Create: `backend/scraper/sources/barchart.py`
- Create: `backend/scraper/tests/test_barchart.py`

The Barchart scraper fetches these symbols:
- `KCA` — ICE NY Arabica (USc/lb)
- `RCA` — ICE London Robusta (USD/MT)
- `USDBRL` — USD/BRL
- `USDVND` — USD/VND
- `USDIDR` — USD/IDR
- `USDHNL` — USD/HNL

**Step 1: Write failing test**

```python
# backend/scraper/tests/test_barchart.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from scraper.sources.barchart import parse_barchart_price

def test_parse_barchart_price_extracts_value():
    # Simulated page HTML containing price
    html = '<span data-testid="last-price">220.50</span>'
    result = parse_barchart_price(html, "KCA", "ICE NY Arabica")
    assert result["title"].startswith("ICE NY Arabica –")
    assert "220.50" in result["body"]
    assert result["source"] == "Barchart"
    assert result["category"] == "general"
    assert "futures" in result["tags"]

def test_parse_barchart_price_returns_none_on_missing():
    html = '<div>no price here</div>'
    result = parse_barchart_price(html, "KCA", "ICE NY Arabica")
    assert result is None
```

**Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest scraper/tests/test_barchart.py -v
```

Expected: `ModuleNotFoundError`

**Step 3: Implement barchart.py**

```python
# backend/scraper/sources/barchart.py
import re
from datetime import date
from bs4 import BeautifulSoup

BARCHART_SYMBOLS = {
    "KCA":    ("ICE NY Arabica",     "general", ["futures", "arabica", "price"], "global"),
    "RCA":    ("ICE London Robusta", "general", ["futures", "robusta", "price"], "global"),
    "USDBRL": ("USD/BRL FX Rate",    "general", ["fx", "brazil"],               "brazil"),
    "USDVND": ("USD/VND FX Rate",    "general", ["fx", "vietnam"],              "vietnam"),
    "USDIDR": ("USD/IDR FX Rate",    "general", ["fx", "indonesia"],            "indonesia"),
    "USDHNL": ("USD/HNL FX Rate",    "general", ["fx", "honduras"],             "honduras"),
}

COUNTRY_COORDS = {
    "brazil":    (-14.235, -51.925),
    "vietnam":   (14.058, 108.277),
    "indonesia": (-0.789, 113.921),
    "honduras":  (15.200, -86.242),
    "global":    (0.0, 0.0),
}

def parse_barchart_price(html: str, symbol: str, label: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    # Barchart renders price in a span with data-testid="last-price" or class containing "last-price"
    tag = soup.find(attrs={"data-testid": "last-price"})
    if not tag:
        # Fallback: look for any element whose text looks like a price
        candidates = soup.find_all(string=re.compile(r"^\d[\d,.]+$"))
        tag = candidates[0].parent if candidates else None
    if not tag:
        return None
    price_text = tag.get_text(strip=True)
    today = date.today().isoformat()
    name, category, tags, country = BARCHART_SYMBOLS.get(symbol, (label, "general", ["price"], "global"))
    lat, lng = COUNTRY_COORDS.get(country, (0.0, 0.0))
    return {
        "title": f"{name} – {today}",
        "body": f"{name} price: {price_text}",
        "source": "Barchart",
        "category": category,
        "lat": lat,
        "lng": lng,
        "tags": tags,
    }

async def scrape_barchart(page, symbol: str) -> dict | None:
    name, *_ = BARCHART_SYMBOLS.get(symbol, (symbol, None, None, None))
    url = f"https://www.barchart.com/futures/quotes/{symbol}/overview"
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(3000)
    html = await page.content()
    return parse_barchart_price(html, symbol, name)

async def run(page) -> list[dict]:
    results = []
    for symbol in BARCHART_SYMBOLS:
        item = await scrape_barchart(page, symbol)
        if item:
            results.append(item)
    return results
```

**Step 4: Create sources __init__.py**

```python
# backend/scraper/sources/__init__.py
```

**Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest scraper/tests/test_barchart.py -v
```

Expected: 2 PASSED

**Step 6: Commit**

```bash
git add backend/scraper/sources/__init__.py backend/scraper/sources/barchart.py backend/scraper/tests/test_barchart.py
git commit -m "feat: add Barchart scraper for ICE futures and FX rates"
```

---

### Task 5: Brazil supply sources

**Files:**
- Create: `backend/scraper/sources/brazil.py`
- Create: `backend/scraper/tests/test_brazil.py`

Covers: Cooabriel (Conilon BRL price), Noticiasagricolas (Arabica price), Cecafe (exports).

**Step 1: Write failing test**

```python
# backend/scraper/tests/test_brazil.py
from scraper.sources.brazil import parse_cooabriel, parse_noticiasagricolas

def test_parse_cooabriel_extracts_price():
    html = '<td class="valor">R$ 1.250,00</td>'
    result = parse_cooabriel(html)
    assert result is not None
    assert "1.250,00" in result["body"] or "1250" in result["body"]
    assert result["source"] == "Cooabriel"
    assert "conilon" in result["tags"]

def test_parse_cooabriel_returns_none_when_missing():
    html = "<html><body>sem dados</body></html>"
    result = parse_cooabriel(html)
    assert result is None

def test_parse_noticiasagricolas_extracts_price():
    html = '<span class="cotacao-valor">650,00</span>'
    result = parse_noticiasagricolas(html)
    assert result is not None
    assert "650" in result["body"]
    assert result["source"] == "Noticiasagricolas"
```

**Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest scraper/tests/test_brazil.py -v
```

Expected: `ModuleNotFoundError`

**Step 3: Implement brazil.py**

```python
# backend/scraper/sources/brazil.py
import re
from datetime import date
from bs4 import BeautifulSoup
from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = -14.235, -51.925

def parse_cooabriel(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"valor|cotacao|price", re.I))
    if not tag:
        tag = soup.find("td", string=re.compile(r"R\$\s*[\d.,]+"))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Conilon Physical Price (Cooabriel) – {_TODAY()}",
        "body": translate_to_english(f"Conilon physical price today: {text}", "pt"),
        "source": "Cooabriel",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "brazil", "conilon"],
    }

def parse_noticiasagricolas(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"cotacao|valor|price", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Brazil Arabica Price (Noticiasagricolas) – {_TODAY()}",
        "body": translate_to_english(f"Arabica coffee price: {text}", "pt"),
        "source": "Noticiasagricolas",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "brazil", "arabica"],
    }

def parse_cecafe(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    # Look for export volume numbers in tables
    tables = soup.find_all("table")
    if not tables:
        return None
    rows = tables[0].find_all("tr")
    if len(rows) < 2:
        return None
    cells = rows[1].find_all("td")
    if not cells:
        return None
    text = " | ".join(c.get_text(strip=True) for c in cells[:4])
    return {
        "title": f"Brazil Coffee Exports (Cecafe) – {_TODAY()}",
        "body": translate_to_english(f"Brazil coffee export data: {text}", "pt"),
        "source": "Cecafe",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["exports", "brazil"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://cooabriel.coop.br/cotacao-do-dia", parse_cooabriel),
        ("https://www.noticiasagricolas.com.br/cotacoes/cafe", parse_noticiasagricolas),
        ("https://www.cecafe.com.br/", parse_cecafe),
    ]
    for url, parser in sources:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            html = await page.content()
            item = parser(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[brazil] {url} failed: {e}")
    return results
```

**Step 4: Run tests**

```bash
cd backend && python -m pytest scraper/tests/test_brazil.py -v
```

Expected: 3 PASSED

**Step 5: Commit**

```bash
git add backend/scraper/sources/brazil.py backend/scraper/tests/test_brazil.py
git commit -m "feat: add Brazil supply scrapers (Cooabriel, Noticiasagricolas, Cecafe)"
```

---

### Task 6: Vietnam supply sources

**Files:**
- Create: `backend/scraper/sources/vietnam.py`
- Create: `backend/scraper/tests/test_vietnam.py`

Covers: Giacaphe (VND price), Tintaynguyen (news), Vicofa (association news).

**Step 1: Write failing test**

```python
# backend/scraper/tests/test_vietnam.py
from scraper.sources.vietnam import parse_giacaphe, parse_tintaynguyen

def test_parse_giacaphe_extracts_price():
    html = '<td class="price">43.500</td>'
    result = parse_giacaphe(html)
    assert result is not None
    assert result["source"] == "Giacaphe"
    assert "vietnam" in result["tags"]
    assert "43" in result["body"] or "price" in result["body"].lower()

def test_parse_giacaphe_returns_none_when_missing():
    html = "<html><body>no data</body></html>"
    result = parse_giacaphe(html)
    assert result is None

def test_parse_tintaynguyen_extracts_headline():
    html = '<h2 class="entry-title"><a href="#">Giá cà phê hôm nay tăng</a></h2>'
    result = parse_tintaynguyen(html)
    assert result is not None
    assert result["source"] == "Tintaynguyen"
```

**Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest scraper/tests/test_vietnam.py -v
```

Expected: `ModuleNotFoundError`

**Step 3: Implement vietnam.py**

```python
# backend/scraper/sources/vietnam.py
import re
from datetime import date
from bs4 import BeautifulSoup
from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = 14.058, 108.277

def parse_giacaphe(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"price|gia|gias", re.I))
    if not tag:
        tag = soup.find("td", string=re.compile(r"\d{2,3}[.,]\d{3}"))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"Vietnam Local Coffee Price (Giacaphe) – {_TODAY()}",
        "body": translate_to_english(f"Vietnam local coffee price: {text} VND/kg", "vi"),
        "source": "Giacaphe",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["price", "vietnam", "robusta"],
    }

def parse_tintaynguyen(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(["h1", "h2", "h3"], class_=re.compile(r"title|entry|heading", re.I))
    if not tag:
        tag = soup.find(["h1", "h2"])
    if not tag:
        return None
    text = tag.get_text(strip=True)
    translated = translate_to_english(text, "vi")
    return {
        "title": f"Vietnam Coffee Intel (Tintaynguyen) – {_TODAY()}",
        "body": translated,
        "source": "Tintaynguyen",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["news", "vietnam"],
    }

def parse_vicofa(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(["h1", "h2", "h3"])
    if not tag:
        return None
    text = tag.get_text(strip=True)
    translated = translate_to_english(text, "vi")
    return {
        "title": f"Vicofa News – {_TODAY()}",
        "body": translated,
        "source": "Vicofa",
        "category": "supply",
        "lat": _LAT, "lng": _LNG,
        "tags": ["news", "vietnam"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://giacaphe.com/gia-ca-phe-noi-dia/", parse_giacaphe),
        ("https://tintaynguyen.com/gia-ca-phe/", parse_tintaynguyen),
        ("https://vicofa.org.vn/", parse_vicofa),
    ]
    for url, parser in sources:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            html = await page.content()
            item = parser(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[vietnam] {url} failed: {e}")
    return results
```

**Step 4: Run tests**

```bash
cd backend && python -m pytest scraper/tests/test_vietnam.py -v
```

Expected: 3 PASSED

**Step 5: Commit**

```bash
git add backend/scraper/sources/vietnam.py backend/scraper/tests/test_vietnam.py
git commit -m "feat: add Vietnam supply scrapers (Giacaphe, Tintaynguyen, Vicofa)"
```

---

### Task 7: Indonesia, Honduras, Uganda, Colombia sources

**Files:**
- Create: `backend/scraper/sources/origins.py`
- Create: `backend/scraper/tests/test_origins.py`

Covers: Alfabean (Indonesia IDR), IHCafe Honduras (HNL/Quintal), Uganda Coffee Board, Federación de Cafeteros Colombia.

**Step 1: Write failing test**

```python
# backend/scraper/tests/test_origins.py
from scraper.sources.origins import parse_alfabean, parse_ihcafe, parse_uganda, parse_colombia

def test_parse_alfabean_extracts_price():
    html = '<td class="price-idr">45.000</td>'
    result = parse_alfabean(html)
    assert result is not None
    assert result["source"] == "Alfabean"
    assert "indonesia" in result["tags"]

def test_parse_ihcafe_extracts_price():
    html = '<td>L. 1.250,00</td>'
    result = parse_ihcafe(html)
    assert result is not None
    assert result["source"] == "IHCafe"
    assert "honduras" in result["tags"]

def test_parse_uganda_extracts_data():
    html = '<p class="export-volume">Uganda exported 500,000 bags</p>'
    result = parse_uganda(html)
    assert result is not None
    assert result["source"] == "Uganda Coffee Board"

def test_parse_colombia_extracts_data():
    html = '<div class="estadisticas">Producción: 1.2M sacos</div>'
    result = parse_colombia(html)
    assert result is not None
    assert result["source"] == "Federación de Cafeteros"
```

**Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest scraper/tests/test_origins.py -v
```

Expected: `ModuleNotFoundError`

**Step 3: Implement origins.py**

```python
# backend/scraper/sources/origins.py
import re
from datetime import date
from bs4 import BeautifulSoup
from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()

COORDS = {
    "indonesia": (-0.789, 113.921),
    "honduras":  (15.200, -86.242),
    "uganda":    (1.373, 32.290),
    "colombia":  (4.571, -74.297),
}

def _first_text(html, selectors):
    soup = BeautifulSoup(html, "html.parser")
    for selector in selectors:
        tag = soup.find(class_=re.compile(selector, re.I)) or soup.find(string=re.compile(selector, re.I))
        if tag:
            return tag if isinstance(tag, str) else tag.get_text(strip=True)
    return None

def parse_alfabean(html: str) -> dict | None:
    text = _first_text(html, [r"price|idr|harga"])
    if not text:
        return None
    lat, lng = COORDS["indonesia"]
    return {
        "title": f"Indonesia Local Coffee Price (Alfabean) – {_TODAY()}",
        "body": translate_to_english(f"Indonesia local coffee price: {text} IDR/kg", "id"),
        "source": "Alfabean",
        "category": "supply",
        "lat": lat, "lng": lng,
        "tags": ["price", "indonesia"],
    }

def parse_ihcafe(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    # Look for Lempira price patterns: "L. X,XXX" or "HNL"
    tag = soup.find(string=re.compile(r"L\.\s*[\d.,]+|HNL|Lempira", re.I))
    if not tag:
        tag = soup.find("td", string=re.compile(r"[\d.,]{4,}"))
    if not tag:
        return None
    text = tag if isinstance(tag, str) else tag.get_text(strip=True)
    lat, lng = COORDS["honduras"]
    return {
        "title": f"Honduras Coffee Price (IHCafe) – {_TODAY()}",
        "body": translate_to_english(f"Honduras daily coffee price: {text}", "es"),
        "source": "IHCafe",
        "category": "supply",
        "lat": lat, "lng": lng,
        "tags": ["price", "honduras"],
    }

def parse_uganda(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"export|stat|news|content", re.I))
    if not tag:
        tag = soup.find("p")
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    lat, lng = COORDS["uganda"]
    return {
        "title": f"Uganda Coffee Export Data – {_TODAY()}",
        "body": text,
        "source": "Uganda Coffee Board",
        "category": "supply",
        "lat": lat, "lng": lng,
        "tags": ["exports", "uganda"],
    }

def parse_colombia(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"estadistica|stat|production|news", re.I))
    if not tag:
        tag = soup.find("div")
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    lat, lng = COORDS["colombia"]
    return {
        "title": f"Colombia Coffee Stats (Federación de Cafeteros) – {_TODAY()}",
        "body": translate_to_english(text, "es"),
        "source": "Federación de Cafeteros",
        "category": "supply",
        "lat": lat, "lng": lng,
        "tags": ["stats", "colombia"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://www.alfabean.com/price-list/",     parse_alfabean),
        ("https://www.ihcafe.hn/",                   parse_ihcafe),
        ("https://ugandacoffee.go.ug/",              parse_uganda),
        ("https://federaciondecafeteros.org/",       parse_colombia),
    ]
    for url, parser in sources:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            html = await page.content()
            item = parser(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[origins] {url} failed: {e}")
    return results
```

**Step 4: Run tests**

```bash
cd backend && python -m pytest scraper/tests/test_origins.py -v
```

Expected: 4 PASSED

**Step 5: Commit**

```bash
git add backend/scraper/sources/origins.py backend/scraper/tests/test_origins.py
git commit -m "feat: add Indonesia, Honduras, Uganda, Colombia scrapers"
```

---

### Task 8: Demand & technicals sources

**Files:**
- Create: `backend/scraper/sources/demand.py`
- Create: `backend/scraper/sources/technicals.py`
- Create: `backend/scraper/tests/test_demand.py`

Covers: ECF EU stocks, AJCA Japan stocks, BLS CPI, CFTC CoT, World Bank fertilizer, Searates freight.

**Step 1: Write failing test**

```python
# backend/scraper/tests/test_demand.py
from scraper.sources.demand import parse_bls_cpi
from scraper.sources.technicals import parse_worldbank_fertilizer

def test_parse_bls_cpi_extracts_value():
    html = '<td class="datavalue">309.685</td>'
    result = parse_bls_cpi(html)
    assert result is not None
    assert result["source"] == "BLS"
    assert "cpi" in result["tags"]
    assert "usa" in result["tags"]

def test_parse_worldbank_fertilizer_extracts_value():
    html = '<td class="odd views-field">156.3</td>'
    result = parse_worldbank_fertilizer(html)
    assert result is not None
    assert result["source"] == "World Bank"
    assert "fertilizer" in result["tags"]
```

**Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest scraper/tests/test_demand.py -v
```

Expected: `ModuleNotFoundError`

**Step 3: Implement demand.py**

```python
# backend/scraper/sources/demand.py
import re
from datetime import date
from bs4 import BeautifulSoup

_TODAY = lambda: date.today().isoformat()

def parse_ecf(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"stat|stock|data|figure", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    return {
        "title": f"EU Port Coffee Stocks (ECF) – {_TODAY()}",
        "body": text,
        "source": "ECF",
        "category": "demand",
        "lat": 50.850, "lng": 4.352,
        "tags": ["stocks", "eu"],
    }

def parse_ajca(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find("table")
    if not tag:
        return None
    rows = tag.find_all("tr")
    if len(rows) < 2:
        return None
    text = rows[1].get_text(" | ", strip=True)[:300]
    return {
        "title": f"Japan Coffee Stocks (AJCA) – {_TODAY()}",
        "body": text,
        "source": "AJCA",
        "category": "demand",
        "lat": 36.204, "lng": 138.253,
        "tags": ["stocks", "japan"],
    }

def parse_bls_cpi(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"datavalue|cpivalue|value", re.I))
    if not tag:
        tag = soup.find("td", string=re.compile(r"^\d{3}[\.,]\d+$"))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    return {
        "title": f"US CPI (BLS) – {_TODAY()}",
        "body": f"US Consumer Price Index: {text}",
        "source": "BLS",
        "category": "demand",
        "lat": 37.090, "lng": -95.713,
        "tags": ["cpi", "usa", "demand"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://www.ecf-coffee.org/statistics/",                      parse_ecf),
        ("http://coffee.ajca.or.jp/data",                               parse_ajca),
        ("https://www.bls.gov/news.release/cpi.t01.htm",                parse_bls_cpi),
    ]
    for url, parser in sources:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            html = await page.content()
            item = parser(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[demand] {url} failed: {e}")
    return results
```

**Step 4: Implement technicals.py**

```python
# backend/scraper/sources/technicals.py
import re
from datetime import date
from bs4 import BeautifulSoup

_TODAY = lambda: date.today().isoformat()

def parse_cftc_cot(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"report|cot|commitment", re.I))
    if not tag:
        tag = soup.find("a", string=re.compile(r"Coffee|Arabica|Robusta", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    return {
        "title": f"CFTC Commitments of Traders – {_TODAY()}",
        "body": f"CoT Report: {text}",
        "source": "CFTC",
        "category": "general",
        "lat": 0.0, "lng": 0.0,
        "tags": ["technicals", "cot"],
    }

def parse_worldbank_fertilizer(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"odd|even|value|data", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)
    if not re.search(r"\d", text):
        return None
    return {
        "title": f"World Bank Fertilizer Index – {_TODAY()}",
        "body": f"Fertilizer commodity index: {text}",
        "source": "World Bank",
        "category": "supply",
        "lat": 0.0, "lng": 0.0,
        "tags": ["inputs", "fertilizer"],
    }

def parse_searates(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"rate|freight|price|index", re.I))
    if not tag:
        return None
    text = tag.get_text(strip=True)[:300]
    return {
        "title": f"Ocean Freight Rates (Searates) – {_TODAY()}",
        "body": f"Ocean freight market: {text}",
        "source": "Searates",
        "category": "general",
        "lat": 0.0, "lng": 0.0,
        "tags": ["logistics", "freight"],
    }

async def run(page) -> list[dict]:
    results = []
    sources = [
        ("https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm", parse_cftc_cot),
        ("https://www.worldbank.org/en/research/commodity-markets",           parse_worldbank_fertilizer),
        ("https://www.searates.com/",                                          parse_searates),
    ]
    for url, parser in sources:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)
            html = await page.content()
            item = parser(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[technicals] {url} failed: {e}")
    return results
```

**Step 5: Run tests**

```bash
cd backend && python -m pytest scraper/tests/test_demand.py -v
```

Expected: 2 PASSED

**Step 6: Commit**

```bash
git add backend/scraper/sources/demand.py backend/scraper/sources/technicals.py backend/scraper/tests/test_demand.py
git commit -m "feat: add demand and technicals scrapers (ECF, AJCA, BLS, CFTC, WorldBank, Searates)"
```

---

### Task 9: B3 Brazil futures scraper

**Files:**
- Create: `backend/scraper/sources/b3.py`
- Create: `backend/scraper/tests/test_b3.py`

B3 requires full JS render (Playwright). The scraper navigates to the coffee futures page and extracts the settlement price.

**Step 1: Write failing test**

```python
# backend/scraper/tests/test_b3.py
from scraper.sources.b3 import parse_b3

def test_parse_b3_extracts_price():
    html = '<td class="quotation__last-value">R$ 1.350,00</td>'
    result = parse_b3(html)
    assert result is not None
    assert result["source"] == "B3"
    assert "brazil" in result["tags"]
    assert "futures" in result["tags"]

def test_parse_b3_returns_none_when_missing():
    html = "<html><body>sem dados</body></html>"
    result = parse_b3(html)
    assert result is None
```

**Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest scraper/tests/test_b3.py -v
```

Expected: `ModuleNotFoundError`

**Step 3: Implement b3.py**

```python
# backend/scraper/sources/b3.py
import re
from datetime import date
from bs4 import BeautifulSoup
from scraper.translate import translate_to_english

_TODAY = lambda: date.today().isoformat()
_LAT, _LNG = -14.235, -51.925

def parse_b3(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find(class_=re.compile(r"last.?value|settlement|cotacao|valor", re.I))
    if not tag:
        tag = soup.find(string=re.compile(r"R\$\s*[\d.,]+"))
    if not tag:
        return None
    text = tag if isinstance(tag, str) else tag.get_text(strip=True)
    return {
        "title": f"B3 Brazil Coffee Futures – {_TODAY()}",
        "body": translate_to_english(f"B3 Brazil coffee futures settlement: {text}", "pt"),
        "source": "B3",
        "category": "general",
        "lat": _LAT, "lng": _LNG,
        "tags": ["futures", "brazil", "arabica"],
    }

async def run(page) -> list[dict]:
    # B3 coffee futures — Arabica (ICA) and Conilon (ICF)
    results = []
    urls = [
        "https://www.b3.com.br/en_us/market-data-and-indices/data-services/market-data/quotes/futures/ica/",
        "https://www.b3.com.br/en_us/market-data-and-indices/data-services/market-data/quotes/futures/icf/",
    ]
    for url in urls:
        try:
            await page.goto(url, wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(4000)
            html = await page.content()
            item = parse_b3(html)
            if item:
                results.append(item)
        except Exception as e:
            print(f"[b3] {url} failed: {e}")
    return results
```

**Step 4: Run tests**

```bash
cd backend && python -m pytest scraper/tests/test_b3.py -v
```

Expected: 2 PASSED

**Step 5: Commit**

```bash
git add backend/scraper/sources/b3.py backend/scraper/tests/test_b3.py
git commit -m "feat: add B3 Brazil coffee futures scraper"
```

---

### Task 10: Main orchestrator

**Files:**
- Create: `backend/scraper/main.py`

**Step 1: Implement main.py**

```python
# backend/scraper/main.py
import asyncio
import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from playwright.async_api import async_playwright
from scraper.db import get_session, upsert_news_item
from scraper.sources import barchart, b3, brazil, vietnam, origins, demand, technicals

ALL_SOURCES = [barchart, b3, brazil, vietnam, origins, demand, technicals]
INTERVAL_HOURS = 24

async def run_all_scrapers():
    print("[scraper] Starting daily scrape run...")
    db = get_session()
    total = 0
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            page = await browser.new_page()
            for source in ALL_SOURCES:
                name = source.__name__.split(".")[-1]
                try:
                    items = await source.run(page)
                    for item in items:
                        upsert_news_item(db, item)
                        total += 1
                    print(f"[scraper] {name}: {len(items)} items")
                except Exception as e:
                    print(f"[scraper] {name} failed: {e}")
            await browser.close()
    finally:
        db.close()
    print(f"[scraper] Done. {total} items inserted.")

def main():
    while True:
        asyncio.run(run_all_scrapers())
        print(f"[scraper] Sleeping {INTERVAL_HOURS}h until next run...")
        time.sleep(INTERVAL_HOURS * 3600)

if __name__ == "__main__":
    main()
```

**Step 2: Verify the module imports cleanly (no DB connection needed)**

```bash
cd backend && python -c "import scraper.main; print('OK')"
```

Expected: `OK` (may show import warnings but no crash)

**Step 3: Commit**

```bash
git add backend/scraper/main.py
git commit -m "feat: add scraper orchestrator with 24h loop"
```

---

### Task 11: Run full test suite & verify

**Step 1: Install scraper dependencies locally**

```bash
cd backend && pip install playwright==1.44.0 deep-translator==1.11.4 pytest==8.2.2 pytest-asyncio==0.23.7
playwright install chromium
```

**Step 2: Run all scraper tests**

```bash
cd backend && python -m pytest scraper/tests/ -v
```

Expected: All tests PASS (should be ~15+ tests)

**Step 3: Build Docker images to verify Dockerfile.scraper is valid**

```bash
docker compose build scraper
```

Expected: Build completes successfully, `playwright install chromium` runs inside image.

**Step 4: Smoke test — run scraper locally against live DB**

```bash
docker compose up -d db
DATABASE_URL=postgresql://coffee:coffee@localhost:5432/coffee_intel docker compose run --rm scraper python -m scraper.main
```

Expected: Scraper logs show each source attempt, some items inserted, process continues to sleep.

**Step 5: Final commit**

```bash
git add .
git commit -m "feat: complete automated daily scraper service"
```

---

## Summary of Files Created

```
backend/
  Dockerfile.scraper
  scraper/
    __init__.py
    main.py
    db.py
    translate.py
    sources/
      __init__.py
      barchart.py
      b3.py
      brazil.py
      vietnam.py
      origins.py      (indonesia, honduras, uganda, colombia)
      demand.py       (ecf, ajca, bls)
      technicals.py   (cftc, worldbank, searates)
    tests/
      __init__.py
      test_db.py
      test_translate.py
      test_barchart.py
      test_b3.py
      test_brazil.py
      test_vietnam.py
      test_origins.py
      test_demand.py
docker-compose.yml    (add scraper service)
```
