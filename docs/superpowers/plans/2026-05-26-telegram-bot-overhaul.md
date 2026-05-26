# Telegram Bot Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the one-way morning brief into a bidirectional Telegram bot with command parser, redesigned brief, and GitHub Actions scraper triggers.

**Architecture:** New `backend/telegram/` package with a FastAPI webhook router, per-command handler modules, and a shared sender/auth layer. Existing `morning_brief.py` is refactored to delegate to the new `handlers/brief.py`.

**Tech Stack:** Python 3.11, FastAPI, `requests` (existing), static JSON files under `frontend/public/data/`, GitHub Actions REST API.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `backend/telegram/__init__.py` | Package marker |
| Create | `backend/telegram/auth.py` | Allowlist check |
| Create | `backend/telegram/sender.py` | `send_message()` helper |
| Create | `backend/telegram/commands.py` | Command dispatch table |
| Create | `backend/telegram/router.py` | FastAPI POST /telegram/webhook |
| Create | `backend/telegram/setup.py` | One-time webhook registration script |
| Create | `backend/telegram/handlers/__init__.py` | Package marker |
| Create | `backend/telegram/handlers/help.py` | /help static response |
| Create | `backend/telegram/handlers/prices.py` | /prices formatter |
| Create | `backend/telegram/handlers/cot.py` | /cot full COT report |
| Create | `backend/telegram/handlers/brazil.py` | /brazil cecafe_daily |
| Create | `backend/telegram/handlers/kaffeesteuer.py` | /kaffeesteuer formatter |
| Create | `backend/telegram/handlers/ecf.py` | /ecf formatter |
| Create | `backend/telegram/handlers/quote.py` | /quote parser + formatter |
| Create | `backend/telegram/handlers/run.py` | /run GitHub Actions dispatch |
| Create | `backend/telegram/handlers/brief.py` | Redesigned morning brief builder |
| Modify | `backend/scraper/morning_brief.py` | Import `build_brief_message` from handlers/brief |
| Modify | `backend/main.py` | Register telegram router |
| Create | `backend/scraper/tests/test_telegram.py` | Unit tests for auth, quote, brief |

---

## Key Data Facts

**`frontend/public/data/latest_prices.json` — VN FAQ ticker:**
```
{'label': 'VN FAQ', 'value': '87.700 VND ($3,347)', 'category': 'physical'}
```
Parse: `vnd = int('87.700'.replace('.',''))` → 87700. USD: `int('3,347'.replace(',',''))` → 3347.

**`frontend/public/data/cot_recent.json` — row structure:**
- `date`, `ny`, `ldn` — find latest row where `ny.mm_long is not None`
- Price: `price_ny` (KC cents/lb), `price_ldn` (RC USD/MT)
- OI: `oi_total`
- MM: `mm_long`, `mm_short`
- Producers: `pmpu_long`, `pmpu_short`
- Other (commercial/roasters): `other_long`, `other_short`

**`frontend/public/data/cecafe_daily.json` — structure:**
```json
{"updated": "2026-05-14", "arabica": {"2026-04": {"13": 1025329, ...}}, "conillon": {...}, "soluvel": {...}}
```
Latest = last key in sorted months, last key in sorted days (int sort). MoM = same day-count in prior month.

**`frontend/public/data/futures_chain.json` — RC prices:**
```python
chain['robusta']['contracts']  # list, first = front
# each: {'symbol': 'RMN26', 'last': 3487, ...}
```

**GitHub Actions workflow filenames:**
```python
WORKFLOWS = {
    "prices":       "scraper-prices.yml",
    "cot":          "scraper-cot.yml",
    "cecafe":       "scraper-cecafe.yml",
    "kaffeesteuer": "scraper-kaffeesteuer.yml",
    "ecf":          "scraper-slow-data.yml",
    "brief":        "morning-brief.yml",
}
```

**Shipment→Contract map:**
```python
STC = {1:"H",2:"H",3:"K",4:"K",5:"N",6:"N",7:"U",8:"U",9:"X",10:"X",11:"F",12:"F"}
```

---

## Task 1: Module Skeleton

**Files:**
- Create: `backend/telegram/__init__.py`
- Create: `backend/telegram/handlers/__init__.py`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p backend/telegram/handlers
touch backend/telegram/__init__.py
touch backend/telegram/handlers/__init__.py
```

- [ ] **Step 2: Verify structure**

```bash
ls backend/telegram/
ls backend/telegram/handlers/
```
Expected: `__init__.py` in both dirs.

- [ ] **Step 3: Commit**

```bash
git add backend/telegram/
git commit -m "feat(telegram): scaffold module skeleton"
```

---

## Task 2: auth.py + sender.py

**Files:**
- Create: `backend/telegram/auth.py`
- Create: `backend/telegram/sender.py`

- [ ] **Step 1: Write failing tests**

Create `backend/scraper/tests/test_telegram.py`:
```python
import os
import pytest

def test_is_allowed_match(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_IDS", "111,222")
    from backend.telegram.auth import is_allowed
    assert is_allowed({"message": {"chat": {"id": 111}}}) is True

def test_is_allowed_miss(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_IDS", "111")
    from backend.telegram.auth import is_allowed
    assert is_allowed({"message": {"chat": {"id": 999}}}) is False

def test_is_allowed_empty_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_IDS", "")
    from backend.telegram.auth import is_allowed
    assert is_allowed({"message": {"chat": {"id": 111}}}) is False

def test_is_allowed_missing_message():
    from backend.telegram.auth import is_allowed
    assert is_allowed({}) is False
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && python -m pytest scraper/tests/test_telegram.py -v 2>&1 | head -20
```
Expected: ImportError or similar.

- [ ] **Step 3: Write auth.py**

```python
from __future__ import annotations
import os


def is_allowed(update: dict) -> bool:
    chat_id = str(update.get("message", {}).get("chat", {}).get("id", ""))
    raw = os.getenv("TELEGRAM_ALLOWED_IDS", "")
    allowed = {x.strip() for x in raw.split(",") if x.strip()}
    return chat_id in allowed
```

- [ ] **Step 4: Write sender.py**

```python
from __future__ import annotations
import os
import requests


TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")


def send_message(chat_id: str | int, text: str, parse_mode: str = "HTML") -> bool:
    if not TELEGRAM_BOT_TOKEN:
        print("[telegram] TELEGRAM_BOT_TOKEN not set")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    resp = requests.post(url, data={"chat_id": chat_id, "text": text, "parse_mode": parse_mode}, timeout=15)
    if resp.ok:
        return True
    print(f"[telegram] sendMessage error: {resp.status_code} {resp.text[:200]}")
    return False
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd backend && python -m pytest scraper/tests/test_telegram.py::test_is_allowed_match scraper/tests/test_telegram.py::test_is_allowed_miss scraper/tests/test_telegram.py::test_is_allowed_empty_env scraper/tests/test_telegram.py::test_is_allowed_missing_message -v
```
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/telegram/auth.py backend/telegram/sender.py backend/scraper/tests/test_telegram.py
git commit -m "feat(telegram): add auth allowlist and sender helper"
```

---

## Task 3: Shared Data Loader

**Files:**
- Create: `backend/telegram/data.py`

All handlers need JSON files. Extract into one shared loader.

- [ ] **Step 1: Write data.py**

```python
from __future__ import annotations
import json
import os
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR  = Path(os.environ.get("DATA_DIR", str(_REPO_ROOT / "frontend" / "public" / "data")))


def load(filename: str) -> dict | list | None:
    path = _DATA_DIR / filename
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
```

- [ ] **Step 2: Verify import works**

```bash
cd backend && python -c "from telegram.data import load; print(type(load('latest_prices.json')))"
```
Expected: `<class 'dict'>`

- [ ] **Step 3: Commit**

```bash
git add backend/telegram/data.py
git commit -m "feat(telegram): shared JSON data loader"
```

---

## Task 4: handlers/help.py + handlers/prices.py

**Files:**
- Create: `backend/telegram/handlers/help.py`
- Create: `backend/telegram/handlers/prices.py`

- [ ] **Step 1: Write help.py**

```python
HELP_TEXT = """\
Coffee Intel Bot — commands:

/brief       Morning summary
/prices      Current futures & physical
/quote       Robusta quotation (+ options)
/cot         COT report KC + RC
/brazil      Brazil daily registrations
/kaffeesteuer  German clearances
/ecf         EU port stocks
/run <name>  Trigger scraper (prices|cot|cecafe|kaffeesteuer|ecf|brief)
/help        This message

Examples:
  /quote basis=-140 eudr bb
  /run prices\
"""


def handle(args: str, context: dict) -> str:
    return HELP_TEXT
```

- [ ] **Step 2: Write prices.py**

```python
from __future__ import annotations
import re
from telegram.data import load


def handle(args: str, context: dict) -> str:
    chain   = load("futures_chain.json")
    latest  = load("latest_prices.json")

    lines = ["<b>Current Prices</b>"]

    if chain:
        arab = chain.get("arabica", {}).get("contracts", [])
        rob  = chain.get("robusta",  {}).get("contracts", [])
        if arab:
            r = arab[0]
            lines.append(f"  KC ({r.get('symbol','')})  {r.get('last','?'):.2f} ¢/lb")
        if rob:
            r = rob[0]
            lines.append(f"  RC ({r.get('symbol','')})  {r.get('last','?'):,.0f} USD/MT")

    if latest:
        tickers = latest.get("tickers", [])
        phys = {t["label"]: t["value"] for t in tickers if t.get("label") in {"VN FAQ","CON T7","UGA S15"}}
        for label, val in phys.items():
            lines.append(f"  {label}: {val}")
        fx_labels = ["USD/BRL", "USD/VND", "USD/IDR"]
        fx = [f"{t['label']}={t['value']}" for t in tickers if t.get("label") in fx_labels]
        if fx:
            lines.append("  FX: " + " | ".join(fx))

    return "\n".join(lines) if len(lines) > 1 else "Price data unavailable. Run /run prices"
```

- [ ] **Step 3: Smoke-test imports**

```bash
cd backend && python -c "
from telegram.handlers.help import handle as h1
from telegram.handlers.prices import handle as h2
print(h1('','{}')[:40])
print(h2('','{}')[:40])
"
```
Expected: first lines of each response, no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/telegram/handlers/help.py backend/telegram/handlers/prices.py
git commit -m "feat(telegram): /help and /prices handlers"
```

---

## Task 5: handlers/cot.py

**Files:**
- Create: `backend/telegram/handlers/cot.py`

- [ ] **Step 1: Add COT test**

Add to `backend/scraper/tests/test_telegram.py`:
```python
def test_cot_handle_no_data():
    from backend.telegram.handlers.cot import handle
    result = handle("", {})
    assert "No COT data" in result or "COT Report" in result
```

- [ ] **Step 2: Write cot.py**

```python
from __future__ import annotations
from telegram.data import load


def _arrow(current, previous) -> str:
    if current is None or previous is None:
        return "?"
    return "▲" if current > previous else "▼" if current < previous else "→"


def _net(row: dict, key_long: str, key_short: str) -> int | None:
    l = row.get(key_long)
    s = row.get(key_short)
    if l is None or s is None:
        return None
    return l - s


def _find_rows(data: list) -> tuple[dict | None, dict | None]:
    """Return (latest, previous) COT rows with mm_long data."""
    latest = prev = None
    for row in reversed(data):
        ny = row.get("ny", {})
        if ny.get("mm_long") is not None:
            if latest is None:
                latest = row
            elif prev is None:
                prev = row
                break
    return latest, prev


def handle(args: str, context: dict) -> str:
    data = load("cot_recent.json")
    if not data or not isinstance(data, list):
        return "No COT data available yet."

    latest, prev = _find_rows(data)
    if not latest:
        return "No COT data available yet."

    date_str = latest["date"]
    lines = [f"<b>COT Report — wk {date_str}</b>"]

    for market, mkt_key, price_key, unit in [
        ("NY Arabica (KC)", "ny",  "price_ny",  "¢/lb"),
        ("London Robusta (RC)", "ldn", "price_ldn", "USD/MT"),
    ]:
        cur  = latest.get(mkt_key, {})
        prv  = prev.get(mkt_key, {}) if prev else {}

        mm_net = _net(cur, "mm_long", "mm_short")
        p_mm_net = _net(prv, "mm_long", "mm_short") if prv else None
        wow = f" {_arrow(mm_net, p_mm_net)}{'+' if (mm_net or 0) - (p_mm_net or 0) >= 0 else ''}{(mm_net or 0) - (p_mm_net or 0):,} WoW" if p_mm_net is not None and mm_net is not None else ""

        prod_net = _net(cur, "pmpu_long", "pmpu_short")
        p_prod = _net(prv, "pmpu_long", "pmpu_short") if prv else None
        prod_wow = f" {_arrow(prod_net, p_prod)}{'+' if (prod_net or 0) - (p_prod or 0) >= 0 else ''}{(prod_net or 0) - (p_prod or 0):,} WoW" if p_prod is not None and prod_net is not None else ""

        oi = cur.get("oi_total")
        p_oi = prv.get("oi_total") if prv else None
        price = cur.get(price_key)
        p_price = prv.get(price_key) if prv else None

        lines.append(f"\n── {market} ──")
        if price is not None:
            lines.append(f"Price: {price:,.2f} {unit}  {_arrow(price, p_price)}")
        if oi is not None:
            lines.append(f"OI:    {oi:,}  {_arrow(oi, p_oi)}")
        if mm_net is not None:
            sign = "+" if mm_net >= 0 else ""
            lines.append(f"MM net: {sign}{mm_net:,}{wow}")
            lines.append(f"  longs: {cur.get('mm_long',0):,} / shorts: {cur.get('mm_short',0):,}")
        if prod_net is not None:
            sign = "+" if prod_net >= 0 else ""
            lines.append(f"Producers: {sign}{prod_net:,}{prod_wow}")
            lines.append(f"  shorts: {cur.get('pmpu_short',0):,} / longs: {cur.get('pmpu_long',0):,}")
        if mm_net is None and prod_net is None:
            lines.append("  (data pending next release)")

    return "\n".join(lines)
```

- [ ] **Step 3: Run tests**

```bash
cd backend && python -m pytest scraper/tests/test_telegram.py::test_cot_handle_no_data -v
```
Expected: 1 passed.

- [ ] **Step 4: Smoke-test output**

```bash
cd backend && python -c "from telegram.handlers.cot import handle; print(handle('','{}'))"
```
Expected: formatted COT report with actual data.

- [ ] **Step 5: Commit**

```bash
git add backend/telegram/handlers/cot.py backend/scraper/tests/test_telegram.py
git commit -m "feat(telegram): /cot handler"
```

---

## Task 6: handlers/brazil.py

**Files:**
- Create: `backend/telegram/handlers/brazil.py`

`cecafe_daily.json` structure: `{arabica: {YYYY-MM: {day_str: cumulative_bags}}, conillon: {...}, soluvel: {...}}`. Day keys are string ints (`"13"`, `"4"`) — sort by `int`.

- [ ] **Step 1: Write brazil.py**

```python
from __future__ import annotations
from telegram.data import load


def _latest(data: dict, type_key: str) -> tuple[str, str, int] | None:
    """Returns (YYYY-MM, day_str, value) for the most recent entry."""
    section = data.get(type_key, {})
    if not section:
        return None
    month = sorted(section.keys())[-1]
    days  = sorted(section[month].keys(), key=int)
    day   = days[-1]
    return month, day, section[month][day]


def _prior_value(data: dict, type_key: str, month: str, day: str) -> int | None:
    """Same day-count in prior calendar month."""
    section = data.get(type_key, {})
    yr, mo = map(int, month.split("-"))
    mo -= 1
    if mo == 0:
        mo, yr = 12, yr - 1
    prev_month = f"{yr:04d}-{mo:02d}"
    prev_sec = section.get(prev_month, {})
    if not prev_sec:
        return None
    # Find closest day <= current day (same position in month)
    avail = sorted(prev_sec.keys(), key=int)
    target = int(day)
    best = None
    for d in avail:
        if int(d) <= target:
            best = d
    return prev_sec[best] if best else None


def handle(args: str, context: dict) -> str:
    data = load("cecafe_daily.json")
    if not data:
        return "Brazil data unavailable. Run /run cecafe"

    result = _latest(data, "arabica")
    if not result:
        return "No Brazil registration data."
    month, day, arab = result

    _, _, con = _latest(data, "conillon") or (None, None, 0)
    _, _, sol = _latest(data, "soluvel")  or (None, None, 0)
    total = arab + con + sol

    lines = [
        f"<b>Brazil Daily Registrations</b> ({month}/{day})",
        f"Total: {total:,} bags",
        "",
        "MoM change (same day):",
    ]

    for label, key, cur_val in [("Arabica","arabica",arab), ("Conilon","conillon",con), ("Soluble","soluvel",sol)]:
        prev = _prior_value(data, key, month, day)
        if prev is not None:
            delta = cur_val - prev
            arrow = "▲" if delta > 0 else "▼" if delta < 0 else "→"
            lines.append(f"  {arrow}{'+' if delta >= 0 else ''}{delta:,}  {label}  ({cur_val:,})")
        else:
            lines.append(f"  {label}: {cur_val:,} (no prior month)")

    return "\n".join(lines)
```

- [ ] **Step 2: Smoke-test**

```bash
cd backend && python -c "from telegram.handlers.brazil import handle; print(handle('','{}'))"
```
Expected: formatted Brazil output with MoM deltas.

- [ ] **Step 3: Commit**

```bash
git add backend/telegram/handlers/brazil.py
git commit -m "feat(telegram): /brazil handler"
```

---

## Task 7: handlers/kaffeesteuer.py + handlers/ecf.py

**Files:**
- Create: `backend/telegram/handlers/kaffeesteuer.py`
- Create: `backend/telegram/handlers/ecf.py`

- [ ] **Step 1: Write kaffeesteuer.py**

```python
from __future__ import annotations
from telegram.data import load


def handle(args: str, context: dict) -> str:
    data = load("kaffeesteuer.json")
    if not data:
        return "Kaffeesteuer data unavailable. Run /run kaffeesteuer"

    items = sorted(data.items())
    last3 = items[-3:]
    lines = ["<b>German Coffee Clearances (GZD)</b>", ""]
    for period, val in last3:
        yr, mo = period.split("-")
        prev_key = str(int(yr) - 1) + "-" + mo
        prev_val = data.get(prev_key)
        yoy = ""
        if prev_val:
            pct = (val - prev_val) / prev_val * 100
            yoy = f"  ({'+' if pct>=0 else ''}{pct:.1f}% YoY)"
        lines.append(f"  {period}: {val:,} bags{yoy}")
    return "\n".join(lines)
```

- [ ] **Step 2: Write ecf.py**

```python
from __future__ import annotations
from telegram.data import load


def handle(args: str, context: dict) -> str:
    data = load("demand_stocks.json")
    if not data:
        return "ECF data unavailable. Run /run ecf"

    ecf = data.get("ecf", {})
    monthly = ecf.get("monthly", [])
    if not monthly:
        return "ECF data empty."

    last4 = monthly[-4:]
    lines = [f"<b>ECF European Port Stocks</b>", f"Updated: {ecf.get('last_updated','?')}", ""]
    for i, m in enumerate(last4):
        prev = last4[i - 1] if i > 0 else None
        mom = ""
        if prev:
            delta = m["value_mt"] - prev["value_mt"]
            pct   = delta / prev["value_mt"] * 100
            mom   = f"  ({'+' if delta>=0 else ''}{delta:,} MT / {'+' if pct>=0 else ''}{pct:.1f}%)"
        lines.append(f"  {m['period']}: {m['value_mt']:,} MT{mom}")
    return "\n".join(lines)
```

- [ ] **Step 3: Smoke-test both**

```bash
cd backend && python -c "
from telegram.handlers.kaffeesteuer import handle as k
from telegram.handlers.ecf import handle as e
print(k('','{}'))
print()
print(e('','{}'))
"
```
Expected: formatted output for both, no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/telegram/handlers/kaffeesteuer.py backend/telegram/handlers/ecf.py
git commit -m "feat(telegram): /kaffeesteuer and /ecf handlers"
```

---

## Task 8: handlers/quote.py

**Files:**
- Create: `backend/telegram/handlers/quote.py`

This is the most complex handler. Implements argument parsing, contract legend, differential per month, and add-on stacking.

- [ ] **Step 1: Write failing tests for quote parser**

Add to `backend/scraper/tests/test_telegram.py`:
```python
def test_quote_parse_defaults():
    from backend.telegram.handlers.quote import parse_args
    a = parse_args("")
    assert a["basis"] is None
    assert a["eudr"] is False
    assert a["bb"] is False

def test_quote_parse_basis():
    from backend.telegram.handlers.quote import parse_args
    assert parse_args("basis=-140")["basis"] == -140
    assert parse_args("basis=+50")["basis"] == 50

def test_quote_parse_addons():
    from backend.telegram.handlers.quote import parse_args
    a = parse_args("eudr rfa bb")
    assert a["eudr"] is True
    assert a["rfa"] is True
    assert a["bb"] is True
    assert a["jute"] is False

def test_quote_differential():
    from backend.telegram.handlers.quote import compute_months
    # 8 months, same contract throughout → diff increases by 30/month
    rows = compute_months(basis=-100, rc_prices={"N": 3487}, today_month=6, today_day=1, addons=0)
    assert rows[0][2] == -100  # Jun: basis + 0*30
    assert rows[1][2] == -70   # Jul: basis + 1*30
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && python -m pytest scraper/tests/test_telegram.py -k "quote" -v 2>&1 | head -20
```

- [ ] **Step 3: Write quote.py**

```python
from __future__ import annotations
import re
from datetime import date
from telegram.data import load

STC = {1:"H",2:"H",3:"K",4:"K",5:"N",6:"N",7:"U",8:"U",9:"X",10:"X",11:"F",12:"F"}
MA  = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
       7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}

ADDON_DIFFS  = {"eudr":50, "rfa":60, "4c":15, "bb":15, "jute":25}
ADDON_FLAGS  = list(ADDON_DIFFS.keys())


def parse_args(raw: str) -> dict:
    tokens = raw.strip().lower().split()
    result = {k: False for k in ADDON_FLAGS}
    result["basis"] = None
    for t in tokens:
        if t.startswith("basis="):
            try:
                result["basis"] = int(t.split("=", 1)[1])
            except ValueError:
                pass
        elif t in ADDON_FLAGS:
            result[t] = True
    return result


def _rc_prices(chain: dict) -> dict[str, float]:
    prices = {}
    for c in chain.get("robusta", {}).get("contracts", []):
        m = re.match(r'^R[MC]([FGHJKMNQUVXZ])\d{2}$', c.get("symbol", ""), re.I)
        if m:
            letter = m.group(1).upper()
            if letter not in prices:
                prices[letter] = c["last"]
    return prices


def _vn_faq_usd(latest: dict) -> float | None:
    for t in latest.get("tickers", []):
        if t.get("label") == "VN FAQ":
            m = re.search(r'\$([0-9,]+)', t["value"])
            if m:
                return float(m.group(1).replace(",", ""))
    return None


def compute_months(basis: int, rc_prices: dict, today_month: int, today_day: int, addons: int) -> list[tuple[str, str, int | None]]:
    """Returns list of (label, sym, diff) for 8 shipment months."""
    offset = 1 if today_day >= 14 else 0
    today_year = date.today().year
    rows = []
    cum_spread = 0
    last_letter = None
    for i in range(8):
        yr, mo = today_year, today_month + offset + i
        while mo > 12:
            mo -= 12
            yr += 1
        letter = STC[mo]
        cyr = yr + 1 if letter == "F" and mo >= 11 else yr
        sym = f"RM{letter}{str(cyr)[2:]}"
        label = f"{MA[mo]}-{str(yr)[2:]}"
        if last_letter and letter != last_letter:
            fp = rc_prices.get(last_letter)
            tp = rc_prices.get(letter)
            if fp and tp:
                cum_spread += round(fp - tp)
        last_letter = letter
        cp = rc_prices.get(letter)
        diff = basis + i * 30 + cum_spread + addons if cp is not None else None
        rows.append((label, sym, diff))
    return rows


def handle(args: str, context: dict) -> str:
    chain  = load("futures_chain.json")
    latest = load("latest_prices.json")
    if not chain or not latest:
        return "RC price data unavailable."

    rc = _rc_prices(chain)
    if not rc:
        return "RC front price not available."

    today = date.today()
    a = parse_args(args)

    vn_usd = _vn_faq_usd(latest)
    front_contracts = chain.get("robusta", {}).get("contracts", [])
    front_price = front_contracts[0]["last"] if front_contracts else None

    basis = a["basis"]
    if basis is None:
        if vn_usd and front_price:
            basis = round(vn_usd - front_price)
        else:
            basis = 0
    basis_label = f"{basis:+d}" if basis != 0 else "0"

    # Front contract symbol
    front_sym = front_contracts[0].get("symbol", "?") if front_contracts else "?"

    # Add-on sum (cert + packing)
    addons = sum(ADDON_DIFFS[k] for k in ["eudr", "rfa", "4c", "bb", "jute"] if a.get(k))

    rows = compute_months(basis, rc, today.month, today.day, addons)

    # Contract legend — unique letters in order
    seen_letters: list[str] = []
    for _, _, _ in rows:
        pass  # rebuild below
    legend_letters: list[str] = []
    for label, sym, diff in rows:
        m = re.match(r'^RM([A-Z])', sym)
        if m:
            letter = m.group(1)
            if letter not in legend_letters:
                legend_letters.append(letter)

    legend_lines = []
    prev_price = None
    for letter in legend_letters:
        price = rc.get(letter)
        if price is None:
            continue
        if prev_price is None:
            legend_lines.append(f"  {letter} = {price:,.0f}  (front)")
        else:
            spread = round(prev_price - price)
            legend_lines.append(f"  {letter} = {price:,.0f}  (+{spread})")
        prev_price = price

    # Quality + packing labels
    certs = [k.upper() for k in ["eudr", "rfa", "4c"] if a.get(k)]
    quality = "Basis G2" + (" " + " ".join(certs) if certs else "")
    if a.get("bb"):
        packing = "Big bags"
    elif a.get("jute"):
        packing = "Jute bags"
    else:
        packing = "Bulk"

    # Shipment rows
    ship_lines = []
    for label, sym, diff in rows:
        m = re.match(r'^RM([A-Z])', sym)
        letter = m.group(1) if m else "?"
        if diff is not None:
            ship_lines.append(f"  {label:<8} {letter}{diff:+d}")
        else:
            ship_lines.append(f"  {label:<8} —")

    out = [
        "<b>Robusta Quotation</b>",
        f"Basis: {front_sym} {basis_label} (VN FAQ ref)",
        "",
    ]
    out.extend(legend_lines)
    out.append("")
    out.append(f"Quality: {quality}")
    out.append(f"Packing: {packing}")
    out.append("")
    out.append("Shipment &amp; price:")
    out.extend(ship_lines)
    out.append("")
    out.append("/quote basis=+50  — adjusts all rows")
    out.append("/quote basis=-140 eudr rfa bb")

    return "\n".join(out)
```

- [ ] **Step 4: Run tests**

```bash
cd backend && python -m pytest scraper/tests/test_telegram.py -k "quote" -v
```
Expected: all 4 quote tests pass.

- [ ] **Step 5: Smoke-test full output**

```bash
cd backend && python -c "from telegram.handlers.quote import handle; print(handle('','{}'))"
```
Expected: full quotation table with 8 shipment rows.

- [ ] **Step 6: Commit**

```bash
git add backend/telegram/handlers/quote.py backend/scraper/tests/test_telegram.py
git commit -m "feat(telegram): /quote handler with differential notation and add-ons"
```

---

## Task 9: handlers/run.py

**Files:**
- Create: `backend/telegram/handlers/run.py`

- [ ] **Step 1: Write run.py**

```python
from __future__ import annotations
import os
import requests

WORKFLOWS = {
    "prices":       "scraper-prices.yml",
    "cot":          "scraper-cot.yml",
    "cecafe":       "scraper-cecafe.yml",
    "kaffeesteuer": "scraper-kaffeesteuer.yml",
    "ecf":          "scraper-slow-data.yml",
    "brief":        "morning-brief.yml",
}
VALID_NAMES = ", ".join(sorted(WORKFLOWS))


def handle(args: str, context: dict) -> str:
    name = args.strip().lower().split()[0] if args.strip() else ""
    if name not in WORKFLOWS:
        return f"Unknown scraper. Options: {VALID_NAMES}"

    owner = os.environ.get("GH_OWNER", "")
    repo  = os.environ.get("GH_REPO", "")
    pat   = os.environ.get("GH_PAT", "")
    if not owner or not repo or not pat:
        return "GitHub credentials not configured (GH_OWNER, GH_REPO, GH_PAT)."

    workflow = WORKFLOWS[name]
    url = f"https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches"
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {pat}", "Accept": "application/vnd.github+json"},
            json={"ref": "main"},
            timeout=10,
        )
    except requests.Timeout:
        return "Trigger timed out. Try again."

    if resp.status_code == 204:
        return f"✓ Triggered {name} scraper. Results in ~2 min."
    return f"Failed to trigger (HTTP {resp.status_code}). Check GH_PAT and workflow name."
```

- [ ] **Step 2: Smoke-test import**

```bash
cd backend && python -c "from telegram.handlers.run import handle; print(handle('invalid','{}'))"
```
Expected: `"Unknown scraper. Options: brief, cecafe, cot, ecf, kaffeesteuer, prices"`

- [ ] **Step 3: Commit**

```bash
git add backend/telegram/handlers/run.py
git commit -m "feat(telegram): /run handler for GitHub Actions dispatch"
```

---

## Task 10: handlers/brief.py (new morning brief format)

**Files:**
- Create: `backend/telegram/handlers/brief.py`

Replaces the old `build_message()` in `morning_brief.py` with the redesigned scannable format.

- [ ] **Step 1: Write brief.py**

```python
from __future__ import annotations
import re
from datetime import UTC, datetime, timedelta
from telegram.data import load

STC = {1:"H",2:"H",3:"K",4:"K",5:"N",6:"N",7:"U",8:"U",9:"X",10:"X",11:"F",12:"F"}


def _arrow(a, b) -> str:
    if a is None or b is None:
        return "?"
    return "▲" if a > b else "▼" if a < b else "→"


def _rc_section(chain: dict | None) -> tuple[str, str | None, float | None]:
    """Returns (line, front_letter, front_price)."""
    if not chain:
        return "RC  data unavailable", None, None
    contracts = chain.get("robusta", {}).get("contracts", [])
    if not contracts:
        return "RC  data unavailable", None, None
    c = contracts[0]
    last  = c.get("last")
    prev  = c.get("prev") or c.get("settle")
    sym   = c.get("symbol", "?")
    m     = re.match(r'^RM([A-Z])', sym)
    letter = m.group(1) if m else "?"
    delta = last - prev if last and prev else None
    arrow = _arrow(last, prev)
    delta_s = f"{delta:+,.0f}" if delta is not None else ""
    return f"RC   {last:,.0f}  {arrow}{delta_s}   ({sym})", letter, last


def _kc_section(latest: dict | None) -> str:
    if not latest:
        return "KC  data unavailable"
    for t in latest.get("tickers", []):
        if t.get("label") == "KC":
            return f"KC   {t['value']}"
    # fallback: search for arabica futures in acaphe_live
    return "KC  data unavailable"


def _vn_faq_line(latest: dict | None, front_letter: str | None, front_price: float | None) -> str:
    if not latest:
        return ""
    for t in latest.get("tickers", []):
        if t.get("label") == "VN FAQ":
            val = t["value"]
            # Parse: "87.700 VND ($3,347)"
            m_vnd = re.match(r'^([\d.]+)\s+VND', val)
            m_usd = re.search(r'\$([0-9,]+)', val)
            if m_vnd and m_usd and front_price:
                vnd = int(m_vnd.group(1).replace(".", ""))
                usd = int(m_usd.group(1).replace(",", ""))
                diff = round(usd - front_price + 100)
                letter = front_letter or "N"
                return f"VN FAQ  {vnd:,} VND · {letter}{diff:+d} (incl. +100 logistics)"
            return f"VN FAQ  {val}"
    return ""


def _cot_brief_section(cot_data: list | None) -> str:
    if not cot_data:
        return ""
    # Find latest two rows with data
    latest = prev = None
    for row in reversed(cot_data):
        ny = row.get("ny", {})
        if ny.get("mm_long") is not None:
            if latest is None:
                latest = row
            elif prev is None:
                prev = row
                break
    if not latest:
        return ""

    date_str = latest["date"]
    # Format: "wk 20 May"
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        wk = d.strftime("%-d %b") if hasattr(d, 'strftime') else date_str
    except ValueError:
        wk = date_str

    lines = []
    for label, mkt_key, price_key, unit in [
        ("COT KC", "ny",  "price_ny",  "¢/lb"),
        ("COT RC", "ldn", "price_ldn", "USD/MT"),
    ]:
        cur = latest.get(mkt_key, {})
        prv = prev.get(mkt_key, {}) if prev else {}

        mm_long  = cur.get("mm_long")
        mm_short = cur.get("mm_short")
        if mm_long is None:
            lines.append(f"{label} ({wk}): data pending")
            continue

        mm_net   = mm_long - mm_short
        p_mm_net = (prv.get("mm_long", 0) or 0) - (prv.get("mm_short", 0) or 0) if prv else None
        wow_delta = mm_net - p_mm_net if p_mm_net is not None else None
        sign = "+" if mm_net >= 0 else ""

        price = cur.get(price_key)
        p_price = prv.get(price_key) if prv else None
        oi    = cur.get("oi_total")
        p_oi  = prv.get("oi_total") if prv else None
        prod_net = (cur.get("pmpu_long") or 0) - (cur.get("pmpu_short") or 0)
        p_prod = ((prv.get("pmpu_long") or 0) - (prv.get("pmpu_short") or 0)) if prv else None
        other_net = (cur.get("other_long") or 0) - (cur.get("other_short") or 0)
        p_other = ((prv.get("other_long") or 0) - (prv.get("other_short") or 0)) if prv else None

        price_s = f"{price:,.2f} {unit}" if price else "?"
        oi_s = f"{oi:,}" if oi else "?"

        lines.append(f"<b>{label}</b> (wk {wk}):")
        lines.append(f"Price {_arrow(price, p_price)} {price_s} · OI {_arrow(oi, p_oi)} {oi_s}")
        lines.append(f"Roasters {_arrow(other_net, p_other)} · Producers {_arrow(prod_net, p_prod)}")
        wow_s = f" {_arrow(mm_net, p_mm_net)}{'+' if (wow_delta or 0)>=0 else ''}{wow_delta:,}" if wow_delta is not None else ""
        lines.append(f"MM net {sign}{mm_net:,}{wow_s}")

    return "\n".join(lines)


def _brazil_brief_line(daily: dict | None) -> str:
    if not daily:
        return ""
    section = daily.get("arabica", {})
    if not section:
        return ""
    month = sorted(section.keys())[-1]
    days  = sorted(section[month].keys(), key=int)
    day   = days[-1]

    arab = section[month][day]
    con  = daily.get("conillon", {}).get(month, {}).get(day, 0) or 0
    sol  = daily.get("soluvel",  {}).get(month, {}).get(day, 0) or 0
    total = arab + con + sol

    # Prior month same day
    yr, mo = map(int, month.split("-"))
    mo -= 1
    if mo == 0:
        mo, yr = 12, yr - 1
    pm = f"{yr:04d}-{mo:02d}"
    day_int = int(day)

    def prior(key: str) -> int | None:
        s = daily.get(key, {}).get(pm, {})
        avail = sorted(s.keys(), key=int)
        best = next((d for d in reversed(avail) if int(d) <= day_int), None)
        return s[best] if best else None

    p_arab = prior("arabica")
    p_con  = prior("conillon")
    p_sol  = prior("soluvel")

    lines = [f"<b>Brazil daily reg</b> ({month}/{day}): {total:,} bags", "MoM:"]
    for label, cur, prev in [("Arabica",arab,p_arab), ("Conilon",con,p_con), ("Soluble",sol,p_sol)]:
        if prev is not None:
            d = cur - prev
            lines.append(f"  {_arrow(cur,prev)}{'+' if d>=0 else ''}{d:,} {label}")
        else:
            lines.append(f"  {label}: {cur:,}")
    return "\n".join(lines)


def _weather_line(supply_files: list[tuple[str, str]]) -> str:
    alerts = []
    for fname, country in supply_files:
        data = load(f"{fname}.json")
        if not data:
            continue
        weather = data.get("weather", {})
        for reg in weather.get("regions", []):
            if reg.get("drought") == "HIGH":
                alerts.append(f"{country}/{reg.get('name','?')} drought")
            if reg.get("csi_30d_level") == "HIGH":
                alerts.append(f"{country}/{reg.get('name','?')} CSI")
        enso = data.get("enso")
        if enso and enso.get("phase") not in (None, "neutral"):
            pass  # skip ENSO from brief for brevity
    return " · ".join(alerts[:3]) if alerts else ""


def build_brief_message(db=None) -> str:
    now = datetime.now(UTC)
    day_str = now.strftime("%a %-d %b") if hasattr(now, 'strftime') else now.strftime("%a %d %b")

    chain   = load("futures_chain.json")
    latest  = load("latest_prices.json")
    cot     = load("cot_recent.json")
    daily   = load("cecafe_daily.json")

    rc_line, front_letter, front_price = _rc_section(chain)
    kc_line = _kc_section(latest)
    vn_line = _vn_faq_line(latest, front_letter, front_price)
    cot_section = _cot_brief_section(cot if isinstance(cot, list) else None)
    brazil_section = _brazil_brief_line(daily if isinstance(daily, dict) else None)

    supply_files = [
        ("brazil_supply","Brazil"), ("vietnam_supply","Vietnam"),
        ("colombia_supply","Colombia"), ("honduras_supply","Honduras"),
        ("indonesia_supply","Indonesia"), ("ethiopia_supply","Ethiopia"),
    ]
    weather = _weather_line(supply_files)

    parts = [f"☕ <b>Coffee Intel · {day_str}</b>", ""]
    parts.append(rc_line)
    parts.append(kc_line)
    if vn_line:
        parts.append(vn_line)
    parts.append("")
    if cot_section:
        parts.append(cot_section)
        parts.append("")
    if brazil_section:
        parts.append(brazil_section)
        parts.append("")
    if weather:
        parts.append(weather)
        parts.append("")
    parts.append("/quote · /cot · /brazil · /ecf")

    return "\n".join(parts)


def handle(args: str, context: dict) -> str:
    return build_brief_message()
```

- [ ] **Step 2: Smoke-test**

```bash
cd backend && python -c "from telegram.handlers.brief import build_brief_message; print(build_brief_message())"
```
Expected: full brief output with actual data values.

- [ ] **Step 3: Commit**

```bash
git add backend/telegram/handlers/brief.py
git commit -m "feat(telegram): redesigned morning brief handler"
```

---

## Task 11: commands.py + router.py

**Files:**
- Create: `backend/telegram/commands.py`
- Create: `backend/telegram/router.py`

- [ ] **Step 1: Write commands.py**

```python
from __future__ import annotations
from telegram.handlers import (
    brief, cot, brazil, ecf, help as help_handler,
    kaffeesteuer, prices, quote, run
)

# Maps command name → handler function(args: str, context: dict) -> str
DISPATCH: dict[str, object] = {
    "brief":        brief.handle,
    "cot":          cot.handle,
    "brazil":       brazil.handle,
    "ecf":          ecf.handle,
    "help":         help_handler.handle,
    "kaffeesteuer": kaffeesteuer.handle,
    "prices":       prices.handle,
    "quote":        quote.handle,
    "run":          run.handle,
}
```

- [ ] **Step 2: Write router.py**

```python
from __future__ import annotations
import os
from fastapi import APIRouter, Request, Response
from telegram.auth import is_allowed
from telegram.sender import send_message
from telegram.commands import DISPATCH

router = APIRouter()


def _parse_command(text: str) -> tuple[str, str]:
    """Split '/command args' → ('command', 'args'). Strips bot username suffix."""
    text = text.strip()
    if not text.startswith("/"):
        return "", text
    parts = text[1:].split(None, 1)
    cmd = parts[0].split("@")[0].lower()  # strip @BotName if present
    args = parts[1] if len(parts) > 1 else ""
    return cmd, args


@router.post("/webhook")
async def webhook(request: Request):
    update = await request.json()

    if not is_allowed(update):
        return Response(status_code=200)

    message = update.get("message", {})
    text    = message.get("text", "")
    chat_id = message.get("chat", {}).get("id")

    if not text or not chat_id:
        return Response(status_code=200)

    cmd, args = _parse_command(text)

    if not cmd:
        return Response(status_code=200)

    handler = DISPATCH.get(cmd)
    if handler is None:
        reply = "Unknown command. /help for list."
    else:
        try:
            context = {"chat_id": chat_id, "message": message}
            reply = handler(args, context)
        except Exception as e:
            reply = f"Error: {e}"

    send_message(chat_id, reply)
    return Response(status_code=200)
```

- [ ] **Step 3: Add router test**

Add to `backend/scraper/tests/test_telegram.py`:
```python
def test_parse_command():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))
    from backend.telegram.router import _parse_command
    assert _parse_command("/quote basis=-140 eudr") == ("quote", "basis=-140 eudr")
    assert _parse_command("/help") == ("help", "")
    assert _parse_command("/quote@CoffeeBot basis=+50") == ("quote", "basis=+50")
    assert _parse_command("hello") == ("", "hello")
```

- [ ] **Step 4: Run tests**

```bash
cd backend && python -m pytest scraper/tests/test_telegram.py::test_parse_command -v
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/telegram/commands.py backend/telegram/router.py backend/scraper/tests/test_telegram.py
git commit -m "feat(telegram): command dispatch table and webhook router"
```

---

## Task 12: Refactor morning_brief.py

**Files:**
- Modify: `backend/scraper/morning_brief.py`

Replace `build_message()` with import from new `handlers/brief.py`. Keep `send_telegram()` in place for now (it calls the old sender pattern); the new `sender.py` is used by the router, not the cron path.

- [ ] **Step 1: Edit morning_brief.py**

Replace the `build_message` function and its private helpers with an import:

Remove lines 44–265 (all the section builders and `build_message`). Replace with:

```python
# ── Message builder (delegates to telegram handler) ───────────────────────────
def build_message(db=None) -> str:
    # Import here to avoid circular at module level when telegram/ is not on path
    import sys
    sys.path.insert(0, str(_REPO_ROOT / "backend"))
    from telegram.handlers.brief import build_brief_message
    return build_brief_message(db)
```

Keep `send_telegram()` and `main()` unchanged.

- [ ] **Step 2: Test the cron path still works**

```bash
cd backend && python -m scraper.morning_brief 2>&1 | head -30
```
Expected: brief printed to stdout (does not send Telegram without token).

- [ ] **Step 3: Commit**

```bash
git add backend/scraper/morning_brief.py
git commit -m "refactor(morning_brief): delegate to telegram/handlers/brief.py"
```

---

## Task 13: Register router in main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add router import and registration**

After the existing router imports, add:
```python
from telegram.router import router as telegram_router
```

After `app.include_router(futures_router)`, add:
```python
app.include_router(telegram_router, prefix="/telegram")
```

- [ ] **Step 2: Verify app starts**

```bash
cd backend && python -c "from main import app; print([r.path for r in app.routes])" 2>&1 | head -5
```
Expected: `/telegram/webhook` in the list.

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(telegram): register webhook router in FastAPI app"
```

---

## Task 14: setup.py (webhook registration)

**Files:**
- Create: `backend/telegram/setup.py`

- [ ] **Step 1: Write setup.py**

```python
"""
One-time webhook registration.
Run: python -m telegram.setup
Requires: TELEGRAM_BOT_TOKEN, BACKEND_PUBLIC_URL env vars.
"""
import os
import requests

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
URL   = os.environ["BACKEND_PUBLIC_URL"]

webhook_url = f"{URL.rstrip('/')}/telegram/webhook"
resp = requests.post(
    f"https://api.telegram.org/bot{TOKEN}/setWebhook",
    json={"url": webhook_url},
    timeout=10,
)
print(f"setWebhook → {resp.status_code}: {resp.json()}")
```

- [ ] **Step 2: Commit**

```bash
git add backend/telegram/setup.py
git commit -m "feat(telegram): webhook registration script"
```

---

## Task 15: Run full test suite + push

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && python -m pytest scraper/tests/test_telegram.py -v
```
Expected: all tests pass.

- [ ] **Step 2: Run existing backend tests to check no regressions**

```bash
cd backend && python -m pytest tests/ -v --tb=short 2>&1 | tail -20
```
Expected: no new failures.

- [ ] **Step 3: Final commit + push**

```bash
git add -p  # verify nothing unintended staged
git push origin main
```

---

## Post-Deploy Checklist (manual steps after Render redeploy)

1. Set new env vars on Render:
   - `GH_PAT` — fine-grained GitHub PAT (Actions:write)
   - `GH_OWNER` — `loicscanu`
   - `GH_REPO` — `Coffee-intel-map`
   - `TELEGRAM_ALLOWED_IDS` — your Telegram chat ID
   - `BACKEND_PUBLIC_URL` — your Render service URL

2. Register webhook (run once after deploy):
```bash
TELEGRAM_BOT_TOKEN=xxx BACKEND_PUBLIC_URL=https://your-app.onrender.com python -m telegram.setup
```

3. Test by sending `/help` in Telegram — expect command list.

4. Test `/quote` — expect quotation table.

5. Test `/run brief` — expect confirmation message + brief arrives ~30s later.
