"""Vietnam Customs 5X/5N harvester — coffee exports/imports BY COUNTRY.

The monthly '5x(ta-sb)' (exports) and '5n(ta-sb)' (imports) bulletins are the
English-language ("ta") preliminary ("sb") matrices of main commodities BY
COUNTRY — richer than the 2x national totals that
scraper.sources.vn_coffee_export already harvests (coffee is one row there;
here we get the destination / origin country split in tonnes and USD).

Discovery is two-path, mirroring vn_coffee_export:

  Path A — index scrape. The statistics listing page enumerates published
    bulletins; regex the hrefs for ...-5[xn](ta-sb).pdf. Cheap when it works,
    but the www.customs.gov.vn listing has historically been JS-rendered
    (vn_coffee_export's plain-HTML path returned 0 links in production and
    needed the Playwright bridge), so treat a 0-link result as expected and
    fall through.

  Path B — URL prediction. The proven /CustomsCMS/TONG_CUC/{pub_y}/{pub_m}/
    {pub_d}/{stem} day-iteration from vn_coffee_export: publication lands in
    data-month+1 (occasionally +2 around Tết), day clusters near the 7th;
    candidate days are tried in plausibility order and 404s are cheap and
    silent. Once one direction is found for a month, the sibling stem (5n
    alongside 5x) is tried at the SAME publication path first, so a typical
    month costs 1–2 extra requests, not another day sweep.

NOTE: both customs hosts are blocked from the dev sandbox (proxy 403).
Run via .github/workflows/vn-customs-by-country.yml — GitHub Actions reaches
them fine (the existing vn_coffee_export monthly job proves it).

Modes:
  probe     Find the newest month's 5x+5n PDFs and dump their table structure
            (pages, table dims, header rows, coffee-row candidates) to logs.
            Used once to design the parser from real evidence.
  backfill  Harvest the last N months and write every parsed coffee-by-country
            row to backend/seed/vn_customs_by_country.json. Until the parser
            is confirmed against a probe run, rows are stored raw
            (raw_row + page/table coordinates) so no information is lost.

Usage (CI):
    PYTHONPATH=. python -m scraper.backfill_vn_customs_country --mode probe
    PYTHONPATH=. python -m scraper.backfill_vn_customs_country --mode backfill --months 24

Exit codes: 0 ran; 2 nothing reachable (nothing proven).
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests
import urllib3

from scraper.sources.vn_coffee_export import _strip_accents

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "seed" / "vn_customs_by_country.json"

_FILES_HOST = "https://files.customs.gov.vn"
_INDEX_URLS = (
    # The listing page the bulletins are linked from (English portal). Often
    # JS-rendered — a 0-link scrape is expected and non-fatal.
    "https://www.customs.gov.vn/index.jsp?pageId=5002&group=Statistical%20data&category=General%20indicators",
)
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
_HEADERS = {"User-Agent": _UA}

# ...-5x(ta-sb).pdf / ...-5n(ta-sb).pdf anywhere in an href.
_PDF_RX = re.compile(r'href="([^"]*-5[xn]\(ta-sb\)\.pdf)"', re.IGNORECASE)
_COFFEE_RX = re.compile(r"\bca\s*phe\b|\bcoffee\b", re.IGNORECASE)

# Same plausibility-ordered day list vn_coffee_export converged on.
_DAY_ORDER = [7, 8, 6, 9, 10, 11, 5, 12, 13, 14, 15, 4, 16, 17, 3, 18, 19, 2,
              20, 21, 1, 22, 23, 24, 25, 26, 27, 28]
_BACKUP_DAYS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 4, 3, 2, 1]


# ── month / URL helpers ──────────────────────────────────────────────────────

def _months_back(n: int) -> list[tuple[int, int]]:
    """Last n completed months, newest first."""
    today = date.today()
    y, m = today.year, today.month - 1
    if m == 0:
        y, m = y - 1, 12
    out = []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def _shift(year: int, month: int, by: int) -> tuple[int, int]:
    m = month + by
    y = year
    while m > 12:
        m -= 12
        y += 1
    return y, m


def _stems(data_y: int, data_m: int, table: str) -> list[str]:
    """Filename variants for one data month + direction ('5x' | '5n')."""
    out = []
    for tprefix in ("t", "T"):
        for mfmt in (str(data_m), f"{data_m:02d}"):
            for suffix in ("(ta-sb)", "(TA-SB)"):
                out.append(f"{data_y}-{tprefix}{mfmt}-{table}{suffix}.pdf")
    return out


def _candidate_urls(data_y: int, data_m: int, table: str) -> list[str]:
    """Predicted URLs for one month+direction, most plausible first.

    Stem-major order (like vn_coffee_export): the modern lowercase stem is
    swept across all plausible days before older case variants are tried at
    all, so a present month resolves in a handful of requests.
    """
    urls: list[str] = []
    for (pub_y, pub_m), days in (
        (_shift(data_y, data_m, 1), _DAY_ORDER),
        (_shift(data_y, data_m, 2), _BACKUP_DAYS),
    ):
        for stem in _stems(data_y, data_m, table):
            for d in days:
                urls.append(f"{_FILES_HOST}/CustomsCMS/TONG_CUC/{pub_y}/{pub_m}/{d}/{stem}")
    seen: set[str] = set()
    return [u for u in urls if not (u in seen or seen.add(u))]


def _download(url: str) -> bytes | None:
    """GET url; PDF bytes on success else None. verify=False matches the
    misconfigured TLS chain on files.customs.gov.vn (see vn_coffee_export)."""
    try:
        r = requests.get(url, headers=_HEADERS, timeout=30, verify=False,
                         allow_redirects=True)
        if r.status_code == 200 and b"%PDF" in r.content[:10]:
            return r.content
        if r.status_code == 403:
            print(f"    403 (blocked, not missing): {url}", file=sys.stderr)
        return None
    except requests.RequestException as e:
        print(f"    {type(e).__name__} on {url}: {str(e)[:120]}", file=sys.stderr)
        return None


# ── Path A: index scrape ─────────────────────────────────────────────────────

def _index_scrape() -> dict[str, str]:
    """Scrape the listing page(s) for 5x/5n hrefs → {filename: absolute_url}.
    A 0-hit result is expected when the listing is JS-rendered."""
    found: dict[str, str] = {}
    for idx_url in _INDEX_URLS:
        try:
            r = requests.get(idx_url, headers=_HEADERS, timeout=30, verify=False)
            print(f"[index] GET {idx_url} → {r.status_code}, {len(r.text)} bytes")
            if r.status_code != 200:
                continue
            hits = _PDF_RX.findall(r.text)
            for href in hits:
                full = href if href.startswith("http") else f"{_FILES_HOST}{href}"
                found[full.rsplit('/', 1)[-1] + "|" + full] = full
            # Pagination reconnaissance (handled properly once the index path
            # is proven to serve links at all).
            for marker in ("pageIndex", "page=", "Next", "phân trang"):
                if marker in r.text:
                    print(f"[index] pagination marker present: {marker!r}")
        except requests.RequestException as e:
            print(f"[index] {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
    urls = dict.fromkeys(found.values())
    print(f"[index] extracted {len(urls)} unique 5x/5n links")
    return {u.rsplit('/', 1)[-1]: u for u in urls}


# ── month harvest (index hits → sibling path → prediction) ───────────────────

def _find_month(data_y: int, data_m: int,
                index_hits: dict[str, str]) -> dict[str, tuple[str, bytes]]:
    """Locate the 5x and 5n PDFs for one data month.

    Order per direction: index hit → sibling publication path (5x and 5n are
    uploaded to the same dated folder, so once one is found the other costs
    ~1 request) → full URL-prediction sweep. Returns {'5x': (url, bytes),
    '5n': ...} for whichever were found.
    """
    out: dict[str, tuple[str, bytes]] = {}
    sibling_paths: list[str] = []
    for table in ("5x", "5n"):
        stem_variants = _stems(data_y, data_m, table)

        # 1) index hit
        url = next((index_hits[s] for s in stem_variants if s in index_hits), None)
        if url:
            body = _download(url)
            if body:
                out[table] = (url, body)
                sibling_paths.append(url.rsplit("/", 1)[0])
                continue

        # 2) same publication folder as the sibling found this month
        got = False
        for pub_path in sibling_paths:
            for stem in stem_variants:
                body = _download(f"{pub_path}/{stem}")
                if body:
                    out[table] = (f"{pub_path}/{stem}", body)
                    got = True
                    break
            if got:
                break
        if got:
            continue

        # 3) full prediction sweep
        for cand in _candidate_urls(data_y, data_m, table):
            body = _download(cand)
            if body:
                out[table] = (cand, body)
                sibling_paths.append(cand.rsplit("/", 1)[0])
                break
    return out


# ── PDF parsing ──────────────────────────────────────────────────────────────
#
# Layout verified against the June-2026 bulletins (fixtures in
# scraper/tests/fixtures/vn_customs_2026-t6-5[xn]_ta-sb.pdf):
#
#   Country/Territory-Main exports   Units   Reporting month     Year to date
#                                            Volume  Value(USD)  Volume  Value(USD)
#   Algeria                                          21,504,938          305,273,444
#     Fishery products               USD              364,500             1,544,675
#     Coffee                         Ton     3,667   15,501,977  60,070  257,173,005
#
# pdfplumber's extract_tables() mangles this layout (multi-line cells lose the
# volume↔commodity alignment), so we parse WORDS by position instead:
#   • lines grouped by y (top / 2.5)
#   • country rows start at x0≈45 and carry NO unit token; commodity rows are
#     indented to x0≈49 with a unit ('Ton'/'USD') in the 265–310 x-band
#   • numbers are right-aligned; the right edge (x1) assigns the column:
#       ≤365 RM volume · ≤436 RM value · ≤494 YTD volume · >494 YTD value
#   • country blocks span page breaks — current country carries across pages
#
# NOTE these 'ta' (English) bulletins use comma-thousands ('15,501,977'), NOT
# the Vietnamese format of the 2x bulletins — vn_coffee_export's
# _parse_vn_number would zero them, hence the dedicated parser below.

_NUM_RX = re.compile(r"^-?[\d,]+(?:\.\d+)?$")
_SKIP_PREFIXES = ("Country/Territory", "Volume", "Value", "MINISTRY", "GENERAL",
                  "Preliminary", "STATISTICS", "Reporting", "TOTAL", "Table:",
                  "Customs IT")

# Column right-edge boundaries (pt) for number→column assignment.
_COL_BOUNDS = ((365.0, "rm_vol"), (436.0, "rm_val"), (494.0, "ytd_vol"),
               (9e9, "ytd_val"))
_NAME_X_MAX = 265.0      # words left of this are the name
_UNIT_X = (265.0, 310.0)  # the Units column band
_COUNTRY_X0 = 47.5        # country rows start left of this; commodities right


def _parse_en_number(s: str) -> float:
    """'15,501,977' → 15501977.0 (English comma-thousands)."""
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return 0.0


def _page_lines(pg) -> list[list[dict]]:
    """Page words grouped into visual lines (sorted top-to-bottom, l-to-r)."""
    lines: dict[int, list[dict]] = {}
    for w in pg.extract_words():
        lines.setdefault(round(w["top"] / 2.5), []).append(w)
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in sorted(lines.items())]


def parse_coffee_by_country(pdf_bytes: bytes) -> list[dict]:
    """Extract every coffee commodity row from a 5X/5N bulletin.

    Returns [{country, commodity, unit, rm_volume, rm_value_usd, ytd_volume,
    ytd_value_usd}] — rm_* is the reporting month, ytd_* the year-to-date
    cumulative; volumes in tonnes (unit column says 'Ton' for coffee). A row
    with no reporting-month trade carries only the ytd_* fields (rm_* None).
    """
    import pdfplumber
    out: list[dict] = []
    country: str | None = None    # carries across page breaks
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pg in pdf.pages:
            for ws in _page_lines(pg):
                name = " ".join(w["text"] for w in ws
                                if w["x0"] < _NAME_X_MAX and not _NUM_RX.match(w["text"]))
                if not name or name.startswith(_SKIP_PREFIXES):
                    continue
                unit = " ".join(w["text"] for w in ws
                                if _UNIT_X[0] <= w["x0"] <= _UNIT_X[1]
                                and not _NUM_RX.match(w["text"]))
                if ws[0]["x0"] < _COUNTRY_X0 and not unit:
                    country = name
                    continue
                if not _COFFEE_RX.search(_strip_accents(name)):
                    continue
                cols: dict[str, float] = {}
                for w in ws:
                    if _NUM_RX.match(w["text"]) and w["x1"] > _UNIT_X[1]:
                        for bound, col in _COL_BOUNDS:
                            if w["x1"] <= bound:
                                cols[col] = _parse_en_number(w["text"])
                                break
                out.append({
                    "country":       country,
                    "commodity":     name,
                    "unit":          unit,
                    "rm_volume":     cols.get("rm_vol"),
                    "rm_value_usd":  cols.get("rm_val"),
                    "ytd_volume":    cols.get("ytd_vol"),
                    "ytd_value_usd": cols.get("ytd_val"),
                })
    return out


def _dump_structure(tag: str, pdf_bytes: bytes) -> None:
    """Probe output: bulletin size + the parsed coffee rows."""
    import pdfplumber
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        n_pages = len(pdf.pages)
        title = (pdf.pages[0].extract_text() or "").splitlines()[:5]
    rows = parse_coffee_by_country(pdf_bytes)
    print(f"\n[{tag}] {n_pages} pages; title: {' / '.join(title)}")
    print(f"[{tag}] {len(rows)} coffee rows:")
    for r in rows:
        print(f"   {str(r['country']):22s} rm {r['rm_volume']} t / {r['rm_value_usd']} USD"
              f"  · ytd {r['ytd_volume']} t / {r['ytd_value_usd']} USD")


# ── modes ────────────────────────────────────────────────────────────────────

def run_probe() -> int:
    index_hits = _index_scrape()
    for (y, m) in _months_back(4):
        print(f"\n[probe] trying {y}-{m:02d} …")
        found = _find_month(y, m, index_hits)
        if not found:
            continue
        for table, (url, body) in found.items():
            print(f"[probe] {table}: {url} ({len(body)//1024} KB)")
            _dump_structure(f"{y}-{m:02d} {table}", body)
        return 0
    print("[probe] FATAL: no 5x/5n PDF found in the last 4 months — host "
          "blocked or pattern changed. Nothing proven.", file=sys.stderr)
    return 2


def run_backfill(months: int) -> int:
    index_hits = _index_scrape()
    series: dict[str, dict] = {}
    ok = 0
    consecutive_misses = 0
    for (y, m) in _months_back(months):
        key = f"{y}-{m:02d}"
        found = _find_month(y, m, index_hits)
        if not found:
            consecutive_misses += 1
            print(f"[backfill] {key}: not found "
                  f"({consecutive_misses} consecutive miss(es))")
            # Three consecutive missing months going backward = the English
            # preliminary archive ends here; stop instead of sweeping ~700
            # more 404s per month into the past.
            if consecutive_misses >= 3:
                print("[backfill] archive appears to end here — stopping.")
                break
            continue
        consecutive_misses = 0
        entry: dict = {}
        for table, (url, body) in found.items():
            rows = parse_coffee_by_country(body)
            side = "exports_by_country" if table == "5x" else "imports_by_country"
            entry[side] = [
                {
                    "country":        r["country"],
                    "volume_ton":     r["rm_volume"],
                    "value_usd":      r["rm_value_usd"],
                    "ytd_volume_ton": r["ytd_volume"],
                    "ytd_value_usd":  r["ytd_value_usd"],
                }
                for r in rows
            ]
            entry[f"source_url_{table}"] = url
            print(f"[backfill] {key} {table}: {len(rows)} coffee rows ({url.rsplit('/', 1)[-1]})")
            unattributed = [r for r in rows if not r["country"]]
            if unattributed:
                print(f"[backfill] {key} {table}: WARNING {len(unattributed)} "
                      f"rows without a resolved country", file=sys.stderr)
        series[key] = entry
        ok += 1
        time.sleep(0.5)   # be polite to the host
    if not series:
        print("[backfill] FATAL: nothing harvested.", file=sys.stderr)
        return 2
    SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEED_PATH.write_text(json.dumps({
        "_note": ("Vietnam Customs coffee by country/territory, harvested from "
                  "the English preliminary bulletins (5X exports / 5N imports, "
                  "'(ta-sb)') on files.customs.gov.vn by "
                  "scraper.backfill_vn_customs_country. volume_ton/value_usd "
                  "are the reporting month; ytd_* the year-to-date cumulative. "
                  "5N carries no coffee commodity line (VN coffee imports are "
                  "folded into 'Other products'), so imports_by_country is "
                  "empty by source, kept for future-proofing."),
        "harvested_months": ok,
        "months": dict(sorted(series.items())),
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"[backfill] wrote {ok} months → {SEED_PATH}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=("probe", "backfill"), default="probe")
    ap.add_argument("--months", type=int, default=24,
                    help="Backfill lookback in months (default 24).")
    args = ap.parse_args(argv)
    return run_probe() if args.mode == "probe" else run_backfill(args.months)


if __name__ == "__main__":
    sys.exit(main())
