"""
fetch_oi_json.py
Fetches KC (Arabica) and RM (Robusta) OI chain data from Barchart using
Playwright, then prepends today's snapshot to data/oi_history.json.
Keeps the last 30 trading-day snapshots per market.

ALSO appends the same snapshot to data/contract_prices_archive.json — an
UNBOUNDED, never-trimmed per-contract price+OI history. oi_history.json is
the 30-day rolling window the frontend's OI tables read; the archive is the
permanent record so we accumulate true per-contract daily prices over time
(the data we lacked when the Stooq backfill went wrong — see RUNBOOK).

Run standalone:
    python backend/scraper/fetch_oi_json.py
"""

import asyncio
import json
import sys
from datetime import date, timedelta
from pathlib import Path

# Resolve project root (works both from repo root and from backend/)
ROOT = Path(__file__).resolve().parents[2]   # …/Coffee-intel-map
DATA_FILE = ROOT / "data" / "oi_history.json"
ARCHIVE_FILE = ROOT / "data" / "contract_prices_archive.json"
MAX_DAYS = 30

BARCHART_INIT_URL = "https://www.barchart.com/futures/quotes/KCK26/overview"


def _prev_biz_day(d: date, n: int = 2) -> str:
    """Return d minus n business days as YYYY-MM-DD (ICE OI has a 2-day lag)."""
    count = 0
    while count < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            count += 1
    return d.isoformat()


async def _fetch_chains() -> dict:
    from playwright.async_api import async_playwright
    result = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        )
        pg = await ctx.new_page()
        try:
            await pg.goto(BARCHART_INIT_URL, wait_until="domcontentloaded", timeout=30000)
            await pg.wait_for_timeout(3000)
            data = await pg.evaluate(
                """async () => {
                    function getCookie(n) {
                        const v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
                        return v ? decodeURIComponent(v[2]) : null;
                    }
                    const xsrf = getCookie('XSRF-TOKEN');
                    const h = { credentials: 'include', headers: { 'x-xsrf-token': xsrf, 'accept': 'application/json' } };
                    const base = 'https://www.barchart.com/proxies/core-api/v1/quotes/get';
                    const fields = 'symbol,contractName,contractExpirationDate,lastPrice,priceChange,openInterest,volume,symbolCode';
                    const opts = '&orderBy=contractExpirationDate&orderDir=asc&limit=12&raw=1';
                    const [kcResp, rmResp] = await Promise.all([
                        fetch(base + '?symbol=KC%5EF&fields=' + fields + opts, h),
                        fetch(base + '?symbol=RM%5EF&fields=' + fields + opts, h),
                    ]);
                    return {
                        kc: kcResp.ok ? await kcResp.json() : null,
                        rm: rmResp.ok ? await rmResp.json() : null,
                    };
                }"""
            )
            result = data or {}
        except Exception as e:
            print(f"[fetch_oi_json] Barchart fetch error: {e}")
        finally:
            await ctx.close()
            await browser.close()
    return result


def _parse(raw: dict, min_oi: int = 100) -> list[dict]:
    """Extract per-contract (symbol, oi, last_price) from the Barchart payload.

    Snapshotting `last_price` alongside `oi` lets a future operator reconstruct
    the COT-Tuesday max-OI price for any day in the 30-day window — the
    Industry Pulse chart now uses max-OI as the price anchor (see
    fetch_tuesday_prices.py::_front_price), and without the per-contract
    price recorded here, the price track can only be revised going forward.
    """
    from datetime import date, timedelta
    cutoff = date.today() + timedelta(days=14)
    contracts = []
    for it in (raw or {}).get("data", []):
        r = it.get("raw", it)
        oi = r.get("openInterest")
        if oi is None or int(oi) < min_oi:
            continue
        exp_str = r.get("contractExpirationDate", "")
        try:
            if date.fromisoformat(exp_str) <= cutoff:
                continue
        except Exception:
            pass
        entry = {"symbol": r.get("symbol", ""), "oi": int(oi)}
        last_price = r.get("lastPrice")
        if last_price is not None:
            try:
                entry["last_price"] = float(last_price)
            except (TypeError, ValueError):
                pass
        contracts.append(entry)
    return contracts


def _load_history() -> dict:
    if DATA_FILE.exists():
        with open(DATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {"arabica": [], "robusta": []}


def _save_history(history: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)


def _prepend(history: dict, market: str, snapshot: dict) -> None:
    entries: list = history.setdefault(market, [])
    # Skip if date already recorded
    if entries and entries[0]["date"] == snapshot["date"]:
        print(f"[fetch_oi_json] {market} {snapshot['date']} already recorded, skipping.")
        return
    entries.insert(0, snapshot)
    # Keep only MAX_DAYS most recent
    history[market] = entries[:MAX_DAYS]


def _load_archive() -> dict:
    if ARCHIVE_FILE.exists():
        with open(ARCHIVE_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {
        "_meta": {
            "description": (
                "Permanent per-contract daily price+OI archive. NEVER trimmed. "
                "Accumulates Barchart chain snapshots so we build true per-contract "
                "history over time. oi_history.json is the 30-day rolling view; this "
                "is the full record. Stored ascending by date."
            ),
            "source": "Barchart core-api/v1/quotes/get via fetch_oi_json.py",
            "started": date.today().isoformat(),
        },
        "arabica": [],
        "robusta": [],
    }


def _append_archive(archive: dict, market: str, snapshot: dict) -> None:
    """Append snapshot to the unbounded archive (ascending by date), dedup
    on date. No trimming — this is the permanent record."""
    entries: list = archive.setdefault(market, [])
    if any(e.get("date") == snapshot["date"] for e in entries):
        print(f"[fetch_oi_json] archive: {market} {snapshot['date']} already present, skipping.")
        return
    entries.append(snapshot)
    entries.sort(key=lambda e: e.get("date", ""))


def _save_archive(archive: dict) -> None:
    ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ARCHIVE_FILE, "w", encoding="utf-8") as f:
        json.dump(archive, f, indent=2)


async def main() -> None:
    print("[fetch_oi_json] Fetching OI chains from Barchart...")
    chains = await _fetch_chains()

    kc = _parse(chains.get("kc"))
    rm = _parse(chains.get("rm"))

    trade_date = _prev_biz_day(date.today(), n=2)
    print(f"[fetch_oi_json] Trade date (T-2): {trade_date}")
    print(f"[fetch_oi_json] Arabica contracts: {[c['symbol'] for c in kc]}")
    print(f"[fetch_oi_json] Robusta contracts:  {[c['symbol'] for c in rm]}")

    if not kc and not rm:
        print("[fetch_oi_json] No data fetched — aborting.")
        sys.exit(1)

    history = _load_history()
    archive = _load_archive()

    if kc:
        snap = {"date": trade_date, "contracts": kc}
        _prepend(history, "arabica", snap)
        _append_archive(archive, "arabica", snap)
    if rm:
        snap = {"date": trade_date, "contracts": rm}
        _prepend(history, "robusta", snap)
        _append_archive(archive, "robusta", snap)

    _save_history(history)
    _save_archive(archive)
    arch_counts = f"arabica={len(archive.get('arabica', []))} robusta={len(archive.get('robusta', []))}"
    print(f"[fetch_oi_json] Saved 30-day window to {DATA_FILE}")
    print(f"[fetch_oi_json] Appended to permanent archive {ARCHIVE_FILE} ({arch_counts} days total)")


if __name__ == "__main__":
    asyncio.run(main())
