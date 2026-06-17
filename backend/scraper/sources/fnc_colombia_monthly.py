"""fnc_colombia_monthly.py — Federación Nacional de Cafeteros monthly bulletins.

Discovers and parses the monthly PDF bulletins FNC publishes at
https://federaciondecafeteros.org. There are two relevant landing pages:

  • /wp/informe-mensual-de-cifras/    — combined bulletin (production +
                                        exports + prices + inventories)
  • /informemensualdeexporaciones/    — exports-only bulletin

Both pages list PDF files via raw <a href> links — there is no JSON
index. Filenames are inconsistent ("3.-Informe-mensual-Marzo-2026-p.pdf",
"Informe-mensual-mayo-p.pdf", "Informe-Expos-Enero-2026.pdf") and the
upload-folder month does NOT track the data month, so we crawl the HTML
each run instead of templating URLs.

Output (frontend/public/data/colombia_supply.json's `exports.monthly`):

  {
    "month": "YYYY-MM",
    "total_k_bags":    1180.4,       # exports — thousand 60-kg bags
    "production_k_bags": 1095.2,     # national production for the same month
    "yoy_pct":         -29.1,
    "_source_pdf":     "https://federaciondecafeteros.org/.../...pdf"
  }

Cadence: M+1, first week of next month.

⚠ Cloudflare risk — Indonesia BPS taught us GitHub Actions IPs get
flagged by some Cloudflare configs. If FNC blocks the runner, the
scraper falls back gracefully (logs and writes nothing); the operator
can either route through a CF Worker (cf-worker/bps-proxy.js pattern)
or curate the values manually until the WAF stops complaining.

Diagnostic mode (--diag) dumps the raw extracted PDF text into
debug/fnc/ so the operator can inspect format drift and design follow-up
parsers without re-downloading.

Usage
-----
    cd backend
    python -m scraper.sources.fnc_colombia_monthly             # preview
    python -m scraper.sources.fnc_colombia_monthly --write     # parse + write
    python -m scraper.sources.fnc_colombia_monthly --diag      # also dump text
    python -m scraper.sources.fnc_colombia_monthly --max 3     # only N PDFs
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR  = ROOT / "frontend" / "public" / "data"
CACHE_DIR = ROOT / "backend"  / "scraper" / "cache" / "fnc"
DEBUG_DIR = ROOT / "backend"  / "scraper" / "debug" / "fnc"
OUT_PATH  = DATA_DIR / "colombia_supply.json"

FNC_BASE = "https://federaciondecafeteros.org"
LISTING_URLS = [
    # Combined monthly bulletin (production + exports + prices + …)
    f"{FNC_BASE}/wp/informe-mensual-de-cifras/",
    # Exports-only bulletin (carries destination-country detail)
    f"{FNC_BASE}/informemensualdeexporaciones/",
    f"{FNC_BASE}/wp/informemensualdeexporaciones/",
]

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    # Spanish-locale Accept-Language so the WordPress upload table renders
    # whichever Spanish-language variant FNC's CMS keys by; harmless if
    # the site doesn't language-vary the upload listings.
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.7",
}

# FNC PDFs land on two parallel path roots (WordPress sometimes serves
# /wp-content/uploads and sometimes /app/uploads depending on which
# multisite domain was used at upload time):
#   /wp-content/uploads/YYYY/MM/<filename>.pdf
#   /app/uploads/YYYY/MM/<filename>.pdf
_PDF_LINK_RE = re.compile(
    r'href=["\']'
    r'(?P<href>'
    r'(?:https?://[^"\']*federaciondecafeteros\.org)?'
    r'/(?:wp-content|app)/uploads/\d{4}/\d{2}/[^"\']+\.pdf'
    r')["\']',
    re.I,
)

# Spanish months (with and without accents) for parsing both the PDF
# filenames and the body text. Accented variants matter because the PDF
# extractor can deliver either form.
SPANISH_MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5,
    "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9,
    "octubre": 10, "noviembre": 11, "diciembre": 12,
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7,
    "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12,
}

# Heuristic patterns for the production + exports lines in the combined
# bulletin. FNC writes numbers in Colombian locale (thousands separator
# `.`, decimal `,`) and labels columns in Spanish ("Producción",
# "Exportaciones"). The bulletin also reports YoY % which we capture for
# the table KPI. Keep these tolerant — minor wording changes happen.
_PRODUCTION_RE = re.compile(
    r"(?:Producci[oó]n)\s+(?:mensual|del\s+mes|colombiana)?[^\d\-]{0,40}"
    r"(?P<k_bags>-?[\d\.,]+)",
    re.I,
)
_EXPORTS_RE = re.compile(
    r"(?:Exportaciones)\s+(?:definitivas|de\s+caf[eé]|colombianas|mensuales)?[^\d\-]{0,40}"
    r"(?P<k_bags>-?[\d\.,]+)",
    re.I,
)
_YOY_RE = re.compile(r"(?P<sign>[+\-])?\s*(?P<pct>[\d\.,]+)\s*%", re.I)

# Filename-derived month hint: e.g. "Informe-mensual-Marzo-2026-p.pdf"
# or "Informe-Expos-Enero-2026.pdf". The body text always trumps the
# filename when both are present.
_FN_MONTH_RE = re.compile(
    r"(?:" + "|".join(SPANISH_MONTHS) + r")[^a-z]?(?P<yr>20\d{2})?",
    re.I,
)


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class MonthlyEntry:
    month:              str                   # "YYYY-MM"
    total_k_bags:       float | None = None   # exports — thousand 60-kg sacks
    production_k_bags:  float | None = None   # production for the same month
    yoy_pct:            float | None = None   # vs same month last year
    source_pdf:         str  = ""             # remote URL we parsed
    parser_version:     str  = "v1"


# ── HTTP fetching ───────────────────────────────────────────────────────────


def _fetch(url: str, *, binary: bool = False, timeout: int = 60) -> bytes | None:
    """One safe GET with our browser headers. Returns raw bytes on 200,
    None on any error so callers can keep walking the listing instead
    of crashing. WAF challenges (403/503) surface here too."""
    try:
        resp = requests.get(url, headers=_BROWSER_HEADERS, timeout=timeout)
    except requests.RequestException as e:
        logger.warning(f"[fnc] GET {url} → request error: {e}")
        return None
    if resp.status_code != 200:
        snippet = (resp.text or "")[:200]
        logger.warning(f"[fnc] GET {url} → HTTP {resp.status_code}: {snippet}")
        return None
    return resp.content if binary else resp.text.encode("utf-8")


# ── PDF discovery ───────────────────────────────────────────────────────────


def discover_pdf_urls() -> list[str]:
    """Crawl FNC's three landing pages and return every PDF link they
    surface, de-duplicated, in the order discovered. Filenames are
    inconsistent enough that we don't try to parse the month out here —
    that happens once we've actually downloaded the PDF and read the
    body (or as a filename-fallback if the body parse fails)."""
    found: list[str] = []
    seen: set[str] = set()
    for listing in LISTING_URLS:
        html_bytes = _fetch(listing)
        if not html_bytes:
            continue
        html = html_bytes.decode("utf-8", errors="ignore")
        for m in _PDF_LINK_RE.finditer(html):
            href = m.group("href")
            if href.startswith("/"):
                href = f"{FNC_BASE}{href}"
            if href in seen:
                continue
            seen.add(href)
            found.append(href)
    logger.info(f"[fnc] discovered {len(found)} PDF link(s) across {len(LISTING_URLS)} listing(s)")
    return found


# ── PDF parsing ─────────────────────────────────────────────────────────────


def _fnc_number(raw: str) -> float | None:
    """Parse a Colombian-locale number. '1.234,56' → 1234.56; '1234' → 1234.
    Strips spaces and stray non-digit detritus so we can hand the regex a
    sloppy capture."""
    if not raw:
        return None
    # Drop everything except digits, dots, commas, and the sign.
    cleaned = re.sub(r"[^\d\.,\-]", "", raw)
    if not cleaned:
        return None
    # Colombian convention: dot=thousands, comma=decimal.
    cleaned = cleaned.replace(".", "").replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _extract_text(pdf_bytes: bytes) -> str:
    """Best-effort full-text extraction. pdfplumber covers most layouts;
    if it can't parse a page (occasional FNC bulletins have rasterised
    pages from scanner workflows) we skip that page rather than crash."""
    try:
        import pdfplumber                       # type: ignore
    except ImportError:
        logger.error("[fnc] pdfplumber not installed — `pip install pdfplumber`")
        return ""
    import io
    text_parts: list[str] = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                try:
                    txt = page.extract_text() or ""
                except Exception as e:                     # noqa: BLE001
                    logger.warning(f"[fnc] page parse error: {e}")
                    txt = ""
                if txt:
                    text_parts.append(txt)
    except Exception as e:                                 # noqa: BLE001
        logger.warning(f"[fnc] pdfplumber open failed: {e}")
        return ""
    return "\n".join(text_parts)


def _month_from_filename(url: str) -> tuple[int, int] | None:
    """Recover (year, month) from the PDF URL when the body parse fails.
    Filenames like 'Informe-mensual-Marzo-2026-p.pdf' or
    '.../2026/04/3.-Informe-mensual-Marzo-2026-p.pdf'. We look at the
    SLUG segment, not the upload-folder month, because the folder
    upload date does NOT track the data month per the recon."""
    slug = url.rsplit("/", 1)[-1].lower()
    m = _FN_MONTH_RE.search(slug)
    if not m:
        return None
    word = m.group(0).rstrip("-_. ").split("-")[0]
    base = re.split(r"[\s\-_]", word, maxsplit=1)[0]
    mn = SPANISH_MONTHS.get(base)
    if not mn:
        return None
    yr_match = re.search(r"20\d{2}", slug)
    if not yr_match:
        return None
    return int(yr_match.group(0)), mn


def parse_bulletin(text: str, source_url: str) -> MonthlyEntry | None:
    """Pull the headline monthly production + exports numbers out of one
    bulletin's full text. Returns None if neither is found — better to
    drop the row than ship a half-row with one field missing.

    Heuristic — FNC's bulletins are PDFs designed for human reading, so
    we look for the keyword + the next number on the same or following
    line. The parser stays tolerant of layout drift (extra whitespace,
    swapped column order); when the layout changes meaningfully we add
    a `_parse_v2` and rely on the diagnostic dump to design it."""
    prod_m = _PRODUCTION_RE.search(text)
    exp_m  = _EXPORTS_RE.search(text)
    if not (prod_m or exp_m):
        return None

    prod_kbags = _fnc_number(prod_m.group("k_bags")) if prod_m else None
    exp_kbags  = _fnc_number(exp_m.group("k_bags"))  if exp_m  else None

    # YoY % is the first signed percentage near the exports line. Best-effort
    # extraction — if it's missing we'll still ship the volumes.
    yoy_pct: float | None = None
    if exp_m:
        tail = text[exp_m.end(): exp_m.end() + 200]
        ym = _YOY_RE.search(tail)
        if ym:
            sign = -1 if (ym.group("sign") == "-") else 1
            pct = _fnc_number(ym.group("pct"))
            if pct is not None:
                yoy_pct = sign * pct

    # Month from filename. The bulletin's body title also names the
    # month but title styling varies more than the URL slug, so we
    # prefer the filename here.
    fn_month = _month_from_filename(source_url)
    if not fn_month:
        # No identifiable month → can't key the entry. Skip.
        return None
    yr, mn = fn_month

    return MonthlyEntry(
        month=             f"{yr:04d}-{mn:02d}",
        total_k_bags=      exp_kbags,
        production_k_bags= prod_kbags,
        yoy_pct=           yoy_pct,
        source_pdf=        source_url,
        parser_version=    "v1",
    )


# ── orchestration ───────────────────────────────────────────────────────────


def _load_existing() -> dict:
    """Read the current colombia_supply.json so we can merge instead of
    clobber — we want to preserve the USDA PSD `annual` block + the
    farmer-economics / weather / ENSO blocks the other scrapers wrote."""
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("[fnc] existing colombia_supply.json unreadable — starting fresh")
    return {}


def _merge_into_supply(monthly: list[MonthlyEntry]) -> dict:
    """Apply this run's monthly entries on top of whatever was already
    in colombia_supply.json — per-month merge so DANE's NANDINA + FOB USD
    breakdown survives an FNC run on the same month (and vice versa).
    The USDA `annual` series (populated by export_stocks) stays put."""
    doc = _load_existing()
    existing_exports = doc.get("exports") or {}
    existing_monthly = existing_exports.get("monthly") or []

    by_month: dict[str, dict] = {row.get("month"): row for row in existing_monthly if row.get("month")}
    for e in monthly:
        existing = by_month.get(e.month, {})
        # Only overwrite a key when this run actually has a value for
        # it — that way a future re-parse with thinner output can't
        # nuke fields populated by the other scraper.
        merged = {**existing, **{k: v for k, v in asdict(e).items() if v is not None and v != ""}}
        by_month[e.month] = merged

    monthly_out = sorted(by_month.values(), key=lambda r: r.get("month") or "")
    last_updated = monthly_out[-1].get("month") if monthly_out else (existing_exports.get("last_updated") or "")
    # Source label combines whatever was there before with FNC — keeps
    # DANE attribution intact when both feeds are wired.
    existing_source = existing_exports.get("source") or ""
    fnc_label = "Federación Nacional de Cafeteros (FNC) monthly bulletins"
    if existing_source and "FNC" not in existing_source and "PSD" not in existing_source:
        source = f"{existing_source} + {fnc_label}"
    else:
        source = existing_source or fnc_label

    new_exports = {
        "source":       source,
        "last_updated": last_updated,
        "unit":         "thousand 60-kg bags",
        "monthly":      monthly_out,
        "annual":       existing_exports.get("annual") or [],
    }
    out = dict(doc)
    out["country"] = "colombia"
    out["scraped_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out["exports"] = new_exports
    return out


def _persist(doc: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _dump_debug(text: str, url: str) -> None:
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w.-]", "_", url.rsplit("/", 1)[-1])
    (DEBUG_DIR / f"{safe}.txt").write_text(text, encoding="utf-8")


def run(*, write: bool, diag: bool, max_pdfs: int | None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    pdf_urls = discover_pdf_urls()
    if not pdf_urls:
        # Either WAF block (likeliest) or FNC restructured. Either way
        # CI fails LOUDLY rather than silently writing nothing — same
        # contract the BPS scraper enforces.
        logger.error("[fnc] FATAL: discovered 0 PDF links from the listing pages")
        return 1
    if max_pdfs:
        pdf_urls = pdf_urls[:max_pdfs]

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    entries: list[MonthlyEntry] = []
    for i, url in enumerate(pdf_urls, start=1):
        cache_path = CACHE_DIR / re.sub(r"[^\w.-]", "_", url.rsplit("/", 1)[-1])
        if cache_path.exists():
            pdf_bytes = cache_path.read_bytes()
        else:
            pdf_bytes = _fetch(url, binary=True)
            if not pdf_bytes:
                continue
            cache_path.write_bytes(pdf_bytes)

        text = _extract_text(pdf_bytes)
        if not text:
            continue
        if diag:
            _dump_debug(text, url)

        entry = parse_bulletin(text, url)
        if entry:
            entries.append(entry)
            print(f"[{i}/{len(pdf_urls)}] {entry.month}: "
                  f"exp={entry.total_k_bags} kBg · prod={entry.production_k_bags} kBg "
                  f"· yoy={entry.yoy_pct}%")
        else:
            print(f"[{i}/{len(pdf_urls)}] no match for {url}")

    if not entries:
        logger.error("[fnc] FATAL: 0 of %d PDFs parsed cleanly", len(pdf_urls))
        return 1

    print(f"[fnc] parsed {len(entries)} monthly entr{'y' if len(entries) == 1 else 'ies'}")

    if write:
        doc = _merge_into_supply(entries)
        _persist(doc)
        print(f"[fnc] wrote {OUT_PATH} ({len(entries)} monthly rows merged)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="Persist parsed JSON")
    ap.add_argument("--diag",  action="store_true", help="Dump raw PDF text to debug/")
    ap.add_argument("--max",   type=int, default=None,
                    help="Cap PDFs processed (small N speeds up iteration)")
    args = ap.parse_args()
    return run(write=args.write, diag=args.diag, max_pdfs=args.max)


if __name__ == "__main__":
    sys.exit(main())
