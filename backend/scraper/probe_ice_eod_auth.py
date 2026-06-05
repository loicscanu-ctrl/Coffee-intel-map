"""ICE Report 12 EOD probe — auth-replay variant.

User provided a working browser-captured cURL with Cloudflare-issued
session cookies (`__cf_bm`, `_cfuvid`) + ICE session cookies
(`reportCenterCookie`, `iceBanner=rcDisclaimer`). This script replays
that exact request from a GH runner.

Hypothesis: if those cookies work from the runner, then the only thing
missing from our requests-only approach was the cookies, and the next
step is to build a cookie-refresh helper (Playwright or curl_cffi).
If they DON'T work from the runner, ICE is IP-binding cookies and we
need a different approach entirely.

Inputs (read from env):
  ICE_COOKIES        — full Cookie: header value, pasted from the
                       browser's curl. Required.
  ICE_TARGET_DATE    — YYYY-MM-DD; defaults to yesterday (biz-day).
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import requests

ENDPOINT = "https://www.ice.com/marketdata/api/reports/12/download/pdf"
OUT_DIR  = Path("debug/ice_probe_eod")

# Same set of headers the user's browser sent — minus Cookie (passed
# separately via the `cookies=` arg).
HEADERS = {
    "Accept":           "*/*",
    "Accept-Language":  "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7,vi;q=0.6",
    "Content-Type":     "application/x-www-form-urlencoded",
    "Origin":           "https://www.ice.com",
    "Referer":          "https://www.ice.com/report/12",
    "Sec-Fetch-Dest":   "empty",
    "Sec-Fetch-Mode":   "cors",
    "Sec-Fetch-Site":   "same-origin",
    "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/148.0.0.0 Safari/537.36",
    "sec-ch-ua":        '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform":'"Windows"',
}


def _prev_biz_day(d: date, n: int = 1) -> date:
    cur, count = d, 0
    while count < n:
        cur -= timedelta(days=1)
        if cur.weekday() < 5:
            count += 1
    return cur


def _parse_cookie_header(cookie_str: str) -> dict[str, str]:
    """Parse a raw `Cookie:` header value into a {name: value} dict for
    requests. Tolerates extra whitespace and Cookie values that contain `=`."""
    out: dict[str, str] = {}
    for kv in cookie_str.split(";"):
        kv = kv.strip()
        if "=" not in kv:
            continue
        name, _, value = kv.partition("=")
        out[name.strip()] = value.strip()
    return out


def main() -> int:
    cookie_str = os.environ.get("ICE_COOKIES", "").strip()
    if not cookie_str:
        print("ERROR: ICE_COOKIES env var is empty. Set it to the full Cookie:")
        print("       header value from your browser's DevTools curl (the long")
        print("       string after `-b ` in the cURL).")
        return 2

    target = os.environ.get("ICE_TARGET_DATE") or _prev_biz_day(date.today()).isoformat()
    cookies = _parse_cookie_header(cookie_str)
    print(f"=== ICE EOD auth-replay · target {target} · {len(cookies)} cookies ===")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    for label, body in (
        ("arabica_KC", {"exchangeCodeAndContract": "IFUS,KC", "selectedDate": target}),
        ("robusta_RC", {"exchangeCodeAndContract": "IEU,RC",  "selectedDate": target}),
    ):
        print(f"\n── {label} ──")
        try:
            r = requests.post(ENDPOINT, headers=HEADERS, cookies=cookies, data=body,
                              timeout=30, allow_redirects=True)
        except requests.RequestException as e:
            print(f"  REQUEST FAILED: {e!r}")
            results.append({"label": label, "error": repr(e)})
            continue

        summary = {
            "label":            label,
            "body":             body,
            "http_status":      r.status_code,
            "content_type":     r.headers.get("content-type"),
            "content_length":   int(r.headers.get("content-length") or len(r.content)),
            "content_disposition": r.headers.get("content-disposition"),
            "looks_like_pdf":   r.content[:4] == b"%PDF",
            "first_bytes_hex":  r.content[:16].hex(),
        }
        print(f"  HTTP {r.status_code}  type={summary['content_type']}  "
              f"len={summary['content_length']:,} B  pdf={summary['looks_like_pdf']}")
        if cd := summary["content_disposition"]:
            print(f"  Content-Disposition: {cd}")

        if r.content:
            ext = "pdf" if summary["looks_like_pdf"] else (
                "json" if "json" in (summary["content_type"] or "") else
                "html" if "html" in (summary["content_type"] or "") else "txt"
            )
            out = OUT_DIR / f"{label}_{target}.{ext}"
            out.write_bytes(r.content)
            summary["saved_to"] = str(out)
            if not summary["looks_like_pdf"]:
                print(f"  body preview: {r.text[:400]}")

        # If we got a PDF, immediately try parsing it for the Test subtab use.
        if summary["looks_like_pdf"]:
            try:
                import pdfplumber
                with pdfplumber.open(out) as pdf:
                    pages = len(pdf.pages)
                    first_text = (pdf.pages[0].extract_text() or "")[:600]
                summary["pdf_pages"]          = pages
                summary["pdf_first_text_500"] = first_text
                print(f"  PDF parsed: {pages} page(s)")
                print(f"  first 600 chars:\n    " + first_text.replace("\n", "\n    "))
            except Exception as e:  # noqa: BLE001
                print(f"  PDF parse failed: {e!r}")

        results.append(summary)

    summary_path = OUT_DIR / "summary.json"
    summary_path.write_text(json.dumps({"target_date": target, "results": results}, indent=2),
                            encoding="utf-8")
    pdfs = sum(1 for r in results if r.get("looks_like_pdf"))
    print(f"\n=== {pdfs}/{len(results)} PDFs · summary → {summary_path} ===")
    return 0 if pdfs else 1


if __name__ == "__main__":
    sys.exit(main())
