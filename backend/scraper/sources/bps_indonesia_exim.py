"""bps_indonesia_exim.py — Indonesia national export data from BPS.

Canonical path: the official BPS Web API at https://webapi.bps.go.id —
no Cloudflare, no JS rendering, plain JSON GETs keyed by HS code and
year. Returns rows shaped:

    { tahun, bulan, kodehs, jenishs, pod, ctr, value, netweight }

where `kodehs` is "[<code>] <description>", `pod` is the Indonesian
port of departure, `ctr` is the destination country, `value` is USD,
`netweight` is kilograms, `bulan` is "[MM] MonthName". Identical schema
to the legacy lampung.bps.go.id Server Action — the aggregator works
unchanged.

The 13 HS codes in COFFEE_HS_CODES below cover the full HS-0901xx coffee
family (green / roasted, Arabica / Robusta / other, decaf / regular,
husks, substitutes). HS-09 at the chapter level also includes tea and
spices and is NOT what we ask for here.

Output: frontend/public/data/indonesia_exports.json — one row per month
with headline totals, by-destination and by-port breakdowns, and the
raw per-HS detail kept so the frontend can re-aggregate as needed.

Why an official API path: every Cloudflare-fronted attempt at
lampung.bps.go.id/en/exim failed from CI — headless Chromium
(#27568532810, #27569193240, #27569356350), Xvfb-headed Chromium
(#27572914986), ZenRows free tier (#27574157444, RESP001), ScraperAPI
free tier (#27594067937, #27594246940, premium-proxy-only), and a
Cloudflare-Worker proxy (intra-CF traffic still 403'd). The Web API at
webapi.bps.go.id is published by BPS specifically for programmatic
access, has no bot challenge, and returns the same row shape — so we
use it as the primary transport and keep the four CF-fronted fallbacks
below as documentation of what doesn't work.

Operator workflow (CI dispatch, the default path):

  GitHub UI → Actions → "0.9 – BPS Indonesia coffee exports (monthly)"
    → Run workflow → pick a single month or from/to range → Run.

Requires repository secret `BPS_API_KEY` (the BPS "App ID" issued at
webapi.bps.go.id after registering an application). The workflow
commits the merged JSON back to the dispatched ref.

Local fallback (test code changes, debug a stuck month):

    cd backend
    BPS_API_KEY=<your-app-id> PYTHONPATH=. \
        python -m scraper.sources.bps_indonesia_exim --month 2026-04 --write
    cd ..

The `--write` flag merges into the existing series (idempotent month-
keyed dedupe). Backfill uses `--from YYYY-MM --to YYYY-MM`.

Implementation notes:
  - The Web API returns a FULL YEAR per (HS code, year) call, so the
    per-month dispatcher caches by year and serves later months in the
    same year from the in-memory cache. A 24-month backfill across 2
    years × 13 codes = 26 HTTP requests total, not 24 × 13 = 312.
  - BPS adopted BTKI-2022 (= HS-2022) in March 2022; the 13 codes in
    COFFEE_HS_CODES are HS-2022 only, so pre-2022-04 months return the
    ~1% slice that overlaps between revisions (tea/spice-adjacent
    codes). Start dates earlier than 2022-04 are not useful.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
OUT_PATH = ROOT / "frontend" / "public" / "data" / "indonesia_exports.json"

BPS_PAGE_URL = "https://lampung.bps.go.id/en/exim"

# Per-deploy Next.js server-action ID, captured from a live browser
# session on 2026-06-15. If BPS rebuilds the site this rotates and the
# scraper will start getting a 400/404; in that case grab the new ID from
# DevTools (Network → exim → Headers → next-action) and update here. A
# regex-based discovery over the page's JS chunks is doable but lots of
# scaffolding for a value that turns over once or twice a year.
NEXT_ACTION_ID = "7f8a3808bc9f1e85e184f370fe19cced09f7c7ca50"

# Full HS-0901xx coffee family at HS2022 6/8-digit precision. Mapped to
# product families so we can publish headline robusta/arabica totals
# next to the granular per-code rows. Only 09011130 (green Robusta) and
# 09011120 (green Arabica) make it into the "green" aggregates that
# match how ICO / GAIN report Indonesian coffee exports — roasted and
# decaf flows are real but small and tracked separately.
COFFEE_HS_CODES: dict[str, dict[str, str]] = {
    "09011120": {"family": "arabica_green", "desc": "Arabica, not roasted, not decaffeinated"},
    "09011130": {"family": "robusta_green", "desc": "Robusta, not roasted, not decaffeinated"},
    "09011190": {"family": "other",         "desc": "Coffee other than arabica and robusta, not roasted, not decaffeinated"},
    "09011220": {"family": "other",         "desc": "Arabica or robusta, not roasted, decaffeinated"},
    "09011290": {"family": "other",         "desc": "Coffee other than arabica or robusta, not roasted, decaffeinated"},
    "09012111": {"family": "arabica_roast", "desc": "Arabica, roasted, unground, not decaffeinated"},
    "09012112": {"family": "robusta_roast", "desc": "Robusta, roasted, unground, not decaffeinated"},
    "09012119": {"family": "other_roast",   "desc": "Coffee other than arabica and robusta, roasted, unground, not decaffeinated"},
    "09012120": {"family": "other_roast",   "desc": "Coffee, roasted, not decaffeinated, ground"},
    "09012210": {"family": "other",         "desc": "Coffee, roasted, decaffeinated, unground"},
    "09012220": {"family": "other",         "desc": "Coffee, roasted, decaffeinated, ground"},
    "09019010": {"family": "husks",         "desc": "Coffee husks and skins"},
    "09019020": {"family": "substitutes",   "desc": "Coffee substitutes containing coffee"},
}

CALL_TIMEOUT = 60   # seconds, applied per network call

_HS_CODE_RE = re.compile(r"^\[(\d{8})\]")  # extracts the 8-digit code from "[09011130] description"


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class MonthlySummary:
    month: str                                  # "YYYY-MM"
    total_coffee_kg: float = 0.0
    total_coffee_usd: float = 0.0
    robusta_green_kg: float = 0.0               # [09011130] only
    arabica_green_kg: float = 0.0               # [09011120] only
    robusta_green_usd: float = 0.0
    arabica_green_usd: float = 0.0
    by_destination: list[dict] = field(default_factory=list)
    by_port:        list[dict] = field(default_factory=list)
    by_hs:          list[dict] = field(default_factory=list)
    row_count:      int = 0
    source_metadata: dict = field(default_factory=dict)


# ── fetch ───────────────────────────────────────────────────────────────────


BPS_API_BASE       = "https://webapi.bps.go.id/v1/api/dataexim"
ZENROWS_API_URL    = "https://api.zenrows.com/v1/"
SCRAPERAPI_URL     = "https://api.scraperapi.com"

# Year-wide in-memory cache for the official Web API. One (HS code, year)
# request returns every month of that year, so a multi-month backfill
# within the same year only fires 13 requests (one per HS code), not
# 13 × N requests. Scoped to the process; cleared automatically on exit.
_BPS_API_YEAR_CACHE: dict[int, list[dict]] = {}


async def fetch_month_via_bps_api(year: int, month: int) -> list[dict] | None:
    """Canonical network path: the official BPS Web API at
    https://webapi.bps.go.id/v1/api/dataexim. Plain JSON GETs keyed by
    HS code + year, no Cloudflare, no JS rendering. Envelope:

        {"status":"OK","data-availability":"available",
         "metadata":{...}, "data":[ {tahun,bulan,kodehs,...}, ... ]}

    One call per (HS code, year). 13 codes × 1 year = 13 requests to
    populate the cache for a 12-month backfill of that year. Requires
    `BPS_API_KEY` env var (the "App ID" issued at webapi.bps.go.id).
    Returns None on env-not-set; otherwise returns the rows for the
    requested month filtered out of the year cache (empty list if BPS
    has no rows for that month yet)."""
    import requests

    api_key = os.environ.get("BPS_API_KEY")
    if not api_key:
        return None

    if year not in _BPS_API_YEAR_CACHE:
        all_rows: list[dict] = []
        for code in COFFEE_HS_CODES:
            url = (
                f"{BPS_API_BASE}/sumber/1/periode/1/kodehs/{code}"
                f"/jenishs/2/tahun/{year}/key/{api_key}"
            )
            try:
                resp = await asyncio.to_thread(requests.get, url, timeout=CALL_TIMEOUT)
            except Exception as e:                  # noqa: BLE001
                logger.warning(f"[bps] API {year} {code} request error: {e}")
                continue
            if resp.status_code != 200:
                snippet = (resp.text or "")[:300]
                logger.warning(f"[bps] API {year} {code} → HTTP {resp.status_code}: {snippet}")
                continue
            try:
                payload = resp.json()
            except ValueError:
                logger.warning(f"[bps] API {year} {code} → non-JSON response")
                continue
            availability = (payload or {}).get("data-availability")
            if availability and availability != "available":
                # Common for HS codes with zero exports in the requested
                # year (e.g. niche substitutes/husks). Silent skip — would
                # flood the log on every backfill otherwise.
                continue
            data = (payload or {}).get("data")
            if isinstance(data, list):
                all_rows.extend(data)
        _BPS_API_YEAR_CACHE[year] = all_rows

    month_tag = f"[{month:02d}]"
    return [r for r in _BPS_API_YEAR_CACHE[year]
            if isinstance(r.get("bulan"), str) and r["bulan"].startswith(month_tag)]


def _build_payload_body(year: int, month: int) -> str:
    """The 9-element Next.js Server Action payload, JSON-stringified
    exactly the way the BPS UI serialises it. Captured 2026-06-15 via
    DevTools; do NOT reformat (whitespace differences trip the action)."""
    payload = [
        "en",                                       # ui language
        "lampung.bps.go.id",                        # subdomain (national data despite the name)
        "1",                                        # 1 = export (2 = import)
        ",".join(COFFEE_HS_CODES.keys()),
        "",                                         # ports filter — empty = all
        "",                                         # countries filter — empty = all
        "2",                                        # "HS Full" aggregation level
        f"{year:04d}",
        f"{month:02d}",
    ]
    return json.dumps(payload, separators=(",", ":"))


async def fetch_month_via_cf_worker(year: int, month: int) -> list[dict] | None:
    """Default network path when a Cloudflare-Worker proxy is deployed
    (`BPS_WORKER_URL` + `BPS_WORKER_SECRET` env vars). The worker lives
    inside Cloudflare's own edge network, so its outbound `fetch()` to
    BPS appears as intra-CF traffic and (usually) clears Turnstile
    without being challenged. See cf-worker/bps-proxy.js for the
    deployable source + setup notes.

    100k req/day free, no rate limiter beyond that. Returns None on any
    error (auth, target HTTP non-200, RSC parse failure)."""
    import requests

    worker_url    = os.environ.get("BPS_WORKER_URL")
    worker_secret = os.environ.get("BPS_WORKER_SECRET")
    if not (worker_url and worker_secret):
        return None
    body = _build_payload_body(year, month)
    try:
        resp = await asyncio.to_thread(
            requests.post,
            worker_url,
            data=body,
            headers={
                "Content-Type":   "text/plain;charset=UTF-8",
                "Accept":         "text/x-component",
                "Next-Action":    NEXT_ACTION_ID,
                "x-proxy-secret": worker_secret,
            },
            timeout=60,
        )
    except Exception as e:                  # noqa: BLE001
        logger.warning(f"[bps] CF Worker {year}-{month:02d} request error: {e}")
        return None
    if resp.status_code != 200:
        snippet = (resp.text or "")[:400]
        logger.warning(f"[bps] CF Worker {year}-{month:02d} → HTTP {resp.status_code}: {snippet}")
        return None
    return parse_rsc_response(resp.text)


async def fetch_month_via_scraperapi(year: int, month: int) -> list[dict] | None:
    """Default network path: ScraperAPI's `ultra_premium` mode forwards
    our request through their residential-proxy pool with managed
    Cloudflare bypass.

    Returns None on any error (auth, plan limit, target HTTP non-200,
    RSC parse failure); the caller logs + skips that month.

    Two-call session pattern (free-tier compatible):
      1. GET the page with `render=true` + `ultra_premium=true` +
         `session_number=N`. Their browser solves the CF Turnstile
         challenge and stores the resulting cookies + IP under the
         session id. We discard the HTML body — we only wanted the
         side-effect of the CF clearance.
      2. POST the server-action body with the SAME `session_number=N`
         (no `render`). ScraperAPI replays the session cookies +
         routes through the same residential IP, so CF lets the POST
         through and BPS responds with the RSC stream we parse.

    Why two calls instead of one: ScraperAPI's docs state explicitly
    that `render=true` is GET-only ("Rendering is only supported for
    GET requests" — observed verbatim in smoke run 27594067937).
    Doubles credit cost (~50 vs ~25 per month) but stays inside the
    5,000-credit trial budget for the 24-month backfill (~1.2k) plus
    monthly cadence (~50 each)."""
    import requests
    import secrets

    api_key = os.environ.get("SCRAPERAPI_API_KEY")
    if not api_key:
        return None
    # Per-month session token so concurrent backfill calls (5 threads on
    # ScraperAPI's free trial) don't collide on the same proxy IP.
    session_id = f"bps-{year:04d}{month:02d}-{secrets.token_hex(3)}"
    body = _build_payload_body(year, month)

    try:
        warmup = await asyncio.to_thread(
            requests.get,
            SCRAPERAPI_URL,
            params={
                "api_key":        api_key,
                "url":            BPS_PAGE_URL,
                "render":         "true",
                "ultra_premium":  "true",
                "session_number": session_id,
            },
            timeout=180,
        )
    except Exception as e:                  # noqa: BLE001
        logger.warning(f"[bps] ScraperAPI {year}-{month:02d} GET warmup error: {e}")
        return None
    if warmup.status_code != 200:
        snippet = (warmup.text or "")[:400]
        logger.warning(f"[bps] ScraperAPI {year}-{month:02d} GET warmup → HTTP {warmup.status_code}: {snippet}")
        return None

    try:
        resp = await asyncio.to_thread(
            requests.post,
            SCRAPERAPI_URL,
            params={
                "api_key":        api_key,
                "url":            BPS_PAGE_URL,
                "ultra_premium":  "true",
                "session_number": session_id,
                "keep_headers":   "true",
            },
            data=body,
            headers={
                "Content-Type": "text/plain;charset=UTF-8",
                "Accept":       "text/x-component",
                "Next-Action":  NEXT_ACTION_ID,
            },
            timeout=180,
        )
    except Exception as e:                  # noqa: BLE001
        logger.warning(f"[bps] ScraperAPI {year}-{month:02d} POST error: {e}")
        return None
    if resp.status_code != 200:
        snippet = (resp.text or "")[:400]
        logger.warning(f"[bps] ScraperAPI {year}-{month:02d} POST → HTTP {resp.status_code}: {snippet}")
        return None
    return parse_rsc_response(resp.text)


async def fetch_month_via_zenrows(year: int, month: int) -> list[dict] | None:
    """Default network path: send the POST through ZenRows' Scraping API
    which runs the request from a residential IP behind their managed
    Cloudflare-bypass infrastructure. CF on github.com / cloud IPs flagged
    every direct-patchright attempt we tried (run IDs 27568532810,
    27569193240, 27569356350, 27572914986); going through a service that
    presents a residential fingerprint is the supported answer.

    Returns None on any error (auth, quota, target HTTP non-200, RSC
    parse failure); the caller logs + skips that month."""
    import requests

    api_key = os.environ.get("ZENROWS_API_KEY")
    if not api_key:
        return None
    body = _build_payload_body(year, month)
    try:
        resp = await asyncio.to_thread(
            requests.post,
            ZENROWS_API_URL,
            params={
                "apikey":          api_key,
                "url":             BPS_PAGE_URL,
                "premium_proxy":   "true",      # residential proxy pool
                "antibot":         "true",      # Cloudflare Turnstile bypass
                "custom_headers":  "true",      # forward Next-Action et al.
                "original_status": "true",      # return BPS's HTTP status, not ZenRows'
            },
            data=body,
            headers={
                "Content-Type": "text/plain;charset=UTF-8",
                "Accept":       "text/x-component",
                "Next-Action":  NEXT_ACTION_ID,
            },
            timeout=180,        # CF bypass can take 20-30 s; pad generously
        )
    except Exception as e:                  # noqa: BLE001
        logger.warning(f"[bps] ZenRows {year}-{month:02d} request error: {e}")
        return None
    if resp.status_code != 200:
        body_snippet = (resp.text or "")[:400]
        logger.warning(f"[bps] ZenRows {year}-{month:02d} → HTTP {resp.status_code}: {body_snippet}")
        return None
    return parse_rsc_response(resp.text)


async def fetch_month_via_patchright(year: int, month: int, headed: bool = False) -> list[dict] | None:
    """Local-debug network path: drive a headed Chromium directly. CF
    rejects this from any cloud IP, but works from a residential laptop
    when ZENROWS_API_KEY isn't set or you want to test a code change
    without burning service credits."""
    try:
        from patchright.async_api import async_playwright
    except ImportError:
        logger.error("[bps] patchright unavailable and ZENROWS_API_KEY not set — no path to BPS")
        return None
    body = _build_payload_body(year, month)

    async with async_playwright() as pw:
        # headless=False (passed via --headed) opens a visible browser
        # window. BPS's Cloudflare config rejects HEADLESS Chromium even
        # from a residential IP — CF fingerprints the browser process,
        # not just the network ASN.
        browser = await pw.chromium.launch(headless=not headed)
        try:
            # No custom user_agent — patchright's stealth profile sets a UA
            # that MATCHES its bundled Chromium's TLS fingerprint.
            ctx = await browser.new_context()
            page = await ctx.new_page()
            try:
                await page.goto(BPS_PAGE_URL, wait_until="networkidle", timeout=60_000)
                try:
                    await page.wait_for_selector("text=Select the Data", timeout=15_000)
                except Exception:                   # noqa: BLE001
                    snippet = (await page.content())[:300]
                    logger.warning(f"[bps] CF challenge not cleared for {year}-{month:02d}: {snippet}")
                    return None
                raw = await page.evaluate(
                    """async ({ url, body, action }) => {
                        const r = await fetch(url, {
                            method: "POST",
                            credentials: "include",
                            headers: {
                                "Content-Type": "text/plain;charset=UTF-8",
                                "Accept":       "text/x-component",
                                "Next-Action":  action,
                            },
                            body,
                        });
                        return { status: r.status, text: await r.text() };
                    }""",
                    {"url": BPS_PAGE_URL, "body": body, "action": NEXT_ACTION_ID},
                )
            finally:
                await page.close()
        finally:
            await browser.close()

    status = raw.get("status") if isinstance(raw, dict) else None
    text   = raw.get("text",   "") if isinstance(raw, dict) else ""
    if status != 200:
        logger.warning(f"[bps] POST {year}-{month:02d} → HTTP {status}: {text[:400]}")
        return None

    return parse_rsc_response(text)


async def fetch_month(year: int, month: int, headed: bool = False) -> list[dict] | None:
    """Dispatcher. Picks the highest-priority transport whose env vars
    are set:

      1. Official BPS Web API (`BPS_API_KEY`) — canonical path, free,
         no Cloudflare. Returns a whole year per HS-code call; the
         per-month dispatcher caches the year to amortise.
      2. Cloudflare-Worker proxy (`BPS_WORKER_URL` + `BPS_WORKER_SECRET`)
         — intra-CF traffic was the plan B; in practice BPS's CF
         config still 403'd intra-CF Workers traffic. Kept as
         documentation of what doesn't work.
      3. ScraperAPI (`SCRAPERAPI_API_KEY`) — premium proxy + render is
         paid-only; the free-tier 7-day trial returns a permission
         error (smoke run 27594246940).
      4. ZenRows (`ZENROWS_API_KEY`) — antibot mode is paid-only on
         their free tier (smoke run 27574157444 returned RESP001).
      5. Local patchright in headed mode — for code-change debugging
         from a residential laptop. The `headed` flag only matters
         here; the service paths ignore it.
    """
    if os.environ.get("BPS_API_KEY"):
        return await fetch_month_via_bps_api(year, month)
    if os.environ.get("BPS_WORKER_URL") and os.environ.get("BPS_WORKER_SECRET"):
        return await fetch_month_via_cf_worker(year, month)
    if os.environ.get("SCRAPERAPI_API_KEY"):
        return await fetch_month_via_scraperapi(year, month)
    if os.environ.get("ZENROWS_API_KEY"):
        return await fetch_month_via_zenrows(year, month)
    return await fetch_month_via_patchright(year, month, headed=headed)


def parse_rsc_response(raw: str) -> list[dict] | None:
    """Pull the data rows out of an RSC stream like:

        0:{"a":"$@1","f":"","b":"..."}
        1:{"status":true,"response":{"status":"OK","data-availability":"...",
            "metadata":{...},"data":[ {row}, {row}, … ]}}

    Lines are `<seq>:<json>` and may appear in any order. We hunt for the
    object whose `response.data` is a list and return it. None on a
    malformed stream so the caller surfaces the failure."""
    for line in (raw or "").splitlines():
        if ":" not in line:
            continue
        _, _, payload = line.partition(":")
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        resp = obj.get("response") if isinstance(obj, dict) else None
        if isinstance(resp, dict):
            data = resp.get("data")
            if isinstance(data, list):
                return data
    return None


def extract_metadata(raw: str) -> dict:
    """Best-effort: return the inner `metadata` block (date_source, source
    URL, field labels). Empty dict if absent — never raises."""
    for line in (raw or "").splitlines():
        if ":" not in line:
            continue
        _, _, payload = line.partition(":")
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        resp = obj.get("response") if isinstance(obj, dict) else None
        if isinstance(resp, dict) and isinstance(resp.get("metadata"), dict):
            return resp["metadata"]
    return {}


# ── aggregate ───────────────────────────────────────────────────────────────


def _hs_code_of(kodehs: str) -> str | None:
    m = _HS_CODE_RE.match(kodehs or "")
    return m.group(1) if m else None


def aggregate(rows: list[dict], month: str) -> MonthlySummary:
    """Roll a single month's flat row list into a MonthlySummary. Rows whose
    HS code isn't in COFFEE_HS_CODES are silently dropped — BPS sometimes
    rounds out the result set with adjacent codes; we only own the coffee
    family."""
    summary = MonthlySummary(month=month)
    by_dest: dict[str, dict] = defaultdict(lambda: {"kg": 0.0, "usd": 0.0,
                                                    "robusta_green_kg": 0.0,
                                                    "arabica_green_kg": 0.0})
    by_port: dict[str, dict] = defaultdict(lambda: {"kg": 0.0, "usd": 0.0,
                                                    "robusta_green_kg": 0.0,
                                                    "arabica_green_kg": 0.0})
    by_hs:   dict[str, dict] = defaultdict(lambda: {"kg": 0.0, "usd": 0.0})

    for r in rows:
        code = _hs_code_of(r.get("kodehs", ""))
        if code not in COFFEE_HS_CODES:
            continue
        kg = float(r.get("netweight") or 0)
        usd = float(r.get("value") or 0)
        if not (kg or usd):
            continue
        ctr = (r.get("ctr") or "Unknown").strip()
        pod = (r.get("pod") or "Unknown").strip()

        summary.total_coffee_kg  += kg
        summary.total_coffee_usd += usd
        summary.row_count += 1
        if code == "09011130":
            summary.robusta_green_kg  += kg
            summary.robusta_green_usd += usd
        elif code == "09011120":
            summary.arabica_green_kg  += kg
            summary.arabica_green_usd += usd

        by_dest[ctr]["kg"]  += kg
        by_dest[ctr]["usd"] += usd
        by_port[pod]["kg"]  += kg
        by_port[pod]["usd"] += usd
        if code == "09011130":
            by_dest[ctr]["robusta_green_kg"] += kg
            by_port[pod]["robusta_green_kg"] += kg
        elif code == "09011120":
            by_dest[ctr]["arabica_green_kg"] += kg
            by_port[pod]["arabica_green_kg"] += kg

        by_hs[code]["kg"]  += kg
        by_hs[code]["usd"] += usd

    summary.by_destination = sorted(
        ({"country": c, **v} for c, v in by_dest.items()),
        key=lambda d: -d["kg"],
    )
    summary.by_port = sorted(
        ({"port": p, **v} for p, v in by_port.items()),
        key=lambda d: -d["kg"],
    )
    summary.by_hs = sorted(
        ({"code": c, "description": COFFEE_HS_CODES[c]["desc"], **v}
         for c, v in by_hs.items()),
        key=lambda d: d["code"],
    )
    return summary


# ── orchestrator ────────────────────────────────────────────────────────────


def _iter_months(start: str, end: str):
    sy, sm = (int(x) for x in start.split("-"))
    ey, em = (int(x) for x in end.split("-"))
    y, m = sy, sm
    while (y, m) <= (ey, em):
        yield y, m
        m += 1
        if m > 12:
            y, m = y + 1, 1


def _load_existing() -> dict:
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text())
        except json.JSONDecodeError:
            logger.warning("[bps] existing JSON unreadable — starting fresh")
    return {}


def _summary_to_dict(s: MonthlySummary) -> dict:
    return {
        "month":             s.month,
        "row_count":         s.row_count,
        "total_coffee_kg":   round(s.total_coffee_kg,  6),
        "total_coffee_usd":  round(s.total_coffee_usd, 6),
        "robusta_green_kg":  round(s.robusta_green_kg, 6),
        "arabica_green_kg":  round(s.arabica_green_kg, 6),
        "robusta_green_usd": round(s.robusta_green_usd, 6),
        "arabica_green_usd": round(s.arabica_green_usd, 6),
        "by_destination":    s.by_destination,
        "by_port":           s.by_port,
        "by_hs":             s.by_hs,
        "source_metadata":   s.source_metadata,
    }


def _build_payload(by_month: dict[str, dict]) -> dict:
    return {
        "source":     "BPS Indonesia (lampung.bps.go.id/en/exim, national export rows)",
        "source_url": BPS_PAGE_URL,
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "unit_weight": "kg",
        "unit_value":  "USD",
        "hs_codes":    {c: v["desc"] for c, v in COFFEE_HS_CODES.items()},
        "hs_families": {c: v["family"] for c, v in COFFEE_HS_CODES.items()},
        "series":      sorted(by_month.values(), key=lambda r: r["month"]),
    }


def _persist(by_month: dict[str, dict]) -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(_build_payload(by_month), indent=2) + "\n",
                        encoding="utf-8")


async def run_async(months: list[tuple[int, int]], write: bool, headed: bool = False) -> int:
    existing = _load_existing() if write else {}
    by_month: dict[str, dict] = {row["month"]: row for row in existing.get("series", [])}
    requested = set(f"{y:04d}-{m:02d}" for y, m in months)
    fetched_this_run: set[str] = set()

    for i, (y, m) in enumerate(months):
        ym = f"{y:04d}-{m:02d}"
        print(f"[bps] fetching {ym}… ({i + 1}/{len(months)})")
        rows = await fetch_month(y, m, headed=headed)
        if rows is None:
            print(f"  → fetch failed; skipping {ym}")
            # Brief politeness sleep even on failure — back off rather
            # than hammer CF when something's already misbehaving.
            if i + 1 < len(months):
                await asyncio.sleep(3)
            continue
        summary = aggregate(rows, ym)
        by_month[ym] = _summary_to_dict(summary)
        fetched_this_run.add(ym)
        print(f"  → {summary.row_count} rows · total {summary.total_coffee_kg:,.2f} kg "
              f"· robusta-green {summary.robusta_green_kg:,.2f} kg "
              f"· arabica-green {summary.arabica_green_kg:,.2f} kg")

        # Persist after EACH successful month. A backfill of 75+ months
        # in one shot would otherwise lose everything on a single
        # mid-range crash (CF flakes, network blip, laptop sleep). With
        # incremental writes, re-running the same range is idempotent
        # and resumes from wherever the JSON currently stands.
        if write:
            _persist(by_month)

        # ~2 s gap between months so we look less like a tight loop to
        # CF / BPS's WAF. Cheap insurance on a long backfill.
        if i + 1 < len(months):
            await asyncio.sleep(2)

    if write:
        print(f"[bps] wrote {OUT_PATH} ({len(by_month)} months)")
    else:
        # Preview mode — render the payload once at the end without persisting.
        print(f"[bps] preview only — {len(by_month)} months would be written")

    # Non-zero exit when nothing fetched this run, so CI fails LOUDLY
    # rather than the "no diff" → "no JSON change" → "success" chain
    # we kept hitting. Smoke runs 27568532810, 27569193240, 27569356350,
    # 27572914986, 27574157444, 27594067937 and 27594246940 all reported
    # the workflow conclusion as success while no data was fetched.
    if requested and not fetched_this_run:
        print(f"[bps] FATAL: 0 of {len(requested)} requested months fetched. "
              f"Check the per-month error logs above.")
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="Single month YYYY-MM")
    ap.add_argument("--from",  dest="start", help="Range start YYYY-MM (inclusive)")
    ap.add_argument("--to",    dest="end",   help="Range end YYYY-MM (inclusive)")
    ap.add_argument("--write", action="store_true",
                    help="Persist the merged JSON to public/data")
    ap.add_argument("--headed", action="store_true",
                    help="Launch Chromium with a visible window. Required to "
                         "clear BPS's Cloudflare bot challenge — headless "
                         "Chromium is fingerprinted and rejected even from "
                         "a residential IP. The window flashes briefly while "
                         "the scrape runs.")
    args = ap.parse_args()

    if args.month:
        y, m = (int(x) for x in args.month.split("-"))
        months = [(y, m)]
    elif args.start and args.end:
        months = list(_iter_months(args.start, args.end))
    else:
        # Default: fetch the most recently published month. BPS lags by
        # roughly six weeks, so two months back from today is a safe
        # bet to land on something `data-availability: available`.
        today = datetime.now(timezone.utc).date()
        y, m = today.year, today.month - 2
        while m < 1:
            y, m = y - 1, m + 12
        months = [(y, m)]

    return asyncio.run(run_async(months, write=args.write, headed=args.headed))


if __name__ == "__main__":
    sys.exit(main())
