"""ENSO probability forecast — multi-source fallback chain.

The IRI/CPC ENSO Quick Look page (Columbia) used to publish the rolling
9-season probability table as an HTML <table>. As of 2026 they shifted to
a JS-rendered / image-only layout, so the HTML parse returns nothing.

We keep the IRI HTML parser (Attempt A) — in case they revert — and fall
back to NOAA CPC's monthly ENSO Diagnostic Discussion bulletin (Attempt B),
which publishes the same probability table as plain text inside a <pre>
block. The bulletin is a .gov text resource: stable, lightweight, no
Akamai/Cloudflare in front.

Public API:
    fetch_enso_forecast() -> list[dict]
        Run the chain (network). Each entry:
        {"season": "AMJ", "la_nina": 8, "neutral": 78, "el_nino": 14}.
    parse_iri_html(html) -> list[dict]      # Attempt A parser
    parse_cpc_discussion(text) -> list[dict]  # Attempt B parser
"""
from __future__ import annotations

import re

import requests

# Source URLs — pinned constants so the fallback chain is greppable.
IRI_FORECAST_URL = "https://iri.columbia.edu/our-expertise/climate/forecasts/enso/current/"
CPC_DISCUSSION_URL = (
    "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/"
    "enso_advisory/ensodisc.shtml"
)

# Standard 3-letter season order (DJF=Dec-Jan-Feb, …). Used by callers that
# need to align analog overlays to the forecast x-axis.
SEASON_ORDER = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ",
                "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]


# ── Attempt A: IRI HTML parser (kept for the day they revert to a table) ──

def parse_iri_html(html: str) -> list[dict]:
    """Parse the IRI/CPC ENSO probability table out of the forecast page HTML.

    Pure (no network). Table layout (column-oriented):
        Season | La Nina | Neutral | El Nino
        MAM    |   0     |   91    |    9
    Returns [{"season": "MAM", "la_nina": 0, "neutral": 91, "el_nino": 9}, ...].
    Empty list when the page has no parseable probability table (which is the
    current production state — IRI is rendering images).
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    forecast: list[dict] = []

    def _int(cell):
        try:
            return int(cell.get_text(strip=True).replace("%", "").strip())
        except (ValueError, AttributeError):
            return None

    for table in soup.find_all("table"):
        all_text = table.get_text()
        if "La Nina" not in all_text and "La Ni\xf1a" not in all_text:
            continue

        rows = table.find_all("tr")
        if not rows:
            continue

        headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]
        col_season: int | None = None
        col_lanina: int | None = None
        col_neutral: int | None = None
        col_elnino: int | None = None
        for i, h in enumerate(headers):
            if col_season is None and (
                h == "season" or "month" in h or "period" in h or "3-mo" in h
            ):
                col_season = i
            if col_lanina is None and "la" in h and ("nina" in h or "niña" in h):
                col_lanina = i
            if col_neutral is None and "neutral" in h:
                col_neutral = i
            if col_elnino is None and "el" in h and ("nino" in h or "niño" in h):
                col_elnino = i

        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < 4:
                continue
            if col_season is not None:
                season = cells[col_season].get_text(strip=True)
            else:
                season = cells[0].get_text(strip=True)
            if len(season) != 3 or not season.isalpha() or not season.isupper():
                continue

            if (col_lanina is not None and col_neutral is not None
                    and col_elnino is not None):
                if len(cells) <= max(col_lanina, col_neutral, col_elnino):
                    continue
                la = _int(cells[col_lanina])
                nu = _int(cells[col_neutral])
                el = _int(cells[col_elnino])
            else:
                nums = [_int(c) for c in cells[1:5]]
                nums = [n for n in nums if n is not None]
                if len(nums) < 3:
                    continue
                la, nu, el = nums[0], nums[1], nums[2]

            forecast.append({"season": season, "la_nina": la, "neutral": nu, "el_nino": el})

        if forecast:
            break

    return forecast


# ── Attempt B: NOAA CPC ENSO Diagnostic Discussion text parser ────────────────

# A CPC discussion contains a probability table inside a <pre>-formatted block.
# Format (slight wording drifts month to month, but the grid is stable):
#
#   Season   La Niña   Neutral   El Niño
#   AMJ 2026     8        78       14
#   MJJ 2026    15        70       15
#   ...
#
# The header line keys "La Niña/Nina", "Neutral", "El Niño/Nino" mark the start
# of the table. Each data row begins with a 3-letter season code (optional
# trailing year) followed by three integer percentages.

_SEASON_RE = re.compile(r"\b([A-Z]{3})(?:\s+\d{4})?\b")
_HEADER_RE = re.compile(
    r"la\s*ni[ñn]a.*?neutral.*?el\s*ni[ñn]o",
    re.IGNORECASE | re.DOTALL,
)


def parse_cpc_discussion(text: str) -> list[dict]:
    """Parse the probability table out of the CPC ENSO Diagnostic Discussion.

    `text` is either the raw page HTML or the inner <pre>-block plain text;
    we strip tags defensively and walk the lines. Pure function.
    """
    # Strip HTML tags but preserve newlines — the <pre> grid loses its grid
    # if we collapse whitespace.
    cleaned = re.sub(r"<[^>]+>", "", text or "")
    # Normalise non-breaking spaces and unicode niñas.
    cleaned = (cleaned.replace("\xa0", " ")
                      .replace("Niña", "Nina")
                      .replace("Niño", "Nino"))

    lines = cleaned.splitlines()
    header_idx = -1
    for i, ln in enumerate(lines):
        low = ln.lower()
        if "la nina" in low and "neutral" in low and "el nino" in low:
            header_idx = i
            break
    if header_idx < 0:
        return []

    # Decide column order from header (CPC has historically used La/Neutral/El
    # but a layout shift could reorder them). Find the column position of each
    # token on the header line and use those positions to slice data rows.
    header_line = lines[header_idx].lower()
    col_la = header_line.find("la nina")
    col_nu = header_line.find("neutral")
    col_el = header_line.find("el nino")
    use_positions = all(c >= 0 for c in (col_la, col_nu, col_el))

    out: list[dict] = []
    for raw in lines[header_idx + 1:]:
        # Stop on blank lines or non-data prose lines after the grid.
        stripped = raw.strip()
        if not stripped:
            # A single blank inside a <pre> usually ends the table; allow a
            # spacer line if the next line still starts with a season code.
            if out:
                break
            continue

        # Data row must start with a 3-letter season code.
        m = _SEASON_RE.match(stripped)
        if not m:
            if out:
                break
            continue
        season = m.group(1)
        if season not in SEASON_ORDER:
            if out:
                break
            continue

        # Extract three integers in column order (or first three if positions
        # not usable). Tolerate "%" suffixes and surrounding whitespace.
        nums = [int(n) for n in re.findall(r"-?\d+", stripped[m.end():])]
        if len(nums) < 3:
            continue
        if use_positions:
            # Use header positions to pick the right three columns. We map by
            # finding which of the three header positions are leftmost /
            # middle / rightmost; CPC's standard order is La / Neutral / El,
            # so a positional sort gives us (la, nu, el) regardless of layout.
            order = sorted([("la_nina", col_la), ("neutral", col_nu),
                            ("el_nino", col_el)], key=lambda x: x[1])
            keys = [k for k, _ in order]
            mapping = dict(zip(keys, nums[:3]))
            out.append({
                "season":  season,
                "la_nina": mapping["la_nina"],
                "neutral": mapping["neutral"],
                "el_nino": mapping["el_nino"],
            })
        else:
            out.append({"season": season, "la_nina": nums[0],
                        "neutral": nums[1], "el_nino": nums[2]})

    return out


# ── Orchestrator: try A, fall back to B ──────────────────────────────────────

def fetch_enso_forecast(timeout: float = 30.0,
                        session: requests.Session | None = None,
                        ) -> tuple[list[dict], str | None]:
    """Try IRI first; if the table comes back empty, try CPC. Returns
    (forecast, source) where source is 'iri', 'cpc', or None when both fail.

    Non-200 / network errors on Attempt A don't abort — we still try B.
    Both failing returns ([], None) so the caller can decide between
    "use stale" or "ship empty".
    """
    s = session or requests.Session()
    headers = {"User-Agent": "Mozilla/5.0"}

    # Attempt A — IRI HTML
    try:
        r = s.get(IRI_FORECAST_URL, headers=headers, timeout=timeout)
        if r.ok:
            forecast = parse_iri_html(r.text)
            if forecast:
                return forecast, "iri"
    except requests.RequestException:
        pass

    # Attempt B — CPC ENSO Diagnostic Discussion
    try:
        r = s.get(CPC_DISCUSSION_URL, headers=headers, timeout=timeout)
        if r.ok:
            forecast = parse_cpc_discussion(r.text)
            if forecast:
                return forecast, "cpc"
    except requests.RequestException:
        pass

    return [], None


# Backwards-compat re-export: existing test_farmer_economics.py calls
# fe.parse_iri_probability_table — keep that name reachable through the
# farmer_economics module.
parse_iri_probability_table = parse_iri_html
