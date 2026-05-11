"""
export_uganda_standalone.py
Downloads UCDA monthly report PDFs directly and writes uganda_supply.json
WITHOUT requiring a database connection.

Use for local preview / testing:
    cd backend && python -m scraper.export_uganda_standalone

Scans IDs around 1319 down ~400 IDs to collect ~18+ months of reports.
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper.sources.ucda_reports import download_pdf, parse_pdf

ROOT    = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

_START_ID  = 1319
_SCAN_BACK = 400
_MAX_HTTP_FAILS = 15


def _build_monthly_series(reports: list[dict]) -> list[dict]:
    by_month: dict[str, dict] = {}

    for r in reports:
        s = r.get("summary", {})
        m = r["month"]
        rob  = s.get("robusta_bags")
        arab = s.get("arabica_bags")
        tot  = s.get("total_bags")
        if not tot:
            continue
        entry: dict = {"month": m, "total_bags": int(tot)}
        if rob and arab and tot:
            # Sanity: R+A should be within 5% of total; Uganda is ~75% robusta.
            # If arabica > robusta, suspect column swap — drop the split.
            split_sum = rob + arab
            if abs(split_sum - tot) / tot < 0.05 and rob >= arab:
                entry["robusta_bags"]  = int(rob)
                entry["arabica_bags"]  = int(arab)
                entry["robusta_pct"] = round(rob / tot * 100, 1)
                entry["arabica_pct"] = round(arab / tot * 100, 1)
            # else: drop unreliable split for this month
        elif rob:
            entry["robusta_bags"] = int(rob)
        elif arab:
            entry["arabica_bags"] = int(arab)
        if s.get("avg_price_usd_kg"):  entry["avg_price_usd_kg"] = s["avg_price_usd_kg"]
        if s.get("total_value"):       entry["total_value_usd"]  = int(s["total_value"])
        if s.get("yoy_qty_pct") is not None: entry["yoy_pct"]   = s["yoy_qty_pct"]
        # Prior year same month
        if s.get("total_bags_py"):
            py_m  = f"{int(m[:4]) - 1}-{m[5:]}"
            py_tot = s["total_bags_py"]
            if py_m not in by_month:
                py: dict = {"month": py_m, "total_bags": int(py_tot)}
                py_rob  = s.get("robusta_bags_py")
                py_arab = s.get("arabica_bags_py")
                if py_rob and py_arab and py_tot:
                    split_sum = py_rob + py_arab
                    if abs(split_sum - py_tot) / py_tot < 0.05 and py_rob >= py_arab:
                        py["robusta_bags"] = int(py_rob)
                        py["arabica_bags"] = int(py_arab)
                by_month[py_m] = py
        by_month[m] = entry

    series = sorted(by_month.values(), key=lambda x: x["month"])

    # Add YoY where missing
    total_map = {e["month"]: e.get("total_bags", 0) for e in series}
    for e in series:
        if "yoy_pct" not in e:
            yr, mo = e["month"][:4], e["month"][5:]
            py_m  = f"{int(yr) - 1}-{mo}"
            py_v  = total_map.get(py_m)
            if py_v and py_v > 0:
                e["yoy_pct"] = round((e["total_bags"] - py_v) / py_v * 100, 1)

    for e in series:
        e["total_k_bags"]   = round(e["total_bags"] / 1000, 1)
        if "robusta_bags" in e: e["robusta_k_bags"] = round(e["robusta_bags"] / 1000, 1)
        if "arabica_bags" in e: e["arabica_k_bags"] = round(e["arabica_bags"] / 1000, 1)

    return series


def main():
    print(f"Scanning IDs {_START_ID} -> {_START_ID - _SCAN_BACK} for UCDA monthly reports...")

    reports     = []
    http_fails  = 0
    seen_months: set[str] = set()

    for doc_id in range(_START_ID, _START_ID - _SCAN_BACK - 1, -1):
        pdf_bytes = download_pdf(doc_id)
        if pdf_bytes is None:
            http_fails += 1
            if http_fails >= _MAX_HTTP_FAILS:
                print(f"  Stop: {_MAX_HTTP_FAILS} consecutive HTTP errors at ID {doc_id}")
                break
            continue
        http_fails = 0

        data = parse_pdf(pdf_bytes)
        if data is None:
            continue  # daily report or non-monthly PDF

        month = data["month"]
        if month in seen_months:
            continue
        seen_months.add(month)
        reports.append(data)

        s   = data["summary"]
        tot = s.get("total_bags", "?")
        rob = s.get("robusta_bags", "?")
        ara = s.get("arabica_bags", "?")
        print(f"  ID {doc_id:4d} | {month} | {tot} bags  R:{rob}  A:{ara}")
        time.sleep(0.3)

    if not reports:
        print("No reports found — check network connectivity")
        return

    # Sort ascending
    reports.sort(key=lambda r: r["month"])
    latest = reports[-1]

    monthly_series = _build_monthly_series(reports)
    last_month     = monthly_series[-1]["month"] if monthly_series else ""

    ucda_detail = {
        "month":        latest["month"],
        "grades":       latest.get("grades", []),
        "exporters":    latest.get("exporters", []),
        "destinations": latest.get("destinations", []),
        "buyers":       latest.get("buyers", []),
        "farmgate":     latest.get("farmgate", {}),
    }

    result = {
        "country":    "uganda",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "exports": {
            "source":       "UCDA Monthly Reports",
            "last_updated": last_month,
            "unit":         "thousand 60-kg bags",
            "monthly":      monthly_series[-48:],
        },
        "ucda_detail": ucda_detail,
        "ucda_price":  None,
        "weather":     None,
        "enso":        None,
        "harvest_cal": {
            "main_crop_harvest":   "Oct-Feb",
            "main_crop_flowering": "Apr-Jun",
            "fly_crop_harvest":    "Apr-Jun",
            "fly_crop_flowering":  "Oct-Dec",
            "description": (
                "Uganda has two crop cycles. Main crop Oct-Feb (robusta & arabica); "
                "fly crop Apr-Jun. 75% robusta (Screen 15 benchmark), 25% arabica."
            ),
        },
        "production_mix": {
            "robusta_pct": 75, "arabica_pct": 25,
            "note": "Uganda is Africa's leading robusta exporter. Screen 15 benchmark.",
            "key_regions": {
                "robusta": ["Kasese", "Masaka", "Mbale"],
                "arabica": ["Mt Elgon", "Rwenzori"],
            },
        },
    }

    out_path = OUT_DIR / "uganda_supply.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote uganda_supply.json:")
    print(f"  {len(reports)} reports parsed ({reports[0]['month']} -> {reports[-1]['month']})")
    print(f"  {len(monthly_series)} months in series")
    print(f"  {len(ucda_detail['exporters'])} exporters, {len(ucda_detail['destinations'])} destinations, {len(ucda_detail['buyers'])} buyers")
    print(f"  Grades: {len(ucda_detail['grades'])}")


if __name__ == "__main__":
    main()
