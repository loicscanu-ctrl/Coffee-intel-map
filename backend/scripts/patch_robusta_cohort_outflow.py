"""One-off: patch certified_stocks_robusta.json with the cohort-DNA fields.

The full xlsx importer re-runs nightly with the workbook attached. When
we ship the cohort pipeline in code, the existing on-disk JSON doesn't
have the new `monthly.implied_outflow` / `monthly.current_by_origin`
fields until the next nightly run. This script derives both from the
data the JSON already carries (`recent_activity.gradings`,
`monthly.age_allowance`, `port_origin_history`) and patches them in
place so the frontend can read them right away.

Idempotent — run again any time the live JSON refreshes.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from scraper.sources.ice_certified_stocks.cohort_outflow import (
    build_cohort_dna,
    build_current_by_origin,
    build_implied_outflow,
    build_port_alltime_dna,
)


def _gradings_per_port_month_origin(gradings: list) -> dict:
    """{port: {cohort_iso: {origin: lots}}} from recent_activity.gradings."""
    out: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(int))
    )
    for ev in gradings or []:
        date = ev.get("date") or ""
        if len(date) < 7:
            continue
        cohort = date[:7]
        for e in ev.get("entries") or []:
            if e.get("tenderable") is False:
                continue
            port = e.get("port") or "?"
            origin = (e.get("origin") or "?").strip()
            lots = e.get("lots") or 0
            if lots <= 0:
                continue
            out[port][cohort][origin] += lots
    return {p: {c: dict(o) for c, o in by_c.items()} for p, by_c in out.items()}


def patch(path: Path, write: bool) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    grads = (data.get("recent_activity") or {}).get("gradings") or []
    age_reports = (data.get("monthly") or {}).get("age_allowance") or []
    port_hist = data.get("port_origin_history") or {}

    gradings_per_pm = _gradings_per_port_month_origin(grads)
    cohort_dna = build_cohort_dna(gradings_per_pm)
    alltime_dna = build_port_alltime_dna(port_hist)
    # age_allowance in the JSON is newest-first; the algorithm wants oldest-first.
    # The JSON's age_allowance is oldest-first after the orchestrator's
    # merge step (the importer emits newest-first but _merge_robusta sorts
    # ascending). Use it as-is.
    age_chrono = age_reports
    implied_outflow = build_implied_outflow(
        age_chrono, cohort_dna, alltime_dna, gradings_per_pm,
    )
    latest = age_chrono[-1] if age_chrono else None
    current_by_origin = build_current_by_origin(
        latest, cohort_dna, alltime_dna, gradings_per_pm,
    ) if latest else {}

    data.setdefault("monthly", {})["implied_outflow"] = implied_outflow
    data["monthly"]["current_by_origin"] = current_by_origin

    summary = {
        "cohort_dna_ports":      len(cohort_dna),
        "cohort_dna_cells":      sum(len(v) for v in cohort_dna.values()),
        "implied_outflow_months": len(implied_outflow),
        "current_by_origin_ports": len(current_by_origin),
    }
    if write:
        path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("json_path", type=Path, nargs="?",
                    default=Path("frontend/public/data/certified_stocks_robusta.json"))
    ap.add_argument("--write", action="store_true",
                    help="patch the file in place (default: dry-run summary)")
    args = ap.parse_args()
    summary = patch(args.json_path, args.write)
    print(f"=== cohort patch · {args.json_path} ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    if not args.write:
        print("\n(dry-run; pass --write to persist)")


if __name__ == "__main__":
    main()
