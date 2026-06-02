"""
fetch_cecafe_daily.py
Scrapes Cecafe's public daily export summary page (no login required) and
appends today's cumulative registration data to cecafe_daily.json.

Page: https://www.cecafe.com.br/dados-estatisticos/exportacoes-brasileiras/resumo-diario/

The page shows:
  - Current month: today's daily movement + month-to-date accumulation
  - Previous month: full-month totals

We record the "Acumulado" (month-to-date) value for today's day number,
building up a day-by-day curve for each month as the scraper runs daily.

Run:
    cd backend
    python -m scraper.fetch_cecafe_daily

Output: frontend/public/data/cecafe_daily.json
  {
    "updated": "YYYY-MM-DD",
    "arabica":  { "YYYY-MM": { "1": bags, "2": bags, ... } },
    "conillon": { "YYYY-MM": { "1": bags, "2": bags, ... } }
  }
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

import requests

ROOT     = Path(__file__).resolve().parents[2]
OUT_DIR  = ROOT / "frontend" / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_PATH = OUT_DIR / "cecafe_daily.json"

# Debug captures live at repo root (NOT under frontend/public, so they're never
# deployed) and are never git-added by the workflow — the workflow uploads this
# dir as a CI artifact so the fetched page can be inspected offline.
DEBUG_DIR = ROOT / "debug"


def _dump_html(name: str, html: str) -> None:
    """Persist a fetched page to debug/ for CI-artifact inspection (best-effort)."""
    try:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        path = DEBUG_DIR / name
        path.write_text(html, encoding="utf-8")
        print(f"  [debug] saved page HTML to {path}  ({len(html):,} chars)")
    except Exception as e:  # noqa: BLE001
        print(f"  [debug] could not save page HTML: {e}")

DAILY_URL = "https://www.cecafe.com.br/dados-estatisticos/exportacoes-brasileiras/resumo-diario/"


# ── Fetch ─────────────────────────────────────────────────────────────────────

# Headers chosen to look like a stock desktop Chrome request — the page
# sometimes returns a 403 / shorter "block page" when called with a generic
# Python User-Agent. The Accept-Language: pt-BR hint matters for some
# Brazilian-hosted sites that geo-tune their response.
_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection":      "keep-alive",
}


class CecafeUnreachable(RuntimeError):
    """TCP connect or read timed out — Cecafe's server refused or dropped
    the connection. Distinguished from a parser error (real bug in our code)
    so the workflow can choose to treat it as a transient external issue."""


def _fetch_page() -> str:
    """Fetch the Cecafe daily-resumo HTML.

    Raises:
        CecafeUnreachable — TCP-level failure (connect/read timeout, DNS,
            ConnectionError). The 2026-05-30 outage was all four attempts
            seeing the same TimeoutError at sock.connect — the runner's
            IP range was being refused by Cecafe's edge for the whole
            ~25min window. Spread retries across the day (multiple cron
            entries in the workflow) to give the block time to clear.
        requests.RequestException — non-timeout HTTP error (4xx/5xx).
            Re-raised so the caller can decide.
    """
    try:
        # (connect, read) — fail fast on connect so the bash retry loop
        # cycles quicker; allow 45s of read time for the slow page itself.
        r = requests.get(DAILY_URL, headers=_BROWSER_HEADERS, timeout=(15, 45))
        r.raise_for_status()
        # requests auto-handles gzip/deflate via Content-Encoding header.
        # .text uses apparent_encoding which works for utf-8 / latin-1
        # pages without us second-guessing.
        return r.text
    except (requests.Timeout, requests.ConnectionError) as e:
        raise CecafeUnreachable(
            f"TCP-level failure reaching {DAILY_URL}: {type(e).__name__}: {e}"
        ) from e


# ── Parse ─────────────────────────────────────────────────────────────────────

# The Cecafé daily page carries two TOTAIS rows we want to capture both of:
#
#   embarques:    "Unidades de Embarques Marítimos e Rodoviários"
#                 physical port loadings — truth of what shipped
#   certificados: "Emissão de Certificados de Origem"
#                 paperwork issued / clearance — runs ahead of loading
#
# Both follow the same 12-column TOTAIS layout (dia + acumulado + mês anterior
# × 4 crop types). We fetch both per-day and the frontend lets the user toggle
# between them — each tracks a different stage of the export pipeline and
# the divergence between them is itself informative.
TABLE_ANCHORS: dict[str, str] = {
    "embarques":    "Unidades de Embarques",
    "certificados": "Certificados de Origem",
}


def _parse_int_br(s: str) -> int:
    return int(s.replace(".", "").replace(",", "").strip())


def _parse_totais_row(body: str, anchor_label: str) -> dict | None:
    """Pull the 12-number TOTAIS row anchored on a section header.
    Returns None when the anchor isn't found OR no TOTAIS row matches —
    caller decides whether that's fatal."""
    anchor_idx = body.lower().find(anchor_label.lower())
    if anchor_idx < 0:
        return None
    section = body[anchor_idx:]

    # Number pattern — Brazilian thousands ("123.456") with optional trailing
    # footnote marker (*, ¹-⁹, †). 12-col primary, 8-col fallback.
    _NUM = r'([\d\.]+)[\*¹²³⁴⁵⁶⁷⁸⁹†]?'
    _SEP = r'\s+'
    totais_12 = re.compile(r'TOTAIS' + _SEP + (_NUM + _SEP) * 11 + _NUM, re.IGNORECASE)
    totais_8  = re.compile(r'TOTAIS' + _SEP + (_NUM + _SEP) *  7 + _NUM, re.IGNORECASE)

    m = totais_12.search(section)
    if m:
        return {
            "arabica":       _parse_int_br(m.group(5)),
            "conillon":      _parse_int_br(m.group(6)),
            "soluvel":       _parse_int_br(m.group(7)),
            "prev_arabica":  _parse_int_br(m.group(9)),
            "prev_conillon": _parse_int_br(m.group(10)),
            "prev_soluvel":  _parse_int_br(m.group(11)),
        }
    m = totais_8.search(section)
    if m:
        return {
            "arabica":       _parse_int_br(m.group(5)),
            "conillon":      _parse_int_br(m.group(6)),
            "soluvel":       _parse_int_br(m.group(7)),
            "prev_arabica":  None,
            "prev_conillon": None,
            "prev_soluvel":  None,
        }
    return None


def _parse_page(html: str) -> dict:
    """
    Returns:
      {
        "ref_date": date,
        "prev_ym":  "YYYY-MM",
        "sources":  {
            "embarques":    {arabica, conillon, soluvel, prev_arabica, prev_conillon, prev_soluvel} | None,
            "certificados": {arabica, conillon, soluvel, prev_arabica, prev_conillon, prev_soluvel} | None,
        },
      }

    Each source TOTAIS row has 12 numbers in the same layout:
      [1] arabica_dia  [2] conillon_dia  [3] soluvel_dia  [4] total_dia
      [5] arabica_acum [6] conillon_acum [7] soluvel_acum [8] total_acum
      [9] arabica_prev [10] conillon_prev [11] soluvel_prev [12] total_prev

    Tolerates:
      * Footnote markers after numbers ("123.456*", "123.456¹")
      * 8-column variant (no Mês Anterior block) — prev_* are None
      * Variable whitespace / non-breaking spaces between cells
      * A source missing — that source's entry is None; caller continues
        as long as at least one source resolved.
    """
    # Strip scripts/styles then convert to plain text
    clean = re.sub(r'<(script|style)[^>]*>.*?</(script|style)>', '',
                   html, flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r'<[^>]+>', ' ', clean)
    clean = clean.replace("\xa0", " ").replace("&nbsp;", " ")
    text  = re.sub(r'\s+', ' ', clean).strip()

    # ── Reference date ──────────────────────────────────────────────────────
    date_m = re.search(r'recebidas\s+at[eé]:\s*(\d{2})/(\d{2})/(\d{4})', text, re.IGNORECASE)
    if not date_m:
        idx = text.lower().find('recebidas')
        snippet = text[max(0, idx - 40): idx + 200] if idx >= 0 else text[:400]
        raise ValueError(
            "Could not find reference date on page. "
            f"Page-text excerpt: ...{snippet!r}..."
        )
    ref_date = date(int(date_m.group(3)), int(date_m.group(2)), int(date_m.group(1)))
    print(f"  Reference date: {ref_date}")

    # ── Both TOTAIS sources ──────────────────────────────────────────────────
    sources: dict[str, dict | None] = {}
    for key, anchor in TABLE_ANCHORS.items():
        sources[key] = _parse_totais_row(text, anchor)
        if sources[key] is None:
            print(f"  [{key}] no TOTAIS row found near {anchor!r} — skipping this source")
        else:
            s = sources[key]
            print(f"  [{key}] acum A={s['arabica']:,} C={s['conillon']:,} S={s['soluvel']:,} | "
                  f"prev A={s['prev_arabica']} C={s['prev_conillon']} S={s['prev_soluvel']}")

    if all(v is None for v in sources.values()):
        snippet = text[:1500].replace("\n", " ")
        raise ValueError(
            f"Could not find TOTAIS row for ANY known source ({list(TABLE_ANCHORS)}). "
            f"Page-text excerpt: ...{snippet!r}..."
        )

    prev_month = ref_date.month - 1 or 12
    prev_year  = ref_date.year if ref_date.month > 1 else ref_date.year - 1
    prev_ym    = f"{prev_year}-{prev_month:02d}"

    return {
        "ref_date": ref_date,
        "prev_ym":  prev_ym,
        "sources":  sources,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def _empty_source() -> dict:
    return {"arabica": {}, "conillon": {}, "soluvel": {}}


def _load_existing() -> tuple[dict, str]:
    """Load the dual-source JSON. Migrates the legacy flat schema
    ({arabica, conillon, soluvel} at top level — originally fed by the
    Certificados de Origem table) into sources["certificados"] so existing
    historical data isn't lost. New schema:
      {
        "updated": "YYYY-MM-DD",
        "_schema": "v2",
        "sources": {
          "embarques":    {arabica:{}, conillon:{}, soluvel:{}},
          "certificados": {arabica:{}, conillon:{}, soluvel:{}},
        }
      }"""
    existing: dict = {
        "updated": "",
        "_schema": "v2",
        "sources": {
            "embarques":    _empty_source(),
            "certificados": _empty_source(),
        },
    }
    prev_updated = ""
    if not OUT_PATH.exists():
        return existing, prev_updated
    try:
        raw = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return existing, prev_updated
    prev_updated = raw.get("updated", "")
    if "sources" in raw:
        # Already new schema — copy through.
        for key in ("embarques", "certificados"):
            src = raw["sources"].get(key) or _empty_source()
            existing["sources"][key] = {
                "arabica":  src.get("arabica", {}),
                "conillon": src.get("conillon", {}),
                "soluvel":  src.get("soluvel", {}),
            }
    else:
        # Legacy flat schema — historical data lived under top-level keys and
        # came from Certificados de Origem. Migrate into certificados; leave
        # embarques empty so it backfills cleanly going forward.
        existing["sources"]["certificados"] = {
            "arabica":  raw.get("arabica",  {}),
            "conillon": raw.get("conillon", {}),
            "soluvel":  raw.get("soluvel",  {}),
        }
        print("  [migrate] legacy flat schema → sources.certificados (one-shot)")
    return existing, prev_updated


def _store_source_day(source_bucket: dict, ym: str, day: str, parsed: dict) -> None:
    """Merge one source's (arabica, conillon, soluvel) cumulative values
    for the given (ym, day) into the source bucket in place."""
    for crop in ("arabica", "conillon", "soluvel"):
        if ym not in source_bucket[crop]:
            source_bucket[crop][ym] = {}
        source_bucket[crop][ym][day] = parsed[crop]


def main():
    print("=== Cecafe daily registration scraper (public, no login) ===")

    # 1. Load + migrate existing JSON.
    existing, prev_updated = _load_existing()

    # 2. Fetch page — surface unreachability cleanly so the workflow log
    # explains a sustained outage (recurring May 2026 issue: GH Actions
    # runner IPs periodically refused by Cecafe's edge for ~30+ min windows).
    print(f"\n[1] Fetching {DAILY_URL}...")
    try:
        html = _fetch_page()
    except CecafeUnreachable as e:
        print(f"  ERROR (transient): {e}")
        print("  Source is unreachable — keeping last good JSON.")
        print("  This is the recurring connect-timeout pattern; the next")
        print("  scheduled cron (midday / evening) will retry with a fresh")
        print("  network window.")
        sys.exit(1)
    print(f"  Page size: {len(html):,} chars")
    _dump_html("cecafe_daily_last_fetch.html", html)

    # 3. Parse — extracts BOTH the embarques and certificados TOTAIS rows
    # plus the ref date. A missing source yields None for that key; we
    # carry on and write whichever sources did parse.
    print("\n[2] Parsing data...")
    try:
        parsed_doc = _parse_page(html)
    except ValueError as e:
        _dump_html("cecafe_daily_last_failed.html", html)
        print(f"  ERROR: {e}")
        sys.exit(1)

    ref = parsed_doc["ref_date"]
    ym  = f"{ref.year}-{ref.month:02d}"
    day = str(ref.day)
    prev_ym = parsed_doc["prev_ym"]

    if prev_updated and ref.isoformat() == prev_updated:
        print(f"  [diag] page reference date {ref.isoformat()} == last stored — "
              "source has NOT published a newer day (nothing new to commit).")
    elif prev_updated:
        print(f"  [diag] page advanced: {prev_updated} -> {ref.isoformat()}")

    # 4. Merge each source's current-month + prev-month same-day cumulatives.
    n_stored = 0
    for source_key, parsed in parsed_doc["sources"].items():
        if parsed is None:
            continue
        bucket = existing["sources"][source_key]
        _store_source_day(bucket, ym, day, parsed)
        if parsed.get("prev_arabica") is not None:
            prev_row = {
                "arabica":  parsed["prev_arabica"],
                "conillon": parsed["prev_conillon"],
                "soluvel":  parsed["prev_soluvel"],
            }
            _store_source_day(bucket, prev_ym, day, prev_row)
        n_stored += 1
        print(f"  [{source_key}] stored {ym} day {day}: "
              f"A={parsed['arabica']:,} C={parsed['conillon']:,} S={parsed['soluvel']:,}")

    if n_stored == 0:
        print("  ERROR: no sources parsed successfully — keeping JSON unchanged.")
        sys.exit(1)

    # 5. Save with the dual-source schema.
    existing["updated"] = ref.isoformat()
    existing["_schema"] = "v2"
    OUT_PATH.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWritten -> {OUT_PATH}  ({OUT_PATH.stat().st_size:,} bytes)")
    for src_key, bucket in existing["sources"].items():
        months = sorted(bucket["arabica"].keys())
        print(f"  {src_key}: {len(months)} months stored ({months[:3]}…{months[-2:]})")


if __name__ == "__main__":
    main()
