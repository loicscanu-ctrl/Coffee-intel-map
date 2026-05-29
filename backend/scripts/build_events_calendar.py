#!/usr/bin/env python3
"""
build_events_calendar.py — generate backend/seed/events.json for 2026

Hand-maintained scheduling data is brittle; this script computes the
recurring entries (WASDE, ICO monthly, Cecafé monthly, ICE FND dates,
Vietnam Customs monthly bulletin) from known patterns so the file stays
in sync without manual data entry every month.

Run:
    python backend/scripts/build_events_calendar.py            # preview to stdout
    python backend/scripts/build_events_calendar.py --write    # overwrite seed/events.json

Known patterns:
  - WASDE: USDA publishes around the 10th-12th of each month (exact list
           in WASDE_2026_DATES below — copied from USDA's published
           schedule at oce.usda.gov).
  - ICO monthly: last business day of each month.
  - Cecafé monthly: ~17th-20th of the following month. Encoded as the 17th
           with a note explaining the date is approximate.
  - ICE KC (Arabica) months: H K N U Z (Mar May Jul Sep Dec).
    First Notice Day: 7 business days before the 1st business day of the
    delivery month. Matches `firstNoticeDay()` in the frontend chain logic.
  - ICE RC (Robusta) months: F H K N U X (Jan Mar May Jul Sep Nov).
    First Notice Day: 4 business days before the 1st business day of the
    delivery month.
  - Vietnam Customs: monthly export bulletin published 22-28 of each month
           (variable; encoded as the 25th with a date-range note).

To add a one-off (NCA, SCA, Sintercafé, Fed FOMC, etc.), append it to
ONE_OFFS below and re-run with --write.
"""
from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT  = Path(__file__).resolve().parents[2]
EVENTS_PATH        = REPO_ROOT / "backend" / "seed" / "events.json"
EVENTS_PUBLIC_PATH = REPO_ROOT / "frontend" / "public" / "data" / "events.json"

# ── Recurring patterns ────────────────────────────────────────────────────────

# USDA WASDE 2026 published schedule (oce.usda.gov; release time 12:00 ET = 16:00/17:00 UTC).
WASDE_2026_DATES = [
    ("2026-01-12", "12:00"),  # times in ET; we'll convert below
    ("2026-02-11", "12:00"),
    ("2026-03-10", "12:00"),
    ("2026-04-09", "12:00"),
    ("2026-05-12", "12:00"),
    ("2026-06-11", "12:00"),
    ("2026-07-10", "12:00"),
    ("2026-08-12", "12:00"),
    ("2026-09-11", "12:00"),
    ("2026-10-09", "12:00"),
    ("2026-11-10", "12:00"),
    ("2026-12-10", "12:00"),
]


# ── ICE FND helpers ───────────────────────────────────────────────────────────

# Month-letter → calendar month for ICE coffee.
KC_MONTHS = {"H": 3, "K": 5, "N": 7, "U": 9, "Z": 12}
RC_MONTHS = {"F": 1, "H": 3, "K": 5, "N": 7, "U": 9, "X": 11}


def _first_biz_day(year: int, month: int) -> date:
    """First Mon-Fri of the given month. (Holidays not adjusted — KC/RC
    FND calculation matches the frontend's `firstNoticeDay` which also
    ignores exchange holidays. Good enough for a watchlist.)"""
    d = date(year, month, 1)
    while d.weekday() >= 5:  # Sat=5, Sun=6
        d += timedelta(days=1)
    return d


def _sub_biz_days(d: date, n: int) -> date:
    """Subtract n business days (Mon-Fri)."""
    out = d
    while n > 0:
        out -= timedelta(days=1)
        if out.weekday() < 5:
            n -= 1
    return out


def _fnd_kc(year: int, month: int) -> date:
    return _sub_biz_days(_first_biz_day(year, month), 7)


def _fnd_rc(year: int, month: int) -> date:
    return _sub_biz_days(_first_biz_day(year, month), 4)


def _last_biz_day(year: int, month: int) -> date:
    """Last Mon-Fri of the given month."""
    # Jump to the 1st of next month, step back to find last weekday.
    if month == 12:
        d = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        d = date(year, month + 1, 1) - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


# ── One-offs — extend manually as new dates are confirmed ─────────────────────

ONE_OFFS: list[dict] = [
    # Example shape — leave empty for now; user populates as needed.
    # {
    #     "date":     "2026-04-08",
    #     "category": "other",
    #     "title":    "NCA Annual Convention 2026 — Day 1",
    #     "url":      "https://www.ncausa.org",
    #     "notes":    "US roaster industry conference, Phoenix AZ."
    # },
]


def build_events(year: int = 2026) -> list[dict]:
    out: list[dict] = []

    # WASDE
    for date_str, _time_et in WASDE_2026_DATES:
        out.append({
            "date":     date_str,
            "time":     "17:00",  # 12:00 ET → 17:00 UTC (winter; close enough for watchlist)
            "category": "wasde",
            "title":    f"USDA WASDE — {date_str[:7]} report",
            "url":      "https://www.usda.gov/oce/commodity/wasde",
            "notes":    "Monthly world S&D balance; coffee section usually drives end-of-year stocks revisions.",
        })

    # ICO monthly — last business day of each month.
    for m in range(1, 13):
        d = _last_biz_day(year, m)
        out.append({
            "date":     d.isoformat(),
            "category": "ico",
            "title":    f"ICO Coffee Market Report — {d.strftime('%b %Y')}",
            "url":      "https://www.ico.org/show_news.asp",
            "notes":    "Monthly composite indicator + export figures; published end of month.",
        })

    # Cecafé monthly — ~17th of the following month (approximate window).
    for m in range(1, 13):
        # Publishes the prior month's data; e.g. April figures in May ~17.
        pub_month = m + 1
        pub_year  = year
        if pub_month > 12:
            pub_month -= 12
            pub_year  += 1
        d = date(pub_year, pub_month, 17)
        # Skip the December 2026 publication for January 2027 if we're only doing 2026.
        if d.year != year:
            continue
        out.append({
            "date":     d.isoformat(),
            "category": "cecafe",
            "title":    f"Cecafé {date(year, m, 1).strftime('%b %Y')} monthly export figures",
            "url":      "https://www.cecafe.com.br",
            "notes":    "Approximate — published 15-20 of the month following the reference month.",
        })

    # ICE KC FND
    for letter, month in KC_MONTHS.items():
        d = _fnd_kc(year, month)
        out.append({
            "date":     d.isoformat(),
            "category": "fnd",
            "title":    f"KC{letter}{str(year)[-2:]} First Notice Day",
            "notes":    f"KC (Arabica) {date(year, month, 1).strftime('%b %Y')} contract — watch for max-OI roll into the next month in the prior 17 business days.",
        })

    # ICE RC FND
    for letter, month in RC_MONTHS.items():
        d = _fnd_rc(year, month)
        out.append({
            "date":     d.isoformat(),
            "category": "fnd",
            "title":    f"RC{letter}{str(year)[-2:]} First Notice Day",
            "notes":    f"RC (Robusta) {date(year, month, 1).strftime('%b %Y')} contract — watch for max-OI roll into the next month in the prior 26 business days.",
        })

    # Vietnam Customs — monthly statistical bulletin, ~25th of the month.
    for m in range(1, 13):
        d = date(year, m, 25)
        if d.weekday() >= 5:  # nudge to nearest weekday
            d -= timedelta(days=d.weekday() - 4)
        out.append({
            "date":     d.isoformat(),
            "category": "vietnam_customs",
            "title":    f"Vietnam Customs — {d.strftime('%b %Y')} export bulletin (approx)",
            "url":      "https://customs.gov.vn",
            "notes":    "Monthly export figures; published 22-28 of each month. Date is approximate — VN Customs has been irregular in 2025-26.",
        })

    out.extend(ONE_OFFS)

    # Sort by (date, time, title) for stable, readable output.
    out.sort(key=lambda e: (e.get("date", ""), e.get("time", "99:99"), e.get("title", "")))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year",  type=int, default=2026)
    ap.add_argument("--write", action="store_true",
                    help="Overwrite backend/seed/events.json. Default is preview-only.")
    args = ap.parse_args()

    events = build_events(args.year)

    # Preserve the schema block; replace only the events array.
    existing = json.loads(EVENTS_PATH.read_text(encoding="utf-8")) if EVENTS_PATH.exists() else {}
    schema   = existing.get("_schema", {})
    doc = {"_schema": schema, "events": events}

    payload = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    print(f"[build_events_calendar] {len(events)} events for {args.year}")
    if args.write:
        EVENTS_PATH.write_text(payload, encoding="utf-8")
        print(f"[build_events_calendar] wrote {EVENTS_PATH}")
        # Mirror into /public/data so the News tab can fetch it without a
        # separate copier step. Two files, one source of truth.
        EVENTS_PUBLIC_PATH.parent.mkdir(parents=True, exist_ok=True)
        EVENTS_PUBLIC_PATH.write_text(payload, encoding="utf-8")
        print(f"[build_events_calendar] mirrored to {EVENTS_PUBLIC_PATH}")
    else:
        print(payload[:2000] + ("...(truncated)" if len(payload) > 2000 else ""))


if __name__ == "__main__":
    main()
