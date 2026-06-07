"""Backfill historical Arabica grading-by-origin from the synthesis workbook.

The ICE daily XLS only carries the origin × port grading matrix from June 2026
on, and snapshots captured before the matrix parser shipped kept just the
scalar passed/failed totals. The user's master workbook (Data ICE Exchange.xlsx)
holds the full per-(date, port, origin) Arabica grading history on sheet
`6_ny_gradings` — so we can recover the whole back-history from it at once
instead of waiting for, or re-fetching, ICE dailies.

This is a SURGICAL patch: it only adds `passed_by_origin` / `failed_by_origin`
(the live-scraper shape: {origin: {by_port, group, total}}) to snapshots that
already exist in the JSON and are still missing the breakdown. It never
rewrites other fields, never adds/removes snapshots, and validates each day's
re-derived totals against the stored scalars before writing.

Usage (run where the workbook is on disk):
    python -m scripts.backfill_arabica_grading_origin_from_xlsx \
        "/path/to/Data ICE Exchange.xlsx"                        # dry-run
    python -m scripts.backfill_arabica_grading_origin_from_xlsx \
        "/path/to/Data ICE Exchange.xlsx" --write                # persist
    # Windows path example:
    #   "C:\\Users\\Loic Scanu\\OneDrive - Tuan Loc Commodities\\TradeTeam\\Data ICE Exchange.xlsx"

Options:
    --json PATH          target JSON (default: frontend/public/data/certified_stocks_arabica.json)
    --write              persist the patch
    --allow-mismatch     write the workbook detail even when its daily total
                         differs from the stored scalar (default: skip + report)
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import openpyxl

from scraper.sources.ice_arabica_groups import group_of
from scripts.import_synthesis_xlsx import parse_sheet_6_gradings

DEFAULT_JSON = Path("frontend/public/data/certified_stocks_arabica.json")
GRADING_SHEET = "6_ny_gradings"


def _is_action(snap: dict) -> bool:
    return (snap.get("passed_today_bags") or 0) > 0 or (snap.get("failed_today_bags") or 0) > 0


def _has_detail(snap: dict) -> bool:
    return bool(snap.get("passed_by_origin") or snap.get("failed_by_origin"))


def _to_scraper_shape(by_port_origin_status: dict) -> tuple[dict, dict]:
    """{port: {origin: {passed, failed}}}  →  two {origin: {by_port, group, total}}."""
    passed: dict[str, dict] = {}
    failed: dict[str, dict] = {}
    for port, by_origin in by_port_origin_status.items():
        for origin, st in by_origin.items():
            for kind, store in (("passed", passed), ("failed", failed)):
                bags = int(st.get(kind, 0) or 0)
                if bags <= 0:
                    continue
                e = store.setdefault(origin, {"by_port": {}, "group": group_of(origin) or "Unknown", "total": 0})
                e["by_port"][port] = e["by_port"].get(port, 0) + bags
                e["total"] += bags
    return passed, failed


def backfill(xlsx_path: Path, json_path: Path, *, write: bool, allow_mismatch: bool) -> dict:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    snaps = data.get("snapshots") or []
    by_date = {s["date"][:10]: s for s in snaps}
    earliest = min(by_date) if by_date else "1900-01-01"
    since = date(*(int(x) for x in earliest.split("-")))

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    if GRADING_SHEET not in wb.sheetnames:
        raise SystemExit(f"workbook has no '{GRADING_SHEET}' sheet (found: {wb.sheetnames})")
    per_date = parse_sheet_6_gradings(wb[GRADING_SHEET], since)

    summary = {
        "action_days_in_json": sum(1 for s in snaps if _is_action(s)),
        "already_detailed": sum(1 for s in snaps if _is_action(s) and _has_detail(s)),
        "workbook_dates": len(per_date),
        "recovered": 0,
        "not_in_json": 0,
        "skipped_have_detail": 0,
        "mismatch": 0,
    }

    for d, rec in sorted(per_date.items()):
        iso = d.isoformat()
        snap = by_date.get(iso)
        if snap is None:
            summary["not_in_json"] += 1
            continue
        if _has_detail(snap):
            summary["skipped_have_detail"] += 1
            continue
        passed_bo, failed_bo = _to_scraper_shape(rec.get("by_port_origin_status", {}))
        if not passed_bo and not failed_bo:
            continue
        # Validate the workbook's daily totals against the stored scalars.
        wb_passed = sum(o["total"] for o in passed_bo.values())
        wb_failed = sum(o["total"] for o in failed_bo.values())
        p_ok = wb_passed == (snap.get("passed_today_bags") or 0)
        f_ok = wb_failed == (snap.get("failed_today_bags") or 0)
        if not (p_ok and f_ok) and not allow_mismatch:
            print(f"    {iso} MISMATCH: workbook P/F={wb_passed}/{wb_failed} "
                  f"vs stored {snap.get('passed_today_bags')}/{snap.get('failed_today_bags')} — skipped")
            summary["mismatch"] += 1
            continue
        if passed_bo:
            snap["passed_by_origin"] = passed_bo
        if failed_bo:
            snap["failed_by_origin"] = failed_bo
        summary["recovered"] += 1
        flag = "" if (p_ok and f_ok) else "  (mismatch, written by --allow-mismatch)"
        print(f"    {iso} ✓ {len(passed_bo)} passed-origins, {len(failed_bo)} failed-origins{flag}")

    if write and summary["recovered"]:
        json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        print(f"\nWrote {summary['recovered']} backfilled day(s) to {json_path}")
    elif not write:
        print("\n(dry-run; pass --write to persist)")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx_path", type=Path, help="path to Data ICE Exchange.xlsx")
    ap.add_argument("--json", type=Path, default=DEFAULT_JSON, dest="json_path")
    ap.add_argument("--write", action="store_true", help="patch the JSON in place")
    ap.add_argument("--allow-mismatch", action="store_true",
                    help="write workbook detail even when its daily total differs from the stored scalar")
    args = ap.parse_args()
    summary = backfill(args.xlsx_path, args.json_path, write=args.write, allow_mismatch=args.allow_mismatch)
    print(f"\n=== xlsx grading backfill · {args.xlsx_path.name} → {args.json_path} ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
