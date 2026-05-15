"""
vn_coffee_export.py — Monthly scraper for Vietnam coffee export data.

Source: Vietnam Customs Statistical Publication portal (same system as vn_fertilizer)
  https://www.customs.gov.vn/index.jsp?pageId=441&cid=192

Differs from vn_fertilizer in one thing: the publication filter. Imports are
type "1n" (nhập khẩu, all-trader). Exports are type "2x" (xuất khẩu, by
commodity). Customs publishes monthly export bulletins as PDFs with filenames
like `{YYYY}-t{MM}-2x(vn-sb).pdf`, e.g.
  https://files.customs.gov.vn/CustomsCMS/TONG_CUC/2025/1/10/2024-t12-2x(vn-sb).pdf
(December 2024 exports, published Jan 10, 2025 — ~10 day publication lag).

Each 2x bulletin contains the full HS-chapter commodity table for the month.
Coffee ("Cà phê") appears as a single row whose period_qty column gives that
month's exports in tonnes. We convert to thousand 60kg bags downstream.

Flow:
  1. Playwright opens customs portal (establishes session cookies).
  2. page.evaluate() calls LayDanhSachMoiCongBoServlet via the bridge proxy.
  3. Filter publications for type "2x" (export commodity bulletins).
  4. Download each PDF via requests (files.customs.gov.vn is open access).
  5. pdfplumber finds the "Cà phê" row and reads period + cumulative tonnes.
  6. Write to backend/scraper/cache/vn_coffee_export.json
     (read by vietnam_supply.fetch_exports() at export time).

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
from datetime import datetime
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


# ── portal helpers ──────────────────────────────────────────────────────────────

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

async def run(page, db) -> None:  # noqa: ARG001
    """Scrape Vietnam Customs coffee export data, write to cache.

    On any failure: logs and retains existing cache (does NOT raise).
    """
    import warnings
    warnings.filterwarnings("ignore", message="Unverified HTTPS request")

    try:
        print("[vn_coffee_export] Navigating to Vietnam Customs portal...")
        await page.goto(_PORTAL_URL, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(2_000)

        publications = await _fetch_publication_list(page)
        print(f"[vn_coffee_export] Got {len(publications)} publications")

        if not publications:
            print("[vn_coffee_export] No publications returned — retaining cache")
            return

        # Filter for 2x bulletins (monthly exports by commodity).
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

        print(f"[vn_coffee_export] {len(pubs_2x)} 2x bulletins identified")

        if not pubs_2x:
            print("[vn_coffee_export] No 2x publications found — retaining cache")
            return

        # Deduplicate by month (keep latest URL — Customs sometimes republishes
        # with revisions). The API order is newest-first so first wins.
        by_month: dict[str, str] = {}
        for pub in pubs_2x:
            by_month.setdefault(pub["month"], pub["url"])

        # Download and parse each PDF
        per_month: dict[str, dict] = {}
        for month, url in sorted(by_month.items()):
            pdf_bytes = _download_pdf(url)
            if not pdf_bytes:
                print(f"[vn_coffee_export] {month}: PDF download failed — skipping")
                continue
            extracted = _extract_coffee_row(pdf_bytes)
            if not extracted:
                print(f"[vn_coffee_export] {month}: no coffee row found")
                continue
            per_month[month] = extracted
            print(f"[vn_coffee_export] {month}: period={extracted['period_qty_tonnes']:.0f}t "
                  f"ytd={extracted['ytd_cum_qty_tonnes']:.0f}t")

        if not per_month:
            print("[vn_coffee_export] No data extracted — retaining cache")
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
