"""Orchestrator — pulls all 10 ICE certified-stock sources and writes 2 JSONs.

Run a windowed backfill (default 30 calendar days):
    python -m scraper.sources.ice_certified_stocks.orchestrate --days 30

Or via the dedicated workflow (.github/workflows/scraper-ice-certified-stocks.yml).

Outputs:
  frontend/public/data/certified_stocks_arabica.json
  frontend/public/data/certified_stocks_robusta.json

Design notes:
  • Per-source resilience: each fetch+parse is wrapped; a single failure marks
    that source `stale_since` but does not blank the file.
  • Throttled: ~0.3 s between HTTP calls to be polite to ICE.
  • Stock report (.csv) has an HHMMSS publish timestamp in the URL — we try a
    handful of common times for *today*, but skip historical days for it (the
    other 9 sources cover history).
  • Latest day gets the full hierarchical `latest_detail`; older days collapse
    to flat `snapshots[]` rows for the time-series table.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

from . import fetch as F
from .parse_age_allowance import parse_age_allowance_xlsx
from .parse_arabica_xls import parse_arabica_xls
from .parse_gradings import parse_gradings
from .parse_iss_recv import parse_iss_recv_daily, parse_iss_recv_monthly
from .parse_pdfs import parse_grading_overview_pdf, parse_infested_warrant_pdf
from .parse_stock_report import parse_stock_report
from .parse_tenders import parse_tenders

OUT_DIR = Path(__file__).resolve().parents[4] / "frontend" / "public" / "data"
# Per-path throttle. Both prefixes have rate limits — discovered by the 180-day
# backfill which hit 429 on /publicdocs/ (arabica) after ~50 sequential 1 s/req
# calls. /marketdata/ is even stricter. New defaults give Akamai breathing room
# while still completing 180 days in <2 h.
TIMEOUT = 30
_THROTTLE = {"public": 2.0, "marketdata": 5.0}
_THROTTLE_CAP = 15.0           # ceiling when self-bumping on 429 retries
TOO_MANY_429S = 4              # bail-out after this many consecutive 429s
RETRY_AFTER_MAX_S = 90         # cap any Retry-After we'll wait for
RETRY_AFTER_GIVE_UP_S = 600    # if Akamai asks > this, abort the rest of the run
_RATE_STATE: dict[str, int] = {"consecutive_429s": 0, "aborted": 0}

# Stock_report.csv's HHMMSS publish time varies daily. Strategy is tiered:
#   Tier 1 — try the 5 most-frequent HHMMSS values from past successful
#            captures (loaded from STOCK_REPORT_HITS_PATH). Cheap: ≤5 GETs.
#   Tier 2 — if Tier 1 misses, sweep every second of the published
#            10:30:00 → 10:31:59 window (120 GETs at 5 s throttle = 10 min
#            worst case). Skipped during multi-day backfills (`sweep=False`).
# Every successful capture is appended to the hits file so the Tier 1
# ordering self-tunes over time.
STOCK_REPORT_HITS_PATH = Path(__file__).with_name("stock_report_hits.json")
STOCK_REPORT_SWEEP_HHMM = ((10, 30), (10, 31))
STOCK_REPORT_TIER1_K = 5

def _load_stock_report_hits() -> list[dict]:
    if not STOCK_REPORT_HITS_PATH.exists():
        return []
    try:
        return json.loads(STOCK_REPORT_HITS_PATH.read_text(encoding="utf-8")).get("hits", [])
    except Exception:
        return []

def _record_stock_report_hit(d: date, hhmmss: str) -> None:
    hits = _load_stock_report_hits()
    hits.append({"date": d.isoformat(), "hhmmss": hhmmss})
    STOCK_REPORT_HITS_PATH.write_text(
        json.dumps({"hits": hits}, indent=2), encoding="utf-8",
    )

def _stock_report_tier1_times() -> tuple[str, ...]:
    """Top-K most-frequent HHMMSS from the hits log."""
    counts: dict[str, int] = defaultdict(int)
    for h in _load_stock_report_hits():
        if h.get("hhmmss"):
            counts[h["hhmmss"]] += 1
    most_common = sorted(counts.items(), key=lambda kv: -kv[1])[:STOCK_REPORT_TIER1_K]
    if most_common:
        return tuple(t for t, _ in most_common)
    # Bootstrap: best guesses from initial exploration. Replaced once the
    # hits log accumulates ≥5 confirmed captures.
    return ("103021", "103126", "103045")

def _stock_report_sweep_times() -> list[str]:
    """Every HH:MM:SS in the 10:30:00 → 10:31:59 publish window."""
    out: list[str] = []
    for hh, mm in STOCK_REPORT_SWEEP_HHMM:
        for ss in range(60):
            out.append(f"{hh:02d}{mm:02d}{ss:02d}")
    return out

# Magic-byte / content-type expectations per source — used to flag "200 OK but
# it's an HTML error page" responses that would otherwise be swallowed silently
# by the parsers.
_EXPECT_BY_NAME: dict[str, tuple] = {
    "arabica_xls":      ("application/vnd.ms-excel",                                       b"\xd0\xcf\x11\xe0"),
    "stock_report":     ("text/csv",                                                       b'"'),
    "age_allowance":    ("application/vnd.openxmlformats-officedocument.spreadsheetml",    b"PK\x03\x04"),
    "grading_overview": ("application/pdf",                                                b"%PDF"),
    "infested_warrant": ("application/pdf",                                                b"%PDF"),
    "gradings":         ("text/plain",                                                     b""),
    "grading_appeals":  ("text/plain",                                                     b""),
    "iss_recv_daily":   ("text/plain",                                                     b""),
    "iss_recv_monthly": ("text/plain",                                                     b""),
    "tenders":          ("text/plain",                                                     b""),
}


def _biz_days_back(start: date, n: int) -> list[date]:
    out: list[date] = []
    cur = start
    while len(out) < n:
        if cur.weekday() < 5:
            out.append(cur)
        cur -= timedelta(days=1)
    return out


def _throttle_for(url: str) -> float:
    return _THROTTLE["marketdata"] if "/marketdata/" in url else _THROTTLE["public"]


def _http_get(url: str, *, source: str | None = None, _retry: bool = False) -> requests.Response | None:
    throttle = _throttle_for(url)
    try:
        if _RATE_STATE["aborted"]:
            return None
        r = requests.get(url, headers=F.HEADERS, timeout=TIMEOUT, allow_redirects=True)

        # 429 → respect Retry-After (capped), back off, retry exactly once.
        if r.status_code == 429:
            if _retry:
                # Retry already done; give up on this URL and let the run continue.
                _RATE_STATE["consecutive_429s"] += 1
                if _RATE_STATE["consecutive_429s"] >= TOO_MANY_429S:
                    _RATE_STATE["aborted"] = 1
                    print(f"  ! {TOO_MANY_429S} consecutive 429s — aborting remaining fetches")
                ctype = r.headers.get("Content-Type", "")[:40]
                print(f"  ! HTTP 429 (after retry) ({ctype}) {url}")
                return r
            # Read Retry-After, then apply our caps:
            #   • if Akamai asks > RETRY_AFTER_GIVE_UP_S (10 min) we abort — the
            #     IP is in penalty box, no point waiting hours per URL.
            #   • otherwise cap at RETRY_AFTER_MAX_S (90 s); long enough for the
            #     rolling window to drain, short enough not to burn the timeout.
            raw_after = 60
            try:
                raw_after = max(int(r.headers.get("Retry-After", "60")), 30)
            except ValueError:
                pass
            if raw_after > RETRY_AFTER_GIVE_UP_S:
                _RATE_STATE["aborted"] = 1
                print(f"  ! HTTP 429 with Retry-After={raw_after}s — too long, aborting "
                      f"remaining fetches: {url}")
                return r
            wait_s = min(raw_after, RETRY_AFTER_MAX_S)
            # Self-tune: bump the matched path's throttle so subsequent calls
            # slow down too (capped). Applies to BOTH /publicdocs/ and
            # /marketdata/ — the 180-day run discovered both have rate limits.
            path_key = "marketdata" if "/marketdata/" in url else "public"
            _THROTTLE[path_key] = min(_THROTTLE[path_key] * 1.3, _THROTTLE_CAP)
            print(f"  ! HTTP 429 → sleeping {wait_s}s (Retry-After={raw_after}s); "
                  f"bumping {path_key} throttle to {_THROTTLE[path_key]:.1f}s/req: {url}")
            time.sleep(wait_s)
            return _http_get(url, source=source, _retry=True)

        if r.status_code == 200:
            _RATE_STATE["consecutive_429s"] = 0
        else:
            ctype = r.headers.get("Content-Type", "")[:40]
            print(f"  ! HTTP {r.status_code} ({ctype}) {url}")
            return r

        # 200 OK but wrong shape (e.g. HTML error page) — treat as miss.
        if source and _wrong_shape(source, r):
            return None
        return r
    except requests.exceptions.RequestException as e:
        print(f"  ! {type(e).__name__}: {url} — {e}")
        return None
    finally:
        time.sleep(throttle)


def _safe_parse(parse_fn, source: str, day: date | None, raw):
    """Wrap a parser; log & swallow on failure so the run continues."""
    try:
        return parse_fn(raw)
    except Exception as e:  # noqa: BLE001
        print(f"  ! parse {source} {day}: {type(e).__name__}: {e}")
        return None


def _wrong_shape(source: str, r: requests.Response) -> bool:
    """Return True (and log) when a 200 response doesn't match the source's
    expected content-type / magic bytes — the classic 'Akamai serves 200 with
    HTML error body' case that otherwise passes silently into the parsers."""
    expected = _EXPECT_BY_NAME.get(source)
    if not expected:
        return False
    ct_prefix, magic = expected
    ctype = (r.headers.get("Content-Type", "") or "").lower()
    raw = r.content or b""
    bad = False
    if ct_prefix and not ctype.startswith(ct_prefix.lower()):
        if "text/html" in ctype:
            bad = True
    if magic and raw[:len(magic)] != magic:
        if raw[:5] in (b"<!DOC", b"<html", b"<HTML", b"<HtmL"):
            bad = True
    if bad:
        print(f"  ! WRONG-SHAPE {source}: ct={ctype[:40]!r} head={raw[:80]!r}")
    return bad


# ── Per-source pull functions ────────────────────────────────────────────────

def pull_arabica_xls(d: date) -> tuple[str, dict | None]:
    url = F.ARABICA_DAILY_XLS.format(yyyymmdd=F.yyyymmdd(d))
    r = _http_get(url, source="arabica_xls")
    if not r or r.status_code != 200 or not r.content:
        return url, None
    return url, _safe_parse(parse_arabica_xls, "arabica_xls", d, r.content)


def pull_stock_report(d: date, *, sweep: bool = True) -> tuple[str | None, dict | None]:
    """Tiered HHMMSS guesser. Returns (url, parsed_dict) on hit, (None, None)
    on miss. `sweep=False` skips the Tier-2 minute-by-minute window — useful
    for multi-day backfills that would otherwise spend 10 min per missed day.
    """
    def _try(hhmmss: str) -> tuple[str | None, dict | None]:
        url = F.ROBUSTA_STOCK_REPORT_CSV.format(yyyymmdd=F.yyyymmdd(d), hhmmss=hhmmss)
        r = _http_get(url, source="stock_report")
        if r and r.status_code == 200 and r.text:
            _record_stock_report_hit(d, hhmmss)
            return url, _safe_parse(parse_stock_report, "stock_report", d, r.text)
        return None, None

    tier1 = _stock_report_tier1_times()
    for hhmmss in tier1:
        url, parsed = _try(hhmmss)
        if url:
            return url, parsed

    if not sweep:
        return None, None

    # Tier 2 — 120-second sweep around the observed publish window.
    # Already-tried tier-1 times are skipped to avoid wasted GETs.
    tried = set(tier1)
    for hhmmss in _stock_report_sweep_times():
        if hhmmss in tried:
            continue
        url, parsed = _try(hhmmss)
        if url:
            return url, parsed
    return None, None


def pull_gradings(d: date, *, max_seq: int = 3) -> list[tuple[str, dict]]:
    """gradrc_*.txt has a -N sequence suffix (multiple panels possible per day)."""
    results: list[tuple[str, dict]] = []
    for n in range(1, max_seq + 1):
        url = F.ROBUSTA_GRADINGS_TXT.format(yymmdd=F.yymmdd(d), n=n)
        r = _http_get(url, source="gradings")
        if not r or r.status_code != 200 or not r.text:
            break  # no -2 if -1 missing
        parsed = _safe_parse(parse_gradings, "gradings", d, r.text)
        if parsed:
            results.append((url, parsed))
    return results


def pull_grading_appeals(d: date, *, max_seq: int = 3) -> list[tuple[str, dict]]:
    """Same shape as gradings; very rare (only when an appeal is filed)."""
    results: list[tuple[str, dict]] = []
    for n in range(1, max_seq + 1):
        url = F.ROBUSTA_GRADING_APPEALS.format(yymmdd=F.yymmdd(d), n=n)
        r = _http_get(url, source="grading_appeals")
        if not r or r.status_code != 200 or not r.text:
            break
        parsed = _safe_parse(parse_gradings, "grading_appeals", d, r.text)
        if parsed:
            results.append((url, parsed))
    return results


def pull_iss_recv_daily(d: date) -> tuple[str, dict | None]:
    url = F.ROBUSTA_ISS_RECV_DAILY.format(yymmdd=F.yymmdd(d))
    r = _http_get(url, source="iss_recv_daily")
    if not r or r.status_code != 200 or not r.text:
        return url, None
    return url, _safe_parse(parse_iss_recv_daily, "iss_recv_daily", d, r.text)


def pull_tenders(d: date) -> tuple[str, dict | None]:
    url = F.ROBUSTA_TENDERS.format(yymmdd=F.yymmdd(d))
    r = _http_get(url, source="tenders")
    if not r or r.status_code != 200 or not r.text:
        return url, None
    return url, _safe_parse(parse_tenders, "tenders", d, r.text)


def pull_grading_overview(d: date) -> tuple[str, dict | None]:
    url = F.ROBUSTA_GRADING_OVERVIEW_PDF.format(yymmdd=F.yymmdd(d))
    r = _http_get(url, source="grading_overview")
    if not r or r.status_code != 200 or not r.content:
        return url, None
    return url, _safe_parse(parse_grading_overview_pdf, "grading_overview", d, r.content)


def pull_infested_warrant(d: date) -> tuple[str, dict | None]:
    """Rare — only ~13 publications per year; most days 404."""
    url = F.ROBUSTA_INFESTED_WARRANT.format(yymmdd=F.yymmdd(d))
    r = _http_get(url, source="infested_warrant")
    if not r or r.status_code != 200 or not r.content:
        return url, None
    return url, _safe_parse(parse_infested_warrant_pdf, "infested_warrant", d, r.content)


def pull_iss_recv_monthly(month_end: date) -> tuple[str, dict | None]:
    url = F.ROBUSTA_ISS_RECV_MONTHLY.format(yymmdd=F.yymmdd(month_end))
    r = _http_get(url, source="iss_recv_monthly")
    if not r or r.status_code != 200 or not r.text:
        return url, None
    return url, _safe_parse(parse_iss_recv_monthly, "iss_recv_monthly", month_end, r.text)


def pull_age_allowance(month_end: date) -> tuple[str, dict | None]:
    url = F.ROBUSTA_AGE_ALLOWANCE_XLSX.format(yyyymmdd=F.yyyymmdd(month_end))
    r = _http_get(url, source="age_allowance")
    if not r or r.status_code != 200 or not r.content:
        return url, None
    return url, _safe_parse(parse_age_allowance_xlsx, "age_allowance", month_end, r.content)


# ── Snapshot reductions (rich parsed dict → flat per-day row) ────────────────

def _arabica_snapshot(d: date, parsed: dict) -> dict:
    # Keep full per-section hierarchy on each snapshot so the period-view drill-
    # down (port → group → origin) can read history, not just latest_detail.
    sections: dict[str, dict] = {}
    for key in ("total_certified", "transition", "pending_grading", "rebagging"):
        s = parsed.get(key) or {}
        if s.get("grand_total") or s.get("by_origin"):
            sections[key] = {
                "grand_total": s.get("grand_total", 0),
                "by_port":     s.get("by_port", {}),
                "by_group":    s.get("by_group", {}),
                "by_origin":   s.get("by_origin", {}),
            }
    tc = sections.get("total_certified", {})
    gt = parsed.get("grading_today") or {}
    return {
        "date":                 d.isoformat(),
        "report_date":          parsed.get("report_date"),
        # Headline scalars (kept flat for cheap reads):
        "total_bags":           tc.get("grand_total", 0),
        "transition_bags":      sections.get("transition", {}).get("grand_total", 0),
        "pending_grading_bags": sections.get("pending_grading", {}).get("grand_total", 0),
        "rebagging_bags":       sections.get("rebagging", {}).get("grand_total", 0),
        "passed_today_bags":    gt.get("passed_today_bags", 0),
        "failed_today_bags":    gt.get("failed_today_bags", 0),
        # Convenience rollups (still flat for the headline charts):
        "by_port":              tc.get("by_port", {}),
        "by_group":             tc.get("by_group", {}),
        # Full hierarchy — port × group × origin per section, drives drill-down.
        "sections":             sections,
    }


def _robusta_snapshot(d: date, stock: dict | None, gradings_today: list[dict],
                      iss_recv_today: dict | None, tenders_today: dict | None) -> dict:
    sr_total = (stock or {}).get("grand_total") or {}
    lots_graded_today = sum(g["summary"]["lots_graded_today"] for g in gradings_today) if gradings_today else 0
    iss_total = (iss_recv_today or {}).get("grand_total") or {}
    tenders_total = (tenders_today or {}).get("totals_today") or {}
    return {
        "date":                 d.isoformat(),
        "cut_off_date":         (stock or {}).get("cut_off_date"),
        "total_lots_certified": sr_total.get("with_val_cert", 0),
        "non_tend_lots":        sr_total.get("non_tend", 0),
        "suspended_lots":       sr_total.get("suspended", 0),
        "lots_graded_today":    lots_graded_today,
        "lots_sold_today":      iss_total.get("sold", 0),
        "lots_bought_today":    iss_total.get("bought", 0),
        "tenders_today":        tenders_total.get("originals", 0),
        "by_port_lots":         {p["port_id"]: p["with_val_cert"] for p in (stock or {}).get("ports", [])},
    }


# ── Merge-into-existing ──────────────────────────────────────────────────────
# Each run produces a window of the recent N days. To support both a one-off
# big backfill (e.g. 180 days) and a cheap daily cron (e.g. 3 days) without
# clobbering history, merge the new window into whatever's already on disk.

def _load_existing_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _merge_arabica(new: dict, old: dict) -> dict:
    by_date = {s["date"]: s for s in (old.get("snapshots") or [])}
    for s in new.get("snapshots") or []:
        by_date[s["date"]] = s                          # new overrides
    new["snapshots"] = sorted(by_date.values(), key=lambda s: s["date"])
    if not new.get("latest_detail") and old.get("latest_detail"):
        new["latest_detail"] = old["latest_detail"]
    if new["snapshots"]:
        new["as_of"] = new["snapshots"][-1]["date"]
    return new


def _merge_robusta(new: dict, old: dict) -> dict:
    # snapshots: union by date.
    by_date = {s["date"]: s for s in (old.get("snapshots") or [])}
    for s in new.get("snapshots") or []:
        by_date[s["date"]] = s
    new["snapshots"] = sorted(by_date.values(), key=lambda s: s["date"])

    # recent_activity: union by `date` field (the event keying).
    for key in ("gradings", "grading_appeals", "iss_recv_daily",
                "tenders", "grading_overview", "infested_warrants"):
        merged: dict[str, dict] = {}
        for e in (old.get("recent_activity") or {}).get(key, []):
            merged[e.get("date") or ""] = e
        for e in (new.get("recent_activity") or {}).get(key, []):
            merged[e.get("date") or ""] = e
        merged.pop("", None)
        new.setdefault("recent_activity", {})[key] = sorted(
            merged.values(), key=lambda e: e.get("date") or ""
        )

    # monthly: union by month key.
    def _merge_monthly(key: str, k_field: str) -> list:
        merged: dict[str, dict] = {}
        for e in (old.get("monthly") or {}).get(key, []):
            merged[e.get(k_field) or ""] = e
        for e in (new.get("monthly") or {}).get(key, []):
            merged[e.get(k_field) or ""] = e
        merged.pop("", None)
        return sorted(merged.values(), key=lambda e: e.get(k_field) or "")

    new.setdefault("monthly", {})["iss_recv_monthly"] = _merge_monthly("iss_recv_monthly", "month")
    new["monthly"]["age_allowance"] = _merge_monthly("age_allowance", "month_end")

    # latest_detail: only overwrite if the new run actually captured a
    # stock_report — otherwise keep the older one so the panel keeps showing
    # the most recent good snapshot even when today's run missed.
    if not new.get("latest_detail", {}).get("stock_report") and old.get("latest_detail", {}).get("stock_report"):
        new["latest_detail"] = old["latest_detail"]

    # port_origin_history (workbook full-history lookup) — only the workbook
    # importer emits it. Preserve the older copy when the daily scraper run
    # doesn't carry one, so it survives across nightly merges.
    if not new.get("port_origin_history") and old.get("port_origin_history"):
        new["port_origin_history"] = old["port_origin_history"]

    if new["snapshots"]:
        new["as_of"] = new["snapshots"][-1]["date"]
    return new

def run(days_back: int = 30, write: bool = True, merge: bool = True) -> dict:
    today = date.today()
    days = _biz_days_back(today, days_back)
    days_sorted_asc = sorted(days)
    print(f"=== ICE certified-stocks pull · window = {days_back} biz days "
          f"({days_sorted_asc[0]} → {days_sorted_asc[-1]}) ===\n")

    # ── Arabica: 1 source, loop dates ──
    arabica_snapshots: list[dict] = []
    arabica_latest: dict | None = None
    arabica_latest_date: date | None = None
    arabica_source_url: str | None = None
    arabica_errors: list[str] = []

    print(f"[arabica] daily xls, {len(days_sorted_asc)} days...")
    for d in days_sorted_asc:
        url, parsed = pull_arabica_xls(d)
        if parsed is None:
            arabica_errors.append(f"{d.isoformat()}: no file")
            continue
        arabica_snapshots.append(_arabica_snapshot(d, parsed))
        arabica_latest = parsed
        arabica_latest_date = d
        arabica_source_url = url
    print(f"  → {len(arabica_snapshots)} snapshots; {len(arabica_errors)} misses\n")

    # ── Robusta: 9 sources ──
    print("[robusta] stock report (.csv, today + recent)...")
    robusta_stocks: dict[date, dict] = {}
    robusta_stock_url: str | None = None
    # Try most-recent business days for stock_report; ICE only keeps one per day
    # under a HHMMSS-stamped URL. Tier-2 sweep (~10 min) runs only for the
    # latest day so the daily cron stays bounded — older days that already
    # missed are filled by the workbook ingest instead.
    recent_days = days_sorted_asc[-5:]
    last_day = recent_days[-1] if recent_days else None
    for d in recent_days:
        url, parsed = pull_stock_report(d, sweep=(d == last_day))
        if parsed is not None:
            robusta_stocks[d] = parsed
            robusta_stock_url = url
    print(f"  → {len(robusta_stocks)} stock-report snapshots captured\n")

    print(f"[robusta] gradings + iss/recv + tenders + overview, {len(days_sorted_asc)} days...")
    gradings_all: list[dict] = []      # list of (date, url, parsed)
    appeals_all: list[dict] = []
    iss_recv_all: dict[date, dict] = {}
    tenders_all: dict[date, dict] = {}
    overview_all: dict[date, dict] = {}
    infested_all: list[dict] = []
    for d in days_sorted_asc:
        for url, parsed in pull_gradings(d):
            gradings_all.append({"date": d.isoformat(), "url": url, **parsed})
        for url, parsed in pull_grading_appeals(d):
            appeals_all.append({"date": d.isoformat(), "url": url, **parsed})
        _, parsed = pull_iss_recv_daily(d)
        if parsed: iss_recv_all[d] = parsed
        _, parsed = pull_tenders(d)
        if parsed: tenders_all[d] = parsed
        _, parsed = pull_grading_overview(d)
        if parsed: overview_all[d] = parsed
        _, parsed = pull_infested_warrant(d)
        if parsed: infested_all.append({"date": d.isoformat(), **parsed})
    print(f"  → gradings={len(gradings_all)}  appeals={len(appeals_all)}  "
          f"iss/recv={len(iss_recv_all)}  tenders={len(tenders_all)}  "
          f"overview={len(overview_all)}  infested={len(infested_all)}\n")

    print("[robusta] monthly: iss/recv + age allowance (last 3 month-ends)...")
    monthly_iss_recv: list[dict] = []
    age_allowance_list: list[dict] = []
    # Walk back from current month's end through last 3 month-ends.
    cursor = today.replace(day=1) - timedelta(days=1)   # last day of previous month
    for _ in range(3):
        _, parsed = pull_iss_recv_monthly(cursor)
        if parsed:
            monthly_iss_recv.append(parsed)
        _, parsed = pull_age_allowance(cursor)
        if parsed:
            age_allowance_list.append({"month_end": cursor.isoformat(), **parsed})
        cursor = (cursor.replace(day=1) - timedelta(days=1))
    print(f"  → monthly_iss_recv={len(monthly_iss_recv)}  age_allowance={len(age_allowance_list)}\n")

    # ── Build robusta snapshots (one per business day with any data) ──
    robusta_snapshots: list[dict] = []
    for d in days_sorted_asc:
        gradings_today = [g for g in gradings_all if g["date"] == d.isoformat()]
        snap = _robusta_snapshot(d, robusta_stocks.get(d), gradings_today,
                                  iss_recv_all.get(d), tenders_all.get(d))
        # Drop empty snapshots (no data at all).
        if any(v for k, v in snap.items() if k not in ("date",)):
            robusta_snapshots.append(snap)
    # Latest is the most recent day with stock_report data.
    robusta_latest_date = max(robusta_stocks.keys(), default=None)
    robusta_latest_stock = robusta_stocks.get(robusta_latest_date) if robusta_latest_date else None

    # ── Assemble JSONs ──
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    arabica_json = {
        "generated_at": now,
        "as_of":        arabica_latest_date.isoformat() if arabica_latest_date else None,
        "source_url":   arabica_source_url,
        "snapshots":    arabica_snapshots,
        "latest_detail": arabica_latest,
        "errors":       arabica_errors,
    }

    robusta_json = {
        "generated_at":  now,
        "as_of":         robusta_latest_date.isoformat() if robusta_latest_date else None,
        "snapshots":     robusta_snapshots,
        "latest_detail": {
            "stock_report":     robusta_latest_stock,
            "stock_report_url": robusta_stock_url,
        },
        "recent_activity": {
            "gradings":          gradings_all,
            "grading_appeals":   appeals_all,
            "iss_recv_daily":    [{"date": d.isoformat(), **v} for d, v in sorted(iss_recv_all.items())],
            "tenders":           [{"date": d.isoformat(), **v} for d, v in sorted(tenders_all.items())],
            "grading_overview":  [{"date": d.isoformat(), **v} for d, v in sorted(overview_all.items())],
            "infested_warrants": infested_all,
        },
        "monthly": {
            "iss_recv_monthly": monthly_iss_recv,
            "age_allowance":    age_allowance_list,
        },
    }

    if merge:
        existing_a = _load_existing_json(OUT_DIR / "certified_stocks_arabica.json")
        existing_r = _load_existing_json(OUT_DIR / "certified_stocks_robusta.json")
        if existing_a:
            n_old = len(existing_a.get("snapshots") or [])
            arabica_json = _merge_arabica(arabica_json, existing_a)
            print(f"[merge] arabica: {n_old} existing snapshots → {len(arabica_json['snapshots'])} after merge")
        if existing_r:
            n_old = len(existing_r.get("snapshots") or [])
            robusta_json = _merge_robusta(robusta_json, existing_r)
            ra = robusta_json["recent_activity"]
            print(f"[merge] robusta: {n_old} existing snapshots → {len(robusta_json['snapshots'])} after merge "
                  f"(events: gradings={len(ra['gradings'])} iss={len(ra['iss_recv_daily'])} "
                  f"tend={len(ra['tenders'])} overview={len(ra['grading_overview'])} "
                  f"infested={len(ra['infested_warrants'])} appeals={len(ra['grading_appeals'])})")

    if write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "certified_stocks_arabica.json").write_text(
            json.dumps(arabica_json, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        (OUT_DIR / "certified_stocks_robusta.json").write_text(
            json.dumps(robusta_json, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        print(f"=== wrote {OUT_DIR / 'certified_stocks_arabica.json'}")
        print(f"=== wrote {OUT_DIR / 'certified_stocks_robusta.json'}")

    return {"arabica": arabica_json, "robusta": robusta_json}


# ── Smoke test ───────────────────────────────────────────────────────────────
# Hits each of the 10 source URLs ONCE against the dates the user verified in
# the probe. If any return non-200 here, the problem is URL/access not data
# volume — not whether ICE happened to publish that day.

_SMOKE_URLS = [
    ("arabica_xls",            F.ARABICA_DAILY_XLS.format(yyyymmdd="20260527")),
    ("stock_report",           F.ROBUSTA_STOCK_REPORT_CSV.format(yyyymmdd="20260527", hhmmss="103021")),
    ("age_allowance",          F.ROBUSTA_AGE_ALLOWANCE_XLSX.format(yyyymmdd="20260430")),
    ("grading_overview",       F.ROBUSTA_GRADING_OVERVIEW_PDF.format(yymmdd="260521")),
    ("gradings",               F.ROBUSTA_GRADINGS_TXT.format(yymmdd="260521", n=1)),
    ("iss_recv_daily",         F.ROBUSTA_ISS_RECV_DAILY.format(yymmdd="260522")),
    ("iss_recv_monthly",       F.ROBUSTA_ISS_RECV_MONTHLY.format(yymmdd="260331")),
    ("grading_appeals",        F.ROBUSTA_GRADING_APPEALS.format(yymmdd="250923", n=1)),
    ("tenders",                F.ROBUSTA_TENDERS.format(yymmdd="260522")),
    ("infested_warrant",       F.ROBUSTA_INFESTED_WARRANT.format(yymmdd="251215")),
]


def smoke() -> int:
    """Hit each of the 10 probe-verified URLs once. Returns # of 200s."""
    print("=== SMOKE: probe-verified URLs (expect 10/10 HTTP 200) ===\n")
    ok = 0
    for name, url in _SMOKE_URLS:
        r = _http_get(url)
        if r is not None and r.status_code == 200 and r.content:
            ok += 1
            ctype = r.headers.get("Content-Type", "")[:40]
            print(f"  ✓ {name:18}  HTTP 200  {len(r.content):>10,} B  {ctype}")
    print(f"\n=== SMOKE: {ok}/{len(_SMOKE_URLS)} OK ===")
    return ok


def _cli() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30,
                    help="business days to look back (default 30)")
    ap.add_argument("--no-write", action="store_true",
                    help="print summary only, don't write JSONs")
    ap.add_argument("--smoke", action="store_true",
                    help="hit probe-verified URLs once each; skip the backfill")
    ap.add_argument("--no-merge", action="store_true",
                    help="overwrite the JSONs instead of merging with existing")
    args = ap.parse_args()

    if args.smoke:
        ok = smoke()
        sys.exit(0 if ok == len(_SMOKE_URLS) else 1)

    out = run(days_back=args.days, write=not args.no_write, merge=not args.no_merge)
    print(f"\nSUMMARY: arabica snapshots={len(out['arabica']['snapshots'])} · "
          f"robusta snapshots={len(out['robusta']['snapshots'])} · "
          f"gradings={len(out['robusta']['recent_activity']['gradings'])}")


if __name__ == "__main__":
    _cli()
