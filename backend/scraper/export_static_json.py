"""
export_static_json.py — thin orchestrator.

Queries the database and exports static JSON files consumed directly by the
Vercel frontend (no live Render API call at page load). The per-topic exporters
live in scraper/exporters/<domain>.py; this module only owns the topic registry
(`_exporters`) and the run loop (`main`, with `--only` topic slicing).

    cd backend
    python -m scraper.export_static_json [--only cot,latest_prices,…]
"""

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from scraper.exporters.base import OUT_DIR
from scraper.exporters.cot import export_cot, export_macro_cot
from scraper.exporters.demand import export_demand_stocks, export_factory_mix_step
from scraper.exporters.futures import export_futures_chain, export_oi_fnd_chart
from scraper.exporters.health import export_health
from scraper.exporters.macro import export_freight, export_retail_cpi
from scraper.exporters.news import export_news
from scraper.exporters.prices import export_latest_prices, export_vn_physical_prices
from scraper.exporters.supply import (
    export_colombia,
    export_ethiopia,
    export_farmer_economics,
    export_farmer_selling,
    export_honduras,
    export_indonesia,
    export_uganda,
    export_vietnam_last,
    export_vietnam_supply,
)


def _exporters(db):
    """Ordered registry of (topic-key, exporter) pairs.

    `main()` runs the full list (nightly cron / manual). Passing `only=[…]`
    runs just that slice — workflow 1.4 maps each upstream scraper trigger to
    the topics it actually affects, avoiding a full 22-topic re-export on every
    run. `health` always runs so the freshness manifest stays current.

    oi_history.json is owned solely by the Daily OI workflow (1.3) and is NOT
    exported here (avoids clobbering 1.3's fresher copy with a stale one).
    """
    from scraper.sources.origin_prices_history import export_origin_prices_history

    def _news():  # map feed — defensive: must not abort the rest of the publish
        try:
            export_news(db)
        except Exception as e:  # noqa: BLE001
            print(f"  news.json → skipped ({e})")

    def _country_pins():
        try:
            from scraper.build_country_pins import export_country_pins
            export_country_pins()
        except Exception as e:  # noqa: BLE001
            print(f"  countries.json → skipped ({e})")

    return [
        ("futures_chain",         lambda: export_futures_chain(db)),
        ("oi_fnd_chart",          lambda: export_oi_fnd_chart(db)),
        ("cot",                   lambda: export_cot(db)),
        ("macro_cot",             lambda: export_macro_cot(db)),
        ("freight",               lambda: export_freight(db)),
        ("farmer_economics",      lambda: export_farmer_economics(db)),
        ("farmer_selling",        lambda: export_farmer_selling()),
        ("vietnam_last",          lambda: export_vietnam_last()),
        ("vietnam_supply",        lambda: export_vietnam_supply()),
        ("colombia",              lambda: export_colombia(db)),
        ("honduras",              lambda: export_honduras(db)),
        ("indonesia",             lambda: export_indonesia(db)),
        ("uganda",                lambda: export_uganda(db)),
        ("ethiopia",              lambda: export_ethiopia(db)),
        ("demand_stocks",         lambda: export_demand_stocks(db)),
        ("factory_mix",           lambda: export_factory_mix_step()),
        ("retail_cpi",            lambda: export_retail_cpi(db)),
        ("latest_prices",         lambda: export_latest_prices(db)),
        ("vn_physical_prices",    lambda: export_vn_physical_prices(db)),
        ("origin_prices_history", lambda: export_origin_prices_history(db)),
        ("news",                  _news),
        ("country_pins",          _country_pins),
        ("health",                lambda: export_health(db)),
    ]


def main(only=None):
    only_set = set(only) if only else None
    if only_set is not None:
        # Validate before opening a DB session (building the registry with a
        # None db only reads the keys — the exporters aren't invoked).
        known = [k for k, _ in _exporters(None)]
        unknown = only_set - set(known)
        if unknown:
            raise SystemExit(f"Unknown export topic(s): {', '.join(sorted(unknown))}. Known: {', '.join(known)}")
    print(f"Exporting static JSON files... [{'full' if only_set is None else ','.join(sorted(only_set))}]")
    db = SessionLocal()
    try:
        for key, fn in _exporters(db):
            # `health` always runs so the freshness manifest reflects this publish.
            if only_set is not None and key != "health" and key not in only_set:
                continue
            fn()
    finally:
        db.close()
    print(f"Done → {OUT_DIR}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Export DB → static JSON for the frontend.")
    ap.add_argument("--only", default="", help="comma-separated topic keys to export (default: all topics)")
    args = ap.parse_args()
    topics = [t.strip() for t in args.only.split(",") if t.strip()]
    main(topics or None)
