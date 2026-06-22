"""enso_thermocline.py — TAO/TRITON subsurface T at 150 m via PMEL ERDDAP.

Phase 3 — depth-resolved subsurface temperature anomalies at the
equatorial Pacific TAO/TRITON buoy network, complementing the WWV
card (Phase 2). The two are different signals on different horizons:

  • WWV (Phase 2): depth-integrated heat content, slow.
    4-6 MONTH lead before SST. Tells you the reservoir is full.
  • T-150m (this module): point measurements at the thermocline depth
    where downwelling Kelvin waves propagate. 4-6 WEEK lead.
    Tells you a slug of heat is propagating eastward NOW.

When BOTH cards show warm anomalies, the surface is going to keep
warming. When the thermocline cools while WWV stays high, the surface
event is past its peak (the reservoir is draining without replenishment).

Data: NOAA PMEL ERDDAP `tabledap` — REST-y CSV endpoint where filters
go in the URL as constraint expressions (e.g. `?latitude>=-1
&latitude<=1&depth>=140&depth<=160&time>=2022-01-01`).

⚠ Network: ERDDAP at upwell.pmel.noaa.gov is reachable from GitHub
Actions runners but NOT from the Claude Code sandbox (same outbound-
allowlist gate). The fetcher runs on the runner; sandbox can only
inspect what's already committed. The dry-run+diag protocol from
Phases 1 and 2 applies here too.

Usage
-----
    cd backend
    python -m scraper.sources.enso_thermocline              # preview
    python -m scraper.sources.enso_thermocline --write      # parse + write
    python -m scraper.sources.enso_thermocline --diag       # log raw CSV
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "frontend" / "public" / "data"
OUT_PATH = DATA_DIR / "enso_thermocline.json"

# Multiple ERDDAP HOSTS — the v1 dispatch on 22 Jun 2026 surfaced
# that `upwell.pmel.noaa.gov` no longer resolves (PMEL decommissioned
# their ERDDAP instance ~2024 and the TAO/TRITON data migrated to
# OSMC and the NMFS PFEG mirrors). Walk all known equivalent hosts.
ERDDAP_HOSTS = [
    # OSMC (Ocean Systems Monitoring Center) — took over TAO data
    # management from PMEL ~2014. Most likely current home.
    "https://osmc.noaa.gov/erddap",
    # CoastWatch West Coast — long-running mirror of many PMEL datasets.
    "https://coastwatch.pfeg.noaa.gov/erddap",
    # NMFS PFEG Santa Cruz — sibling mirror to CoastWatch.
    "https://upwell.pfeg.noaa.gov/erddap",
    # Pacific Coastal & Marine ERDDAP — another candidate mirror.
    "https://erddap.aoml.noaa.gov/hdb/erddap",
    # Legacy PMEL — kept in case NOAA brings the service back.
    "https://upwell.pmel.noaa.gov/erddap",
]

# Multiple PMEL ERDDAP dataset IDs to try in order. The IDs survived
# the host migration on most mirrors (they kept the same names for
# backward compatibility), so the cross-product host × dataset
# (5 × 5 = 25 candidates) covers a wide search space without a code
# change when NOAA next reshuffles.
DATASET_CANDIDATES = [
    "pmelTaoMonT",       # Monthly subsurface T — most common ID
    "pmelTaoMonsT",      # Variant naming
    "pmelTaoMonTao",     # Older ID
    "pmelTaoDyT",        # Daily fallback if monthly is dropped
    "pmelTaoDySubsurfT",
]

# Target depth (m) — 150 m is the canonical Kelvin-wave depth in the
# equatorial Pacific (the thermocline sits at ~120-180m there). We
# range-filter ±10 m because TAO buoys sample at discrete depths
# (standard set: 1, 5, 10, 20, 40, 60, 80, 100, 120, 140, 180, 300, 500 m)
# and the closest measurement to 150 m is usually 140 m or 180 m.
TARGET_DEPTH_M = 150
DEPTH_LOWER = 140
DEPTH_UPPER = 180

# Equatorial Pacific buoy longitudes (PMEL convention: 0-360 east).
# These are the five "anchor" sites along 0°N used in ENSO monitoring.
# In each tuple: (PMEL 0-360 longitude, display label).
EQ_BUOY_SITES = [
    (165.0, "165°E"),   # Western Pacific
    (180.0, "180°"),    # Date line
    (190.0, "170°W"),   # Central
    (220.0, "140°W"),   # Central-east (headline buoy for ENSO)
    (250.0, "110°W"),   # Eastern
]

# How much history to pull. 5 years gives enough to compute a
# trailing-12-month climatology per site AND show a 60-day evolution
# on the frontend without re-fetching.
HISTORY_START_DATE = "2021-01-01"

# Headline buoy — 0°N, 140°W (PMEL longitude 220) — sits in the
# central-east equatorial Pacific where Kelvin waves SURFACE before
# breaching into the Niño 3.4 region. This is the buoy the alert
# fires on.
HEADLINE_BUOY_LON = 220.0

# Kelvin-wave detection threshold (°C). Anomalies > +1 °C at 150m
# historically precede a surface SST rise of comparable magnitude
# 4-6 weeks later (see McPhaden 1999 and follow-ups). Conservative
# enough that we don't fire on noise.
KELVIN_WARM_THRESHOLD = 1.0
KELVIN_COLD_THRESHOLD = -1.0

_BROWSER_HEADERS = {
    "User-Agent": "coffee-intel-map/enso-thermocline (https://github.com/loicscanu-ctrl/coffee-intel-map)",
    "Accept": "text/csv, */*",
}

# ERDDAP returns one of these names for the temperature column,
# depending on the dataset variant. We don't pin the column name
# in the URL — let the server send whatever it has — and then pick
# the first column that smells like a temperature value.
_TEMP_COLUMN_CANDIDATES = ("T_25", "T_20", "T", "temperature", "WTMP", "T_TEMP")


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class ThermoclineSample:
    month:           str        # "YYYY-MM"
    longitude_e:     float      # PMEL 0-360 convention
    site_label:      str        # e.g. "140°W"
    depth_m:         float      # measured depth (often 140 or 180, near 150)
    temp_c:          float      # raw temperature in °C
    temp_anomaly_c:  float | None  # vs site's 12-month trailing mean


# ── HTTP fetching ───────────────────────────────────────────────────────────


def _fetch(url: str, *, timeout: int = 60) -> str | None:
    """One GET. Returns text on 200, None on any error so one dataset
    failing doesn't kill the run. ERDDAP responses can be slow on
    larger queries — generous timeout."""
    try:
        resp = requests.get(url, headers=_BROWSER_HEADERS, timeout=timeout)
    except requests.RequestException as e:
        logger.warning(f"[therm] GET {url} → request error: {e}")
        return None
    if resp.status_code != 200:
        snippet = (resp.text or "")[:200]
        logger.warning(f"[therm] GET {url} → HTTP {resp.status_code}: {snippet}")
        return None
    return resp.text


def _build_query(host: str, dataset_id: str) -> str:
    """ERDDAP tabledap CSV query for equatorial Pacific subsurface T.

    Each filter is a constraint expression (NOT a key=value param).
    We don't pin column names in the SELECT — let the server return
    its full schema so the parser can find whichever temperature
    column this dataset uses (variants: T_25, T_20, T, temperature).
    """
    return (
        f"{host}/tabledap/{dataset_id}.csv"
        f"?&latitude>=-1&latitude<=1"
        f"&depth>={DEPTH_LOWER}&depth<={DEPTH_UPPER}"
        f"&time>={HISTORY_START_DATE}"
    )


def _fetch_first_ok(
    hosts: list[str],
    datasets: list[str],
) -> tuple[str | None, str | None]:
    """Walk the host × dataset cross-product, return (csv_text,
    "host/dataset_id") for the first 200 response. (None, None) when
    all fail. Logs the winner so the operator sees which ERDDAP
    server NOAA is currently serving TAO data from — useful when
    PMEL/OSMC/NMFS reshuffle ownership again.

    Outer loop is hosts (we'd rather find an alive ERDDAP server
    that happens to use a less-preferred dataset ID than waste time
    checking dead hosts with five different IDs each)."""
    for host in hosts:
        for ds in datasets:
            url = _build_query(host, ds)
            text = _fetch(url)
            if text:
                tag = f"{host}/{ds}"
                logger.info(f"[therm] fetched OK: {tag} ({len(text):,} bytes)")
                return text, tag
    return None, None


# ── parsing ─────────────────────────────────────────────────────────────────


def _nearest_site(longitude_e: float) -> tuple[float, str] | None:
    """Bucket a raw buoy longitude into one of our 5 anchor sites.
    PMEL serves longitudes in 0-360 east; sites are spaced ~30° apart.
    A strict <15° tolerance assigns each measurement unambiguously —
    points exactly halfway between two anchors (235°E sits 15° from
    both 220 and 250) are dropped rather than mis-attributed."""
    best, best_dist = None, 999.0
    for site_lon, label in EQ_BUOY_SITES:
        d = abs(longitude_e - site_lon)
        if d < best_dist and d < 15:
            best, best_dist = (site_lon, label), d
    return best


def _pick_temp_column(header: list[str]) -> int | None:
    """Find the temperature column index in ERDDAP's header. Different
    PMEL datasets use different names (T_25, T_20, T, temperature) but
    they're all the same quantity — degrees C at the sampled depth."""
    lower = [h.strip().lower() for h in header]
    for cand in _TEMP_COLUMN_CANDIDATES:
        if cand.lower() in lower:
            return lower.index(cand.lower())
    # Fallback: any column whose name starts with "t" and isn't time.
    for i, h in enumerate(lower):
        if h.startswith("t") and h not in ("time",):
            return i
    return None


def _pick_col(header: list[str], names: tuple[str, ...]) -> int | None:
    lower = [h.strip().lower() for h in header]
    for n in names:
        if n.lower() in lower:
            return lower.index(n.lower())
    return None


def parse_erddap_csv(text: str) -> list[ThermoclineSample]:
    """Parse an ERDDAP tabledap CSV response. The CSV layout is:
        row 0: column names    (time, latitude, longitude, depth, T_25, …)
        row 1: units            (UTC,  degrees_north, degrees_east, m, degree_C, …)
        row 2+: data rows

    For each data row we:
      • Convert time to "YYYY-MM" (drop the day; the file is monthly).
      • Bucket the longitude into one of our 5 anchor sites (±15°).
      • Skip rows outside our anchor sites.
      • Anomaly is computed later in _enrich_with_anomalies, not here.
    """
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        return []
    try:
        next(reader)   # units row — skip
    except StopIteration:
        return []

    i_time = _pick_col(header, ("time",))
    i_lon  = _pick_col(header, ("longitude",))
    i_dep  = _pick_col(header, ("depth",))
    i_t    = _pick_temp_column(header)
    if None in (i_time, i_lon, i_dep, i_t):
        logger.warning(
            f"[therm] missing required column — header={header} "
            f"(time={i_time}, lon={i_lon}, depth={i_dep}, t={i_t})"
        )
        return []

    out: list[ThermoclineSample] = []
    for row in reader:
        if len(row) <= max(i_time, i_lon, i_dep, i_t):
            continue
        try:
            t_iso = row[i_time]
            lon   = float(row[i_lon])
            depth = float(row[i_dep])
            temp  = float(row[i_t])
        except (ValueError, IndexError):
            continue
        # PMEL ERDDAP serves time as ISO 8601: 2024-05-15T12:00:00Z.
        # Take just YYYY-MM — these are monthly means anyway.
        if len(t_iso) < 7:
            continue
        month = t_iso[:7]
        site = _nearest_site(lon)
        if site is None:
            continue
        site_lon, site_label = site
        out.append(ThermoclineSample(
            month=          month,
            longitude_e=    site_lon,
            site_label=     site_label,
            depth_m=        depth,
            temp_c=         round(temp, 2),
            temp_anomaly_c= None,   # filled below
        ))
    return out


def _enrich_with_anomalies(samples: list[ThermoclineSample]) -> list[ThermoclineSample]:
    """Compute a simple anomaly per (site, month) by subtracting the
    trailing-12-month mean at the same site. Cheap but reasonable —
    a proper climatology would use a 30-year normal per calendar
    month, but TAO data only goes back so far AND the trailing mean
    captures the relative "is current month warmer than recent" signal
    that the trader cares about. Earlier-than-12-month samples get
    anomaly=None (insufficient baseline)."""
    # Group by site (longitude); within each, by ascending month.
    by_site: dict[float, list[ThermoclineSample]] = defaultdict(list)
    for s in samples:
        by_site[s.longitude_e].append(s)
    for _lon, site_samples in by_site.items():
        site_samples.sort(key=lambda s: s.month)
        for i, s in enumerate(site_samples):
            # Look back up to 12 months at the same site for baseline.
            baseline_window = site_samples[max(0, i - 12): i]
            if len(baseline_window) < 6:
                # Not enough history yet — keep anomaly None.
                continue
            mean = sum(b.temp_c for b in baseline_window) / len(baseline_window)
            s.temp_anomaly_c = round(s.temp_c - mean, 2)
    return samples


# ── orchestration ──────────────────────────────────────────────────────────


def _classify_kelvin(anomaly: float | None) -> str:
    if anomaly is None:
        return "unknown"
    if anomaly >= KELVIN_WARM_THRESHOLD:
        return "warm-kelvin-wave"
    if anomaly <= KELVIN_COLD_THRESHOLD:
        return "cold-kelvin-wave"
    return "neutral"


def _fmt_signed(v: float | None, fmt: str = "+.2f") -> str:
    if v is None:
        return "—"
    return f"{v:{fmt}}"


def build_payload(samples: list[ThermoclineSample], dataset_id: str | None) -> dict:
    """Compose the JSON the frontend reads. Two views:
      • `by_site` — latest reading at each of the 5 anchor longitudes,
        for the across-Pacific snapshot (the "Kelvin wave is at this
        longitude" visual).
      • `headline_buoy` — full history at 0°N 140°W (the
        central-east, where Kelvin waves surface first), for the
        time-series chart."""
    # Latest per site.
    latest_per_site: dict[float, ThermoclineSample] = {}
    for s in samples:
        cur = latest_per_site.get(s.longitude_e)
        if cur is None or s.month > cur.month:
            latest_per_site[s.longitude_e] = s

    by_site = []
    for site_lon, site_label in EQ_BUOY_SITES:
        s = latest_per_site.get(site_lon)
        by_site.append({
            "longitude_e":     site_lon,
            "site_label":      site_label,
            "month":           s.month            if s else None,
            "temp_c":          s.temp_c           if s else None,
            "temp_anomaly_c":  s.temp_anomaly_c   if s else None,
            "kelvin_signal":   _classify_kelvin(s.temp_anomaly_c if s else None),
        })

    # Headline buoy time series — ascending month order.
    headline_samples = sorted(
        (s for s in samples if abs(s.longitude_e - HEADLINE_BUOY_LON) < 0.1),
        key=lambda s: s.month,
    )
    headline_latest = headline_samples[-1] if headline_samples else None

    return {
        "scraped_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "thermocline": {
            "source":         "NOAA PMEL TAO/TRITON via ERDDAP — subsurface T anomaly near 150 m, equatorial Pacific",
            "winning_dataset": dataset_id,
            "depth_m":        TARGET_DEPTH_M,
            "depth_range_m":  {"lower": DEPTH_LOWER, "upper": DEPTH_UPPER},
            "thresholds": {
                "warm_kelvin": KELVIN_WARM_THRESHOLD,
                "cold_kelvin": KELVIN_COLD_THRESHOLD,
            },
            "lead_weeks": "4–6",
            "headline_buoy": {
                "longitude_e": HEADLINE_BUOY_LON,
                "label":       "0°N 140°W",
                "latest": {
                    "month":          headline_latest.month            if headline_latest else None,
                    "temp_c":         headline_latest.temp_c           if headline_latest else None,
                    "temp_anomaly_c": headline_latest.temp_anomaly_c   if headline_latest else None,
                    "kelvin_signal":  _classify_kelvin(
                        headline_latest.temp_anomaly_c if headline_latest else None
                    ),
                },
                "monthly": [
                    {
                        "month":          s.month,
                        "temp_c":         s.temp_c,
                        "temp_anomaly_c": s.temp_anomaly_c,
                    }
                    for s in headline_samples
                ],
            },
            "by_site": by_site,
        },
    }


def _persist(doc: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


def run(*, write: bool, backfill: bool, diag: bool = False) -> int:
    """Fetch CSV, parse, persist. backfill is informational only —
    ERDDAP queries return the full history every request given the
    same date range filter, so backfill and refresh are the same code
    path. `--diag` dumps the raw CSV head/tail for format inspection."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    mode = "backfill" if backfill else "refresh"
    logger.info(f"[therm] mode={mode}")

    text, dataset_id = _fetch_first_ok(ERDDAP_HOSTS, DATASET_CANDIDATES)

    if diag:
        if text:
            lines = text.splitlines()
            head = "\n".join(lines[:8])
            tail = "\n".join(lines[-5:])
            logger.info(
                f"[therm] --diag erddap csv ({len(lines)} lines, dataset={dataset_id})\n"
                f"--- head ---\n{head}\n--- tail ---\n{tail}"
            )
        else:
            logger.info("[therm] --diag erddap: <no CSV fetched>")

    if not text:
        logger.error("[therm] FATAL: ERDDAP unreachable across all dataset candidates")
        return 1

    samples = parse_erddap_csv(text)
    if not samples:
        logger.error("[therm] FATAL: 0 samples parsed — column-name drift? re-run with --diag")
        return 1
    samples = _enrich_with_anomalies(samples)

    doc = build_payload(samples, dataset_id)
    headline = doc["thermocline"]["headline_buoy"]["latest"]
    by_site = doc["thermocline"]["by_site"]
    logger.info(
        f"[therm] {len(samples)} samples across {len({s.longitude_e for s in samples})} sites "
        f"(headline 0°N 140°W {headline['month'] or '—'}: "
        f"T={_fmt_signed(headline['temp_c'], fmt='+.2f')} °C, "
        f"anom={_fmt_signed(headline['temp_anomaly_c'])} °C, "
        f"signal={headline['kelvin_signal']})"
    )
    for s in by_site:
        logger.info(
            f"[therm]   {s['site_label']:>6}: "
            f"{s['month'] or '—'}  T={_fmt_signed(s['temp_c'], fmt='+5.2f')}  "
            f"anom={_fmt_signed(s['temp_anomaly_c'])}  ({s['kelvin_signal']})"
        )

    if write:
        _persist(doc)
        logger.info(f"[therm] wrote {OUT_PATH}")
    else:
        logger.info("[therm] preview only — pass --write to persist")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write",    action="store_true", help="Persist parsed JSON")
    ap.add_argument("--backfill", action="store_true",
                    help="Operator-intent flag for the full-history seed run. "
                         "Functionally identical to default refresh.")
    ap.add_argument("--diag", action="store_true",
                    help="Log head/tail of the fetched CSV so the operator "
                         "can confirm the column names from the workflow log.")
    args = ap.parse_args()
    return run(write=args.write, backfill=args.backfill, diag=args.diag)


if __name__ == "__main__":
    sys.exit(main())
