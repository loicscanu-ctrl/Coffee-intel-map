# CI/CD Pipeline Reliability Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Problem

The current GitHub Actions data pipeline has three failure modes:

1. **Git push race condition** — every workflow does `checkout → scrape → commit → push`. If a manual commit or another workflow has pushed between checkout and push, the push is rejected silently. The `&&` chaining means `git push` is swallowed by the shell's short-circuit evaluation and the workflow exits 0. *(Partially mitigated: `git pull --rebase` has been added to all workflows as of 2026-04-20, but the fundamental multi-committer structure remains.)*

2. **Silent bad data** — if a data source is down or returns a partial/malformed page, the scraper may write empty or invalid data to the DB or directly to the JSON file. The workflow turns green but the dashboard regresses.

3. **No alerting** — failures are discovered by the user checking the UI in the morning. There is no proactive signal.

---

## Design

### Architecture split

Scrapers are divided into two categories based on how they produce output:

**DB-backed scrapers** (write to Postgres, export via `export_static_json.py`):
- `scraper-daily` — futures chain, OI FND, freight, farmer economics weather/ENSO
- `scraper-monthly` — CONAB acreage/yield, Comex Stat fertilizer imports
- `scraper-cot` — COT positions + prices (CFTC + ICE Robusta)

**Direct-write scrapers** (write JSON without a DB intermediary):
- `daily_oi` — OI history (Playwright → `oi_history.json`)
- `quant-currency-index` — coffee currency index (yfinance → `quant_report.json`)
- `scraper-cecafe-daily` — Cecafe daily registrations (PDF → `cecafe_daily.json`)
- `scraper-earnings` — quarterly earnings (yfinance → `earnings.json`)
- `scraper-kaffeesteuer` — German coffee tax (→ `kaffeesteuer.json`)

### Solution per category

**DB-backed scrapers → consolidate export into one workflow**

Each DB-backed workflow is stripped of its export and commit steps. A new `export-and-publish.yml` workflow runs at 04:00 UTC (3 h after `scraper-daily` starts), reads the DB, validates each JSON file, and makes a single commit+push per day. Zero git conflicts by construction.

**Direct-write scrapers → retry + data guard in-place**

Each direct-write workflow keeps its own commit step but gains:
- A 3-attempt retry loop with 5-minute backoff around the scrape step
- A data validation check before committing (write to temp, validate, replace or keep old)

If all retries fail the workflow exits non-zero → GitHub sends an email notification.

### New file: `backend/scraper/validate_export.py`

A single module with one validation function per JSON file. Each function receives the parsed JSON dict and returns `(bool, str)` — pass/fail and a reason string.

Validation rules:

| File | Rules |
|---|---|
| `futures_chain.json` | `arabica` and `robusta` both present; `pub_date` within 7 calendar days of today; each commodity has ≥ 5 contracts |
| `farmer_economics.json` | `weather` not null; `fertilizer.items` length ≥ 1; `scraped_at` within 48 h |
| `cot.json` | top-level list has ≥ 1 entry; first entry `report_date` within 14 days |
| `macro_cot.json` | top-level list has ≥ 1 entry |
| `freight.json` | `rates` list non-empty |
| `oi_fnd_chart.json` | `arabica` and `robusta` both present |
| `oi_history.json` | rows present; most recent entry date within 3 calendar days |
| `quant_report.json` | `currencies` list non-empty |
| `cecafe_daily.json` | at least 1 entry |
| `earnings.json` | at least 1 entry |
| `kaffeesteuer.json` | at least 1 entry |

Usage pattern in `export_static_json.py`:
```python
from scraper.validate_export import validate_futures_chain

tmp = OUT_DIR / "futures_chain.json.tmp"
tmp.write_text(json.dumps(payload, ...))
ok, reason = validate_futures_chain(payload)
if ok:
    tmp.replace(OUT_DIR / "futures_chain.json")
else:
    tmp.unlink()
    print(f"[validate] futures_chain.json FAILED validation: {reason} — keeping existing file")
```

### New workflow: `export-and-publish.yml`

```
Trigger: schedule 04:00 UTC daily + workflow_dispatch
Steps:
  1. checkout
  2. install python deps (same as scraper-daily)
  3. python -m scraper.export_static_json   (reads DB, validates, writes JSON)
  4. git add frontend/public/data/futures_chain.json \
            frontend/public/data/oi_fnd_chart.json \
            frontend/public/data/cot.json \
            frontend/public/data/macro_cot.json \
            frontend/public/data/freight.json \
            frontend/public/data/farmer_economics.json
  5. git diff --cached → if changed: commit + pull --rebase + push
```

The export script already validates each file before writing (see above), so no separate validation step is needed in the workflow.

### Retry pattern (all DB-backed and direct-write scraper steps)

```bash
for attempt in 1 2 3; do
  python -m scraper.run_daily && break
  [ $attempt -lt 3 ] && echo "Attempt $attempt failed, retrying in 5m..." && sleep 300 || exit 1
done
```

If all 3 attempts fail the step exits 1 → the job fails → GitHub sends a workflow-failure email.

### Staleness badge (frontend, thin layer)

A shared React hook `useDataFreshness(isoTimestamp: string | undefined, thresholdHours: number)` returns `"ok" | "stale" | "unknown"`. Each panel that exposes a timestamp (already present on most JSON files) renders:
- `"ok"` → nothing extra
- `"stale"` → small amber dot + tooltip "Last updated X h ago"
- `"unknown"` → no indicator (timestamp missing)

No backend changes. The hook computes `Date.now() - Date.parse(isoTimestamp) > thresholdHours * 3600_000`.

Thresholds per panel:
- Futures chain: 48 h (data is T-2 business days by design)
- Farmer economics: 48 h
- COT: 10 days (weekly release)
- Freight, OI: 48 h
- Quant/currency: 48 h
- Cecafe daily: 36 h

---

## Files created or modified

| File | Change |
|---|---|
| `.github/workflows/export-and-publish.yml` | **New** — single daily export+commit for all DB-backed JSON |
| `.github/workflows/scraper-daily.yml` | Remove export + commit steps |
| `.github/workflows/scraper-monthly.yml` | Remove export + commit steps |
| `.github/workflows/scraper-cot.yml` | Remove export + commit steps |
| `.github/workflows/daily_oi.yml` | Add retry loop + data guard |
| `.github/workflows/quant-currency-index.yml` | Add retry loop + data guard |
| `.github/workflows/scraper-cecafe-daily.yml` | Add retry loop + data guard |
| `.github/workflows/scraper-earnings.yml` | Add retry loop + data guard |
| `.github/workflows/scraper-kaffeesteuer.yml` | Add retry loop + data guard |
| `backend/scraper/validate_export.py` | **New** — per-file validation functions |
| `backend/scraper/export_static_json.py` | Call validate_export before each file write |
| `frontend/hooks/useDataFreshness.ts` | **New** — staleness detection hook |
| `frontend/components/supply/farmer-economics/FertilizerPanel.tsx` | Add staleness badge example |

---

## Out of scope

- Migrating direct-write scrapers to use the DB (future work — would eventually allow them to join the consolidated export too)
- Real-time data (WebSockets, server-sent events)
- Alerting beyond GitHub's built-in workflow failure emails
