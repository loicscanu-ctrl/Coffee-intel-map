# Farmer Economics Live Data Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock data in the Brazil Farmer Economics tab with live scraped data from 6 free sources (Open-Meteo, NOAA CPC, World Bank, CONAB Safra, CONAB Custos, Comex Stat).

**Architecture:** Two new Python scraper files write to two new DB tables (`WeatherSnapshot`, `FertilizerImport`) and four `NewsItem` rows. A new `export_farmer_economics(db)` function assembles `frontend/public/data/farmer_economics.json`. `BrazilFarmerEconomics.tsx` fetches that file on mount instead of reading a constant. Three frontend components are updated: `WeatherRiskPanel` (adds Current Conditions row), `FertilizerPanel` (adds import bar chart), and `farmerEconomicsData.ts` (adds types, removes `ForecastAccuracyPoint`).

**Tech Stack:** Python 3.11, SQLAlchemy 2.0, requests, BeautifulSoup4, openpyxl, Playwright (Comex Stat only), Next.js 14, TypeScript, Recharts, GitHub Actions

---

## File Map

**New backend:**
- `backend/scraper/sources/farmer_economics.py` — daily: Open-Meteo weather, NOAA ENSO, World Bank fertilizer prices
- `backend/scraper/sources/conab_supply.py` — monthly: CONAB Safra acreage/yield + CONAB Custos production cost
- `backend/scraper/sources/comex_fertilizer.py` — monthly: Comex Stat fertilizer imports (Playwright)
- `backend/scraper/run_monthly.py` — monthly runner entrypoint
- `backend/scraper/tests/test_farmer_economics.py`
- `backend/scraper/tests/test_conab_supply.py`
- `.github/workflows/scraper-monthly.yml`

**Modified backend:**
- `backend/models.py` — add WeatherSnapshot, FertilizerImport
- `backend/scraper/db.py` — add `create_farmer_economics_tables()`
- `backend/scraper/main.py` — call farmer_economics.run() in daily loop
- `backend/scraper/run_daily.py` — call create_farmer_economics_tables() on startup
- `backend/scraper/export_static_json.py` — add `export_farmer_economics()`, call from `main()`
- `.github/workflows/scraper-daily.yml` — add farmer_economics.json to git-add step

**Modified frontend:**
- `frontend/components/supply/farmer-economics/farmerEconomicsData.ts`
- `frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx`
- `frontend/components/supply/farmer-economics/WeatherRiskPanel.tsx`
- `frontend/components/supply/farmer-economics/FertilizerPanel.tsx`

---

## NewsItem meta JSON contracts (source of truth for Task 5)

Each source stores one NewsItem row, overwritten on each successful scrape:

**NOAA CPC** (source="NOAA CPC", tags=["enso","supply"]):
```json
{
  "oni_history": [
    {"month": "Oct-24", "value": 0.1},
    {"month": "Jan-26", "value": 0.3, "forecast": true}
  ]
}
```

**World Bank** (source="World Bank", tags=["fertilizer","price","supply"]):
```json
{
  "urea_monthly":  [268, 274, 281, 290, 298, 312, 340],
  "dap_monthly":   [560, 565, 570, 572, 572, 584, 595],
  "kcl_monthly":   [310, 305, 298, 292, 294, 278, 265]
}
```
(7 values oldest→newest; first 6 = sparkline, last = current price)

**CONAB Safra** (source="CONAB Safra", tags=["conab","supply","brazil"]):
```json
{
  "season": "2025/26",
  "harvested_area_kha": 2240,
  "prev_area_kha": 2209,
  "yield_bags_ha": 32,
  "prev_yield_bags_ha": 33,
  "source_label": "CONAB Safra Apr 2026"
}
```

**CONAB Custos** (source="CONAB Custos", tags=["conab","supply","brazil","cost"]):
```json
{
  "season": "2025/26",
  "total_brl_per_bag": 730,
  "prev_total_brl_per_bag": 715,
  "brl_usd": 5.0,
  "components_brl": [
    {"label": "Inputs",        "label_pt": "Insumos",       "brl": 277, "color": "#3b82f6"},
    {"label": "Labor",         "label_pt": "Mão de obra",   "brl": 197, "color": "#22c55e"},
    {"label": "Mechanization", "label_pt": "Mecanização",   "brl": 131, "color": "#f59e0b"},
    {"label": "Land rent",     "label_pt": "Arrendamento",  "brl":  87, "color": "#8b5cf6"},
    {"label": "Admin",         "label_pt": "Administração", "brl":  36, "color": "#475569"}
  ],
  "inputs_detail_brl": [
    {"label": "Nitrogen (urea / AN)",    "brl": 90},
    {"label": "Potassium (KCl)",         "brl": 68},
    {"label": "Phosphorus (MAP)",        "brl": 54},
    {"label": "Pesticides / fungicides", "brl": 44},
    {"label": "Lime / soil correction",  "brl": 21}
  ],
  "source_label": "CONAB Custos Apr 2026"
}
```

---

## Task 1: DB Models — WeatherSnapshot and FertilizerImport

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/scraper/db.py`
- Test: `backend/scraper/tests/test_farmer_economics.py` (table structure checks)

- [ ] **Step 1: Write the failing test**

```python
# backend/scraper/tests/test_farmer_economics.py
import pytest

def test_weather_snapshot_has_expected_columns():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import WeatherSnapshot
    cols = {c.name for c in WeatherSnapshot.__table__.columns}
    assert {"id", "region", "scraped_at", "daily_data"}.issubset(cols)

def test_fertilizer_import_has_expected_columns():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import FertilizerImport
    cols = {c.name for c in FertilizerImport.__table__.columns}
    assert {"id", "month", "ncm_code", "ncm_label", "net_weight_kg", "fob_usd", "scraped_at"}.issubset(cols)

def test_fertilizer_import_unique_constraint():
    from models import FertilizerImport
    constraints = {c.name for c in FertilizerImport.__table__.constraints}
    assert "uq_fert_import_month_ncm" in constraints
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
python -m pytest scraper/tests/test_farmer_economics.py -v
```
Expected: `ImportError` (WeatherSnapshot not defined yet)

- [ ] **Step 3: Add models to `backend/models.py`**

Add after the `CommodityPrice` class (line ~174):

```python
class WeatherSnapshot(Base):
    __tablename__ = "weather_snapshots"

    id:         Mapped[int]      = mapped_column(primary_key=True)
    region:     Mapped[str]      = mapped_column(String(100), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    daily_data: Mapped[dict]     = mapped_column(JSON, default=list)


class FertilizerImport(Base):
    __tablename__ = "fertilizer_imports"

    id:            Mapped[int]      = mapped_column(primary_key=True)
    month:         Mapped[date]     = mapped_column(Date, nullable=False)
    ncm_code:      Mapped[str]      = mapped_column(String(20), nullable=False)
    ncm_label:     Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    net_weight_kg: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fob_usd:       Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    scraped_at:    Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("month", "ncm_code", name="uq_fert_import_month_ncm"),)
```

- [ ] **Step 4: Add `create_farmer_economics_tables()` to `backend/scraper/db.py`**

Add at the end of the file:

```python
def create_farmer_economics_tables():
    """Create WeatherSnapshot and FertilizerImport tables if they don't exist."""
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from database import Base
    from models import WeatherSnapshot, FertilizerImport
    engine = _get_engine()
    Base.metadata.create_all(engine, tables=[
        WeatherSnapshot.__table__,
        FertilizerImport.__table__,
    ])
    print("[db] farmer_economics tables created/verified")
```

- [ ] **Step 5: Run tests**

```bash
cd backend
python -m pytest scraper/tests/test_farmer_economics.py -v
```
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/scraper/db.py backend/scraper/tests/test_farmer_economics.py
git commit -m "feat: add WeatherSnapshot and FertilizerImport DB models"
```

---

## Task 2: farmer_economics.py — Weather Scraper (Open-Meteo)

**Files:**
- Create: `backend/scraper/sources/farmer_economics.py`
- Modify: `backend/scraper/tests/test_farmer_economics.py`

- [ ] **Step 1: Add tests for parsing helpers**

Append to `backend/scraper/tests/test_farmer_economics.py`:

```python
def test_aggregate_hourly_to_daily_basic():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from sources.farmer_economics import _aggregate_hourly_to_daily

    # 48 hours of data for 2 days
    times  = [f"2026-04-15T{h:02d}:00" for h in range(24)] + \
             [f"2026-04-16T{h:02d}:00" for h in range(24)]
    hourly = {
        "time":                     times,
        "temperature_2m":           [10.0] * 24 + [3.0]  * 24,
        "dew_point_2m":             [5.0]  * 24 + [2.0]  * 24,
        "cloud_cover":              [50.0] * 24 + [80.0] * 24,
        "wind_speed_10m":           [20.0] * 24 + [35.0] * 24,
        "precipitation_probability":[70.0] * 24 + [10.0] * 24,
    }
    result = _aggregate_hourly_to_daily(hourly)
    assert len(result) == 2
    # Day 1: min_temp=10, precip=70 → no frost, no drought
    assert result[0]["frost_risk"] == "-"
    assert result[0]["drought_risk"] == "-"
    # Day 2: min_temp=3 → "H" frost; precip=10 → "H" drought
    assert result[1]["frost_risk"] == "H"
    assert result[1]["drought_risk"] == "H"

def test_frost_risk_boundaries():
    from sources.farmer_economics import _frost_risk
    assert _frost_risk(3.9)  == "H"
    assert _frost_risk(4.0)  == "M"
    assert _frost_risk(7.9)  == "M"
    assert _frost_risk(8.0)  == "L"
    assert _frost_risk(11.9) == "L"
    assert _frost_risk(12.0) == "-"

def test_drought_risk_boundaries():
    from sources.farmer_economics import _drought_risk
    assert _drought_risk(14.9) == "H"
    assert _drought_risk(15.0) == "M"
    assert _drought_risk(34.9) == "M"
    assert _drought_risk(35.0) == "L"
    assert _drought_risk(59.9) == "L"
    assert _drought_risk(60.0) == "-"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python -m pytest scraper/tests/test_farmer_economics.py::test_aggregate_hourly_to_daily_basic -v
```
Expected: `ModuleNotFoundError` (farmer_economics.py not yet created)

- [ ] **Step 3: Create `backend/scraper/sources/farmer_economics.py` with weather helpers**

```python
"""
farmer_economics.py — Daily scraper for Brazil Farmer Economics panel.
Sources: Open-Meteo (weather), NOAA CPC (ENSO/ONI), World Bank Pink Sheet (fertilizer prices).
Called from main.py as an async run(page, db) function.
"""
import json
import calendar
import requests
from datetime import datetime, date, timezone

REGIONS = [
    {"name": "Sul de Minas",   "lat": -21.76, "lon": -45.25},
    {"name": "Cerrado",        "lat": -18.50, "lon": -47.50},
    {"name": "Paraná",         "lat": -23.55, "lon": -51.17},
    {"name": "Espírito Santo", "lat": -20.08, "lon": -41.37},
]

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&hourly=temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m,precipitation_probability"
    "&forecast_days=14"
    "&timezone=America/Sao_Paulo"
)

NOAA_ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"

WORLD_BANK_URL = (
    "https://thedocs.worldbank.org/en/doc/"
    "5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx"
)

# Map 3-letter season code to representative calendar month number
_SEASON_MONTHS = {
    "DJF":1,"JFM":2,"FMA":3,"MAM":4,"AMJ":5,"MJJ":6,
    "JJA":7,"JAS":8,"ASO":9,"SON":10,"OND":11,"NDJ":12,
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _frost_risk(min_temp: float) -> str:
    if min_temp < 4:  return "H"
    if min_temp < 8:  return "M"
    if min_temp < 12: return "L"
    return "-"

def _drought_risk(precip_prob: float) -> str:
    if precip_prob < 15: return "H"
    if precip_prob < 35: return "M"
    if precip_prob < 60: return "L"
    return "-"

def _aggregate_hourly_to_daily(hourly: dict) -> list[dict]:
    """Aggregate Open-Meteo hourly data into 14 daily dicts with risk levels."""
    times  = hourly["time"]
    temp   = hourly["temperature_2m"]
    dew    = hourly["dew_point_2m"]
    cloud  = hourly["cloud_cover"]
    wind   = hourly["wind_speed_10m"]
    precip = hourly["precipitation_probability"]

    buckets: dict[str, dict] = {}
    for i, t in enumerate(times):
        day = t[:10]
        if day not in buckets:
            buckets[day] = {"temps":[], "dews":[], "clouds":[], "winds":[], "precips":[]}
        buckets[day]["temps"].append(temp[i])
        buckets[day]["dews"].append(dew[i])
        buckets[day]["clouds"].append(cloud[i])
        buckets[day]["winds"].append(wind[i])
        buckets[day]["precips"].append(precip[i])

    result = []
    for day in sorted(buckets.keys())[:14]:
        b = buckets[day]
        min_temp   = min(b["temps"])
        max_temp   = max(b["temps"])
        mean_dew   = sum(b["dews"])   / len(b["dews"])
        mean_cloud = sum(b["clouds"]) / len(b["clouds"])
        max_wind   = max(b["winds"])
        max_precip = max(b["precips"])
        result.append({
            "date":         day,
            "min_temp":     round(min_temp, 1),
            "max_temp":     round(max_temp, 1),
            "dew_point":    round(mean_dew, 1),
            "cloud_cover":  round(mean_cloud),
            "wind_speed":   round(max_wind, 1),
            "precip_prob":  round(max_precip),
            "frost_risk":   _frost_risk(min_temp),
            "drought_risk": _drought_risk(max_precip),
        })
    return result


def _scrape_weather(db) -> None:
    """Fetch 14-day forecast for 4 regions and upsert WeatherSnapshot rows."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import WeatherSnapshot

    now = datetime.now(timezone.utc)
    for region in REGIONS:
        url  = OPEN_METEO_URL.format(lat=region["lat"], lon=region["lon"])
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        data       = resp.json()
        daily_data = _aggregate_hourly_to_daily(data["hourly"])

        db.query(WeatherSnapshot).filter(
            WeatherSnapshot.region == region["name"]
        ).delete(synchronize_session=False)
        db.commit()

        db.add(WeatherSnapshot(
            region=region["name"],
            scraped_at=now,
            daily_data=daily_data,
        ))
        db.commit()
    print(f"[farmer_economics] weather: {len(REGIONS)} regions")


# ── ENSO ─────────────────────────────────────────────────────────────────────

def _parse_oni_text(text: str) -> list[dict]:
    """Parse NOAA CPC ONI plain-text file into a list of history dicts.
    Returns last 15 data rows + up to 3 forecast rows (last 3 lines)."""
    lines = [l.strip() for l in text.strip().splitlines()
             if l.strip() and not l.strip().startswith("SEAS")]
    rows = []
    for line in lines:
        parts = line.split()
        if len(parts) < 4:
            continue
        seas, yr, anom = parts[0], int(parts[1]), float(parts[3])
        rows.append({"season": seas, "year": yr, "anom": anom})

    if len(rows) < 3:
        return [_oni_row_to_point(r) for r in rows]

    data_rows     = rows[:-3]
    forecast_rows = rows[-3:]
    history = [_oni_row_to_point(r) for r in data_rows[-15:]]
    forecast = [_oni_row_to_point(r, forecast=True) for r in forecast_rows]
    return history + forecast


def _oni_row_to_point(r: dict, forecast: bool = False) -> dict:
    month_num = _SEASON_MONTHS.get(r["season"], 1)
    label = f"{calendar.month_abbr[month_num]}-{str(r['year'])[-2:]}"
    pt: dict = {"month": label, "value": r["anom"]}
    if forecast:
        pt["forecast"] = True
    return pt


def _scrape_enso(db) -> None:
    """Fetch NOAA ONI file and upsert as a NewsItem."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import NewsItem

    resp = requests.get(NOAA_ONI_URL, timeout=20)
    resp.raise_for_status()
    oni_history = _parse_oni_text(resp.text)

    db.query(NewsItem).filter(NewsItem.source == "NOAA CPC").delete(
        synchronize_session=False
    )
    db.commit()
    db.add(NewsItem(
        title=f"ENSO ONI – {date.today().strftime('%Y-%m')}",
        body="NOAA Climate Prediction Center ONI data",
        source="NOAA CPC",
        category="supply",
        tags=["enso", "supply", "brazil"],
        meta=json.dumps({"oni_history": oni_history}),
        pub_date=datetime.utcnow(),
    ))
    db.commit()
    print("[farmer_economics] enso: OK")


# ── Fertilizer Prices ─────────────────────────────────────────────────────────

# Row labels in the World Bank "Monthly Prices" sheet → internal key
_WB_ROW_LABELS = {
    "Urea, E. Europe (fob Bulk)":           "urea",
    "DAP (fob US Gulf)":                    "dap",
    "Potassium chloride (fob Vancouver)":   "kcl",
}

def _parse_world_bank_excel(content: bytes) -> dict:
    """Return {urea_monthly, dap_monthly, kcl_monthly} — last 7 USD values each."""
    import openpyxl
    from io import BytesIO
    wb = openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)
    ws = wb["Monthly Prices"]

    # Find the USD column header row (usually row 4 or 5); then locate target rows.
    # The sheet has commodity labels in column A and USD prices in column B.
    rows_by_label: dict[str, list] = {}
    current_label: str | None = None

    for row in ws.iter_rows(values_only=True):
        cell_a = str(row[0]).strip() if row[0] is not None else ""
        cell_b = row[1] if len(row) > 1 else None

        for label in _WB_ROW_LABELS:
            if label in cell_a:
                current_label = _WB_ROW_LABELS[label]
                rows_by_label.setdefault(current_label, [])
                break
        else:
            current_label = None

        if current_label and isinstance(cell_b, (int, float)):
            rows_by_label[current_label].append(float(cell_b))

    result = {}
    for key in ("urea", "dap", "kcl"):
        vals = rows_by_label.get(key, [])
        result[f"{key}_monthly"] = [round(v, 1) for v in vals[-7:]] if len(vals) >= 7 else vals
    return result


def _scrape_fertilizer_prices(db) -> None:
    """Download World Bank Pink Sheet Excel and upsert as a NewsItem."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import NewsItem

    resp = requests.get(WORLD_BANK_URL, timeout=60)
    resp.raise_for_status()
    meta_data = _parse_world_bank_excel(resp.content)

    db.query(NewsItem).filter(NewsItem.source == "World Bank").delete(
        synchronize_session=False
    )
    db.commit()
    db.add(NewsItem(
        title=f"Fertilizer Prices – {date.today().strftime('%Y-%m')}",
        body="World Bank Pink Sheet — Urea, DAP, KCl monthly prices",
        source="World Bank",
        category="supply",
        tags=["fertilizer", "price", "supply", "brazil"],
        meta=json.dumps(meta_data),
        pub_date=datetime.utcnow(),
    ))
    db.commit()
    print("[farmer_economics] fertilizer prices: OK")


# ── Entry point ───────────────────────────────────────────────────────────────

async def run(page, db) -> None:
    """Daily entry point. Called from main.py alongside macro_cot."""
    _scrape_weather(db)
    _scrape_enso(db)
    _scrape_fertilizer_prices(db)
```

- [ ] **Step 4: Run tests**

```bash
cd backend
python -m pytest scraper/tests/test_farmer_economics.py -v
```
Expected: all existing tests PASS (no live network calls in tests)

- [ ] **Step 5: Commit**

```bash
git add backend/scraper/sources/farmer_economics.py \
        backend/scraper/tests/test_farmer_economics.py
git commit -m "feat: add farmer_economics daily scraper (weather, ENSO, fertilizer prices)"
```

---

## Task 3: ENSO Parsing Tests

**Files:**
- Modify: `backend/scraper/tests/test_farmer_economics.py`

- [ ] **Step 1: Add ENSO parsing tests**

Append to `backend/scraper/tests/test_farmer_economics.py`:

```python
def test_parse_oni_text_extracts_history_and_forecast():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from sources.farmer_economics import _parse_oni_text

    # Minimal ONI file: header + 6 rows (last 3 treated as forecast)
    text = """SEAS YR   TOTAL  ANOM
DJF  2025  26.8   0.1
FMA  2025  27.1   0.4
AMJ  2025  28.0   1.1
JJA  2025  28.5   1.4
ASO  2025  28.3   1.2
OND  2025  27.5   0.8"""

    result = _parse_oni_text(text)
    # 3 history rows (first 3) + 3 forecast rows (last 3)
    assert len(result) == 6
    # Last 3 should be forecast
    for pt in result[-3:]:
        assert pt.get("forecast") is True
    # First rows should not be forecast
    assert "forecast" not in result[0]
    # Values should match ANOM column
    assert result[0]["value"] == 0.1

def test_parse_oni_text_month_labels():
    from sources.farmer_economics import _parse_oni_text
    text = "SEAS YR   TOTAL  ANOM\nDJF  2025  26.8   0.5\nFMA  2025  27.1   0.6\nAMJ  2025  28.0   1.1"
    result = _parse_oni_text(text)
    # All 3 rows become forecast (len < 6, can't split history/forecast cleanly but function returns all)
    assert len(result) == 3
    # Month label for DJF 2025 → "Jan-25"
    assert result[0]["month"] == "Jan-25"
```

- [ ] **Step 2: Run tests**

```bash
cd backend
python -m pytest scraper/tests/test_farmer_economics.py -v
```
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/scraper/tests/test_farmer_economics.py
git commit -m "test: add ENSO ONI parsing tests"
```

---

## Task 4: conab_supply.py — Acreage/Yield and Production Cost Scrapers

**Files:**
- Create: `backend/scraper/sources/conab_supply.py`
- Create: `backend/scraper/tests/test_conab_supply.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/scraper/tests/test_conab_supply.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

def test_parse_conab_safra_html_extracts_area_and_yield():
    from sources.conab_supply import _parse_conab_safra_html

    # Minimal HTML with Brazil total row
    html = """
    <table>
      <tr><th>Produto/UF</th><th>Área Colhida (mil ha)</th><th>Produtividade (sc/ha)</th></tr>
      <tr><td>Brasil</td><td>2.240,5</td><td>32,1</td></tr>
    </table>
    """
    result = _parse_conab_safra_html(html)
    assert result is not None
    assert result["harvested_area_kha"] == 2240.5
    assert result["yield_bags_ha"] == 32.1

def test_parse_conab_safra_html_returns_none_on_no_data():
    from sources.conab_supply import _parse_conab_safra_html
    html = "<html><body>sem dados</body></html>"
    result = _parse_conab_safra_html(html)
    assert result is None

def test_brl_float_parse():
    from sources.conab_supply import _brl_to_float
    assert _brl_to_float("2.240,5") == 2240.5
    assert _brl_to_float("32,1")    == 32.1
    assert _brl_to_float("")        is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python -m pytest scraper/tests/test_conab_supply.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create `backend/scraper/sources/conab_supply.py`**

```python
"""
conab_supply.py — Monthly scraper for CONAB acreage/yield and production cost.
Sources:
  - CONAB Safra: https://www.conab.gov.br/info-agro/safras/cafe
  - CONAB Custos: https://www.conab.gov.br/info-agro/custos-de-producao/cafe
Called from run_monthly.py.
"""
import json
import re
import requests
from datetime import datetime, date
from bs4 import BeautifulSoup

CONAB_SAFRA_URL  = "https://www.conab.gov.br/info-agro/safras/cafe"
CONAB_CUSTOS_URL = "https://www.conab.gov.br/info-agro/custos-de-producao/cafe"

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CoffeeIntelScraper/1.0)"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _brl_to_float(s: str) -> float | None:
    """Convert Brazilian number format '2.240,5' → 2240.5."""
    s = s.strip()
    if not s:
        return None
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return None


# ── Acreage / Yield ───────────────────────────────────────────────────────────

def _parse_conab_safra_html(html: str) -> dict | None:
    """Extract Brazil total harvested area (thousand ha) and yield (bags/ha) from CONAB Safra HTML."""
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if not cells:
                continue
            label = cells[0].get_text(strip=True)
            if re.search(r"brasil", label, re.I):
                # Expect area in col 1, yield in col 2
                if len(cells) < 3:
                    continue
                area  = _brl_to_float(cells[1].get_text(strip=True))
                yield_ = _brl_to_float(cells[2].get_text(strip=True))
                if area is not None and yield_ is not None:
                    return {
                        "harvested_area_kha": area,
                        "yield_bags_ha":      yield_,
                    }
    return None


def _scrape_acreage_yield(db) -> None:
    """Fetch CONAB Safra page and upsert acreage/yield NewsItem."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import NewsItem

    resp = requests.get(CONAB_SAFRA_URL, headers=_HEADERS, timeout=30)
    resp.raise_for_status()
    parsed = _parse_conab_safra_html(resp.text)
    if not parsed:
        print("[conab_supply] acreage/yield: no data found on page — retaining previous")
        return

    # Try to get previous values for YoY
    existing = db.query(NewsItem).filter(NewsItem.source == "CONAB Safra").first()
    prev_meta = json.loads(existing.meta or "{}") if existing else {}

    meta = {
        "season":            _current_season(),
        "harvested_area_kha": parsed["harvested_area_kha"],
        "prev_area_kha":      prev_meta.get("harvested_area_kha"),
        "yield_bags_ha":      parsed["yield_bags_ha"],
        "prev_yield_bags_ha": prev_meta.get("yield_bags_ha"),
        "source_label":       f"CONAB Safra {date.today().strftime('%b %Y')}",
    }

    db.query(NewsItem).filter(NewsItem.source == "CONAB Safra").delete(
        synchronize_session=False
    )
    db.commit()
    db.add(NewsItem(
        title=f"CONAB Acreage Yield – {meta['season']}",
        body="CONAB Safra bulletin — harvested area and yield for Brazil arabica",
        source="CONAB Safra",
        category="supply",
        tags=["conab", "supply", "brazil", "acreage"],
        meta=json.dumps(meta),
        pub_date=datetime.utcnow(),
    ))
    db.commit()
    print(f"[conab_supply] acreage/yield: {parsed['harvested_area_kha']} kha, {parsed['yield_bags_ha']} bags/ha")


def _current_season() -> str:
    """Return current crop-year label, e.g. '2025/26'. Brazil crop year starts July."""
    today = date.today()
    start_year = today.year if today.month >= 7 else today.year - 1
    return f"{start_year}/{str(start_year + 1)[-2:]}"


# ── Production Cost ────────────────────────────────────────────────────────────

# Expected row labels in the CONAB Custos Excel (Portuguese) → English label + color
_COST_COMPONENT_MAP = {
    r"insumo":        ("Inputs",        "#3b82f6"),
    r"m.o\.?\s*de\s*obra|m\.o\.": ("Labor", "#22c55e"),
    r"mecaniza":      ("Mechanization", "#f59e0b"),
    r"arrendamento":  ("Land rent",     "#8b5cf6"),
    r"administra":    ("Admin",         "#475569"),
}

_INPUT_DETAIL_MAP = {
    r"nitrog|ur[eé]ia":      "Nitrogen (urea / AN)",
    r"pot[áa]ssio|kcl":      "Potassium (KCl)",
    r"f[oó]sforo|map|dap":   "Phosphorus (MAP)",
    r"defensivo|pesticida":  "Pesticides / fungicides",
    r"calcá|cal|lime":       "Lime / soil correction",
}


def _parse_conab_custos_excel(content: bytes, brl_usd: float) -> dict | None:
    """Parse CONAB Custos Excel, return structured cost dict."""
    import openpyxl
    from io import BytesIO

    wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
    # Try 'Sul de Minas' sheet first, fall back to first sheet
    ws = wb["Sul de Minas"] if "Sul de Minas" in wb.sheetnames else wb.active

    components_brl = []
    inputs_detail_brl = []
    total_brl = None

    for row in ws.iter_rows(values_only=True):
        label_cell = str(row[0]).strip() if row[0] else ""
        # Find a numeric value in the row (first float column)
        value = None
        for cell in row[1:]:
            if isinstance(cell, (int, float)) and cell > 0:
                value = float(cell)
                break
        if value is None:
            continue

        label_lower = label_cell.lower()

        # Check for total row
        if re.search(r"custo total|total geral", label_lower):
            total_brl = value
            continue

        # Check for component rows
        for pattern, (eng_label, color) in _COST_COMPONENT_MAP.items():
            if re.search(pattern, label_lower):
                components_brl.append({
                    "label":    eng_label,
                    "label_pt": label_cell,
                    "brl":      round(value, 2),
                    "color":    color,
                })
                break

        # Check for inputs detail rows
        for pattern, eng_label in _INPUT_DETAIL_MAP.items():
            if re.search(pattern, label_lower):
                inputs_detail_brl.append({
                    "label": eng_label,
                    "brl":   round(value, 2),
                })
                break

    if not components_brl or total_brl is None:
        return None

    return {
        "total_brl_per_bag":     round(total_brl, 2),
        "brl_usd":               round(brl_usd, 4),
        "components_brl":        components_brl,
        "inputs_detail_brl":     inputs_detail_brl,
    }


def _get_brl_usd() -> float:
    """Fetch current BRL/USD rate from Yahoo Finance. Returns 5.0 on failure."""
    try:
        import yfinance as yf
        ticker = yf.Ticker("BRL=X")
        hist = ticker.history(period="2d")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])
    except Exception:
        pass
    return 5.0


def _scrape_production_cost(db) -> None:
    """Download CONAB Custos Excel and upsert production cost NewsItem."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import NewsItem

    # Get the Excel download link from the CONAB Custos page
    page_resp = requests.get(CONAB_CUSTOS_URL, headers=_HEADERS, timeout=30)
    page_resp.raise_for_status()
    soup = BeautifulSoup(page_resp.text, "html.parser")

    # Look for first .xlsx link
    excel_url = None
    for link in soup.find_all("a", href=True):
        if ".xlsx" in link["href"].lower() or ".xls" in link["href"].lower():
            href = link["href"]
            excel_url = href if href.startswith("http") else f"https://www.conab.gov.br{href}"
            break

    if not excel_url:
        print("[conab_supply] production cost: no Excel link found — retaining previous")
        return

    excel_resp = requests.get(excel_url, headers=_HEADERS, timeout=60)
    excel_resp.raise_for_status()

    brl_usd = _get_brl_usd()
    parsed  = _parse_conab_custos_excel(excel_resp.content, brl_usd)
    if not parsed:
        print("[conab_supply] production cost: could not parse Excel — retaining previous")
        return

    existing = db.query(NewsItem).filter(NewsItem.source == "CONAB Custos").first()
    prev_meta = json.loads(existing.meta or "{}") if existing else {}

    season = _current_season()
    meta = {
        "season":                season,
        "total_brl_per_bag":     parsed["total_brl_per_bag"],
        "prev_total_brl_per_bag":prev_meta.get("total_brl_per_bag"),
        "brl_usd":               parsed["brl_usd"],
        "components_brl":        parsed["components_brl"],
        "inputs_detail_brl":     parsed["inputs_detail_brl"],
        "source_label":          f"CONAB Custos {date.today().strftime('%b %Y')}",
    }

    db.query(NewsItem).filter(NewsItem.source == "CONAB Custos").delete(
        synchronize_session=False
    )
    db.commit()
    db.add(NewsItem(
        title=f"CONAB Production Cost – {season}",
        body="CONAB Custos de Produção — Sul de Minas arabica production cost",
        source="CONAB Custos",
        category="supply",
        tags=["conab", "supply", "brazil", "cost"],
        meta=json.dumps(meta),
        pub_date=datetime.utcnow(),
    ))
    db.commit()
    print(f"[conab_supply] production cost: R${parsed['total_brl_per_bag']}/bag")


async def run(db) -> None:
    """Monthly entry point. Called from run_monthly.py."""
    _scrape_acreage_yield(db)
    _scrape_production_cost(db)
```

- [ ] **Step 4: Run tests**

```bash
cd backend
python -m pytest scraper/tests/test_conab_supply.py -v
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/scraper/sources/conab_supply.py \
        backend/scraper/tests/test_conab_supply.py
git commit -m "feat: add conab_supply monthly scraper (acreage/yield + production cost)"
```

---

## Task 5: comex_fertilizer.py — Fertilizer Imports (Playwright)

**Files:**
- Create: `backend/scraper/sources/comex_fertilizer.py`

No unit tests (Playwright-dependent). End-to-end testing via `workflow_dispatch` on `scraper-monthly.yml`.

- [ ] **Step 1: Create `backend/scraper/sources/comex_fertilizer.py`**

```python
"""
comex_fertilizer.py — Monthly Playwright scraper for Brazil fertilizer imports.
Source: Comex Stat MDIC (https://comexstat.mdic.gov.br/pt/geral)
NCM Chapter 31: nitrogenous, potassic, phosphatic fertilizers.
Called from run_monthly.py.
"""
import re
from datetime import datetime, date
from calendar import monthrange

COMEX_STAT_URL = "https://comexstat.mdic.gov.br/pt/geral"

# NCM codes → label
NCM_LABELS = {
    "31021010": "Urea",
    "31042010": "KCl",
    "31052000": "MAP",
    "31054000": "DAP",
}


def _month_str_to_date(month_str: str) -> date | None:
    """Convert 'Jan/2026' or '2026-01' to date(2026, 1, 1)."""
    m = re.match(r"(\d{4})-(\d{2})", month_str)
    if m:
        return date(int(m.group(1)), int(m.group(2)), 1)
    months_pt = {
        "jan":1,"fev":2,"mar":3,"abr":4,"mai":5,"jun":6,
        "jul":7,"ago":8,"set":9,"out":10,"nov":11,"dez":12,
    }
    m2 = re.match(r"(\w{3})/(\d{4})", month_str, re.I)
    if m2:
        mon = months_pt.get(m2.group(1).lower()[:3])
        if mon:
            return date(int(m2.group(2)), mon, 1)
    return None


async def run(page, db) -> None:
    """
    Navigate Comex Stat UI, extract NCM Chapter 31 fertilizer import data
    for the last 12 months, and upsert into FertilizerImport table.
    On failure, logs the error and retains existing data.
    """
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    from models import FertilizerImport

    try:
        await page.goto(COMEX_STAT_URL, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(3000)

        # Select NCM query mode and Chapter 31
        ncm_input = page.locator("input[placeholder*='NCM'], input[placeholder*='ncm']").first
        await ncm_input.fill("31")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(2000)

        # Click the query/search button
        search_btn = page.locator("button:has-text('Consultar'), button:has-text('Pesquisar')").first
        await search_btn.click()
        await page.wait_for_timeout(5000)

        # Parse the rendered table
        rows = await page.evaluate("""() => {
            const tbl = document.querySelector('table');
            if (!tbl) return [];
            const result = [];
            for (const tr of tbl.querySelectorAll('tbody tr')) {
                const cells = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
                if (cells.length >= 4) result.push(cells);
            }
            return result;
        }""")

        inserted = 0
        for row in rows:
            if len(row) < 4:
                continue
            ncm_code  = re.sub(r"[^0-9]", "", row[0])
            if ncm_code not in NCM_LABELS:
                continue
            month_dt = _month_str_to_date(row[1])
            if not month_dt:
                continue

            # net_weight_kg and fob_usd — strip formatting
            def parse_int(s: str) -> int | None:
                s = re.sub(r"[^\d]", "", s)
                return int(s) if s else None

            net_kg  = parse_int(row[2])
            fob_usd = parse_int(row[3])

            # Delete existing (same month + ncm), then insert
            db.query(FertilizerImport).filter(
                FertilizerImport.month    == month_dt,
                FertilizerImport.ncm_code == ncm_code,
            ).delete(synchronize_session=False)

            db.add(FertilizerImport(
                month=month_dt,
                ncm_code=ncm_code,
                ncm_label=NCM_LABELS[ncm_code],
                net_weight_kg=net_kg,
                fob_usd=fob_usd,
                scraped_at=datetime.utcnow(),
            ))
            inserted += 1

        db.commit()
        print(f"[comex_fertilizer] {inserted} rows upserted")

    except Exception as e:
        db.rollback()
        print(f"[comex_fertilizer] FAILED: {e} — retaining previous data")
```

- [ ] **Step 2: Commit**

```bash
git add backend/scraper/sources/comex_fertilizer.py
git commit -m "feat: add comex_fertilizer monthly Playwright scraper"
```

---

## Task 6: export_farmer_economics() in export_static_json.py

**Files:**
- Modify: `backend/scraper/export_static_json.py`

- [ ] **Step 1: Add imports at top of export_static_json.py**

After the existing `from models import NewsItem, CotWeekly, ...` line, add:

```python
from models import NewsItem, CotWeekly, CommodityCot, CommodityPrice, FreightRate, WeatherSnapshot, FertilizerImport
```

(Replace the existing `from models import ...` line entirely with the above.)

- [ ] **Step 2: Add ENSO helper functions and static config**

Add before the `# ── Main ──` section (around line 407):

```python
# ── 7. Farmer Economics ───────────────────────────────────────────────────────

# Static: regional impact type per ENSO phase (type is climatologically fixed)
_REGIONAL_IMPACT_BY_PHASE = {
    "el-nino": [
        {"region": "Sul de Minas", "type": "DRY",  "note": "rainfall −18% vs norm."},
        {"region": "Cerrado",      "type": "DRY",  "note": "moisture deficit critical"},
        {"region": "Paraná",       "type": "COLD", "note": "frost window +12 days"},
        {"region": "Espírito Santo","type": "WET", "note": "above-avg rainfall"},
    ],
    "la-nina": [
        {"region": "Sul de Minas", "type": "WET",  "note": "above-avg rainfall"},
        {"region": "Cerrado",      "type": "WET",  "note": "above-avg rainfall"},
        {"region": "Paraná",       "type": "WARM", "note": "reduced frost risk"},
        {"region": "Espírito Santo","type": "DRY", "note": "below-avg rainfall"},
    ],
    "neutral": [
        {"region": "Sul de Minas",  "type": "WARM", "note": "near-normal conditions"},
        {"region": "Cerrado",       "type": "WARM", "note": "near-normal conditions"},
        {"region": "Paraná",        "type": "WARM", "note": "near-normal conditions"},
        {"region": "Espírito Santo","type": "WARM", "note": "near-normal conditions"},
    ],
}

_HISTORICAL_STAT_BY_PHASE = {
    "el-nino": "El Niño years avg. Brazil arabica output −4.2% vs neutral",
    "la-nina": "La Niña years avg. Brazil arabica output +2.1% vs neutral",
    "neutral":  "Neutral ENSO: near-average Brazil arabica output expected",
}

_RISK_ORDER = {"-": 0, "L": 1, "M": 2, "H": 3}


def _derive_enso_phase(oni_history: list[dict]) -> tuple[str, str, float]:
    """Return (phase, intensity, current_oni) from oni_history list."""
    non_forecast = [p for p in oni_history if not p.get("forecast")]
    if not non_forecast:
        return "neutral", "Weak", 0.0
    current_oni = non_forecast[-1]["value"]

    # Phase: check last 5 consecutive above/below ±0.5
    recent = [p["value"] for p in non_forecast[-5:]]
    if len(recent) >= 5 and all(v >= 0.5 for v in recent):
        phase = "el-nino"
    elif len(recent) >= 5 and all(v <= -0.5 for v in recent):
        phase = "la-nina"
    else:
        phase = "neutral"

    # Intensity from |current_oni|
    abs_oni = abs(current_oni)
    if abs_oni >= 2.0:
        intensity = "Extreme"
    elif abs_oni >= 1.5:
        intensity = "Strong"
    elif abs_oni >= 1.0:
        intensity = "Moderate"
    else:
        intensity = "Weak"

    return phase, intensity, current_oni


def _oni_to_dots(oni: float) -> int:
    """Convert ONI magnitude to 1-4 dot scale."""
    a = abs(oni)
    if a >= 2.0: return 4
    if a >= 1.5: return 3
    if a >= 1.0: return 2
    return 1


def _worst_risk(risks: list[str]) -> str:
    if not risks: return "-"
    return max(risks, key=lambda r: _RISK_ORDER.get(r, 0))


def _badge_from_risk_code(code: str) -> str:
    return {"H": "HIGH", "M": "MED", "L": "LOW", "-": "NONE"}.get(code, "NONE")


def export_farmer_economics(db) -> None:
    # ── 1. Weather ────────────────────────────────────────────────────────────
    weather_out = None
    snapshots = (
        db.query(WeatherSnapshot)
        .order_by(WeatherSnapshot.scraped_at.desc())
        .all()
    )
    # Keep latest snapshot per region
    latest_by_region: dict[str, WeatherSnapshot] = {}
    for snap in snapshots:
        if snap.region not in latest_by_region:
            latest_by_region[snap.region] = snap

    if latest_by_region:
        regions_out = []
        daily_frost_out  = []
        daily_drought_out = []
        current_conditions_out = []
        scraped_at_out = None

        for region_name in ["Sul de Minas", "Cerrado", "Paraná", "Espírito Santo"]:
            snap = latest_by_region.get(region_name)
            if not snap:
                continue
            if scraped_at_out is None:
                scraped_at_out = snap.scraped_at.isoformat()

            daily_data = snap.daily_data or []

            # Frost/drought badges: worst risk over first 7 days
            frost_codes   = [d.get("frost_risk",   "-") for d in daily_data[:7]]
            drought_codes = [d.get("drought_risk",  "-") for d in daily_data[:7]]
            frost_badge   = _badge_from_risk_code(_worst_risk(frost_codes))
            drought_badge = _badge_from_risk_code(_worst_risk(drought_codes))

            regions_out.append({
                "name":    region_name,
                "frost":   frost_badge,
                "drought": drought_badge,
            })

            # 14-day daily risk rows (include region if any day is non-"-")
            frost_days   = [d.get("frost_risk",   "-") for d in daily_data]
            drought_days = [d.get("drought_risk",  "-") for d in daily_data]
            if any(c != "-" for c in frost_days):
                daily_frost_out.append({"region": region_name, "days": frost_days})
            if any(c != "-" for c in drought_days):
                daily_drought_out.append({"region": region_name, "days": drought_days})

            # Current conditions: today (index 0)
            today_data = daily_data[0] if daily_data else {}
            current_conditions_out.append({
                "region":          region_name,
                "temp_c":          today_data.get("max_temp", 0),
                "dew_point_c":     today_data.get("dew_point", 0),
                "cloud_cover_pct": today_data.get("cloud_cover", 0),
                "wind_speed_kmh":  today_data.get("wind_speed", 0),
            })

        weather_out = {
            "scraped_at":        scraped_at_out or date.today().isoformat(),
            "regions":           regions_out,
            "daily_frost":       daily_frost_out,
            "daily_drought":     daily_drought_out,
            "current_conditions": current_conditions_out,
        }

    # ── 2. ENSO ───────────────────────────────────────────────────────────────
    enso_out = None
    enso_item = db.query(NewsItem).filter(NewsItem.source == "NOAA CPC").first()
    if enso_item:
        enso_meta   = json.loads(enso_item.meta or "{}")
        oni_history = enso_meta.get("oni_history", [])
        phase, intensity, current_oni = _derive_enso_phase(oni_history)
        dots = _oni_to_dots(current_oni)
        impacts = [
            {**imp, "dots": dots}
            for imp in _REGIONAL_IMPACT_BY_PHASE.get(phase, [])
        ]

        non_forecast = [p for p in oni_history if not p.get("forecast")]
        forecast_pts = [p for p in oni_history if p.get("forecast")]
        peak_pt = max(non_forecast, key=lambda p: abs(p["value"])) if non_forecast else None
        forecast_dir = ""
        if forecast_pts:
            last_val = forecast_pts[-1]["value"]
            if abs(last_val) < 0.5:
                forecast_dir = f"Neutral by {forecast_pts[-1]['month']}"
            elif last_val > 0:
                forecast_dir = f"El Niño persists through {forecast_pts[-1]['month']}"
            else:
                forecast_dir = f"La Niña persists through {forecast_pts[-1]['month']}"

        enso_out = {
            "phase":              phase,
            "intensity":          intensity,
            "oni":                current_oni,
            "peak_month":         peak_pt["month"] if peak_pt else "",
            "forecast_direction": forecast_dir,
            "oni_history":        oni_history,
            "regional_impact":    impacts,
            "historical_stat":    _HISTORICAL_STAT_BY_PHASE.get(phase, ""),
            "last_updated":       str(enso_item.pub_date)[:10],
        }

    # ── 3. Fertilizer prices ──────────────────────────────────────────────────
    fert_items_out = []
    fert_item = db.query(NewsItem).filter(NewsItem.source == "World Bank").first()
    if fert_item:
        fert_meta = json.loads(fert_item.meta or "{}")
        # Static fertilizer config: input_weight and base_usd_per_bag are crop-year values
        _FERT_CONFIG = {
            "urea": {"name": "Urea (N)", "input_weight": 0.35, "base_usd_per_bag": 18.9},
            "dap":  {"name": "MAP (P)",  "input_weight": 0.20, "base_usd_per_bag": 10.8},
            "kcl":  {"name": "KCl (K)",  "input_weight": 0.25, "base_usd_per_bag": 13.5},
        }
        for key, cfg in _FERT_CONFIG.items():
            monthly = fert_meta.get(f"{key}_monthly", [])
            if len(monthly) < 2:
                continue
            current = monthly[-1]
            prev    = monthly[-2]
            mom_pct = round((current - prev) / prev * 100, 1) if prev else 0.0
            fert_items_out.append({
                "name":            cfg["name"],
                "price_usd_mt":    round(current, 0),
                "mom_pct":         mom_pct,
                "sparkline":       monthly[:6],
                "input_weight":    cfg["input_weight"],
                "base_usd_per_bag":cfg["base_usd_per_bag"],
            })

    # ── 4. Fertilizer imports ─────────────────────────────────────────────────
    imports_out = None
    cutoff = date(date.today().year - 1, date.today().month, 1)
    import_rows = (
        db.query(FertilizerImport)
        .filter(FertilizerImport.month >= cutoff)
        .order_by(FertilizerImport.month.asc())
        .all()
    )
    if import_rows:
        by_month: dict[str, dict] = {}
        for row in import_rows:
            m = row.month.strftime("%Y-%m")
            if m not in by_month:
                by_month[m] = {"month": m, "urea_kt": 0, "kcl_kt": 0, "map_dap_kt": 0,
                                "total_kt": 0, "total_fob_usd_m": 0.0}
            kt = (row.net_weight_kg or 0) / 1_000_000
            fob_m = (row.fob_usd or 0) / 1_000_000
            label = (row.ncm_label or "").lower()
            if "urea" in label:
                by_month[m]["urea_kt"] += kt
            elif "kcl" in label or "potassium" in label:
                by_month[m]["kcl_kt"] += kt
            else:
                by_month[m]["map_dap_kt"] += kt
            by_month[m]["total_kt"]        += kt
            by_month[m]["total_fob_usd_m"] += fob_m

        for m in by_month:
            for k in ("urea_kt", "kcl_kt", "map_dap_kt", "total_kt"):
                by_month[m][k] = round(by_month[m][k], 1)
            by_month[m]["total_fob_usd_m"] = round(by_month[m]["total_fob_usd_m"], 2)

        last_import = max(import_rows, key=lambda r: r.scraped_at)
        imports_out = {
            "last_updated": last_import.scraped_at.strftime("%Y-%m-%d"),
            "monthly":      sorted(by_month.values(), key=lambda x: x["month"]),
        }

    # ── 5. Acreage / Yield ────────────────────────────────────────────────────
    acreage_out = None
    yield_out   = None
    season_out  = "2025/26"
    safra_item  = db.query(NewsItem).filter(NewsItem.source == "CONAB Safra").first()
    if safra_item:
        sm = json.loads(safra_item.meta or "{}")
        season_out = sm.get("season", "2025/26")
        area       = sm.get("harvested_area_kha", 0)
        prev_area  = sm.get("prev_area_kha")
        yld        = sm.get("yield_bags_ha", 0)
        prev_yld   = sm.get("prev_yield_bags_ha")
        area_yoy   = round((area - prev_area) / prev_area * 100, 1) if prev_area else 0.0
        yld_yoy    = round((yld  - prev_yld)  / prev_yld  * 100, 1) if prev_yld  else 0.0
        source_lbl = sm.get("source_label", "CONAB Safra")
        acreage_out = {"thousand_ha": area, "yoy_pct": area_yoy, "source_label": source_lbl}
        yield_out   = {"bags_per_ha":  yld,  "yoy_pct": yld_yoy,  "source_label": source_lbl}

    # ── 6. Production Cost ────────────────────────────────────────────────────
    cost_out = None
    custos_item = db.query(NewsItem).filter(NewsItem.source == "CONAB Custos").first()

    # KC spot from most recent arabica futures NewsItem
    kc_spot = 0.0
    kc_item = next(
        (i for i in db.query(NewsItem)
            .filter(NewsItem.meta.isnot(None))
            .order_by(NewsItem.pub_date.desc()).all()
         if "futures" in (i.tags or []) and "arabica" in (i.tags or [])),
        None,
    )
    if kc_item:
        try:
            kc_meta  = json.loads(kc_item.meta or "{}")
            kc_spot  = kc_meta.get("contracts", [{}])[0].get("lastPrice", 0.0)
        except Exception:
            pass

    if custos_item:
        cm = json.loads(custos_item.meta or "{}")
        total_brl = cm.get("total_brl_per_bag", 0)
        prev_brl  = cm.get("prev_total_brl_per_bag")
        brl_usd   = cm.get("brl_usd", 5.0)
        total_usd = round(total_brl / brl_usd, 1) if brl_usd else 0

        yoy_pct = 0.0
        if prev_brl:
            yoy_pct = round((total_brl - prev_brl) / prev_brl * 100, 1)

        components = []
        total_brl_check = sum(c["brl"] for c in cm.get("components_brl", []))
        for c in cm.get("components_brl", []):
            usd   = round(c["brl"] / brl_usd, 1) if brl_usd else 0
            share = round(c["brl"] / total_brl_check, 2) if total_brl_check else 0
            components.append({
                "label": c["label"], "share": share,
                "usd": usd, "color": c["color"],
            })

        inputs_detail = []
        inputs_brl    = sum(c["brl"] for c in cm.get("inputs_detail_brl", []))
        for d in cm.get("inputs_detail_brl", []):
            usd   = round(d["brl"] / brl_usd, 1) if brl_usd else 0
            share = round(d["brl"] / inputs_brl, 2) if inputs_brl else 0
            inputs_detail.append({"label": d["label"], "share": share, "usd": usd})

        season_lbl = cm.get("source_label", "CONAB Custos")
        cost_out = {
            "total_usd_per_bag": total_usd,
            "yoy_pct":           yoy_pct,
            "season_label":      season_lbl,
            "components":        components,
            "inputs_detail":     inputs_detail,
            "kc_spot":           kc_spot,
            "last_updated":      str(custos_item.pub_date)[:10],
        }

    # ── Assemble output ───────────────────────────────────────────────────────
    result = {
        "country":    "brazil",
        "season":     season_out,
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "cost":       cost_out,
        "acreage":    acreage_out,
        "yield":      yield_out,
        "weather":    weather_out,
        "enso":       enso_out,
        "fertilizer": {
            "items":            fert_items_out,
            "imports":          imports_out,
            "next_application": "May–Jun",
        },
    }

    path = OUT_DIR / "farmer_economics.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  farmer_economics.json → cost:{cost_out is not None} weather:{weather_out is not None} enso:{enso_out is not None}")
```

- [ ] **Step 3: Add `export_farmer_economics(db)` call to `main()` in export_static_json.py**

In the `main()` function, add the call after `export_freight(db)`:

```python
def main():
    print("Exporting static JSON files...")
    db = SessionLocal()
    try:
        export_futures_chain(db)
        export_oi_fnd_chart(db)
        export_oi_history()
        export_cot(db)
        export_macro_cot(db)
        export_freight(db)
        export_farmer_economics(db)
    finally:
        db.close()
    print(f"Done → {OUT_DIR}")
```

- [ ] **Step 4: Commit**

```bash
git add backend/scraper/export_static_json.py
git commit -m "feat: add export_farmer_economics() static JSON export"
```

---

## Task 7: Wire Scrapers into Daily and Monthly Runners

**Files:**
- Modify: `backend/scraper/main.py`
- Modify: `backend/scraper/run_daily.py`
- Create: `backend/scraper/run_monthly.py`

- [ ] **Step 1: Modify `backend/scraper/main.py`**

Add `farmer_economics` import and call after `macro_cot`:

```python
# backend/scraper/main.py
import asyncio
import time
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from playwright.async_api import async_playwright
from scraper.db import get_session, upsert_news_item
from scraper.sources import barchart, b3, brazil, vietnam, origins, demand, technicals, futures, uganda, freightos, cepea, rss, b3_icf
from scraper.sources import macro_cot as _macro_cot
from scraper.sources import farmer_economics as _farmer_economics

ALL_SOURCES = [barchart, b3, brazil, vietnam, origins, demand, technicals, futures, uganda, freightos, cepea, rss, b3_icf]
SCHEDULED_HOUR_UTC = 1

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
            try:
                await _macro_cot.run(page)
                print("[scraper] macro_cot: OK")
            except Exception as e:
                print(f"[scraper] macro_cot failed: {e}")
            try:
                await _farmer_economics.run(page, db)
                print("[scraper] farmer_economics: OK")
            except Exception as e:
                print(f"[scraper] farmer_economics failed: {e}")
            await browser.close()
    finally:
        db.close()
    print(f"[scraper] Done. {total} items inserted.")

def seconds_until_next_run():
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    next_run = now.replace(hour=SCHEDULED_HOUR_UTC, minute=0, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(days=1)
    delta = (next_run - now).total_seconds()
    print(f"[scraper] Next run scheduled at {next_run.strftime('%Y-%m-%d %H:%M UTC')} ({delta/3600:.1f}h from now)")
    return delta

def main():
    asyncio.run(run_all_scrapers())
    while True:
        time.sleep(seconds_until_next_run())
        asyncio.run(run_all_scrapers())

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Modify `backend/scraper/run_daily.py`**

```python
# backend/scraper/run_daily.py
import asyncio
from scraper.db import migrate_cot_weekly_columns, create_farmer_economics_tables
from scraper.main import run_all_scrapers

if __name__ == "__main__":
    migrate_cot_weekly_columns()
    create_farmer_economics_tables()
    asyncio.run(run_all_scrapers())
```

- [ ] **Step 3: Create `backend/scraper/run_monthly.py`**

```python
# backend/scraper/run_monthly.py
# Monthly runner: CONAB supply data + Comex Stat fertilizer imports.
# Called by scraper-monthly.yml on the 5th of each month.
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.db import get_session, create_farmer_economics_tables
from scraper.sources import conab_supply, comex_fertilizer

async def run_monthly_scrapers():
    print("[scraper-monthly] Starting monthly scrape run...")
    create_farmer_economics_tables()
    db = get_session()
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            page    = await browser.new_page()
            try:
                await conab_supply.run(db)
                print("[scraper-monthly] conab_supply: OK")
            except Exception as e:
                print(f"[scraper-monthly] conab_supply failed: {e}")
            try:
                await comex_fertilizer.run(page, db)
                print("[scraper-monthly] comex_fertilizer: OK")
            except Exception as e:
                print(f"[scraper-monthly] comex_fertilizer failed: {e}")
            await browser.close()
    finally:
        db.close()
    print("[scraper-monthly] Done.")

if __name__ == "__main__":
    asyncio.run(run_monthly_scrapers())
```

- [ ] **Step 4: Commit**

```bash
git add backend/scraper/main.py backend/scraper/run_daily.py backend/scraper/run_monthly.py
git commit -m "feat: wire farmer_economics into daily runner, add run_monthly.py"
```

---

## Task 8: GitHub Actions

**Files:**
- Modify: `.github/workflows/scraper-daily.yml`
- Create: `.github/workflows/scraper-monthly.yml`

- [ ] **Step 1: Add `farmer_economics.json` to the git-add step in `scraper-daily.yml`**

Replace the `git add` line in the "Commit updated static JSON if changed" step:

```yaml
          git add frontend/public/data/futures_chain.json \
                  frontend/public/data/oi_fnd_chart.json \
                  frontend/public/data/oi_history.json \
                  frontend/public/data/cot.json \
                  frontend/public/data/macro_cot.json \
                  frontend/public/data/freight.json \
                  frontend/public/data/farmer_economics.json
```

Also add `openpyxl` to the pip install step in scraper-daily.yml:

```yaml
      - name: Install Python dependencies
        working-directory: backend
        run: pip install -r scraper/requirements.txt pandas requests yfinance python-dotenv openpyxl
```

- [ ] **Step 2: Create `.github/workflows/scraper-monthly.yml`**

```yaml
name: Monthly Scraper (CONAB + Comex Stat)

on:
  schedule:
    - cron: '0 2 5 * *'   # 02:00 UTC on the 5th of each month
  workflow_dispatch:

jobs:
  scrape-monthly:
    runs-on: ubuntu-22.04
    timeout-minutes: 45
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Python dependencies
        working-directory: backend
        run: pip install -r scraper/requirements.txt pandas requests yfinance python-dotenv openpyxl

      - name: Install Playwright browser
        run: playwright install chromium --with-deps

      - name: Run monthly scraper
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: python -m scraper.run_monthly

      - name: Export static JSON files
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: python -m scraper.export_static_json

      - name: Commit updated static JSON if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add frontend/public/data/farmer_economics.json
          git diff --cached --quiet \
            && echo "No changes." \
            || git commit -m "data: update farmer_economics.json [skip ci]" && git push
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/scraper-daily.yml .github/workflows/scraper-monthly.yml
git commit -m "ci: add scraper-monthly workflow, add farmer_economics.json to daily commit"
```

---

## Task 9: Frontend Types Update (farmerEconomicsData.ts)

**Files:**
- Modify: `frontend/components/supply/farmer-economics/farmerEconomicsData.ts`

- [ ] **Step 1: Update the types file**

Replace the entire file:

```typescript
// ── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "HIGH" | "MED" | "LOW" | "NONE";
export type EnsoPhase = "el-nino" | "la-nina" | "neutral";
export type ImpactType = "DRY" | "WET" | "COLD" | "WARM";
export type DayRisk = "H" | "M" | "L" | "-";

export interface CostComponent {
  label: string;
  share: number;   // 0–1
  usd: number;
  color: string;
}

export interface InputDetail {
  label: string;
  share: number;   // 0–1 of inputs total
  usd: number;
}

export interface WeatherRegion {
  name: string;
  frost: RiskLevel;
  drought: RiskLevel;
}

export interface DailyRiskRow {
  region: string;
  days: DayRisk[];  // length 14
}

// Current conditions from today's weather snapshot (replaces ForecastAccuracyPoint)
export interface CurrentCondition {
  region: string;
  temp_c: number;
  dew_point_c: number;
  cloud_cover_pct: number;
  wind_speed_kmh: number;
}

export interface OniHistoryPoint {
  month: string;      // "Oct-24"
  value: number;
  forecast?: boolean;
}

export interface RegionalImpact {
  region: string;
  type: ImpactType;
  dots: number;       // 1–4
  note: string;
}

export interface FertilizerItem {
  name: string;
  price_usd_mt: number;
  mom_pct: number;
  sparkline: number[];   // 6 monthly prices, oldest first
  input_weight: number;
  base_usd_per_bag: number;
}

export interface FertilizerImportMonth {
  month: string;         // "2026-01"
  urea_kt: number;
  kcl_kt: number;
  map_dap_kt: number;
  total_kt: number;
  total_fob_usd_m: number;
}

export interface FarmerEconomicsData {
  country: string;
  season: string;
  scraped_at: string;
  cost: {
    total_usd_per_bag: number;
    yoy_pct: number;
    season_label: string;
    components: CostComponent[];
    inputs_detail: InputDetail[];
    kc_spot: number;
    last_updated: string;
  } | null;
  acreage: { thousand_ha: number; yoy_pct: number; source_label: string } | null;
  yield:   { bags_per_ha: number; yoy_pct: number; source_label: string } | null;
  weather: {
    scraped_at: string;
    regions: WeatherRegion[];
    daily_frost: DailyRiskRow[];
    daily_drought: DailyRiskRow[];
    current_conditions: CurrentCondition[];
  } | null;
  enso: {
    phase: EnsoPhase;
    intensity: string;
    oni: number;
    peak_month: string;
    forecast_direction: string;
    oni_history: OniHistoryPoint[];
    regional_impact: RegionalImpact[];
    historical_stat: string;
    last_updated: string;
  } | null;
  fertilizer: {
    items: FertilizerItem[];
    imports: {
      last_updated: string;
      monthly: FertilizerImportMonth[];
    } | null;
    next_application: string;
  };
}
```

Note: `ForecastAccuracyPoint` is removed. `BRAZIL_FARMER_DATA` constant is removed (fetch replaces it).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```
Expected: errors in BrazilFarmerEconomics.tsx and WeatherRiskPanel.tsx (not yet updated) — that is expected. Fix them in Tasks 10–12.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/supply/farmer-economics/farmerEconomicsData.ts
git commit -m "feat: update FarmerEconomicsData types for live data (CurrentCondition, FertilizerImportMonth)"
```

---

## Task 10: BrazilFarmerEconomics.tsx — Switch from Constant to Fetch

**Files:**
- Modify: `frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx`

- [ ] **Step 1: Replace the component**

```tsx
"use client";
import { useState, useEffect } from "react";
import type { FarmerEconomicsData } from "./farmerEconomicsData";
import ProductionCostPanel from "./ProductionCostPanel";
import AcreageYieldPanel   from "./AcreageYieldPanel";
import WeatherRiskPanel    from "./WeatherRiskPanel";
import EnsoPanel           from "./EnsoPanel";
import FertilizerPanel     from "./FertilizerPanel";

export default function BrazilFarmerEconomics() {
  const [data, setData] = useState<FarmerEconomicsData | null>(null);

  useEffect(() => {
    fetch("/data/farmer_economics.json")
      .then((r) => r.json())
      .then(setData)
      .catch((err) => console.error("[FarmerEconomics] fetch failed:", err));
  }, []);

  if (!data) {
    return (
      <div className="text-slate-500 text-sm py-12 text-center">
        Loading farmer economics data…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-5">
      {/* ── Left: Fundamentals ─────────────────────────────────── */}
      <div className="space-y-4">
        {data.cost    && <ProductionCostPanel cost={data.cost} />}
        {data.acreage && data.yield && (
          <AcreageYieldPanel acreage={data.acreage} yield_={data.yield} />
        )}
      </div>

      {/* ── Right: Risk Signals ─────────────────────────────────── */}
      <div className="space-y-4">
        {data.weather    && <WeatherRiskPanel weather={data.weather} />}
        {data.enso       && <EnsoPanel enso={data.enso} />}
        <FertilizerPanel fertilizer={data.fertilizer} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update AcreageYieldPanel.tsx prop types**

The `acreage` prop type changed (added `source_label`). Open `frontend/components/supply/farmer-economics/AcreageYieldPanel.tsx` and update the Props interface to:

```tsx
interface Props {
  acreage: { thousand_ha: number; yoy_pct: number; source_label?: string };
  yield_:  { bags_per_ha: number; yoy_pct: number; source_label?: string };
}
```

- [ ] **Step 3: Update ProductionCostPanel.tsx prop types**

The `cost` prop type changed (added `season_label`, `last_updated`; removed nothing breaking). Open `frontend/components/supply/farmer-economics/ProductionCostPanel.tsx` and update Props:

```tsx
interface Props {
  cost: {
    total_usd_per_bag: number;
    yoy_pct: number;
    season_label?: string;
    components: CostComponent[];
    inputs_detail: InputDetail[];
    kc_spot: number;
    last_updated?: string;
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/supply/farmer-economics/BrazilFarmerEconomics.tsx \
        frontend/components/supply/farmer-economics/AcreageYieldPanel.tsx \
        frontend/components/supply/farmer-economics/ProductionCostPanel.tsx
git commit -m "feat: switch BrazilFarmerEconomics from mock constant to live fetch"
```

---

## Task 11: WeatherRiskPanel.tsx — Replace Forecast Accuracy with Current Conditions

**Files:**
- Modify: `frontend/components/supply/farmer-economics/WeatherRiskPanel.tsx`

- [ ] **Step 1: Replace the component**

Read the current file first, then replace with:

```tsx
"use client";
import React from "react";
import type { FarmerEconomicsData, RiskLevel, DayRisk, CurrentCondition } from "./farmerEconomicsData";

interface Props {
  weather: NonNullable<FarmerEconomicsData["weather"]>;
}

const RISK_BADGE: Record<RiskLevel, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "bg-red-600 text-white" },
  MED:  { label: "MED",  className: "bg-amber-500 text-black" },
  LOW:  { label: "LOW",  className: "bg-green-600 text-white" },
  NONE: { label: "—",    className: "bg-slate-800 text-slate-500 border border-slate-600" },
};

const FROST_CELL: Record<DayRisk, string> = {
  "H": "bg-blue-900 text-white",
  "M": "bg-blue-600 text-white",
  "L": "bg-blue-950 text-blue-300",
  "-": "bg-slate-900 text-slate-600",
};

const DROUGHT_CELL: Record<DayRisk, string> = {
  "H": "bg-amber-700 text-white",
  "M": "bg-amber-500 text-black",
  "L": "bg-amber-900 text-amber-300",
  "-": "bg-slate-900 text-slate-600",
};

export default function WeatherRiskPanel({ weather }: Props) {
  const today = new Date();
  const dayLabels = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return String(d.getDate());
  });

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Weather Risk</div>

      {/* Current risk badges */}
      <div className="grid grid-cols-2 gap-2">
        {weather.regions.map((r) => {
          const frost   = RISK_BADGE[r.frost];
          const drought = RISK_BADGE[r.drought];
          return (
            <div key={r.name} className="bg-slate-900 rounded p-2 border border-slate-700">
              <div className="text-[10px] text-slate-400 mb-1 truncate">{r.name}</div>
              <div className="flex gap-1 flex-wrap">
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${frost.className}`}>
                  ❄ {frost.label}
                </span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${drought.className}`}>
                  ☀ {drought.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 14-day frost grid */}
      {weather.daily_frost.length > 0 && (
        <div>
          <div className="text-[9px] text-blue-400 mb-1">14-Day Frost Risk</div>
          <div className="overflow-x-auto">
            <table className="text-[8px] border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left text-slate-500 pr-2 font-normal w-20">Region</th>
                  {dayLabels.map((d, i) => (
                    <th key={i} className="text-center text-slate-600 w-5 font-normal">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weather.daily_frost.map((row) => (
                  <React.Fragment key={row.region}>
                    <tr>
                      <td className="text-slate-400 pr-2 py-0.5 truncate max-w-[80px]">{row.region}</td>
                      {row.days.map((d, i) => (
                        <td key={i} className={`text-center py-0.5 ${FROST_CELL[d]}`}>{d}</td>
                      ))}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 14-day drought grid */}
      {weather.daily_drought.length > 0 && (
        <div>
          <div className="text-[9px] text-amber-400 mb-1">14-Day Drought Risk</div>
          <div className="overflow-x-auto">
            <table className="text-[8px] border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left text-slate-500 pr-2 font-normal w-20">Region</th>
                  {dayLabels.map((d, i) => (
                    <th key={i} className="text-center text-slate-600 w-5 font-normal">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weather.daily_drought.map((row) => (
                  <React.Fragment key={row.region}>
                    <tr>
                      <td className="text-slate-400 pr-2 py-0.5 truncate max-w-[80px]">{row.region}</td>
                      {row.days.map((d, i) => (
                        <td key={i} className={`text-center py-0.5 ${DROUGHT_CELL[d]}`}>{d}</td>
                      ))}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Current Conditions (replaces Forecast Accuracy chart) */}
      {weather.current_conditions.length > 0 && (
        <div>
          <div className="text-[9px] text-slate-400 mb-2">Current Conditions (Today)</div>
          <div className="grid grid-cols-2 gap-2">
            {weather.current_conditions.map((cc: CurrentCondition) => (
              <div key={cc.region} className="bg-slate-900 rounded p-2 border border-slate-700">
                <div className="text-[9px] text-slate-400 mb-1 truncate">{cc.region}</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span className="text-[8px] text-slate-500">Temp</span>
                  <span className="text-[8px] text-slate-200 text-right">{cc.temp_c}°C</span>
                  <span className="text-[8px] text-slate-500">Dew pt</span>
                  <span className="text-[8px] text-slate-200 text-right">{cc.dew_point_c}°C</span>
                  <span className="text-[8px] text-slate-500">Cloud</span>
                  <span className="text-[8px] text-slate-200 text-right">{cc.cloud_cover_pct}%</span>
                  <span className="text-[8px] text-slate-500">Wind</span>
                  <span className="text-[8px] text-slate-200 text-right">{cc.wind_speed_kmh} km/h</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[8px] text-slate-600">
        Source: Open-Meteo · Updated {weather.scraped_at?.slice(0, 10) ?? "—"}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```
Expected: no errors in WeatherRiskPanel.tsx

- [ ] **Step 3: Commit**

```bash
git add frontend/components/supply/farmer-economics/WeatherRiskPanel.tsx
git commit -m "feat: replace forecast accuracy chart with Current Conditions in WeatherRiskPanel"
```

---

## Task 12: FertilizerPanel.tsx — Add Imports Bar Chart

**Files:**
- Modify: `frontend/components/supply/farmer-economics/FertilizerPanel.tsx`

- [ ] **Step 1: Update the component**

Replace the entire file:

```tsx
"use client";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { FarmerEconomicsData, FertilizerItem } from "./farmerEconomicsData";
import { fertCostDelta, netFertImpact } from "./farmerEconomicsUtils";

interface Props {
  fertilizer: FarmerEconomicsData["fertilizer"];
}

const TT_STYLE = { background: "#1e293b", border: "1px solid #334155", borderRadius: 6, fontSize: 10 };

function FertCard({ item }: { item: FertilizerItem }) {
  const delta     = fertCostDelta(item);
  const priceRose = item.mom_pct > 0;
  const sparkData = item.sparkline.map((v, i) => ({ i, v }));

  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 flex-1 min-w-0">
      <div className="text-[10px] text-slate-400 mb-0.5">{item.name}</div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className="text-base font-extrabold text-slate-100">${item.price_usd_mt}</span>
        <span className="text-[9px] text-slate-500">/mt</span>
      </div>
      <div className="text-[8px] text-slate-600 mb-1">CFR Brazil</div>

      <div className="h-10 mb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sparkData}>
            <Tooltip
              contentStyle={TT_STYLE}
              formatter={(v: unknown) => [`$${v}/mt`, item.name]}
              labelFormatter={() => ""}
            />
            <Line
              type="monotone" dataKey="v"
              stroke={priceRose ? "#ef4444" : "#22c55e"}
              strokeWidth={1.5} dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={`text-[10px] font-semibold mb-1 ${priceRose ? "text-red-400" : "text-green-400"}`}>
        {priceRose ? "▲" : "▼"} {Math.abs(item.mom_pct).toFixed(1)}% MoM
      </div>
      <div className={`text-[9px] font-semibold px-1.5 py-0.5 rounded inline-block ${
        delta > 0 ? "bg-red-950 text-red-300" : delta < 0 ? "bg-green-950 text-green-300" : "bg-slate-800 text-slate-500"
      }`}>
        {delta > 0 ? "↑" : delta < 0 ? "↓" : "="} {delta > 0 ? "+" : ""}{delta.toFixed(1)}/bag est.
      </div>
    </div>
  );
}

export default function FertilizerPanel({ fertilizer }: Props) {
  const net = netFertImpact(fertilizer.items);
  const imports = fertilizer.imports;

  // Bar chart data: total import volume (kt) by month
  const importChartData = imports?.monthly.map((m) => ({
    month:   m.month.slice(5),   // "01" → just month number
    total:   m.total_kt,
    urea:    m.urea_kt,
    kcl:     m.kcl_kt,
    map_dap: m.map_dap_kt,
  })) ?? [];

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Fertilizer Prices</div>

      <div className="flex gap-3">
        {fertilizer.items.map((item) => (
          <FertCard key={item.name} item={item} />
        ))}
      </div>

      <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-700">
        Net input cost impact:{" "}
        <span className={`font-bold ${net > 0 ? "text-amber-400" : "text-green-400"}`}>
          {net > 0 ? "+" : ""}{net.toFixed(1)}/bag vs last month
        </span>
        {" "}· Next application window: {fertilizer.next_application}
      </div>

      {/* Fertilizer imports bar chart */}
      {imports && importChartData.length > 0 && (
        <div className="pt-2 border-t border-slate-700">
          <div className="text-[9px] text-slate-400 mb-1 flex justify-between">
            <span>Brazil Fertilizer Imports (kt)</span>
            <span className="text-slate-600">Source: Comex Stat · {imports.last_updated}</span>
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={importChartData} barSize={6} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: unknown, name: string) => [`${v} kt`, name]}
                />
                <Bar dataKey="urea"    name="Urea"    fill="#3b82f6" stackId="a" />
                <Bar dataKey="kcl"     name="KCl"     fill="#8b5cf6" stackId="a" />
                <Bar dataKey="map_dap" name="MAP+DAP" fill="#22c55e" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
cd frontend
npx tsc --noEmit
```
Expected: clean compile (0 errors)

- [ ] **Step 3: Commit**

```bash
git add frontend/components/supply/farmer-economics/FertilizerPanel.tsx
git commit -m "feat: add fertilizer imports bar chart to FertilizerPanel"
```

---

## Task 13: Seed farmer_economics.json for Local Development

The live pipeline requires DB + scrapers. For local dev and CI preview, seed a minimal valid JSON so the fetch doesn't fail.

**Files:**
- Create: `frontend/public/data/farmer_economics.json`

- [ ] **Step 1: Create seed file**

```json
{
  "country": "brazil",
  "season": "2025/26",
  "scraped_at": "2026-04-16T00:00:00Z",
  "cost": null,
  "acreage": null,
  "yield": null,
  "weather": null,
  "enso": null,
  "fertilizer": {
    "items": [],
    "imports": null,
    "next_application": "May–Jun"
  }
}
```

- [ ] **Step 2: Verify frontend loads without errors**

Run dev server and open the Brazil → Farmer Economics tab. Expected: loading spinner completes, panels that have `null` data are hidden (conditionally rendered in BrazilFarmerEconomics.tsx), `FertilizerPanel` renders with empty items.

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add frontend/public/data/farmer_economics.json
git commit -m "data: seed empty farmer_economics.json for local dev"
```

---

## Self-Review

### Spec coverage check

| Spec section | Task |
|---|---|
| 3.1 Open-Meteo weather (4 regions, 14-day, hourly→daily, frost/drought risk) | Task 2 |
| 3.2 NOAA CPC ONI (18 months, phase classification) | Task 2, 6 |
| 3.3 World Bank Pink Sheet (Urea, DAP, KCl, 7 months) | Task 2 |
| 3.4 Comex Stat fertilizer imports (Playwright, NCM 31xx) | Task 5 |
| 3.5 CONAB Safra (acreage/yield HTML parse) | Task 4 |
| 3.6 CONAB Custos (production cost Excel, Sul de Minas sheet) | Task 4 |
| 4. WeatherSnapshot table | Task 1 |
| 4. FertilizerImport table | Task 1 |
| 5. farmer_economics.py | Task 2 |
| 5. conab_supply.py | Task 4 |
| 5. comex_fertilizer.py | Task 5 |
| 6. farmer_economics.json output shape | Task 6 |
| 7. BrazilFarmerEconomics.tsx → fetch | Task 10 |
| 7. FertilizerPanel → imports bar chart | Task 12 |
| 7. WeatherRiskPanel → Current Conditions | Task 11 |
| 8. scraper-daily.yml modified | Task 8 |
| 8. scraper-monthly.yml created | Task 8 |
| 9. CurrentCondition type | Task 9 |
| 9. FertilizerImportMonth type | Task 9 |
| 9. ForecastAccuracyPoint removed | Task 9 |

All spec requirements covered. ✓
