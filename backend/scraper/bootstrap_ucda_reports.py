"""
bootstrap_ucda_reports.py
One-off script: scans UCDA download IDs backwards from 1319,
parses monthly report PDFs, stores results in DB.

Daily analysis reports (also PDFs) are silently skipped.
Only HTTP errors (404/timeout) count toward the stop condition.

Run once:
    cd backend && python -m scraper.bootstrap_ucda_reports

Expects DATABASE_URL env var.
"""
import sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import SessionLocal
from scraper.sources.ucda_reports import download_pdf, parse_pdf, _upsert_report, _stored_months

_START_ID   = 1319
_SCAN_BACK  = 800   # IDs 1319→519; ~800/21 ≈ 38 months = ~3 years history
_MAX_HTTP_FAILS = 20   # stop after 20 consecutive non-PDF / 404 responses


def main():
    db = SessionLocal()
    stored = _stored_months(db)
    print(f"Already stored: {len(stored)} months")
    print(f"Scanning IDs {_START_ID} down to {_START_ID - _SCAN_BACK} ...")
    print("(Daily analysis PDFs are silently skipped)\n")

    http_fails  = 0
    new_count   = 0
    skip_count  = 0
    daily_skip  = 0

    for doc_id in range(_START_ID, _START_ID - _SCAN_BACK - 1, -1):
        pdf_bytes = download_pdf(doc_id)
        if pdf_bytes is None:
            http_fails += 1
            if http_fails >= _MAX_HTTP_FAILS:
                print(f"\nStopping: {_MAX_HTTP_FAILS} consecutive HTTP errors at ID {doc_id}")
                break
            continue

        http_fails = 0  # reset on any successful download

        data = parse_pdf(pdf_bytes)
        if data is None:
            daily_skip += 1  # silent
            continue

        month = data["month"]

        if month in stored:
            skip_count += 1
            continue

        _upsert_report(db, data)
        stored.add(month)
        new_count += 1
        s   = data["summary"]
        rob = s.get("robusta_bags", "?")
        ara = s.get("arabica_bags", "?")
        tot = s.get("total_bags", "?")
        price = s.get("avg_price_usd_kg", "")
        price_str = f" @ ${price}/kg" if price else ""
        print(f"  ID {doc_id:4d} | {month} | {tot:>8} bags (R:{rob} A:{ara}){price_str}")
        time.sleep(0.35)

    db.close()
    print(f"\nDone. {new_count} new months stored, {skip_count} already existed, "
          f"{daily_skip} daily/other PDFs skipped.")


if __name__ == "__main__":
    main()
