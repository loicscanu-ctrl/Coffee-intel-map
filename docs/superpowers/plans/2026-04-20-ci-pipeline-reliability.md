# CI/CD Pipeline Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the data pipeline robust by consolidating DB-backed JSON exports into a single daily workflow, adding per-file data validation, and adding retry loops to all scrapers.

**Architecture:** A new `export-and-publish.yml` workflow owns all DB-backed JSON commits (futures, COT, freight, farmer economics). DB-backed scraper workflows are stripped of their export/commit steps. Direct-write scrapers (OI, Cecafe, quant, earnings, kaffeesteuer) keep their own commit steps but gain a 3-attempt retry loop and a data validation gate that restores the old JSON if the new one is bad. A shared `validate_export.py` module contains all per-file validation logic. A frontend hook `useDataFreshness` powers a staleness badge on any panel with a timestamp.

**Tech Stack:** Python 3.11, GitHub Actions, Next.js 14 (React hook), TypeScript

---

## File map

| File | Action |
|---|---|
| `backend/scraper/validate_export.py` | **Create** — per-file validators + `safe_write_json` helper |
| `backend/scraper/tests/test_validate_export.py` | **Create** — unit tests for every validator |
| `backend/scraper/export_static_json.py` | **Modify** — use `safe_write_json` in each export function |
| `.github/workflows/export-and-publish.yml` | **Create** — single daily export+commit for DB-backed JSON |
| `.github/workflows/scraper-daily.yml` | **Modify** — remove export+commit steps, add retry to scrape |
| `.github/workflows/scraper-monthly.yml` | **Modify** — remove export+commit steps, add retry to scrape |
| `.github/workflows/scraper-cot.yml` | **Modify** — remove export+commit steps, add retry to scrape steps |
| `.github/workflows/daily_oi.yml` | **Modify** — add retry + validation gate |
| `.github/workflows/quant-currency-index.yml` | **Modify** — add retry + validation gate |
| `.github/workflows/scraper-cecafe-daily.yml` | **Modify** — add retry + validation gate |
| `.github/workflows/scraper-earnings.yml` | **Modify** — add retry + validation gate |
| `.github/workflows/scraper-kaffeesteuer.yml` | **Modify** — add retry + validation gate |
| `frontend/lib/useDataFreshness.ts` | **Create** — staleness hook |
| `frontend/components/supply/farmer-economics/FertilizerPanel.tsx` | **Modify** — add staleness badge wired to `scraped_at` |

---

## Task 1: Create `validate_export.py` with all validators

**Files:**
- Create: `backend/scraper/validate_export.py`
- Test: `backend/scraper/tests/test_validate_export.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/scraper/tests/test_validate_export.py`:

```python
"""Tests for validate_export.py — each validator has a passing and a failing case."""
import pytest
from datetime import date, timedelta


def today_str():
    return date.today().isoformat()


def old_date_str():
    return (date.today() - timedelta(days=30)).isoformat()


# ── futures_chain ─────────────────────────────────────────────────────────────

def test_validate_futures_chain_passes():
    from scraper.validate_export import validate_futures_chain
    good = {
        "arabica": {"pub_date": today_str(), "contracts": [{}] * 6},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, reason = validate_futures_chain(good)
    assert ok, reason


def test_validate_futures_chain_missing_robusta():
    from scraper.validate_export import validate_futures_chain
    bad = {"arabica": {"pub_date": today_str(), "contracts": [{}] * 6}}
    ok, _ = validate_futures_chain(bad)
    assert not ok


def test_validate_futures_chain_stale():
    from scraper.validate_export import validate_futures_chain
    bad = {
        "arabica": {"pub_date": old_date_str(), "contracts": [{}] * 6},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, _ = validate_futures_chain(bad)
    assert not ok


def test_validate_futures_chain_too_few_contracts():
    from scraper.validate_export import validate_futures_chain
    bad = {
        "arabica": {"pub_date": today_str(), "contracts": [{}] * 3},
        "robusta": {"pub_date": today_str(), "contracts": [{}] * 6},
    }
    ok, _ = validate_futures_chain(bad)
    assert not ok


# ── farmer_economics ──────────────────────────────────────────────────────────

def test_validate_farmer_economics_passes():
    from scraper.validate_export import validate_farmer_economics
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    good = {
        "weather": {"regions": []},
        "fertilizer": {"items": [{"name": "Urea"}]},
        "scraped_at": now,
    }
    ok, reason = validate_farmer_economics(good)
    assert ok, reason


def test_validate_farmer_economics_null_weather():
    from scraper.validate_export import validate_farmer_economics
    bad = {"weather": None, "fertilizer": {"items": [{}]}, "scraped_at": "2099-01-01T00:00:00Z"}
    ok, _ = validate_farmer_economics(bad)
    assert not ok


def test_validate_farmer_economics_empty_fertilizer():
    from scraper.validate_export import validate_farmer_economics
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    bad = {"weather": {"regions": []}, "fertilizer": {"items": []}, "scraped_at": now}
    ok, _ = validate_farmer_economics(bad)
    assert not ok


# ── cot ───────────────────────────────────────────────────────────────────────

def test_validate_cot_passes():
    from scraper.validate_export import validate_cot
    good = [{"date": today_str(), "ny": {}, "ldn": {}}]
    ok, reason = validate_cot(good)
    assert ok, reason


def test_validate_cot_empty():
    from scraper.validate_export import validate_cot
    ok, _ = validate_cot([])
    assert not ok


def test_validate_cot_stale():
    from scraper.validate_export import validate_cot
    bad = [{"date": old_date_str()}]
    ok, _ = validate_cot(bad)
    assert not ok


# ── macro_cot ─────────────────────────────────────────────────────────────────

def test_validate_macro_cot_passes():
    from scraper.validate_export import validate_macro_cot
    ok, reason = validate_macro_cot([{"date": today_str()}])
    assert ok, reason


def test_validate_macro_cot_empty():
    from scraper.validate_export import validate_macro_cot
    ok, _ = validate_macro_cot([])
    assert not ok


# ── freight ───────────────────────────────────────────────────────────────────

def test_validate_freight_passes():
    from scraper.validate_export import validate_freight
    ok, reason = validate_freight({"routes": [{"name": "Santos-Hamburg"}], "history": []})
    assert ok, reason


def test_validate_freight_empty_routes():
    from scraper.validate_export import validate_freight
    ok, _ = validate_freight({"routes": [], "history": []})
    assert not ok


# ── oi_fnd_chart ──────────────────────────────────────────────────────────────

def test_validate_oi_fnd_chart_passes():
    from scraper.validate_export import validate_oi_fnd_chart
    ok, reason = validate_oi_fnd_chart({"arabica": [], "robusta": []})
    assert ok, reason


def test_validate_oi_fnd_chart_missing_key():
    from scraper.validate_export import validate_oi_fnd_chart
    ok, _ = validate_oi_fnd_chart({"arabica": []})
    assert not ok


# ── oi_history ────────────────────────────────────────────────────────────────

def test_validate_oi_history_passes():
    from scraper.validate_export import validate_oi_history
    ok, reason = validate_oi_history({"arabica": [{"date": today_str()}], "robusta": [{"date": today_str()}]})
    assert ok, reason


def test_validate_oi_history_empty():
    from scraper.validate_export import validate_oi_history
    ok, _ = validate_oi_history({"arabica": [], "robusta": [{"date": today_str()}]})
    assert not ok


# ── quant_report ──────────────────────────────────────────────────────────────

def test_validate_quant_report_passes():
    from scraper.validate_export import validate_quant_report
    ok, reason = validate_quant_report({"currency_index": [{"brl": 5.1}], "scraped_at": "2026-04-20"})
    assert ok, reason


def test_validate_quant_report_empty():
    from scraper.validate_export import validate_quant_report
    ok, _ = validate_quant_report({"currency_index": []})
    assert not ok


# ── cecafe_daily ──────────────────────────────────────────────────────────────

def test_validate_cecafe_daily_passes():
    from scraper.validate_export import validate_cecafe_daily
    ok, reason = validate_cecafe_daily({"updated": today_str(), "arabica": {"2026-04": 1000}, "conillon": {}})
    assert ok, reason


def test_validate_cecafe_daily_empty():
    from scraper.validate_export import validate_cecafe_daily
    ok, _ = validate_cecafe_daily({"updated": today_str(), "arabica": {}, "conillon": {}})
    assert not ok


# ── earnings ──────────────────────────────────────────────────────────────────

def test_validate_earnings_passes():
    from scraper.validate_export import validate_earnings
    ok, reason = validate_earnings({"scraped_at": today_str(), "companies": [{"ticker": "CAFE"}]})
    assert ok, reason


def test_validate_earnings_empty():
    from scraper.validate_export import validate_earnings
    ok, _ = validate_earnings({"scraped_at": today_str(), "companies": []})
    assert not ok


# ── kaffeesteuer ──────────────────────────────────────────────────────────────

def test_validate_kaffeesteuer_passes():
    from scraper.validate_export import validate_kaffeesteuer
    ok, reason = validate_kaffeesteuer({"2025-01": 12345, "2025-02": 11000})
    assert ok, reason


def test_validate_kaffeesteuer_empty():
    from scraper.validate_export import validate_kaffeesteuer
    ok, _ = validate_kaffeesteuer({})
    assert not ok


# ── safe_write_json ───────────────────────────────────────────────────────────

def test_safe_write_json_writes_on_pass(tmp_path):
    from scraper.validate_export import safe_write_json, validate_macro_cot
    dest = tmp_path / "macro_cot.json"
    result = safe_write_json(dest, [{"date": "2026-04-01"}], validate_macro_cot)
    assert result is True
    assert dest.exists()


def test_safe_write_json_keeps_old_on_fail(tmp_path):
    import json
    from scraper.validate_export import safe_write_json, validate_macro_cot
    dest = tmp_path / "macro_cot.json"
    dest.write_text(json.dumps([{"date": "2026-01-01"}]))
    result = safe_write_json(dest, [], validate_macro_cot)  # empty list fails
    assert result is False
    data = json.loads(dest.read_text())
    assert data == [{"date": "2026-01-01"}]   # old data preserved
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python -m pytest scraper/tests/test_validate_export.py -v 2>&1 | head -30
```

Expected: `ImportError` or `ModuleNotFoundError` — `validate_export` doesn't exist yet.

- [ ] **Step 3: Create `backend/scraper/validate_export.py`**

```python
"""
validate_export.py
Per-file validation for static JSON exports.

Each validate_* function receives the in-memory payload and returns
(passed: bool, reason: str).  Called by safe_write_json before any write.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import json


# ── helpers ───────────────────────────────────────────────────────────────────

def _days_since_iso(iso_str: str) -> float:
    """Hours since an ISO-8601 datetime string (handles Z and +00:00)."""
    try:
        s = iso_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 86400
    except Exception:
        return float("inf")


def _days_since_date(date_str: str) -> int:
    """Days since a YYYY-MM-DD date string."""
    try:
        return (date.today() - date.fromisoformat(date_str)).days
    except Exception:
        return 9999


# ── validators ────────────────────────────────────────────────────────────────

def validate_futures_chain(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    for market in ("arabica", "robusta"):
        if data.get(market) is None:
            return False, f"missing {market}"
        contracts = data[market].get("contracts", [])
        if len(contracts) < 5:
            return False, f"{market} has {len(contracts)} contracts (need ≥ 5)"
        pub_date = data[market].get("pub_date")
        if pub_date and _days_since_date(pub_date) > 7:
            return False, f"{market} pub_date {pub_date} is > 7 days old"
    return True, "ok"


def validate_farmer_economics(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if data.get("weather") is None:
        return False, "weather is null"
    items = (data.get("fertilizer") or {}).get("items", [])
    if not items:
        return False, "fertilizer.items is empty"
    scraped_at = data.get("scraped_at")
    if scraped_at and _days_since_iso(scraped_at) > 2:
        return False, f"scraped_at {scraped_at} is > 48 h old"
    return True, "ok"


def validate_cot(data: list) -> tuple[bool, str]:
    if not isinstance(data, list) or len(data) == 0:
        return False, "empty list"
    report_date = data[-1].get("date") or data[-1].get("report_date")
    if report_date and _days_since_date(report_date) > 14:
        return False, f"most recent date {report_date} is > 14 days old"
    return True, "ok"


def validate_macro_cot(data: list) -> tuple[bool, str]:
    if not isinstance(data, list) or len(data) == 0:
        return False, "empty list"
    return True, "ok"


def validate_freight(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if not data.get("routes"):
        return False, "routes list is empty"
    return True, "ok"


def validate_oi_fnd_chart(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    for market in ("arabica", "robusta"):
        if market not in data:
            return False, f"missing {market}"
    return True, "ok"


def validate_oi_history(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    for market in ("arabica", "robusta"):
        rows = data.get(market) or []
        if not rows:
            return False, f"{market} rows are empty"
    return True, "ok"


def validate_quant_report(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if not data.get("currency_index"):
        return False, "currency_index is empty"
    return True, "ok"


def validate_cecafe_daily(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    arabica = data.get("arabica") or {}
    conillon = data.get("conillon") or {}
    if not arabica and not conillon:
        return False, "no arabica or conillon data"
    return True, "ok"


def validate_earnings(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if not data.get("companies"):
        return False, "companies list is empty"
    return True, "ok"


def validate_kaffeesteuer(data: dict) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "not a dict"
    if len(data) == 0:
        return False, "empty dict — no monthly records"
    return True, "ok"


# ── write helper ──────────────────────────────────────────────────────────────

def safe_write_json(path, payload, validate_fn, indent: int = 2) -> bool:
    """
    Validate payload then write to path atomically via a .tmp file.

    Returns True if written, False if validation failed.
    On failure the existing file at `path` is left untouched.
    """
    ok, reason = validate_fn(payload)
    if not ok:
        name = Path(path).name
        print(f"[validate] {name} FAILED: {reason} — keeping existing file")
        return False

    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(payload, indent=indent), encoding="utf-8")
    tmp.replace(path)
    return True
```

- [ ] **Step 4: Run tests — all should pass**

```bash
cd backend
python -m pytest scraper/tests/test_validate_export.py -v
```

Expected: all green. If any fail, fix the validator logic (not the tests).

- [ ] **Step 5: Commit**

```bash
git add backend/scraper/validate_export.py backend/scraper/tests/test_validate_export.py
git commit -m "feat: add per-file JSON export validators and safe_write_json helper"
```

---

## Task 2: Integrate validation into `export_static_json.py`

**Files:**
- Modify: `backend/scraper/export_static_json.py`

Context: The file has 7 export functions. Each currently writes its JSON file with `with open(path, "w") as f: json.dump(result, f, indent=2)`. We replace each with a `safe_write_json` call. The import goes at the top of the file.

- [ ] **Step 1: Add import at the top of `export_static_json.py`**

In `backend/scraper/export_static_json.py`, after the existing imports block (around line 36), add:

```python
from scraper.validate_export import (
    safe_write_json,
    validate_futures_chain,
    validate_oi_fnd_chart,
    validate_cot,
    validate_macro_cot,
    validate_freight,
    validate_farmer_economics,
)
```

- [ ] **Step 2: Replace the write in `export_futures_chain`**

Find (around line 117):
```python
    path = OUT_DIR / "futures_chain.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  futures_chain.json → arabica:{result['arabica'] is not None} robusta:{result['robusta'] is not None}")
```

Replace with:
```python
    path = OUT_DIR / "futures_chain.json"
    written = safe_write_json(path, result, validate_futures_chain)
    print(f"  futures_chain.json → written:{written} arabica:{result['arabica'] is not None} robusta:{result['robusta'] is not None}")
```

- [ ] **Step 3: Replace the write in `export_oi_fnd_chart`**

Find (around line 183):
```python
    path = OUT_DIR / "oi_fnd_chart.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  oi_fnd_chart.json → arabica:{len(result['arabica'])} robusta:{len(result['robusta'])} series")
```

Replace with:
```python
    path = OUT_DIR / "oi_fnd_chart.json"
    written = safe_write_json(path, result, validate_oi_fnd_chart)
    print(f"  oi_fnd_chart.json → written:{written} arabica:{len(result['arabica'])} robusta:{len(result['robusta'])} series")
```

- [ ] **Step 4: Replace the write in `export_cot`**

Find (around line 251):
```python
    path = OUT_DIR / "cot.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  cot.json → {len(result)} weeks")
```

Replace with:
```python
    path = OUT_DIR / "cot.json"
    written = safe_write_json(path, result, validate_cot)
    print(f"  cot.json → written:{written} {len(result)} weeks")
```

- [ ] **Step 5: Replace the write in `export_macro_cot`**

Find (around line 313):
```python
    path = OUT_DIR / "macro_cot.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  macro_cot.json → {len(result)} weeks")
```

Replace with:
```python
    path = OUT_DIR / "macro_cot.json"
    written = safe_write_json(path, result, validate_macro_cot)
    print(f"  macro_cot.json → written:{written} {len(result)} weeks")
```

- [ ] **Step 6: Replace the write in `export_freight`**

Find (around line 402):
```python
    path = OUT_DIR / "freight.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  freight.json → {len(result.get('routes', []))} routes, {len(result.get('history', []))} history rows")
```

Replace with:
```python
    path = OUT_DIR / "freight.json"
    written = safe_write_json(path, result, validate_freight)
    print(f"  freight.json → written:{written} {len(result.get('routes', []))} routes, {len(result.get('history', []))} history rows")
```

- [ ] **Step 7: Replace the write in `export_farmer_economics`**

Find (around line 920):
```python
    path = OUT_DIR / "farmer_economics.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  farmer_economics.json → cost:{cost_out is not None} weather:{weather_out is not None} enso:{enso_out is not None}")
```

Replace with:
```python
    path = OUT_DIR / "farmer_economics.json"
    written = safe_write_json(path, result, validate_farmer_economics)
    print(f"  farmer_economics.json → written:{written} cost:{cost_out is not None} weather:{weather_out is not None} enso:{enso_out is not None}")
```

- [ ] **Step 8: Verify the existing tests still pass**

```bash
cd backend
python -m pytest scraper/tests/ -v --ignore=scraper/tests/test_validate_export.py -x -q 2>&1 | tail -20
```

Expected: no regressions (any pre-existing failures are not your problem — only check you haven't broken passing tests).

- [ ] **Step 9: Smoke-test the export script locally**

```bash
cd backend
python -m scraper.export_static_json 2>&1 | grep -E "written:|FAILED|Done"
```

Expected: each file line shows `written:True`. No `FAILED` lines.

- [ ] **Step 10: Commit**

```bash
git add backend/scraper/export_static_json.py
git commit -m "feat: guard all static JSON writes with data validation"
```

---

## Task 3: Create `export-and-publish.yml`

**Files:**
- Create: `.github/workflows/export-and-publish.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Export and Publish Static JSON

on:
  schedule:
    - cron: '0 4 * * *'   # 04:00 UTC daily — 3 h after scraper-daily (01:00 UTC)
  workflow_dispatch:        # allow manual trigger from GitHub UI

jobs:
  export:
    runs-on: ubuntu-22.04
    timeout-minutes: 15
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Python dependencies
        working-directory: backend
        run: pip install -r scraper/requirements.txt pandas requests python-dotenv openpyxl

      - name: Export static JSON files
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: python -m scraper.export_static_json

      - name: Commit updated static JSON if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add frontend/public/data/futures_chain.json \
                  frontend/public/data/oi_fnd_chart.json \
                  frontend/public/data/cot.json \
                  frontend/public/data/macro_cot.json \
                  frontend/public/data/freight.json \
                  frontend/public/data/farmer_economics.json
          git diff --cached --quiet \
            && echo "No changes." \
            || (git commit -m "data: update static JSON [skip ci]" && git pull --rebase origin main && git push)
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/export-and-publish.yml
git commit -m "feat: add export-and-publish workflow (single daily JSON commit)"
```

---

## Task 4: Strip export+commit from DB-backed scraper workflows

**Files:**
- Modify: `.github/workflows/scraper-daily.yml`
- Modify: `.github/workflows/scraper-monthly.yml`
- Modify: `.github/workflows/scraper-cot.yml`

These workflows must no longer export or commit JSON. They just scrape to DB and exit. We also add a retry loop to each scrape step so transient failures auto-recover.

- [ ] **Step 1: Rewrite `scraper-daily.yml`**

Replace the full file content with:

```yaml
name: Daily News Scraper

on:
  schedule:
    - cron: '0 1 * * *'  # 01:00 UTC daily
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-22.04
    timeout-minutes: 30
    permissions:
      contents: read

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

      - name: Run daily scraper (3 attempts)
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          for attempt in 1 2 3; do
            python -m scraper.run_daily && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done
```

- [ ] **Step 2: Rewrite `scraper-monthly.yml`**

Replace the full file content with:

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
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Python dependencies
        working-directory: backend
        run: pip install -r scraper/requirements.txt pandas requests yfinance python-dotenv openpyxl xlrd

      - name: Install Playwright browser
        run: playwright install chromium --with-deps

      - name: Run monthly scraper (3 attempts)
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          for attempt in 1 2 3; do
            python -m scraper.run_monthly && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done
```

- [ ] **Step 3: Rewrite `scraper-cot.yml`**

Replace the full file content with:

```yaml
name: COT Scraper (Positions + Prices)

on:
  schedule:
    - cron: '0 20 * * 5'  # 20:00 UTC Friday
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Python dependencies
        working-directory: backend
        run: pip install sqlalchemy psycopg2-binary pandas requests yfinance python-dotenv

      - name: Run macro COT scraper (3 attempts)
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          for attempt in 1 2 3; do
            python -m scraper.run_cot && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done

      - name: Run Coffee COT scraper (3 attempts)
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          for attempt in 1 2 3; do
            python -m scraper.run_cot_coffee && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scraper-daily.yml \
        .github/workflows/scraper-monthly.yml \
        .github/workflows/scraper-cot.yml
git commit -m "refactor: strip export+commit from DB-backed scrapers, add retry loops"
```

---

## Task 5: Add retry + data guard to direct-write workflows

**Files:**
- Modify: `.github/workflows/daily_oi.yml`
- Modify: `.github/workflows/quant-currency-index.yml`
- Modify: `.github/workflows/scraper-cecafe-daily.yml`
- Modify: `.github/workflows/scraper-earnings.yml`
- Modify: `.github/workflows/scraper-kaffeesteuer.yml`

The data guard pattern for direct-write workflows: after the scrape step, run a Python one-liner that validates the output JSON. If validation fails, `git checkout -- <file>` restores the old version — then the commit step finds nothing staged and skips. If all 3 retries fail, `exit 1` fails the workflow loudly.

- [ ] **Step 1: Rewrite `daily_oi.yml`**

```yaml
name: Daily OI Snapshot

on:
  schedule:
    - cron: "0 2 * * 1-5"   # 02:00 UTC Mon–Fri
  workflow_dispatch:

jobs:
  fetch-oi:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          pip install playwright
          playwright install chromium --with-deps

      - name: Fetch OI (3 attempts)
        run: |
          for attempt in 1 2 3; do
            python backend/scraper/fetch_oi_json.py && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done

      - name: Copy OI history to frontend
        run: cp data/oi_history.json frontend/public/data/oi_history.json

      - name: Validate output
        run: |
          python -c "
          import json, sys, subprocess
          sys.path.insert(0, 'backend')
          from scraper.validate_export import validate_oi_history
          data = json.load(open('frontend/public/data/oi_history.json'))
          ok, reason = validate_oi_history(data)
          if not ok:
              print(f'[validate] oi_history.json FAILED: {reason} — restoring HEAD version')
              subprocess.run(['git', 'checkout', '--', 'data/oi_history.json', 'frontend/public/data/oi_history.json'])
          "

      - name: Commit updated OI data
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/oi_history.json frontend/public/data/oi_history.json
          git diff --cached --quiet \
            && echo "No changes." \
            || (git commit -m "chore: daily OI snapshot $(date -u +%Y-%m-%d) [skip ci]" && git pull --rebase origin main && git push)
```

- [ ] **Step 2: Rewrite `quant-currency-index.yml`**

```yaml
name: Quant – Coffee Currency Index

on:
  schedule:
    - cron: "30 21 * * 1-5"  # 21:30 UTC Mon–Fri
  workflow_dispatch:

jobs:
  compute:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: pip install yfinance pandas numpy

      - name: Run Currency Index scraper (3 attempts)
        run: |
          for attempt in 1 2 3; do
            python -m backend.scraper.quant_model.fetch_currency_index && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done

      - name: Validate output
        run: |
          python -c "
          import json, sys, subprocess
          sys.path.insert(0, 'backend')
          from scraper.validate_export import validate_quant_report
          data = json.load(open('frontend/public/data/quant_report.json'))
          ok, reason = validate_quant_report(data)
          if not ok:
              print(f'[validate] quant_report.json FAILED: {reason} — restoring HEAD version')
              subprocess.run(['git', 'checkout', '--', 'frontend/public/data/quant_report.json'])
          "

      - name: Commit updated JSON if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add frontend/public/data/quant_report.json
          git diff --cached --quiet \
            && echo "No changes." \
            || (git commit -m "data: update quant_report.json [skip ci]" && git pull --rebase origin main && git push)
```

- [ ] **Step 3: Rewrite `scraper-cecafe-daily.yml`**

```yaml
name: Cecafe Daily Registration Scraper

on:
  schedule:
    - cron: '0 9 * * *'  # 09:00 UTC daily
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install pdfplumber

      - name: Run Cecafe scraper (3 attempts)
        run: |
          for attempt in 1 2 3; do
            python -m backend.scraper.fetch_cecafe_daily && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done

      - name: Validate output
        run: |
          python -c "
          import json, sys, subprocess
          sys.path.insert(0, 'backend')
          from scraper.validate_export import validate_cecafe_daily
          data = json.load(open('frontend/public/data/cecafe_daily.json'))
          ok, reason = validate_cecafe_daily(data)
          if not ok:
              print(f'[validate] cecafe_daily.json FAILED: {reason} — restoring HEAD version')
              subprocess.run(['git', 'checkout', '--', 'frontend/public/data/cecafe_daily.json'])
          "

      - name: Commit updated JSON if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add frontend/public/data/cecafe_daily.json
          git diff --cached --quiet \
            && echo "No changes." \
            || (git commit -m "data: cecafe daily registration $(date -u +%Y-%m-%d) [skip ci]" && git pull --rebase origin main && git push)
```

- [ ] **Step 4: Rewrite `scraper-earnings.yml`**

```yaml
name: Scraper – Earnings

on:
  schedule:
    - cron: "0 8 15 2,5,8,11 *"  # quarterly
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: pip install yfinance pandas

      - name: Run earnings scraper (3 attempts)
        run: |
          for attempt in 1 2 3; do
            python backend/scraper/fetch_earnings.py && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done

      - name: Validate output
        run: |
          python -c "
          import json, sys, subprocess
          sys.path.insert(0, 'backend')
          from scraper.validate_export import validate_earnings
          data = json.load(open('frontend/public/data/earnings.json'))
          ok, reason = validate_earnings(data)
          if not ok:
              print(f'[validate] earnings.json FAILED: {reason} — restoring HEAD version')
              subprocess.run(['git', 'checkout', '--', 'frontend/public/data/earnings.json'])
          "

      - name: Commit updated JSON if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add frontend/public/data/earnings.json
          git diff --cached --quiet \
            && echo "No changes." \
            || (git commit -m "data: update earnings.json [skip ci]" && git pull --rebase origin main && git push)
```

- [ ] **Step 5: Rewrite `scraper-kaffeesteuer.yml`**

```yaml
name: Scraper – Kaffeesteuer

on:
  schedule:
    - cron: "0 8 1 * *"  # 1st of each month at 08:00 UTC
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: pip install requests pdfplumber beautifulsoup4 lxml

      - name: Run Kaffeesteuer scraper (3 attempts)
        run: |
          for attempt in 1 2 3; do
            python backend/scraper/fetch_kaffeesteuer.py && break
            [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
          done

      - name: Validate output
        run: |
          python -c "
          import json, sys, subprocess
          sys.path.insert(0, 'backend')
          from scraper.validate_export import validate_kaffeesteuer
          data = json.load(open('frontend/public/data/kaffeesteuer.json'))
          ok, reason = validate_kaffeesteuer(data)
          if not ok:
              print(f'[validate] kaffeesteuer.json FAILED: {reason} — restoring HEAD version')
              subprocess.run(['git', 'checkout', '--', 'frontend/public/data/kaffeesteuer.json'])
          "

      - name: Commit updated JSON if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add frontend/public/data/kaffeesteuer.json
          git diff --cached --quiet \
            && echo "No changes — JSON already up to date." \
            || (git commit -m "data: update kaffeesteuer.json [skip ci]" && git pull --rebase origin main && git push)
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/daily_oi.yml \
        .github/workflows/quant-currency-index.yml \
        .github/workflows/scraper-cecafe-daily.yml \
        .github/workflows/scraper-earnings.yml \
        .github/workflows/scraper-kaffeesteuer.yml
git commit -m "feat: add retry loops and data validation guard to direct-write workflows"
```

---

## Task 6: Frontend staleness hook and badge

**Files:**
- Create: `frontend/lib/useDataFreshness.ts`
- Modify: `frontend/components/supply/farmer-economics/FertilizerPanel.tsx`

- [ ] **Step 1: Create `frontend/lib/useDataFreshness.ts`**

```typescript
/**
 * useDataFreshness
 * Returns "ok" | "stale" | "unknown" based on how old a timestamp is.
 *
 * Usage:
 *   const status = useDataFreshness(data.scraped_at, 48)
 *   if (status === "stale") show amber badge
 */
"use client";
import { useMemo } from "react";

export type FreshnessStatus = "ok" | "stale" | "unknown";

export function useDataFreshness(
  isoTimestamp: string | null | undefined,
  thresholdHours: number,
): FreshnessStatus {
  return useMemo(() => {
    if (!isoTimestamp) return "unknown";
    const parsed = Date.parse(isoTimestamp);
    if (isNaN(parsed)) return "unknown";
    const hoursOld = (Date.now() - parsed) / 3_600_000;
    return hoursOld > thresholdHours ? "stale" : "ok";
  }, [isoTimestamp, thresholdHours]);
}
```

- [ ] **Step 2: Add staleness badge to `FertilizerPanel.tsx`**

In `frontend/components/supply/farmer-economics/FertilizerPanel.tsx`, add the import at the top (after existing imports):

```typescript
import { useDataFreshness } from "@/lib/useDataFreshness";
```

Inside `FertilizerPanel`, before the return statement, add:

```typescript
  const freshness = useDataFreshness(fertilizer.prices_as_of ?? undefined, 48);
```

In the panel header JSX, find the `prices_as_of` span and extend it:

```tsx
        {fertilizer.prices_as_of && (
          <span className="text-[8px] text-slate-600 normal-case font-normal flex items-center gap-1">
            {freshness === "stale" && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400"
                title={`Data may be stale (last: ${fertilizer.prices_as_of})`}
              />
            )}
            Comex Stat · FOB implied · {fertilizer.prices_as_of}
          </span>
        )}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to these files).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/useDataFreshness.ts \
        frontend/components/supply/farmer-economics/FertilizerPanel.tsx
git commit -m "feat: add useDataFreshness hook and staleness badge to FertilizerPanel"
```

---

## Final push

```bash
git pull --rebase origin main && git push
```
