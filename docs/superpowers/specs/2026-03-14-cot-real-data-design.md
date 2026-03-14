# CoT Real Data Pipeline — Design Spec

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Replace `generateData()` synthetic data in `CotDashboard.tsx` with real CFTC/ICE CoT history from a dedicated `cot_weekly` PostgreSQL table, seeded from a local Excel file and kept current by the existing weekly scraper.

**Architecture:** Excel → one-time import script → `cot_weekly` table in Supabase → `GET /api/cot` endpoint → frontend lazy-fetch when CoT tab first activated → `transformApiData()` replaces `generateData()`.

**Tech Stack:** Python/openpyxl (import), SQLAlchemy 2.0 mapped_column style (ORM), FastAPI (API), Next.js/TypeScript (frontend)

---

## Data Sources (Excel file)

File: `C:\Users\Loic Scanu\OneDrive - Tuan Loc Commodities\TradeTeam\COT report.xlsx`

| Sheet | Use | Rows | Date range |
|-------|-----|------|------------|
| `NY COT FO` | NY Arabica OI + trader counts | 967 | 2007-09-04 → 2026-03-10 |
| `LDN COT FO` | LDN Robusta OI + trader counts | 598 | 2014-09-30 → 2026-03-10 |
| `Other` | Daily prices, OI, volume, EFP, spread vol | 14 746 | 1973 → present |

### `NY COT FO` / `LDN COT FO` column mapping (0-indexed, row 1 = header)

| Col (NY) | Col (LDN) | Excel header | DB field |
|----------|-----------|-------------|----------|
| 0 | 0 | Date | date |
| 1 | 1 | All | oi_total |
| 2 | 2 | All OI PUMP L | pmpu_long |
| 3 | 3 | All OI PUMP S | pmpu_short |
| 4 | 4 | All OI SD L | swap_long |
| 5 | 5 | All OI SD S | swap_short |
| 6 | 6 | All OI SD SP | swap_spread |
| 7 | 7 | All OI MM L | mm_long |
| 8 | 8 | All OI MM S | mm_short |
| 9 | 9 | All OI MM SD | mm_spread |
| 10 | 10 | All OI OR L | other_long |
| 11 | 11 | All OI OR S | other_short |
| 12 | 12 | All OI OR SP | other_spread |
| 13 | 13 | All OI NR L | nr_long |
| 14 | 14 | All OI NR S | nr_short |
| 32 | 17 | All # PUMP L | t_pmpu_long |
| 33 | 18 | All # PUMP S | t_pmpu_short |
| 34 | 19 | All # SD L | t_swap_long |
| 35 | 20 | All # SD S | t_swap_short |
| 36 | 21 | All # SD SP | t_swap_spread |
| 37 | 22 | All # MM L | t_mm_long |
| 38 | 23 | All # MM S | t_mm_short |
| 39 | 24 | All # MM SD | t_mm_spread |
| 40 | 25 | All # OR L | t_other_long |
| 41 | 26 | All # OR S | t_other_short |
| 42 | 27 | All # OR SP | t_other_spread |
| 43 | **N/A** | All # NR L | t_nr_long |
| 44 | **N/A** | All # NR S | t_nr_short |

**LDN sheet has no NR trader count columns.** For all LDN rows, set `t_nr_long = None` and `t_nr_short = None` explicitly.

### `Other` sheet column mapping (0-indexed; row 1 = section headers, row 2 = sub-headers, data starts row 3)

**openpyxl is 1-indexed** (`min_row=3` skips the two header rows); Python list access for the data rows uses 0-indexed column offsets from the code below.

| Col | Sub-header | DB field | Notes |
|-----|-----------|----------|-------|
| 0 | Date | (join key) | daily |
| 1 | NY 1st | price_ny | front-month settlement |
| 4 | LDN 1st | price_ldn | front-month settlement |
| 7 | NY Structure | structure_ny | calendar spread NY |
| 8 | LDN Structure | structure_ldn | calendar spread LDN |
| 18 | NY (Open Interest) | exch_oi_ny | exchange-reported daily OI |
| 19 | LD (Open Interest) | exch_oi_ldn | |
| 20 | NY (Volume) | vol_ny | daily traded volume |
| 21 | LD (Volume) | vol_ldn | |
| 22 | NY (EFP) | efp_ny | Exchange for Physical |
| 23 | LD (EFP) | efp_ldn | |
| 24 | NY (Spread Volume) | spread_vol_ny | |
| 25 | LD (Spread Volume) | spread_vol_ldn | |

**Price join:** Build a sorted list of `(date, fields)` from the Other sheet. For each CoT report date, look up the exact date; if absent, use the most recent prior date.

---

## DB Schema

**New table: `cot_weekly`** in `backend/models.py`

Use the same SQLAlchemy 2.0 `Mapped` / `mapped_column` style as the rest of `models.py`. Follow `FreightRate` exactly — use `date` (not an alias), omit explicit `Integer` from the `id` primary key:

```python
from datetime import date, datetime
from typing import Optional
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import UniqueConstraint, Integer, Float, String, Date, DateTime

class CotWeekly(Base):
    __tablename__ = "cot_weekly"

    id: Mapped[int]        = mapped_column(primary_key=True)
    date: Mapped[date]     = mapped_column(Date, nullable=False, index=True)
    market: Mapped[str]    = mapped_column(String(3), nullable=False)  # "ny" | "ldn"

    # CoT OI fields
    oi_total:     Mapped[Optional[int]] = mapped_column(Integer)
    pmpu_long:    Mapped[Optional[int]] = mapped_column(Integer)
    pmpu_short:   Mapped[Optional[int]] = mapped_column(Integer)
    swap_long:    Mapped[Optional[int]] = mapped_column(Integer)
    swap_short:   Mapped[Optional[int]] = mapped_column(Integer)
    swap_spread:  Mapped[Optional[int]] = mapped_column(Integer)
    mm_long:      Mapped[Optional[int]] = mapped_column(Integer)
    mm_short:     Mapped[Optional[int]] = mapped_column(Integer)
    mm_spread:    Mapped[Optional[int]] = mapped_column(Integer)
    other_long:   Mapped[Optional[int]] = mapped_column(Integer)
    other_short:  Mapped[Optional[int]] = mapped_column(Integer)
    other_spread: Mapped[Optional[int]] = mapped_column(Integer)
    nr_long:      Mapped[Optional[int]] = mapped_column(Integer)
    nr_short:     Mapped[Optional[int]] = mapped_column(Integer)

    # Trader count fields
    t_pmpu_long:   Mapped[Optional[int]] = mapped_column(Integer)
    t_pmpu_short:  Mapped[Optional[int]] = mapped_column(Integer)
    t_swap_long:   Mapped[Optional[int]] = mapped_column(Integer)
    t_swap_short:  Mapped[Optional[int]] = mapped_column(Integer)
    t_swap_spread: Mapped[Optional[int]] = mapped_column(Integer)
    t_mm_long:     Mapped[Optional[int]] = mapped_column(Integer)
    t_mm_short:    Mapped[Optional[int]] = mapped_column(Integer)
    t_mm_spread:   Mapped[Optional[int]] = mapped_column(Integer)
    t_other_long:  Mapped[Optional[int]] = mapped_column(Integer)
    t_other_short: Mapped[Optional[int]] = mapped_column(Integer)
    t_other_spread:Mapped[Optional[int]] = mapped_column(Integer)
    t_nr_long:     Mapped[Optional[int]] = mapped_column(Integer)   # NY only; None for LDN
    t_nr_short:    Mapped[Optional[int]] = mapped_column(Integer)   # NY only; None for LDN

    # From Other sheet (joined by date)
    price_ny:      Mapped[Optional[float]] = mapped_column(Float)
    price_ldn:     Mapped[Optional[float]] = mapped_column(Float)
    structure_ny:  Mapped[Optional[float]] = mapped_column(Float)
    structure_ldn: Mapped[Optional[float]] = mapped_column(Float)
    exch_oi_ny:    Mapped[Optional[int]]   = mapped_column(Integer)
    exch_oi_ldn:   Mapped[Optional[int]]   = mapped_column(Integer)
    vol_ny:        Mapped[Optional[int]]   = mapped_column(Integer)
    vol_ldn:       Mapped[Optional[int]]   = mapped_column(Integer)
    efp_ny:        Mapped[Optional[float]] = mapped_column(Float)   # float: EFP can be fractional
    efp_ldn:       Mapped[Optional[float]] = mapped_column(Float)
    spread_vol_ny: Mapped[Optional[float]] = mapped_column(Float)   # float: may be fractional in source
    spread_vol_ldn:Mapped[Optional[float]] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("date", "market", name="uq_cot_date_market"),
    )
```

---

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `backend/models.py` | Modify | Add `CotWeekly` model |
| `backend/seed/import_cot_excel.py` | Create | One-time Excel → DB import |
| `backend/routes/cot.py` | Create | `GET /api/cot` endpoint |
| `backend/main.py` | Modify | Register `/api/cot` router |
| `backend/scraper/sources/futures.py` | Modify | Also upsert to `cot_weekly` after weekly parse |
| `backend/scraper/db.py` | Modify | Add `upsert_cot_weekly()` helper |
| `frontend/lib/api.ts` | Modify | Add `fetchCot()` |
| `frontend/components/futures/CotDashboard.tsx` | Modify | Lazy-fetch, `transformApiData()`, loading state |

---

## Import Script (`backend/seed/import_cot_excel.py`)

Usage:
```bash
DATABASE_URL=postgresql://... python -m seed.import_cot_excel \
  --file "C:/Users/Loic Scanu/OneDrive - Tuan Loc Commodities/TradeTeam/COT report.xlsx"
```

**Deployment sequence (important):**
1. Add `CotWeekly` to `models.py` and push/deploy so the server runs `Base.metadata.create_all()` on startup — this creates the `cot_weekly` table in Supabase
2. Then run the import script with `DATABASE_URL` pointing at the Supabase production DB
3. Update CORS in `main.py` to include the production frontend origin (currently hardcoded as `http://localhost:3000`)

**Logic:**
1. Read `Other` sheet using openpyxl `min_row=3` (rows 1–2 are headers) → build `prices: dict[date, dict]` keyed by `.date()`, values contain all Other-sheet fields (price_ny, price_ldn, structure_ny/ldn, exch_oi, vol, efp, spread_vol)
2. Sort `prices` keys to allow binary-search for "most recent prior date" lookups
3. Read `NY COT FO` using `min_row=2` (row 1 is header); skip rows where `row[0]` is None or not a datetime
4. Read `LDN COT FO` using `min_row=2`; same skip condition
5. For each row in each sheet:
   - Parse date from `row[0].date()`
   - Extract OI + trader fields per column mapping table above (column offsets are 0-indexed from the row tuple returned by openpyxl)
   - For LDN rows: set `t_nr_long = None`, `t_nr_short = None` (no such columns)
   - Coerce non-numeric cells to `None` (catch `TypeError`, `ValueError`)
   - Look up `prices[date]`; if absent, find most recent prior date in sorted keys using `bisect_right`
   - Upsert into `cot_weekly` using `upsert_cot_weekly()`
6. Print summary: `NY: X rows, LDN: Y rows upserted` (count = total rows processed, not just newly inserted)

---

## `upsert_cot_weekly` helper (`backend/scraper/db.py`)

Follow the exact same pattern as `upsert_freight_rate` (own session via `get_session()`, try/except rollback/raise, close in finally):

```python
def upsert_cot_weekly(market: str, report_date, fields: dict):
    from models import CotWeekly
    db = get_session()
    try:
        existing = db.query(CotWeekly).filter_by(date=report_date, market=market).first()
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            db.add(CotWeekly(date=report_date, market=market, **fields))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
```

---

## Scraper Update (`backend/scraper/sources/futures.py`)

**Architecture note:** The local variables `pmpu_l`, `pmpu_s`, `mm_l`, etc. exist only inside `_make_cot_item` and `_make_ice_cot_item` before the function returns. The cleanest approach — with minimal refactoring — is to call `upsert_cot_weekly` from **inside** each function, immediately after building `cot_struct`, using the local variables that are already available there.

```python
from scraper.db import upsert_cot_weekly

# Inside _make_cot_item(), after building cot_struct (CFTC → NY):
upsert_cot_weekly("ny", report_date, {
    "oi_total": oi,
    "pmpu_long": pmpu_l,   "pmpu_short": pmpu_s,
    "swap_long": swap_l,   "swap_short": swap_s,   "swap_spread": swap_sp,
    "mm_long": mm_l,       "mm_short": mm_s,       "mm_spread": mm_sp,
    "other_long": oth_l,   "other_short": oth_s,   "other_spread": oth_sp,
    "nr_long": nr_l,       "nr_short": nr_s,
    # Trader counts: CFTC disaggregated CSV does not include trader counts
    # (those come from a separate supplemental report); leave as None for now
    # price_ny / price_ldn = not available at scrape time, leave as None
})

# Inside _make_ice_cot_item(), after building cot_struct (ICE → LDN):
upsert_cot_weekly("ldn", report_date, {
    "oi_total": oi,
    "pmpu_long": pmpu_l,   "pmpu_short": pmpu_s,
    "swap_long": swap_l,   "swap_short": swap_s,   "swap_spread": swap_sp,
    "mm_long": mm_l,       "mm_short": mm_s,       "mm_spread": mm_sp,
    "other_long": oth_l,   "other_short": oth_s,   "other_spread": oth_sp,
    "nr_long": nr_l,       "nr_short": nr_s,
    "t_nr_long": None, "t_nr_short": None,
    # price_ny / price_ldn = not available at scrape time
})
```

The `news_feed` upsert already in place is kept unchanged.

---

## API Endpoint (`backend/routes/cot.py`)

```
GET /api/cot?after=YYYY-MM-DD   (optional; defaults to no filter)
```

The optional `after` query parameter uses **exclusive** comparison (`date > after`) so the frontend can pass its last known date to fetch only new rows.

- Query `cot_weekly` ordered `date ASC`, filtered `date > after` if provided
- **Group in Python** (not SQL): iterate rows and build `merged: dict[date, {ny, ldn}]`; SQL GROUP BY with MAX() is impractical given 50+ columns
- Dates where only one market exists are still returned (`ldn: null` for dates before 2014)

Response shape:
```json
[
  {
    "date": "2007-09-14",
    "ny": {
      "oi_total": 150000,
      "pmpu_long": 45000,  "pmpu_short": 60000,
      "swap_long": 20000,  "swap_short": 15000,  "swap_spread": 5000,
      "mm_long": 25000,    "mm_short": 12000,    "mm_spread": 8000,
      "other_long": 8000,  "other_short": 6000,  "other_spread": 3000,
      "nr_long": 5000,     "nr_short": 5000,
      "t_pmpu_long": 80,   "t_pmpu_short": 75,
      "t_swap_long": 18,   "t_swap_short": 18,   "t_swap_spread": 15,
      "t_mm_long": 55,     "t_mm_short": 50,     "t_mm_spread": 60,
      "t_other_long": 35,  "t_other_short": 50,  "t_other_spread": 45,
      "t_nr_long": 260,    "t_nr_short": 255,
      "price_ny": 145.20,  "structure_ny": 0.018,
      "exch_oi_ny": 155000, "vol_ny": 28000,
      "efp_ny": 500.0,     "spread_vol_ny": 12000.0
    },
    "ldn": { "...same fields...", "t_nr_long": null, "t_nr_short": null }
  }
]
```

---

## Frontend Changes

### `frontend/lib/api.ts`

```typescript
export async function fetchCot(after?: string): Promise<any[]> {
  const url = after
    ? `${API_URL}/api/cot?after=${after}`
    : `${API_URL}/api/cot`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch CoT data");
  return res.json();
}
```

### `frontend/components/futures/CotDashboard.tsx`

**True lazy loading — fetch only when CoT tab is first activated:**

The component is only mounted when the CoT tab is active (in `futures/page.tsx`), so `useEffect(…, [])` on mount is equivalent to "first tab click". No additional gating needed.

```tsx
const [cotRows, setCotRows] = useState<any[] | null>(null);
const [cotError, setCotError] = useState(false);

useEffect(() => {
  fetchCot()
    .then(setCotRows)
    .catch(() => setCotError(true));
}, []);
```

- While `cotRows === null && !cotError`: show a skeleton spinner (grey animated bar) in the chart area
- If `cotError`: use `generateData()` with a small amber banner "Live data unavailable — showing illustrative data"

**`data` derivation — use `length` check to treat empty array as "not ready":**
```tsx
const data = useMemo(
  () => (cotRows?.length ? transformApiData(cotRows) : generateData()),
  [cotRows]
);
```

> **Why `cotRows?.length` not `cotRows`:** An empty array `[]` is truthy but would produce an empty `data` array, causing `data[data.length - 1]` (used for `latest`) to be `undefined` and crash the render. If the DB is empty or the fetch returns no rows, fall back to `generateData()`.

---

## `transformApiData(rows)` — Complete Specification

Input: `rows` = API response array `[{date, ny:{...}, ldn:{...}}]`, sorted by date ascending.

**This function must perform a single ordered iteration** (not a `map`) to compute delta fields that depend on the previous row.

### Step 1: Ordered iteration to build base rows

```typescript
const ARABICA_MT_FACTOR = 17.01;
const ROBUSTA_MT_FACTOR = 10.00;
const MARGIN_OUTRIGHT   = 6000;
const MARGIN_SPREAD     = 1200;
const CENTS_LB_TO_USD_TON = 22.0462;

let prevPriceNY  = 130;   // carry-forward seed value
let prevPriceLDN = 1800;
let cumulativeNominal = 0;
let cumulativeMargin  = 0;

const base = rows.map((row, i) => {
  const ny  = row.ny  ?? {};
  const ldn = row.ldn ?? {};

  // OI
  const oiNY  = ny.oi_total  ?? 0;
  const oiLDN = ldn.oi_total ?? 0;
  const totalOI = oiNY + oiLDN;

  // Spreading — computed from RAW API spread fields (NOT from the ny/ldn sub-objects below)
  const spreadingNY  = (ny.swap_spread  ?? 0) + (ny.mm_spread  ?? 0) + (ny.other_spread  ?? 0);
  const spreadingLDN = (ldn.swap_spread ?? 0) + (ldn.mm_spread ?? 0) + (ldn.other_spread ?? 0);
  const spreadingTotal = spreadingNY + spreadingLDN;
  const outrightTotal  = totalOI - spreadingTotal;

  // Price — carry forward last known value when null
  const priceNY  = ny.price_ny   != null ? ny.price_ny   : prevPriceNY;
  const priceLDN = ldn.price_ldn != null ? ldn.price_ldn : prevPriceLDN;
  prevPriceNY  = priceNY;
  prevPriceLDN = priceLDN;

  const priceNY_USD_Ton  = priceNY * CENTS_LB_TO_USD_TON;
  const avgPrice_USD_Ton = totalOI > 0
    ? ((priceNY_USD_Ton * oiNY) + (priceLDN * oiLDN)) / totalOI
    : 0;

  // Delta OI — requires prev row (i > 0)
  const prevRow      = i > 0 ? base[i - 1] : null;
  const deltaOINY    = prevRow ? oiNY  - prevRow.oiNY  : 0;
  const deltaOILDN   = prevRow ? oiLDN - prevRow.oiLDN : 0;

  // Weekly nominal flow ($ millions)
  const flowNY  = (deltaOINY  * priceNY  * 375) / 1_000_000;
  const flowLDN = (deltaOILDN * priceLDN * 10)  / 1_000_000;
  const weeklyNominalFlow = flowNY + flowLDN;

  // Weekly margin flow ($ millions)
  const prevSpread   = prevRow ? prevRow.spreadingTotal : 0;
  const prevOutright = prevRow ? prevRow.outrightTotal  : 0;
  const deltaSpread   = spreadingTotal - prevSpread;
  const deltaOutright = outrightTotal  - prevOutright;
  const weeklyMarginFlow =
    ((deltaOutright * MARGIN_OUTRIGHT) + (deltaSpread * MARGIN_SPREAD)) / 1_000_000;

  cumulativeNominal += weeklyNominalFlow;
  cumulativeMargin  += weeklyMarginFlow;

  // macroMarket / macroSofts: no real macro source exists; derive from cumulativeNominal
  // (matches the generateData() formula without the synthetic oscillation)
  const macroMarket = cumulativeNominal * 2.5;
  const macroSofts  = cumulativeNominal * 1.5;

  // ny / ldn sub-objects — camelCase OI fields used by Tabs 2–6
  // NOTE: these sub-objects contain only Long/Short OI. Spread OI is NOT included here
  // because it was already used above (raw) for spreadingTotal computation.
  // KEY NAMING RULE:
  //   - ny.nonRepLong / ny.nonRepShort  (camelCase) — used by Tab 2 as d.ny[`${cat}Long`]
  //     where cat = "nonRep"; also Tab 5 uses oiKey = cat === "nonrep" ? "nonRep" : cat
  //   - tradersNY.nonrep                (lowercase)  — used by Tab 5 as m.tr["nonrep"]
  //   Both are intentionally different naming systems. Do NOT change either.
  const nyObj = {
    pmpuLong:   ny.pmpu_long  ?? 0,  pmpuShort:  ny.pmpu_short  ?? 0,
    swapLong:   ny.swap_long  ?? 0,  swapShort:  ny.swap_short  ?? 0,
    mmLong:     ny.mm_long    ?? 0,  mmShort:    ny.mm_short    ?? 0,
    otherLong:  ny.other_long ?? 0,  otherShort: ny.other_short ?? 0,
    nonRepLong: ny.nr_long    ?? 0,  nonRepShort: ny.nr_short   ?? 0,  // ← critical: nr_long → nonRepLong
  };
  const ldnObj = {
    pmpuLong:   ldn.pmpu_long  ?? 0,  pmpuShort:  ldn.pmpu_short  ?? 0,
    swapLong:   ldn.swap_long  ?? 0,  swapShort:  ldn.swap_short  ?? 0,
    mmLong:     ldn.mm_long    ?? 0,  mmShort:    ldn.mm_short    ?? 0,
    otherLong:  ldn.other_long ?? 0,  otherShort: ldn.other_short ?? 0,
    nonRepLong: ldn.nr_long    ?? 0,  nonRepShort: ldn.nr_short   ?? 0,
  };

  // tradersNY / tradersLDN — lowercase keys, used by Tab 5 processedDpData m.tr[cat]
  // Long-side trader count used as representative count per category (business convention)
  const tradersNY = {
    pmpu:   ny.t_pmpu_long  ?? 0,
    mm:     ny.t_mm_long    ?? 0,
    swap:   ny.t_swap_long  ?? 0,
    other:  ny.t_other_long ?? 0,
    nonrep: ny.t_nr_long    ?? 0,
  };
  const tradersLDN = {
    pmpu:   ldn.t_pmpu_long  ?? 0,
    mm:     ldn.t_mm_long    ?? 0,
    swap:   ldn.t_swap_long  ?? 0,
    other:  ldn.t_other_long ?? 0,
    nonrep: 0,   // always 0 for LDN (no NR trader count in ICE data)
  };

  // Industry fields (Tab 4)
  const pmpuShortMT_NY  = nyObj.pmpuShort  * ARABICA_MT_FACTOR;
  const pmpuShortMT_LDN = ldnObj.pmpuShort * ROBUSTA_MT_FACTOR;
  const pmpuShortMT     = pmpuShortMT_NY + pmpuShortMT_LDN;
  const efpMT           = (ny.efp_ny ?? 0) * ARABICA_MT_FACTOR;

  // Timeframe — computed after building the full array (see Step 2 below)
  // Placeholder here; overwritten in Step 2
  return {
    id: i,
    date: row.date,
    priceNY, priceLDN, avgPrice_USD_Ton,
    oiNY, oiLDN, totalOI,
    spreadingTotal, outrightTotal,
    weeklyNominalFlow, weeklyMarginFlow, cumulativeNominal, cumulativeMargin,
    macroMarket, macroSofts,
    ny: nyObj, ldn: ldnObj,
    tradersNY, tradersLDN,
    pmpuShortMT_NY, pmpuShortMT_LDN, pmpuShortMT, efpMT,
    timeframe: "historical",  // overwritten below
  };
});
```

> **Important:** `base[i - 1]` is valid because `base` is built in-order and each entry is pushed before the next iteration accesses it. Use a `for` loop (not `.map`) if your runtime doesn't guarantee this, or compute deltas in a second pass.

### Step 2: Assign timeframe buckets and compute priceRank / oiRank

```typescript
const n = base.length;

return base.map((d, i) => {
  // Timeframe classification (from end of array)
  const timeframe =
    i === n - 1              ? "current"    :
    i === n - 2              ? "recent_1"   :
    i >= n - 6 && i <= n - 3 ? "recent_4"   :
    i >= n - 58 && i <= n - 7 ? "year"      :
                               "historical";

  // priceRank and oiRank — 52-week sliding window
  const slice  = base.slice(Math.max(0, i - 52), i + 1);
  const maxP   = Math.max(...slice.map(s => s.priceNY));
  const minP   = Math.min(...slice.map(s => s.priceNY));
  const net    = d.ny.mmLong - d.ny.mmShort;
  const nets   = slice.map(s => s.ny.mmLong - s.ny.mmShort);
  const maxNet = Math.max(...nets);
  const minNet = Math.min(...nets);

  return {
    ...d,
    timeframe,
    priceRank: maxP !== minP ? ((d.priceNY - minP) / (maxP - minP)) * 100 : 50,
    oiRank:    maxNet !== minNet ? ((net - minNet) / (maxNet - minNet)) * 100 : 50,
  };
});
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| API down / network error | `generateData()` + amber banner |
| DB empty (fresh deploy before import) | Returns `[]` → `cotRows?.length` is falsy → `generateData()` |
| LDN missing for a date (pre-2014) | `row.ldn = null`; code uses `ldn = row.ldn ?? {}` then `?? 0` defaults |
| Partial row (None values in Excel) | Import coerces non-numeric cells to `None`; API returns `null` JSON; frontend uses `?? 0` |
| Date not found in Other sheet | Use most-recent prior date; if none exists, leave price/vol fields `null` |
| `priceNY`/`priceLDN` null in DB | Carry-forward applied **during** the ordered iteration in Step 1 above — always populated before priceRank computation |

---

## Testing

- `backend/tests/test_cot_model.py`: upsert insert + update for `CotWeekly`; verify LDN row has `t_nr_long = None`
- `backend/tests/test_cot_route.py`: empty DB returns `[]`; seeded rows produce correct merged structure with `nr_long` field present in JSON; `after` param filters with exclusive `>` comparison
- Manual: run import script against local Docker DB, verify `SELECT COUNT(*) FROM cot_weekly` matches expected (967 NY + 598 LDN = 1565)
