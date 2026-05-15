"""
vn_coffee_export.py — Monthly scraper for Vietnam coffee export data.

Two-path source strategy against Vietnam Customs:

  Path A (primary): direct PDF URL prediction.
    Customs publishes monthly export bulletins at a predictable path on
    files.customs.gov.vn:
      /CustomsCMS/TONG_CUC/{pub_y}/{pub_m}/{pub_d}/{data_y}-t{data_m}-2x(vn-sb).pdf
    The publication date is typically the 8th–18th of the FOLLOWING month
    (e.g. December 2024 published 2025/1/10). We just iterate candidate
    days and download whichever URL responds 200. No portal session needed.

  Path B (fallback): customs portal + bridge API (vn_fertilizer pattern).
    Loads www.customs.gov.vn/index.jsp?pageId=441 via Playwright, calls
    LayDanhSachMoiCongBoServlet to enumerate publications, filters for "2x".
    Used only if path A returned nothing — also gives us diagnostic visibility
    into why the bridge fails when it does.

Each 2x bulletin contains the full HS-chapter commodity table for the month.
Coffee ("Cà phê") appears as a single row whose period_qty column gives that
month's exports in tonnes. We convert to thousand 60kg bags downstream.

Column layout in 2x PDFs (0-indexed, assumed parallel to 1n template):
  [0] row index  [1] commodity  [2] unit  [3] period_qty  [4] period_usd
  [5] ytd_cum_qty  [6] ytd_cum_usd
We capture all numeric cells defensively so misalignment shows up in the
cache file (raw_row field) rather than silently writing the wrong number.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re
import sys
import unicodedata
from datetime import date, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_PORTAL_URL = "https://www.customs.gov.vn/index.jsp?pageId=441&cid=192"
_BRIDGE_URL = (
    "https://www.customs.gov.vn/bridge"
    "?url=/customs/api/LayDanhSachMoiCongBoServlet"
    "&site=https://tongcuc.customs.gov.vn/"
)
_CACHE_PATH = Path(__file__).resolve().parents[2] / "scraper" / "cache" / "vn_coffee_export.json"

# Match "cà phê" with or without diacritics, allowing whitespace between syllables.
# Customs PDFs are usually properly accented but we normalize to be safe.
_COFFEE_RX = re.compile(r"\bca\s*phe\b", re.IGNORECASE)


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


# ── number helpers (reused from vn_fertilizer) ─────────────────────────────────

def _parse_vn_number(s: str | None) -> float:
    """Parse Vietnamese number format (period = thousands separator).

    "1.173.727" → 1173727.0
    "24.302"    → 24302.0  (three digits after the period → thousands sep)
    """
    if not s:
        return 0.0
    s = s.strip()
    if s.count(".") > 1:
        s = s.replace(".", "")
    else:
        parts = s.split(".")
        if len(parts) == 2 and len(parts[1]) == 3:
            s = s.replace(".", "")
    s = re.sub(r"[^\d.]", "", s)
    try:
        return float(s)
    except ValueError:
        return 0.0


# ── period code helpers ─────────────────────────────────────────────────────────

def _period_to_month(code: str) -> str | None:
    """'2024-t12-2x' → '2024-12', '2025-t3-2x' → '2025-03'. None if unparseable."""
    m = re.search(r"(\d{4})-t(\d{1,2})", code, re.IGNORECASE)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    return None


def _is_2x(code: str) -> bool:
    """'2x' = monthly export-by-commodity bulletin.

    Matches: '2x' standalone, or 2x bracketed in filename like '...-t12-2x(vn-sb).pdf'.
    Rejects: '5x' (by country), '1n' (imports), '3x'/'3n' (FDI-only).
    """
    return bool(
        re.search(r"[\-_(]2x(?=[\-_(\.]|$)", code, re.IGNORECASE)
        or re.search(r"^2x$", code, re.IGNORECASE)
    )


# ── PDF parsing ─────────────────────────────────────────────────────────────────

def _extract_coffee_row(pdf_bytes: bytes) -> dict | None:
    """Parse a Vietnam Customs 2x export PDF, return the coffee row's numeric cells.

    Returns {"period_qty_tonnes": X, "ytd_cum_qty_tonnes": Y, "raw_row": [...]}
    or None if no coffee row was found / parse failed.

    Strategy: scan every table on every page; find any row whose commodity cell
    matches /cà phê/i. Parse all numeric-looking cells; the period_qty is the
    first plausible monthly tonnage (~10k–500k tonnes), the cumulative is the
    largest value in the row.
    """
    try:
        import pdfplumber
    except ImportError:
        logger.error("[vn_coffee_export] pdfplumber not installed")
        return None

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for pg in pdf.pages:
                for table in (pg.extract_tables() or []):
                    for row in table:
                        if not row or len(row) < 3:
                            continue
                        commodity_cell = (row[1] or "") if len(row) > 1 else ""
                        normalized = _strip_accents(commodity_cell).lower()
                        if not _COFFEE_RX.search(normalized):
                            continue

                        # Found the coffee row. Capture every numeric cell.
                        raw = [c if c is not None else "" for c in row]
                        nums = [_parse_vn_number(c) for c in raw]

                        # Templated layout: [0] idx [1] name [2] unit [3] period_qty
                        # [4] period_usd [5] ytd_qty [6] ytd_usd
                        period_qty = nums[3] if len(nums) > 3 else 0.0
                        ytd_qty = nums[5] if len(nums) > 5 else 0.0

                        # Sanity: Vietnam exports ~125k-200k MT/month, ~1.5M MT/year.
                        # If period_qty looks too big to be monthly (e.g. > 800k),
                        # it might actually be the YTD column due to layout shift.
                        # Don't auto-correct — write raw values; humans can adjust.
                        return {
                            "period_qty_tonnes": round(period_qty, 1),
                            "ytd_cum_qty_tonnes": round(ytd_qty, 1),
                            "raw_row": [str(c).strip() if c else "" for c in raw],
                        }
        return None

    except Exception as e:
        logger.warning(f"[vn_coffee_export] PDF parse error: {e}")
        return None


# ── URL-prediction (path A) ─────────────────────────────────────────────────────

# Where customs hosts the published PDFs. No auth, but TLS cert is sometimes
# misconfigured so we verify=False (matches vn_fertilizer's _download_pdf).
_FILES_HOST = "https://files.customs.gov.vn"


def _months_to_try(months_back: int = 18) -> list[tuple[int, int]]:
    """Last `months_back` completed months, oldest first (e.g. for May 2026 → starts at Nov 2024)."""
    today = date.today()
    y, m = today.year, today.month - 1
    if m == 0:
        m, y = 12, y - 1
    out: list[tuple[int, int]] = []
    for _ in range(months_back):
        out.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return sorted(out)


def _candidate_pdf_urls(data_year: int, data_month: int) -> list[str]:
    """Generate likely PDF URLs for one data month.

    Publication month = data_month + 1. Publication day varies but clusters
    around the 10th — we try 8..20 in plausibility order. Both lowercase
    'tN' (modern convention, observed 2024+) and uppercase 'TN' (older
    bulletins) are emitted in case customs is inconsistent.
    """
    pub_year, pub_month = data_year, data_month + 1
    if pub_month > 12:
        pub_month = 1
        pub_year += 1

    # Plausibility-ordered days; first hit wins so order matters for HTTP cost.
    day_order = [10, 11, 9, 12, 8, 13, 14, 15, 7, 16, 6, 17, 5, 18, 19, 20]

    urls: list[str] = []
    for tprefix in ("t", "T"):
        for mfmt in (str(data_month), f"{data_month:02d}"):
            stem = f"{data_year}-{tprefix}{mfmt}-2x(vn-sb).pdf"
            for d in day_order:
                urls.append(f"{_FILES_HOST}/CustomsCMS/TONG_CUC/{pub_year}/{pub_month}/{d}/{stem}")
    # Dedupe while preserving order (data_month and f"{data_month:02d}" collide for 10–12).
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _try_download_pdf(url: str) -> bytes | None:
    """GET the URL; return PDF bytes on 200 + valid magic, else None.

    Distinguishes 404 (URL wrong → try next candidate) from 403 (Cloudflare
    or similar → URL pattern probably right but we're blocked) via logging.
    """
    import requests
    try:
        resp = requests.get(url, timeout=30, verify=False, allow_redirects=True)
        if resp.status_code == 200 and b"%PDF" in resp.content[:10]:
            return resp.content
        if resp.status_code == 403:
            logger.warning(f"[vn_coffee_export] 403 on {url} — host accessible but blocked")
        # 404 is expected for wrong candidate days — silent.
        return None
    except Exception as e:
        logger.warning(f"[vn_coffee_export] GET {url} threw {type(e).__name__}: {e}")
        return None


def _find_pdf_for_month(year: int, month: int) -> tuple[str, bytes] | None:
    """Try candidate URLs for (year, month); return (url, bytes) on first hit."""
    for url in _candidate_pdf_urls(year, month):
        body = _try_download_pdf(url)
        if body:
            return url, body
    return None


def _harvest_via_url_prediction(months_back: int = 18) -> dict[str, dict]:
    """Path A: discover bulletins by guessing the publication URL.

    Returns {month_key: extracted_dict} for every month where we found a PDF
    AND successfully parsed a coffee row from it.
    """
    per_month: dict[str, dict] = {}
    targets = _months_to_try(months_back)
    print(f"[vn_coffee_export] [pathA] trying {len(targets)} months via URL prediction")
    for (y, mo) in targets:
        key = f"{y}-{mo:02d}"
        hit = _find_pdf_for_month(y, mo)
        if not hit:
            print(f"[vn_coffee_export] [pathA] {key}: no PDF at predicted URLs")
            continue
        url, pdf_bytes = hit
        extracted = _extract_coffee_row(pdf_bytes)
        if not extracted:
            print(f"[vn_coffee_export] [pathA] {key}: PDF fetched but no coffee row — {url.rsplit('/', 1)[-1]}")
            continue
        per_month[key] = extracted
        print(f"[vn_coffee_export] [pathA] {key}: period={extracted['period_qty_tonnes']:.0f}t "
              f"ytd={extracted['ytd_cum_qty_tonnes']:.0f}t (pub {url.split('/TONG_CUC/', 1)[1].split('/', 3)[:3]})")
    return per_month


# ── portal helpers (path B fallback) ────────────────────────────────────────────

async def _fetch_publication_list(page) -> list[dict]:
    """Call LayDanhSachMoiCongBoServlet via page.evaluate() (browser session required).

    Heavy diagnostics: the previous version silently returned [] on any
    structural surprise. Both vn_fertilizer and vn_coffee_export observed
    'Got 0 publications' in production, so we now log the page state and
    the raw bridge response to figure out where the data is hiding.
    """
    try:
        print(f"[vn_coffee_export] page.url after goto: {page.url}")
        try:
            title = await page.title()
            body_preview = await page.evaluate("() => document.body ? document.body.innerText.slice(0, 400) : ''")
            print(f"[vn_coffee_export] page title: {title!r}")
            print(f"[vn_coffee_export] body preview: {body_preview!r}")
        except Exception as e:
            print(f"[vn_coffee_export] page introspection failed: {e}")

        # Try the bridge API. Return the raw response so we can see what came back.
        result = await page.evaluate(f"""async () => {{
            try {{
                const resp = await fetch(
                    '{_BRIDGE_URL}',
                    {{
                        method: 'POST',
                        headers: {{
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'x-requested-with': 'XMLHttpRequest'
                        }},
                        body: JSON.stringify({{"pageId": "441", "pageSize": 200, "pageIndex": 1}})
                    }}
                );
                const text = await resp.text();
                let parsed = null;
                try {{ parsed = JSON.parse(text); }} catch {{}}
                return {{
                    status:       resp.status,
                    ok:           resp.ok,
                    final_url:    resp.url,
                    body_len:     text.length,
                    body_preview: text.slice(0, 800),
                    parsed:       parsed
                }};
            }} catch (e) {{
                return {{ error: e.toString() }};
            }}
        }}""")

        print(f"[vn_coffee_export] bridge raw status={result.get('status')} ok={result.get('ok')} "
              f"len={result.get('body_len')} final_url={result.get('final_url')!r}")
        if result.get("error"):
            print(f"[vn_coffee_export] bridge JS error: {result['error']}")
            return []
        body_preview = result.get("body_preview", "")
        if body_preview:
            print(f"[vn_coffee_export] bridge body_preview: {body_preview!r}")

        parsed = result.get("parsed")
        if parsed is None:
            print("[vn_coffee_export] bridge response was not JSON")
            return []
        if isinstance(parsed, list):
            print(f"[vn_coffee_export] bridge returned top-level array, len={len(parsed)}")
            return parsed
        if isinstance(parsed, dict):
            print(f"[vn_coffee_export] bridge returned object, keys={list(parsed.keys())}")
            for key in ("data", "list", "items", "records", "danhSach", "result", "Data", "rows"):
                if isinstance(parsed.get(key), list):
                    print(f"[vn_coffee_export] using key {key!r}, len={len(parsed[key])}")
                    return parsed[key]
            # No expected key matched — log the first item-like value if any.
            for k, v in parsed.items():
                if isinstance(v, list) and v:
                    print(f"[vn_coffee_export] unexpected key {k!r} with list of {len(v)} — using it")
                    return v
        return []
    except Exception as e:
        print(f"[vn_coffee_export] publication list fetch threw {type(e).__name__}: {e}")
        return []


def _download_pdf(url: str) -> bytes | None:
    """Download PDF from files.customs.gov.vn (no auth required)."""
    import requests
    try:
        resp = requests.get(url, timeout=60, verify=False)
        resp.raise_for_status()
        if b"%PDF" not in resp.content[:10]:
            return None
        return resp.content
    except Exception as e:
        logger.warning(f"[vn_coffee_export] PDF download failed {url}: {e}")
        return None


# ── monthly derivation ──────────────────────────────────────────────────────────

def _derive_monthly_rows(raw: dict[str, dict]) -> list[dict]:
    """Build month-sorted list with period_qty preferred, fall back to YTD diff.

    raw: {month: {period_qty_tonnes, ytd_cum_qty_tonnes, ...}}

    For each month we want a single 'tonnes' figure. The 2x bulletin's
    period_qty IS the monthly value (one bulletin per month), so we prefer it.
    YTD-diff is computed as a sanity-check and kept in the row for debugging.
    """
    months = sorted(raw.keys())
    out: list[dict] = []
    for i, m in enumerate(months):
        cur = raw[m]
        period = cur.get("period_qty_tonnes", 0.0)
        ytd = cur.get("ytd_cum_qty_tonnes", 0.0)

        # YTD-diff fallback: if period is 0 but YTD exists, derive from prior month.
        ytd_diff = None
        if i > 0:
            prev = raw[months[i - 1]]
            prev_yr, cur_yr = int(months[i - 1][:4]), int(m[:4])
            if prev_yr == cur_yr:
                ytd_diff = max(0.0, round(ytd - prev.get("ytd_cum_qty_tonnes", 0.0), 1))
            else:
                # Year boundary: Jan YTD = Jan monthly.
                ytd_diff = ytd
        else:
            ytd_diff = ytd if period == 0 else None

        tonnes = period if period > 0 else (ytd_diff or 0.0)

        out.append({
            "month":              m,
            "tonnes":             round(tonnes, 1),
            "period_qty_tonnes":  round(period, 1),
            "ytd_cum_qty_tonnes": round(ytd, 1),
            "ytd_diff_tonnes":    round(ytd_diff, 1) if ytd_diff is not None else None,
        })
    return out


# ── main runner ─────────────────────────────────────────────────────────────────

async def _harvest_via_bridge(page) -> dict[str, dict]:
    """Path B: portal session + bridge API to enumerate publications.

    Returns the same {month_key: extracted_dict} shape as path A. Heavy
    diagnostics inside _fetch_publication_list will surface any portal /
    bridge issues to the workflow log.
    """
    per_month: dict[str, dict] = {}
    print("[vn_coffee_export] [pathB] navigating to customs portal...")
    await page.goto(_PORTAL_URL, wait_until="domcontentloaded", timeout=30_000)
    await page.wait_for_timeout(2_000)

    publications = await _fetch_publication_list(page)
    print(f"[vn_coffee_export] [pathB] got {len(publications)} publications")

    if not publications:
        return per_month

    pubs_2x: list[dict] = []
    for pub in publications:
        file_url  = pub.get("fileSoBo") or pub.get("filePath") or pub.get("url") or ""
        type_code = pub.get("loaiBaoCao") or pub.get("type") or pub.get("reportType") or ""
        name      = pub.get("tenBaoCao") or pub.get("name") or pub.get("title") or ""
        combined  = f"{file_url} {type_code} {name}"
        if not _is_2x(combined):
            continue
        month = _period_to_month(combined)
        if month:
            pubs_2x.append({"month": month, "url": file_url, "raw": combined})

    print(f"[vn_coffee_export] [pathB] {len(pubs_2x)} 2x bulletins identified")
    if not pubs_2x:
        return per_month

    by_month: dict[str, str] = {}
    for pub in pubs_2x:
        by_month.setdefault(pub["month"], pub["url"])

    for month, url in sorted(by_month.items()):
        pdf_bytes = _download_pdf(url)
        if not pdf_bytes:
            print(f"[vn_coffee_export] [pathB] {month}: PDF download failed")
            continue
        extracted = _extract_coffee_row(pdf_bytes)
        if not extracted:
            print(f"[vn_coffee_export] [pathB] {month}: no coffee row found")
            continue
        per_month[month] = extracted
        print(f"[vn_coffee_export] [pathB] {month}: period={extracted['period_qty_tonnes']:.0f}t "
              f"ytd={extracted['ytd_cum_qty_tonnes']:.0f}t")
    return per_month


async def run(page, db) -> None:  # noqa: ARG001
    """Scrape Vietnam Customs coffee export data, write to cache.

    Two paths attempted in order: URL prediction (no portal needed) and the
    portal+bridge API. On total failure: logs and retains existing cache.
    """
    import warnings
    warnings.filterwarnings("ignore", message="Unverified HTTPS request")

    try:
        # Path A: direct URL prediction — fast, no Playwright dependency.
        per_month = _harvest_via_url_prediction(months_back=18)

        if not per_month:
            print("[vn_coffee_export] path A returned nothing — trying path B (bridge API)")
            per_month = await _harvest_via_bridge(page)

        if not per_month:
            print("[vn_coffee_export] both paths failed — retaining cache")
            return

        monthly = _derive_monthly_rows(per_month)

        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        cache = {
            "scraped_at": datetime.utcnow().isoformat() + "Z",
            "source":     "Vietnam Customs (customs.gov.vn) 2x monthly export bulletins",
            "unit":       "tonnes",
            "monthly":    monthly,
        }
        _CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[vn_coffee_export] Done. {len(monthly)} months written to cache.")

    except Exception as e:
        print(f"[vn_coffee_export] FAILED: {e} — retaining cache")


# ── standalone ──────────────────────────────────────────────────────────────────

async def _standalone():
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page    = await browser.new_page()
        await run(page, None)
        await browser.close()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    asyncio.run(_standalone())
