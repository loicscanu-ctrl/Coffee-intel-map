"""One-shot probe for the ICE Report 12 EOD PDF endpoint.

Second iteration. First iteration confirmed:
  • theice.com 301-redirects to www.ice.com (canonical)
  • The backend endpoint is /api/icereportcenterservice/v1/reports/12/download/pdf
  • POST with form-urlencoded reaches the backend (got structured JSON,
    not a Cloudflare WAF block)
  • Both IFUS,KC and IEU,RC produce identical 409 → it's a body/header
    problem, not an exchange-code problem

This iteration sweeps the body shape and headers to narrow the 409 cause.
Each row in `CASES` below is one (label, body, header overrides). All
hit www.ice.com directly (skipping the 301 chain).
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import requests

ENDPOINT = "https://www.ice.com/marketdata/api/reports/12/download/pdf"

BASE_HEADERS = {
    "Accept":       "*/*",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin":       "https://www.ice.com",
    "Referer":      "https://www.ice.com/report/12",
    "User-Agent":   ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                     "AppleWebKit/537.36 (KHTML, like Gecko) "
                     "Chrome/124.0.0.0 Safari/537.36"),
}

OUT_DIR = Path("debug/ice_probe_eod")


def _prev_biz_day(d: date, n: int = 1) -> date:
    cur, count = d, 0
    while count < n:
        cur -= timedelta(days=1)
        if cur.weekday() < 5:
            count += 1
    return cur


def _probe(label: str, body: dict, extra_headers: dict | None = None) -> dict:
    headers = {**BASE_HEADERS, **(extra_headers or {})}
    print(f"\n── {label} ──")
    print(f"  body: {body}")
    try:
        r = requests.post(ENDPOINT, headers=headers, data=body, timeout=30,
                          allow_redirects=True)
    except requests.RequestException as e:
        print(f"  REQUEST FAILED: {e!r}")
        return {"label": label, "error": repr(e)}

    summary: dict = {
        "label":           label,
        "body_sent":       body,
        "http_status":     r.status_code,
        "content_type":    r.headers.get("content-type"),
        "content_length":  int(r.headers.get("content-length") or len(r.content)),
        "first_bytes_hex": r.content[:32].hex() if r.content else "",
        "looks_like_pdf":  r.content[:4] == b"%PDF",
        "final_url":       r.url,
    }
    print(f"  HTTP {r.status_code}  type={summary['content_type']}  "
          f"len={summary['content_length']:,} B  pdf={summary['looks_like_pdf']}")

    if r.content:
        ext = "pdf" if summary["looks_like_pdf"] else (
            "json" if "json" in (summary["content_type"] or "") else
            "html" if "html" in (summary["content_type"] or "") else
            "txt"
        )
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out = OUT_DIR / f"{label}.{ext}"
        out.write_bytes(r.content)
        summary["saved_to"] = str(out)
        if not summary["looks_like_pdf"]:
            try:
                preview = r.text[:500]
                print(f"  body: {preview}")
            except Exception:  # noqa: BLE001
                pass
    return summary


def main() -> int:
    target = _prev_biz_day(date.today()).isoformat()
    print(f"=== ICE EOD probe v2 · {len(_cases(target))} cases · target {target} ===")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    results = [_probe(label, body, extra) for label, body, extra in _cases(target)]

    summary_path = OUT_DIR / "summary.json"
    summary_path.write_text(json.dumps({"results": results}, indent=2),
                            encoding="utf-8")
    print(f"\n=== summary → {summary_path} ===")
    pdfs = sum(1 for r in results if r.get("looks_like_pdf"))
    print(f"=== {pdfs}/{len(results)} returned PDF magic bytes ===")
    return 0 if pdfs else 1


def _cases(target_date: str) -> list[tuple[str, dict, dict | None]]:
    """Matrix of variations to isolate what trips the 409. Each tuple is
    (label, form-body, header-override)."""
    return [
        # A. Baseline (matches user's blueprint exactly, hits ice.com directly).
        ("A1_baseline_KC", {"exchangeCodeAndContract": "IFUS,KC", "selectedDate": target_date}, None),
        ("A2_baseline_RC", {"exchangeCodeAndContract": "IEU,RC",  "selectedDate": target_date}, None),

        # B. Try without selectedDate — maybe Report 12 serves "latest" by default.
        ("B1_no_date_KC",  {"exchangeCodeAndContract": "IFUS,KC"}, None),
        ("B2_no_date_RC",  {"exchangeCodeAndContract": "IEU,RC"},  None),

        # C. Alternative date parameter names (existing spa_api.py reads multiple
        # field names off the response — server may accept multiple on the way in).
        ("C1_reportDate",  {"exchangeCodeAndContract": "IFUS,KC", "reportDate": target_date}, None),
        ("C2_asOfDate",    {"exchangeCodeAndContract": "IFUS,KC", "asOfDate":   target_date}, None),

        # D. Alternative date FORMATS for selectedDate.
        ("D1_us_slash",    {"exchangeCodeAndContract": "IFUS,KC", "selectedDate": target_date[5:7] + "/" + target_date[8:10] + "/" + target_date[:4]}, None),
        ("D2_iso_dt",      {"exchangeCodeAndContract": "IFUS,KC", "selectedDate": target_date + "T00:00:00Z"}, None),

        # E. Try empty body and JSON content-type (would be a hint that the user's
        # form-urlencoded reading was wrong; this is what spa_api.py uses for report 142).
        ("E1_json_body",   {"exchangeCodeAndContract": "IFUS,KC", "selectedDate": target_date},
            {"Content-Type": "application/json"}),

        # F. The DevTools intercept the user reported had a content-length of 57 ON
        # www.ice.com. Maybe theice.com requires a session cookie. Try sending a
        # plausible XSRF-style header (commonly required for SPA POSTs).
        ("F1_xsrf_header", {"exchangeCodeAndContract": "IFUS,KC", "selectedDate": target_date},
            {"X-XSRF-TOKEN": "probe-no-token-test"}),

        # G. Maybe the server wants the report-center API path directly (avoid the
        # marketdata proxy hop that returns the 301).
        # NOTE: this case overrides ENDPOINT inline below by short-circuiting.
    ]


if __name__ == "__main__":
    sys.exit(main())
