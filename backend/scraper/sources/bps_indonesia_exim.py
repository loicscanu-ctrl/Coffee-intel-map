"""bps_indonesia_exim.py — Indonesia national export data from BPS.

Hits the Next.js Server Action behind https://lampung.bps.go.id/en/exim
(despite the `lampung.` subdomain, the data is national — all Indonesian
ports show up in the rows). One POST per (year, month) returns a flat
list of rows shaped:

    { jenishs, value, netweight, kodehs, pod, ctr, tahun, bulan }

where `kodehs` is "[<code>] <description>", `pod` is the Indonesian
port of departure, `ctr` is the destination country, `value` is USD,
`netweight` is kilograms.

The 13 HS codes in COFFEE_HS_CODES below cover the full HS-0901xx coffee
family (green / roasted, Arabica / Robusta / other, decaf / regular,
husks, substitutes). HS-09 at the chapter level also includes tea and
spices and is NOT what we ask for here.

Output: frontend/public/data/indonesia_exports.json — one row per month
with headline totals, by-destination and by-port breakdowns, and the
raw per-HS detail kept so the frontend can re-aggregate as needed.

Patchright drives the network call because BPS sits behind Cloudflare
(cf_clearance, __cf_bm cookies) — `requests.post()` from a plain
GitHub Actions IP 403's. The browser GETs the page once to clear the
CF challenge, then reuses the same context's request API for the POST,
which sends matching TLS-fingerprint, cookies and headers.

Usage:
    cd backend
    python -m scraper.sources.bps_indonesia_exim --month 2026-04
    python -m scraper.sources.bps_indonesia_exim --month 2026-04 --write
    python -m scraper.sources.bps_indonesia_exim --from 2020-01 --to 2026-04 --write
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
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


async def fetch_month(year: int, month: int) -> list[dict] | None:
    """Hit the BPS server action once and return the flat list of data rows
    (one per HS×port×country). Returns None on any network/parse failure;
    the caller logs + skips that month.

    The fetch is dispatched from INSIDE the rendered page via
    `page.evaluate(...)` rather than `ctx.request.post(...)`. First live
    smoke (run 27568532810, 2026-06-15) showed the latter served Cloudflare's
    "Just a moment..." interstitial on the POST even though the GET cleared
    cleanly — the request API doesn't replay all the headers a true page
    fetch carries (Origin, Referer, Sec-Fetch-*, …) so CF treats it as a
    different client. Going through `fetch()` in page context inherits the
    exact same fingerprint as a user clicking the Download button."""
    try:
        from patchright.async_api import async_playwright
    except ImportError:
        logger.error("[bps] patchright unavailable — cannot reach Cloudflare-gated BPS")
        return None

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
    body = json.dumps(payload, separators=(",", ":"))

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            # No custom user_agent — patchright's stealth profile sets a UA
            # that MATCHES its bundled Chromium's TLS fingerprint. First
            # smoke runs overrode it with a stale Chrome-124 string while
            # patchright runs Chromium 148 underneath; Cloudflare flagged
            # the JA3/UA mismatch and served the "Just a moment…"
            # interstitial on every request.
            ctx = await browser.new_context()
            page = await ctx.new_page()
            try:
                # 1. Render the page until network goes quiet — `networkidle`
                #    waits for CF's challenge JS to finish its round-trips
                #    before returning. `domcontentloaded` returned while
                #    the interstitial HTML was still on screen.
                await page.goto(BPS_PAGE_URL, wait_until="networkidle", timeout=60_000)

                # 2. Explicit sanity check: wait for an element that only
                #    appears on the real BPS UI, not the CF interstitial.
                #    The "Select the Data" heading is a stable, prominent
                #    marker of the rendered exim form.
                try:
                    await page.wait_for_selector("text=Select the Data", timeout=15_000)
                except Exception:                   # noqa: BLE001
                    snippet = (await page.content())[:300]
                    logger.warning(f"[bps] CF challenge not cleared for {year}-{month:02d}: {snippet}")
                    return None

                # 3. Dispatch the POST from the page's own JS context.
                #    `fetch()` here automatically attaches Origin, Referer,
                #    Sec-Fetch-Site/Mode/Dest, the CF cookies, the right TLS
                #    fingerprint — everything a user click would carry.
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


async def run_async(months: list[tuple[int, int]], write: bool) -> int:
    existing = _load_existing() if write else {}
    by_month: dict[str, dict] = {row["month"]: row for row in existing.get("series", [])}

    for y, m in months:
        ym = f"{y:04d}-{m:02d}"
        print(f"[bps] fetching {ym}…")
        rows = await fetch_month(y, m)
        if rows is None:
            print(f"  → fetch failed; skipping {ym}")
            continue
        summary = aggregate(rows, ym)
        # Source metadata sits inside the same response — capture the
        # `date_source` so the JSON shows when BPS last touched the
        # numbers we just ingested.
        by_month[ym] = _summary_to_dict(summary)
        print(f"  → {summary.row_count} rows · total {summary.total_coffee_kg:,.2f} kg "
              f"· robusta-green {summary.robusta_green_kg:,.2f} kg "
              f"· arabica-green {summary.arabica_green_kg:,.2f} kg")

    payload = {
        "source":     "BPS Indonesia (lampung.bps.go.id/en/exim, national export rows)",
        "source_url": BPS_PAGE_URL,
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "unit_weight": "kg",
        "unit_value":  "USD",
        "hs_codes":    {c: v["desc"] for c, v in COFFEE_HS_CODES.items()},
        "hs_families": {c: v["family"] for c, v in COFFEE_HS_CODES.items()},
        "series":      sorted(by_month.values(), key=lambda r: r["month"]),
    }

    if write:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"[bps] wrote {OUT_PATH} ({len(payload['series'])} months)")
    else:
        print(f"[bps] preview only — {len(payload['series'])} months would be written")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="Single month YYYY-MM")
    ap.add_argument("--from",  dest="start", help="Range start YYYY-MM (inclusive)")
    ap.add_argument("--to",    dest="end",   help="Range end YYYY-MM (inclusive)")
    ap.add_argument("--write", action="store_true",
                    help="Persist the merged JSON to public/data")
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

    return asyncio.run(run_async(months, write=args.write))


if __name__ == "__main__":
    sys.exit(main())
