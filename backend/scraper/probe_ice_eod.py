"""One-shot probe for the ICE Report 12 EOD PDF endpoint.

Pattern mirrors backend/scraper/probe_ice_stocks.py: hit the endpoint once
from a GitHub runner (where ice.com egress is reachable, unlike a typical
dev sandbox), log everything diagnostic, and write any successful response
body to debug/ice_probe/ so we can inspect the actual file shape before
writing a parser.

The endpoint pattern is documented in the user's DevTools intercept:
  POST https://www.theice.com/marketdata/api/reports/12/download/pdf
  Content-Type: application/x-www-form-urlencoded
  Body: exchangeCodeAndContract=IFUS,KC&selectedDate=YYYY-MM-DD

Comma in `IFUS,KC` gets URL-encoded by requests automatically (→ %2C),
which is what produces the 57-byte content-length the user observed.

What this script does NOT do:
  • DB writes
  • JSON output for the frontend
  • Long-running retries (a 403 here is the answer, not a transient)

This is a diagnostic. Once we see what comes back (PDF? JSON? HTML edge-
denial?), the production fetcher lives in a separate module.
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import requests

ENDPOINT = "https://www.theice.com/marketdata/api/reports/12/download/pdf"

# Two markets the EOD report exists for — both probed so we see if the
# IEU-side (Robusta) reaches the same WAF treatment as IFUS (Arabica).
MARKETS = {
    "arabica_KC": {"exchangeCodeAndContract": "IFUS,KC"},
    "robusta_RC": {"exchangeCodeAndContract": "IEU,RC"},
}

# Browser-spoof headers. Identical to the user's Chrome capture; matches the
# pattern in backend/scraper/sources/ice_certified_stocks/spa_api.py:38-43
# which is proven to work against ICE's Akamai/WAF from GH runners.
HEADERS = {
    "Accept":       "*/*",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin":       "https://www.theice.com",
    "Referer":      "https://www.theice.com/report/12",
    "User-Agent":   ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                     "AppleWebKit/537.36 (KHTML, like Gecko) "
                     "Chrome/124.0.0.0 Safari/537.36"),
}

OUT_DIR = Path("debug/ice_probe_eod")


def _prev_biz_day(d: date, n: int = 1) -> date:
    """N-th most recent business day on or before `d`. EOD reports publish
    after market close — pulling for N-1 weekday avoids racing publication
    when the script is exercised same-day."""
    cur = d
    count = 0
    while count < n:
        cur -= timedelta(days=1)
        if cur.weekday() < 5:
            count += 1
    return cur


def _probe_one(label: str, body: dict, target_date: str) -> dict:
    """POST once, dump headers + first 32 bytes + length, write any non-
    empty body to disk regardless of status (HTML/JSON error bodies are
    just as informative as a PDF success)."""
    payload = dict(body)
    payload["selectedDate"] = target_date
    print(f"\n── {label}  selectedDate={target_date} ──")
    try:
        r = requests.post(ENDPOINT, headers=HEADERS, data=payload, timeout=30,
                          allow_redirects=False)
    except requests.RequestException as e:
        print(f"  REQUEST FAILED: {e!r}")
        return {"label": label, "error": repr(e)}

    summary: dict = {
        "label":          label,
        "payload":        payload,
        "http_status":    r.status_code,
        "content_type":   r.headers.get("content-type"),
        "content_length": int(r.headers.get("content-length") or len(r.content)),
        "first_bytes_hex": r.content[:32].hex() if r.content else "",
        "looks_like_pdf":  r.content[:4] == b"%PDF",
    }
    cd = r.headers.get("content-disposition")
    if cd:
        summary["content_disposition"] = cd

    print(f"  HTTP {r.status_code}  type={summary['content_type']}  "
          f"len={summary['content_length']:,} B")
    if cd:
        print(f"  Content-Disposition: {cd}")
    print(f"  first bytes: {summary['first_bytes_hex']}  "
          f"PDF-magic: {summary['looks_like_pdf']}")

    # Write any non-empty body to disk so the artifact upload step can
    # surface it. PDF → .pdf, HTML/JSON/text → .{ext} based on content-type.
    if r.content:
        ext = "pdf" if summary["looks_like_pdf"] else (
            "html" if "html" in (summary["content_type"] or "") else
            "json" if "json" in (summary["content_type"] or "") else
            "txt"
        )
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out = OUT_DIR / f"{label}_{target_date}.{ext}"
        out.write_bytes(r.content)
        summary["saved_to"] = str(out)
        print(f"  saved → {out}")

        # If non-PDF, print first 800 chars of body for log-readable diagnosis.
        if not summary["looks_like_pdf"] and ext != "pdf":
            try:
                snippet = r.text[:800]
                print(f"  body preview:\n    {snippet}".replace("\n", "\n    "))
            except Exception:  # noqa: BLE001
                pass

    return summary


def main() -> int:
    target = _prev_biz_day(date.today()).isoformat()
    print(f"=== ICE EOD probe (Report 12) · target date {target} ===")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    results = [_probe_one(label, body, target) for label, body in MARKETS.items()]

    summary_path = OUT_DIR / "summary.json"
    summary_path.write_text(
        json.dumps({"target_date": target, "results": results}, indent=2),
        encoding="utf-8",
    )
    print(f"\n=== summary → {summary_path} ===")
    pdf_hits = sum(1 for r in results if r.get("looks_like_pdf"))
    print(f"=== {pdf_hits}/{len(results)} returned PDF magic bytes ===")
    return 0 if pdf_hits else 1


if __name__ == "__main__":
    sys.exit(main())
