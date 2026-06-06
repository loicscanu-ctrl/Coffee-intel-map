"""Backfill per-(origin, port) Arabica grading detail into historical snapshots.

The Arabica daily XLS publishes "TODAY'S GRADING SUMMARY" as an origin × port
matrix on action days (June 2026+), but snapshots captured before the matrix
parser shipped kept only the scalar `passed_today_bags` / `failed_today_bags`.
This script re-fetches the historical daily XLS for each action day that is
still missing the breakdown, re-parses it with the current parser, and patches
`passed_by_origin` / `failed_by_origin` into the snapshot in place — so we get
the full back-history at once instead of waiting for new action days.

Safety:
  • Only touches snapshots where (passed>0 or failed>0) AND the breakdown is
    absent. Days already backfilled are skipped (idempotent).
  • Validates the re-parsed grand totals against the stored scalars; on a
    mismatch the day is reported and left untouched (never corrupts history).
  • Legacy "N Bags Passed Today" days have no matrix in the source — they will
    report `no-matrix` and are left as-is (the scalar is all ICE published).

Network: needs egress to www.ice.com. If a session's allowlist blocks it,
run this where ICE is reachable (e.g. the scheduled scraper environment).

Usage:
    # See which dates would be fetched — no network, no writes:
    python -m scripts.backfill_arabica_grading_origin --plan

    # Re-fetch + parse + report coverage (no writes):
    python -m scripts.backfill_arabica_grading_origin

    # Persist the breakdown into the JSON:
    python -m scripts.backfill_arabica_grading_origin --write
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import date
from pathlib import Path

import requests

from scraper.sources.ice_certified_stocks import fetch as F
from scraper.sources.ice_certified_stocks.parse_arabica_xls import parse_arabica_xls

DEFAULT_JSON = Path("frontend/public/data/certified_stocks_arabica.json")


def _iso_to_date(iso: str) -> date:
    y, m, d = (int(x) for x in iso[:10].split("-"))
    return date(y, m, d)


def _is_action(snap: dict) -> bool:
    return (snap.get("passed_today_bags") or 0) > 0 or (snap.get("failed_today_bags") or 0) > 0


def _has_detail(snap: dict) -> bool:
    return bool(snap.get("passed_by_origin") or snap.get("failed_by_origin"))


def _candidates(snaps: list[dict]) -> list[dict]:
    """Action-day snapshots still missing the per-origin breakdown."""
    return [s for s in snaps if _is_action(s) and not _has_detail(s)]


def _fetch_xls(d: date, *, retries: int = 3, pause: float = 0.6) -> bytes | None:
    url = F.ARABICA_DAILY_XLS.format(yyyymmdd=F.yyyymmdd(d))
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=F.HEADERS, timeout=30, allow_redirects=True)
        except requests.RequestException as exc:
            print(f"    {d} network error: {exc}")
            time.sleep(pause * (attempt + 1))
            continue
        if r.status_code == 200 and r.content and len(r.content) > 256:
            ctype = (r.headers.get("Content-Type", "") or "").lower()
            if "html" in ctype:
                print(f"    {d} returned HTML (not the XLS) — treating as missing")
                return None
            return r.content
        if r.status_code == 404:
            return None
        if r.status_code == 429:
            wait = max(int(r.headers.get("Retry-After", "30")), 30)
            print(f"    {d} rate-limited; waiting {wait}s")
            time.sleep(wait)
            continue
        print(f"    {d} HTTP {r.status_code} ({len(r.content)} bytes)")
        time.sleep(pause * (attempt + 1))
    return None


def backfill(path: Path, *, write: bool, plan: bool, pause: float) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    snaps = data.get("snapshots") or []
    cands = _candidates(snaps)

    summary = {
        "action_days": sum(1 for s in snaps if _is_action(s)),
        "already_detailed": sum(1 for s in snaps if _is_action(s) and _has_detail(s)),
        "candidates": len(cands),
        "recovered": 0,
        "no_matrix": 0,
        "missing_file": 0,
        "mismatch": 0,
    }

    if plan:
        print("=== plan: action days missing per-origin grading detail ===")
        for s in cands:
            print(f"  {s['date']}  passed={s.get('passed_today_bags')}  failed={s.get('failed_today_bags')}")
        print(f"\n{len(cands)} day(s) would be re-fetched. (no network performed)")
        return summary

    for s in cands:
        d = _iso_to_date(s["date"])
        content = _fetch_xls(d, pause=pause)
        time.sleep(pause)
        if content is None:
            summary["missing_file"] += 1
            continue
        try:
            parsed = parse_arabica_xls(content)
        except Exception as exc:  # noqa: BLE001 — one bad file shouldn't abort the run
            print(f"    {s['date']} parse error: {exc}")
            summary["missing_file"] += 1
            continue
        gt = parsed.get("grading_today") or {}
        pd_ = gt.get("passed_detail")
        fd_ = gt.get("failed_detail")
        if not (pd_ and pd_.get("by_origin")) and not (fd_ and fd_.get("by_origin")):
            summary["no_matrix"] += 1
            continue
        # Validate against the stored scalars before trusting the matrix.
        p_ok = (not pd_) or pd_.get("grand_total", 0) == (s.get("passed_today_bags") or 0)
        f_ok = (not fd_) or fd_.get("grand_total", 0) == (s.get("failed_today_bags") or 0)
        if not (p_ok and f_ok):
            print(f"    {s['date']} MISMATCH: parsed P/F = "
                  f"{pd_.get('grand_total') if pd_ else '—'}/{fd_.get('grand_total') if fd_ else '—'} "
                  f"vs stored {s.get('passed_today_bags')}/{s.get('failed_today_bags')} — left untouched")
            summary["mismatch"] += 1
            continue
        if pd_ and pd_.get("by_origin"):
            s["passed_by_origin"] = pd_["by_origin"]
        if fd_ and fd_.get("by_origin"):
            s["failed_by_origin"] = fd_["by_origin"]
        summary["recovered"] += 1
        print(f"    {s['date']} ✓ recovered "
              f"({len(s.get('passed_by_origin') or {})} passed-origins, "
              f"{len(s.get('failed_by_origin') or {})} failed-origins)")

    if write and summary["recovered"]:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        print(f"\nWrote {summary['recovered']} backfilled day(s) to {path}")
    elif not write:
        print("\n(dry-run; pass --write to persist)")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("json_path", type=Path, nargs="?", default=DEFAULT_JSON)
    ap.add_argument("--write", action="store_true", help="patch the file in place")
    ap.add_argument("--plan", action="store_true", help="list candidate dates only — no network, no writes")
    ap.add_argument("--pause", type=float, default=0.6, help="seconds between requests (politeness)")
    args = ap.parse_args()
    summary = backfill(args.json_path, write=args.write, plan=args.plan, pause=args.pause)
    print(f"\n=== backfill summary · {args.json_path} ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
