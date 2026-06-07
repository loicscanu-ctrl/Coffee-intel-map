"""Backfill historical Arabica grading-by-origin from a grading-sheet export.

The ICE daily XLS only carries the origin × port grading matrix from June 2026
on, and snapshots captured before the matrix parser shipped kept just the
scalar passed/failed totals. The master grading sheet (NY grading, columns
date · port · status · bags · origin) holds the full per-(date, port, origin)
history — so we recover the whole back-history from a single export instead of
waiting for, or re-fetching, ICE dailies.

This is a SURGICAL patch: it only adds `passed_by_origin` / `failed_by_origin`
(the live-scraper shape: {origin: {by_port, group, total}}) to snapshots that
already exist in the JSON and are still missing the breakdown. It never
rewrites other fields, never adds/removes snapshots, and validates each day's
re-derived totals against the stored scalars before writing.

Input — a delimited export of the grading sheet (.csv / .tsv / .txt). The
delimiter is auto-detected (tab / comma / semicolon) and columns are matched by
header name, so column order doesn't matter. Rows with an empty origin (older
history, before ICE published origins) feed the day's pass/fail totals but
carry no origin, so those snapshots stay scalar-only — exactly as before.

Usage:
    python -m scripts.backfill_arabica_grading_origin_from_export grading.txt
    python -m scripts.backfill_arabica_grading_origin_from_export grading.csv --write

Options:
    --json PATH          target JSON (default: frontend/public/data/certified_stocks_arabica.json)
    --write              persist the patch
    --allow-mismatch     write the export's detail even when a day's total
                         differs from the stored scalar (default: skip + report)
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from scraper.sources.ice_arabica_groups import group_of

DEFAULT_JSON = Path("frontend/public/data/certified_stocks_arabica.json")


# ── small coercers ────────────────────────────────────────────────────────────

def _to_date(v) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, date):
        return v
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _int(v) -> int:
    if v is None or v == "":
        return 0
    try:
        return int(round(float(str(v).replace(",", ""))))
    except (TypeError, ValueError):
        return 0


def _str(v) -> str:
    return "" if v is None else str(v).strip()


def _kind(status: str) -> str | None:
    s = status.lower()
    return "passed" if s.startswith("pass") else "failed" if s.startswith("fail") else None


def _is_action(snap: dict) -> bool:
    return (snap.get("passed_today_bags") or 0) > 0 or (snap.get("failed_today_bags") or 0) > 0


def _has_detail(snap: dict) -> bool:
    return bool(snap.get("passed_by_origin") or snap.get("failed_by_origin"))


# ── read the delimited export → rows of (date, port, status, bags, origin) ────

def _rows_from_export(path: Path):
    raw = path.read_text(encoding="utf-8-sig")
    first = raw.split("\n", 1)[0]
    delim = "\t" if "\t" in first else ";" if (";" in first and "," not in first) else ","
    reader = csv.reader(raw.splitlines(), delimiter=delim)
    header = next(reader, None)
    if not header:
        raise SystemExit("empty file")
    low = [h.strip().lower() for h in header]

    def find(*keys, avoid=()):
        for i, h in enumerate(low):
            if any(k in h for k in keys) and not any(a in h for a in avoid):
                return i
        return None

    i_date = find("date")
    i_port = find("port_code", "port code") or find("port", avoid=("name",)) or find("port")
    i_status = find("status", "pass", "result")
    i_bags = find("bag", "lot", "qty", "quantity", "volume")
    i_origin = find("origin", "growth", "country")
    missing = [n for n, i in (("date", i_date), ("port", i_port), ("status", i_status),
                              ("bags", i_bags), ("origin", i_origin)) if i is None]
    if missing:
        raise SystemExit(f"file missing column(s) {missing}; header was: {header}")
    print(f"    delimiter={delim!r}; columns → date={header[i_date]}, port={header[i_port]}, "
          f"status={header[i_status]}, bags={header[i_bags]}, origin={header[i_origin]}")
    for row in reader:
        if not row or len(row) <= max(i_date, i_port, i_status, i_bags, i_origin):
            continue
        yield (_to_date(row[i_date]), _str(row[i_port]), _str(row[i_status]),
               _int(row[i_bags]), _str(row[i_origin]))


# ── aggregate → {date: {by_port_origin_status, passed, failed}} ───────────────

def _new_day():
    return {"passed": 0, "failed": 0,
            "by_port_origin_status": defaultdict(lambda: defaultdict(lambda: defaultdict(int)))}


def _aggregate(rows, since: date) -> dict:
    per_date: dict[date, dict] = defaultdict(_new_day)
    n = 0
    for d, port, status, bags, origin in rows:
        if d is None or d < since:
            continue
        kind = _kind(status)
        if kind is None or bags <= 0 or not port:   # skips "X Total" rows and zeros
            continue
        if port.lower() in {"total", "totals", "all", "grand total"}:
            continue
        per_date[d][kind] += bags
        if origin:                                   # older history has no origin
            per_date[d]["by_port_origin_status"][port][origin][kind] += bags
        n += 1
    print(f"    parsed {n} grading rows across {len(per_date)} dates.")
    return per_date


def _to_scraper_shape(by_port_origin_status: dict) -> tuple[dict, dict]:
    """{port: {origin: {passed, failed}}} → two {origin: {by_port, group, total}}."""
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


def backfill(src: Path, json_path: Path, *, write: bool, allow_mismatch: bool) -> dict:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    snaps = data.get("snapshots") or []
    by_date = {s["date"][:10]: s for s in snaps}
    earliest = min(by_date) if by_date else "1900-01-01"
    since = date(*(int(x) for x in earliest.split("-")))

    per_date = _aggregate(_rows_from_export(src), since)

    summary = {
        "action_days_in_json": sum(1 for s in snaps if _is_action(s)),
        "already_detailed": sum(1 for s in snaps if _is_action(s) and _has_detail(s)),
        "source_dates": len(per_date),
        "recovered": 0, "not_in_json": 0, "skipped_have_detail": 0, "mismatch": 0,
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
        passed_bo, failed_bo = _to_scraper_shape(rec["by_port_origin_status"])
        if not passed_bo and not failed_bo:          # day had no origin info
            continue
        wb_passed = sum(o["total"] for o in passed_bo.values())
        wb_failed = sum(o["total"] for o in failed_bo.values())
        p_ok = wb_passed == (snap.get("passed_today_bags") or 0)
        f_ok = wb_failed == (snap.get("failed_today_bags") or 0)
        if not (p_ok and f_ok) and not allow_mismatch:
            print(f"    {iso} MISMATCH: export P/F={wb_passed}/{wb_failed} "
                  f"vs stored {snap.get('passed_today_bags')}/{snap.get('failed_today_bags')} — skipped")
            summary["mismatch"] += 1
            continue
        if passed_bo:
            snap["passed_by_origin"] = passed_bo
        if failed_bo:
            snap["failed_by_origin"] = failed_bo
        summary["recovered"] += 1
        flag = "" if (p_ok and f_ok) else "  (mismatch, forced)"
        print(f"    {iso} ✓ {len(passed_bo)} passed-origins, {len(failed_bo)} failed-origins{flag}")

    if write and summary["recovered"]:
        json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        print(f"\nWrote {summary['recovered']} backfilled day(s) to {json_path}")
    elif not write:
        print("\n(dry-run; pass --write to persist)")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path,
                    help="delimited export of the grading sheet (.csv/.tsv/.txt)")
    ap.add_argument("--json", type=Path, default=DEFAULT_JSON, dest="json_path")
    ap.add_argument("--write", action="store_true", help="patch the JSON in place")
    ap.add_argument("--allow-mismatch", action="store_true",
                    help="write the export's detail even when a day's total differs from the stored scalar")
    args = ap.parse_args()
    summary = backfill(args.source, args.json_path, write=args.write, allow_mismatch=args.allow_mismatch)
    print(f"\n=== grading backfill · {args.source.name} → {args.json_path} ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
