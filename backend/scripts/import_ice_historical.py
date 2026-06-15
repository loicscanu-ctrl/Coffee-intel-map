#!/usr/bin/env python3
"""import_ice_historical.py — parse a folder of ICE source files into the JSONs.

When the rate-limited scraper isn't a fit (e.g. a big historical backfill), you
can hand the daily files in directly. Drop a directory of files into the script
and it identifies each by filename, parses with the matching parser, builds
snapshots in the same shape the orchestrator emits, and MERGES into
frontend/public/data/certified_stocks_arabica.json + _robusta.json (preserving
whatever was already there from prior runs).

    python backend/scripts/import_ice_historical.py /path/to/files
    python backend/scripts/import_ice_historical.py /path/to/files --no-write

Recognised filename patterns (any depth under the given dir):
    coffee_cert_stock_YYYYMMDD.xls              ← arabica daily
    Stock_Report_RC_YYYYMMDD_HHMMSS.csv         ← robusta stock report
    Robusta_Coffee_Age_Allowance_YYYYMMDD.xlsx
    GradingOverviewCoffee_YYMMDD.pdf
    gradrc_YYMMDD-N.txt                         ← gradings
    apprc_YYMMDD-N.txt                          ← grading appeals
    irrrc_YYMMDD.txt                            ← iss/recv daily
    irrrc_mYYMMDD.txt                           ← iss/recv monthly
    tendrc_YYMMDD.txt                           ← tenders
    INFESTEDCOFFEEWARRANT_YYMMDD.pdf

Unrecognised files are silently skipped (so a folder mixing source files with
e.g. a README or a zip artefact is fine).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import UTC, date, datetime
from pathlib import Path

# Make backend/ importable when running from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scraper.sources.ice_certified_stocks.orchestrate import (
    OUT_DIR,
    _arabica_snapshot,
    _merge_arabica,
    _merge_robusta,
    _robusta_snapshot,
)
from scraper.sources.ice_certified_stocks.parse_age_allowance import parse_age_allowance_xlsx
from scraper.sources.ice_certified_stocks.parse_arabica_xls import parse_arabica_xls
from scraper.sources.ice_certified_stocks.parse_gradings import parse_gradings
from scraper.sources.ice_certified_stocks.parse_iss_recv import (
    parse_iss_recv_daily,
    parse_iss_recv_monthly,
)
from scraper.sources.ice_certified_stocks.parse_pdfs import (
    parse_grading_overview_pdf,
    parse_infested_warrant_pdf,
)
from scraper.sources.ice_certified_stocks.parse_stock_report import parse_stock_report
from scraper.sources.ice_certified_stocks.parse_tenders import parse_tenders


def _ymd8(s: str) -> date:  return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
def _ymd6(s: str) -> date:  return date(2000 + int(s[:2]), int(s[2:4]), int(s[4:6]))


# (pattern, kind, parser, date-from-match, content-is-binary)
PATTERNS = [
    (re.compile(r"coffee_cert_stock_(\d{8})\.xls$", re.I),
        "arabica_xls",      parse_arabica_xls,           lambda m: _ymd8(m.group(1)), True),
    (re.compile(r"Stock_Report_RC_(\d{8})_\d{6}\.csv$", re.I),
        "stock_report",     parse_stock_report,          lambda m: _ymd8(m.group(1)), False),
    (re.compile(r"Robusta_Coffee_Age_Allowance_(\d{8})\.xlsx$", re.I),
        "age_allowance",    parse_age_allowance_xlsx,    lambda m: _ymd8(m.group(1)), True),
    (re.compile(r"GradingOverviewCoffee_(\d{6})\.pdf$", re.I),
        "grading_overview", parse_grading_overview_pdf,  lambda m: _ymd6(m.group(1)), True),
    (re.compile(r"gradrc_(\d{6})-\d+\.txt$", re.I),
        "gradings",         parse_gradings,              lambda m: _ymd6(m.group(1)), False),
    (re.compile(r"apprc_(\d{6})-\d+\.txt$", re.I),
        "grading_appeals",  parse_gradings,              lambda m: _ymd6(m.group(1)), False),
    (re.compile(r"irrrc_m(\d{6})\.txt$", re.I),
        "iss_recv_monthly", parse_iss_recv_monthly,      lambda m: _ymd6(m.group(1)), False),
    (re.compile(r"irrrc_(\d{6})\.txt$", re.I),
        "iss_recv_daily",   parse_iss_recv_daily,        lambda m: _ymd6(m.group(1)), False),
    (re.compile(r"tendrc_(\d{6})\.txt$", re.I),
        "tenders",          parse_tenders,               lambda m: _ymd6(m.group(1)), False),
    (re.compile(r"INFESTEDCOFFEEWARRANT_(\d{6})\.pdf$", re.I),
        "infested_warrant", parse_infested_warrant_pdf,  lambda m: _ymd6(m.group(1)), True),
]


def _identify(f: Path):
    for pat, kind, parser, date_fn, is_binary in PATTERNS:
        m = pat.search(f.name)
        if m:
            return kind, parser, date_fn(m), is_binary
    return None


def run(root: Path, write: bool = True) -> dict:
    arabica_per_date:    dict[date, dict] = {}
    stock_per_date:      dict[date, dict] = {}
    iss_recv_daily:      dict[date, dict] = {}
    tenders_by_date:     dict[date, dict] = {}
    overview_by_date:    dict[date, dict] = {}
    gradings_list:       list[dict] = []
    appeals_list:        list[dict] = []
    infested_list:       list[dict] = []
    age_allowance_list:  list[dict] = []
    iss_recv_monthly_l:  list[dict] = []

    counts = {p[1]: 0 for p in PATTERNS}
    errors: list[str] = []
    files_found = 0
    unrecognised: list[str] = []

    print(f"=== scanning {root} ===")
    for f in sorted(root.rglob("*")):
        if not f.is_file():
            continue
        files_found += 1
        info = _identify(f)
        if not info:
            unrecognised.append(f.name)
            continue
        kind, parser, file_date, is_binary = info
        try:
            content = f.read_bytes() if is_binary else f.read_text(encoding="utf-8")
            parsed = parser(content)
        except Exception as e:  # noqa: BLE001
            msg = f"{f.name}: {type(e).__name__}: {e}"
            errors.append(msg)
            print(f"  ! parse {msg}")
            continue

        counts[kind] += 1
        print(f"  + {kind:18} {file_date.isoformat()}  {f.name}")
        if kind == "arabica_xls":      arabica_per_date[file_date]    = parsed
        elif kind == "stock_report":   stock_per_date[file_date]      = parsed
        elif kind == "iss_recv_daily": iss_recv_daily[file_date]      = parsed
        elif kind == "tenders":        tenders_by_date[file_date]     = parsed
        elif kind == "grading_overview": overview_by_date[file_date]  = parsed
        elif kind == "gradings":       gradings_list.append({"date": file_date.isoformat(), "url": f.name, **parsed})
        elif kind == "grading_appeals":appeals_list.append({"date": file_date.isoformat(), "url": f.name, **parsed})
        elif kind == "infested_warrant":infested_list.append({"date": file_date.isoformat(), **parsed})
        elif kind == "age_allowance":  age_allowance_list.append({"month_end": file_date.isoformat(), **parsed})
        elif kind == "iss_recv_monthly":iss_recv_monthly_l.append(parsed)

    print(f"\n=== scanned {files_found} files; matched: {sum(counts.values())}; "
          f"unrecognised: {len(unrecognised)}; parse errors: {len(errors)} ===")
    print(f"per-source counts: {counts}\n")

    # ── Build arabica JSON ──
    arabica_snaps = sorted(
        (_arabica_snapshot(d, p) for d, p in arabica_per_date.items()),
        key=lambda s: s["date"],
    )
    arabica_latest_date = max(arabica_per_date) if arabica_per_date else None
    arabica_latest      = arabica_per_date.get(arabica_latest_date) if arabica_latest_date else None

    # ── Build robusta JSON ──
    all_dates = (set(stock_per_date) | set(iss_recv_daily) | set(tenders_by_date)
                 | set(overview_by_date) | {date.fromisoformat(g["date"]) for g in gradings_list})
    robusta_snaps: list[dict] = []
    for d in sorted(all_dates):
        gradings_today = [g for g in gradings_list if g["date"] == d.isoformat()]
        snap = _robusta_snapshot(d, stock_per_date.get(d), gradings_today,
                                 iss_recv_daily.get(d), tenders_by_date.get(d))
        if any(v for k, v in snap.items() if k != "date"):
            robusta_snaps.append(snap)
    robusta_latest_date = max(stock_per_date) if stock_per_date else None
    robusta_latest_stock = stock_per_date.get(robusta_latest_date) if robusta_latest_date else None

    now_iso = datetime.now(UTC).isoformat(timespec="seconds")
    arabica_json = {
        "generated_at":  now_iso,
        "as_of":         arabica_latest_date.isoformat() if arabica_latest_date else None,
        "source_url":    None,
        "snapshots":     arabica_snaps,
        "latest_detail": arabica_latest,
        "errors":        [],
    }
    robusta_json = {
        "generated_at":  now_iso,
        "as_of":         robusta_latest_date.isoformat() if robusta_latest_date else None,
        "snapshots":     robusta_snaps,
        "latest_detail": {"stock_report": robusta_latest_stock, "stock_report_url": None},
        "recent_activity": {
            "gradings":          gradings_list,
            "grading_appeals":   appeals_list,
            "iss_recv_daily":    [{"date": d.isoformat(), **v} for d, v in sorted(iss_recv_daily.items())],
            "tenders":           [{"date": d.isoformat(), **v} for d, v in sorted(tenders_by_date.items())],
            "grading_overview":  [{"date": d.isoformat(), **v} for d, v in sorted(overview_by_date.items())],
            "infested_warrants": infested_list,
        },
        "monthly": {
            "iss_recv_monthly":  iss_recv_monthly_l,
            "age_allowance":     age_allowance_list,
        },
    }

    # ── Merge into whatever's on disk ──
    a_path = OUT_DIR / "certified_stocks_arabica.json"
    r_path = OUT_DIR / "certified_stocks_robusta.json"
    if a_path.exists():
        try:
            existing = json.loads(a_path.read_text(encoding="utf-8"))
            n_old = len(existing.get("snapshots") or [])
            arabica_json = _merge_arabica(arabica_json, existing)
            print(f"[merge] arabica: {n_old} existing snapshots → {len(arabica_json['snapshots'])} after merge")
        except Exception as e:  # noqa: BLE001
            print(f"[merge] arabica skipped ({e})")
    if r_path.exists():
        try:
            existing = json.loads(r_path.read_text(encoding="utf-8"))
            n_old = len(existing.get("snapshots") or [])
            robusta_json = _merge_robusta(robusta_json, existing)
            ra = robusta_json["recent_activity"]
            print(f"[merge] robusta: {n_old} existing snapshots → {len(robusta_json['snapshots'])} after merge "
                  f"(events: gradings={len(ra['gradings'])} iss={len(ra['iss_recv_daily'])} "
                  f"tend={len(ra['tenders'])} overview={len(ra['grading_overview'])} "
                  f"infested={len(ra['infested_warrants'])} appeals={len(ra['grading_appeals'])})")
        except Exception as e:  # noqa: BLE001
            print(f"[merge] robusta skipped ({e})")

    if write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        a_path.write_text(json.dumps(arabica_json, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        r_path.write_text(json.dumps(robusta_json, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        print(f"\n=== wrote {a_path}")
        print(f"=== wrote {r_path}")

    print(f"\nSUMMARY: arabica snapshots={len(arabica_json['snapshots'])} · "
          f"robusta snapshots={len(robusta_json['snapshots'])}")
    if errors:
        print(f"\n{len(errors)} parse errors:")
        for e in errors:
            print(f"  • {e}")
    return {"arabica": arabica_json, "robusta": robusta_json}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=Path, help="Directory of ICE source files (recursive scan)")
    ap.add_argument("--no-write", action="store_true",
                    help="parse + summarise only; don't touch the JSON files")
    args = ap.parse_args()
    if not args.dir.exists() or not args.dir.is_dir():
        print(f"ERROR: {args.dir} is not a directory", file=sys.stderr)
        sys.exit(1)
    run(args.dir, write=not args.no_write)


if __name__ == "__main__":
    main()
