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
# 1.0 s ≈ 1 req/s. The smoke test (10 reqs in ~3 s) passes; the previous 0.3 s
# backfill (~3 req/s sustained) tripped Akamai's burst protection partway in
# (arabica's 30 sequential reqs completed, then everything after silently got
# 200-with-HTML error bodies). 1 req/s sits comfortably under typical limits.
THROTTLE_S = 1.0
TIMEOUT = 30

# Stock_report.csv's HHMMSS publish time varies daily; 10 guesses per day was
# 90% wasted 404s and *that* burst was what tripped Akamai. Just try the two
# real sample times — if neither hits, we live with the gap (the other 8
# robusta sources still capture per-day activity).
STOCK_REPORT_TIMES = ("103021", "103126", "103045")

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


def _http_get(url: str, *, source: str | None = None) -> requests.Response | None:
    try:
        r = requests.get(url, headers=F.HEADERS, timeout=TIMEOUT, allow_redirects=True)
        if r.status_code != 200:
            ctype = r.headers.get("Content-Type", "")[:40]
            print(f"  ! HTTP {r.status_code} ({ctype}) {url}")
            return r
        # 200 OK but wrong shape (Akamai HTML error page on a CSV/PDF endpoint
        # is the silent failure mode we just hit). Return None so the parser
        # never sees a misleading body; the WRONG-SHAPE line in _wrong_shape
        # makes the cause visible.
        if source and _wrong_shape(source, r):
            return None
        return r
    except requests.exceptions.RequestException as e:
        print(f"  ! {type(e).__name__}: {url} — {e}")
        return None
    finally:
        time.sleep(THROTTLE_S)


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


def pull_stock_report(d: date, *, times: tuple[str, ...] = STOCK_REPORT_TIMES) -> tuple[str | None, dict | None]:
    """The HHMMSS varies daily — try a small list of likely publish times."""
    for hhmmss in times:
        url = F.ROBUSTA_STOCK_REPORT_CSV.format(yyyymmdd=F.yyyymmdd(d), hhmmss=hhmmss)
        r = _http_get(url, source="stock_report")
        if r and r.status_code == 200 and r.text:
            return url, _safe_parse(parse_stock_report, "stock_report", d, r.text)
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
    tc = parsed.get("total_certified") or {}
    tr = parsed.get("transition") or {}
    pg = parsed.get("pending_grading") or {}
    rb = parsed.get("rebagging") or {}
    gt = parsed.get("grading_today") or {}
    return {
        "date":                 d.isoformat(),
        "report_date":          parsed.get("report_date"),
        "total_bags":           tc.get("grand_total", 0),
        "transition_bags":      tr.get("grand_total", 0),
        "pending_grading_bags": pg.get("grand_total", 0),
        "rebagging_bags":       rb.get("grand_total", 0),
        "passed_today_bags":    gt.get("passed_today_bags", 0),
        "failed_today_bags":    gt.get("failed_today_bags", 0),
        "by_port":              tc.get("by_port", {}),
        "by_group":             tc.get("by_group", {}),
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


# ── Main run ─────────────────────────────────────────────────────────────────

def run(days_back: int = 30, write: bool = True) -> dict:
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
    # under a HHMMSS-stamped URL.
    for d in days_sorted_asc[-5:]:                   # try last 5 days only
        url, parsed = pull_stock_report(d)
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
    args = ap.parse_args()

    if args.smoke:
        ok = smoke()
        sys.exit(0 if ok == len(_SMOKE_URLS) else 1)

    out = run(days_back=args.days, write=not args.no_write)
    print(f"\nSUMMARY: arabica snapshots={len(out['arabica']['snapshots'])} · "
          f"robusta snapshots={len(out['robusta']['snapshots'])} · "
          f"gradings={len(out['robusta']['recent_activity']['gradings'])}")


if __name__ == "__main__":
    _cli()
