"""
acaphe_poller.py — Login once via Playwright, poll iquote.php every POLL_INTERVAL seconds,
write cleaned JSON to frontend/public/data/acaphe_live.json.

Usage (from repo root):
    python backend/scraper/acaphe_poller.py
"""

import asyncio
import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUTPUT        = Path(__file__).parents[2] / "frontend" / "public" / "data" / "acaphe_live.json"
VIETNAM_LAST  = Path(__file__).parents[2] / "frontend" / "public" / "data" / "vietnam_last.json"
UPSTASH_URL   = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/")
UPSTASH_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")
REDIS_KEY     = "live_quotes"
DATABASE_URL  = os.environ.get("DATABASE_URL", "")


def _push_redis(data: dict) -> None:
    """Push data to Upstash Redis via REST API. Silent no-op if not configured."""
    if not UPSTASH_URL or not UPSTASH_TOKEN:
        return
    try:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        resp = requests.post(
            UPSTASH_URL,
            headers={
                "Authorization": f"Bearer {UPSTASH_TOKEN}",
                "Content-Type":  "application/json",
            },
            json=["SET", REDIS_KEY, payload],
            timeout=5,
        )
        resp.raise_for_status()
    except Exception as exc:
        print(f"[acaphe][redis] push failed: {exc}")
API_URL       = "https://acaphe.com/iquote.php?v="
LOGIN_URL     = "https://acaphe.com/"
USERNAME      = "LBS"
PASSWORD      = "LBS"
POLL_INTERVAL = 30   # seconds between polls
RELOGIN_AFTER = 3    # consecutive failures before re-login

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer":          "https://acaphe.com/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept":           "application/json, text/plain, */*",
}


# ── Parsing helpers ────────────────────────────────────────────────────────────

def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s or "").strip()


def _parse_oi(s: str) -> tuple[int | None, int | None]:
    """'10898 (-1177)' → (10898, -1177)"""
    m = re.match(r"([\d,]+)\s*\(([+-]?[\d,]+)\)", str(s or ""))
    if not m:
        return None, None
    return int(m.group(1).replace(",", "")), int(m.group(2).replace(",", ""))


def _parse_52wk(s: str) -> tuple[float | None, float | None]:
    """'5029 / 3084' → (5029.0, 3084.0)"""
    parts = str(s or "").split(" / ")
    if len(parts) != 2:
        return None, None
    try:
        return float(parts[0].strip()), float(parts[1].strip())
    except ValueError:
        return None, None


def _parse_chg_pct(s: str) -> float | None:
    """'<span ...>(2.77%)</span>' → 2.77"""
    m = re.search(r"\(([\d.]+)%\)", s or "")
    return float(m.group(1)) if m else None


def _parse_vietnam(row14: dict) -> dict:
    raw = row14.get("High", "")

    # Local time: "09:46 21/04 (...)"
    tm = re.match(r"(\d{2}:\d{2}\s+\d{2}/\d{2})", raw)
    local_time = tm.group(1) if tm else None

    # BMT bid/offer
    bmt = re.search(r"BMT bid ([\d]+-[\d]+)\s*/\s*offer\s+([\d]+-[\d]+)", raw)
    # HCM bid/offer
    hcm = re.search(r"HCM bid ([\d]+-[\d]+)\s*/\s*offer\s+([\d]+-[\d]+)", raw)
    # R2 FOB differential
    r2  = re.search(r"R2 FOB.*?bid\s*([+-]?\d+)\s*/\s*offer\s*([+-]?\d+)", raw)
    # Pepper
    pep = re.search(r"Pepper[^(]*([\d]+-[\d,]+)", raw)

    # USD/VND from whenldclose: "87326(163976)" → first number
    vc  = str(row14.get("whenldclose", "") or "")
    vcm = re.match(r"(\d+)", vc)
    usd_vnd = int(vcm.group(1)) if vcm else None

    return {
        "local_time":  local_time,
        "bmt_bid":     bmt.group(1) if bmt else None,
        "bmt_offer":   bmt.group(2) if bmt else None,
        "hcm_bid":     hcm.group(1) if hcm else None,
        "hcm_offer":   hcm.group(2) if hcm else None,
        "r2_fob_bid":  r2.group(1)  if r2  else None,
        "r2_fob_offer":r2.group(2)  if r2  else None,
        "pepper_faq":  pep.group(1) if pep else None,
        "usd_vnd":     usd_vnd,
    }


def _safe_float(s) -> float | None:
    try:
        return float(str(s or "0").replace(",", ""))
    except (ValueError, TypeError):
        return None


def _safe_int(s) -> int | None:
    try:
        return int(str(s or "0").replace(",", ""))
    except (ValueError, TypeError):
        return None


def transform(raw: list) -> dict:
    """Convert the 15-row iquote.php response into a clean dict."""
    robusta: list[dict] = []
    arabica: list[dict] = []
    row14: dict | None  = None

    for row in raw:
        stt = int(row.get("stt", -1))
        if stt == 14:
            row14 = row
            continue

        month = row.get("Month", "")
        is_arabica = month.startswith("A")

        change = _safe_float(row.get("Change")) or 0.0
        chg_pct = _parse_chg_pct(row.get("Change_per", ""))
        if chg_pct is not None and change < 0:
            chg_pct = -chg_pct

        oi, oi_chg = _parse_oi(row.get("OpInt", ""))
        w52h, w52l = _parse_52wk(row.get("Time", ""))

        entry = {
            "month":       month,
            "change":      change,
            "change_pct":  chg_pct,
            "last":        _safe_float(row.get("Last")),
            "vol":         _safe_int(row.get("Vol")),
            "high":        _safe_float(row.get("High")),
            "low":         _safe_float(row.get("Low")),
            "open":        _safe_float(row.get("Open")),
            "prev":        _safe_float(row.get("Prev")),
            "oi":          oi,
            "oi_chg":      oi_chg,
            "week52_high": w52h,
            "week52_low":  w52l,
            # Only front months carry LTD/FND dates
            "opt_ltd":     row.get("Opt_LTD") or None,
            "fut_fnd":     row.get("Fut_FND") or None,
        }

        (arabica if is_arabica else robusta).append(entry)

    result: dict = {
        "fetched_at": datetime.now(UTC).isoformat(),
        "now_time":   raw[0].get("now_time", "") if raw else "",
        "robusta":    robusta,
        "arabica":    arabica,
    }

    if row14:
        result["vietnam"] = _parse_vietnam(row14)
        result["spreads"] = {
            "robusta": row14.get("Time", ""),
            "arabica": row14.get("Date", ""),
        }
        result["arb_ratio"] = row14.get("TimeV", "")
        result["equities"]  = _strip_html(row14.get("timelife") or row14.get("nyld", ""))

    return result


# ── Network helpers ────────────────────────────────────────────────────────────

async def playwright_login() -> dict:
    """Login via Playwright, return session cookies."""
    from playwright.async_api import async_playwright

    print("[acaphe] Logging in via Playwright …")
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=HEADERS["User-Agent"])
        page = await ctx.new_page()

        await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(2_000)
        await page.fill('input[type="text"]',     USERNAME)
        await page.fill('input[type="password"]', PASSWORD)
        await page.click('input[type="submit"]')
        await page.wait_for_timeout(5_000)

        cookies = await ctx.cookies()
        await browser.close()

    cookie_dict = {c["name"]: c["value"] for c in cookies}
    print(f"[acaphe] Login OK — {len(cookie_dict)} cookie(s): {list(cookie_dict.keys())}")
    return cookie_dict


def _save_vn_prices_to_db(viet: dict, fetched_at: str) -> None:
    """Store VN local prices to Postgres so the nightly export can publish them."""
    import os
    import sys
    # Add backend dir to path so db/models are importable
    backend_dir = str(Path(__file__).parents[1])
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    try:
        os.environ.setdefault("DATABASE_URL", DATABASE_URL)
        from datetime import datetime

        from scraper.db import create_vn_local_prices_table, upsert_vn_local_price
        create_vn_local_prices_table()
        recorded_at = datetime.fromisoformat(fetched_at.replace("Z", "+00:00")).replace(tzinfo=None)
        upsert_vn_local_price(viet, recorded_at)
        print("[acaphe] Vietnam prices saved to DB")
    except Exception as exc:
        print(f"[acaphe][db] write failed: {exc}")


def fetch_and_save(cookies: dict) -> bool:
    """Fetch iquote.php, transform, write to OUTPUT. Returns True on success."""
    url = f"{API_URL}{int(time.time() * 1000)}"
    try:
        resp = requests.get(url, cookies=cookies, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        raw  = resp.json()
        data = transform(raw)
        OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        _push_redis(data)

        # Persist Vietnam prices whenever acaphe shows them (they disappear after morning)
        viet = data.get("vietnam") or {}
        if viet.get("bmt_bid") or viet.get("hcm_bid"):
            snapshot = {**viet, "saved_at": data["fetched_at"]}
            VIETNAM_LAST.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
            print("[acaphe] Vietnam snapshot saved (local)")
            if DATABASE_URL:
                _save_vn_prices_to_db(viet, data["fetched_at"])

        viet     = data.get("vietnam", {}) or {}
        bmt_bid  = viet.get("bmt_bid", "?")
        bmt_off  = viet.get("bmt_offer", "?")
        usd_vnd  = viet.get("usd_vnd", "?")
        r_last   = data["robusta"][0]["last"]  if data["robusta"]  else "?"
        a_last   = data["arabica"][0]["last"]  if data["arabica"]  else "?"
        now_t    = data.get("now_time", "")
        print(
            f"[acaphe] {datetime.now().strftime('%H:%M:%S')} | {now_t} | "
            f"RC={r_last} KC={a_last} | BMT {bmt_bid}/{bmt_off} | VCB={usd_vnd}"
        )
        return True
    except Exception as exc:
        print(f"[acaphe] ERROR: {exc}")
        return False


# ── Main loop ─────────────────────────────────────────────────────────────────

async def main():
    cookies = await playwright_login()
    print(f"[acaphe] Polling every {POLL_INTERVAL}s → {OUTPUT}")

    fails = 0
    while True:
        ok = fetch_and_save(cookies)
        if ok:
            fails = 0
        else:
            fails += 1
            if fails >= RELOGIN_AFTER:
                print(f"[acaphe] {fails} consecutive failures — re-logging in …")
                cookies = await playwright_login()
                fails   = 0

        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
