"""enso_thermocline.py — TAO/TRITON subsurface T at 150 m via NDBC.

Phase 3 v3 — pivots off the dead-end ERDDAP path (PMEL decommissioned
its instance + the PFEG/OSMC mirrors blacklist GHA egress IPs) to
NDBC's flat-text realtime feed, which serves the same upstream buoy
telemetry without a WAF in front of it.

  https://www.ndbc.noaa.gov/data/realtime2/{STATION_ID}.ocean

Each .ocean file carries ~45 days of multi-depth temperature
observations from one TAO buoy. We pull 7 specific stations all
anchored INSIDE the Niño 3.4 box (5°N-5°S, 170°W-120°W) along three
longitudes (170°W, 155°W, 140°W), filter to depths near 150 m
(the Kelvin-wave depth), and compute a 30-day delta per station
(recent 7-day mean minus 30-37-day-old 7-day mean). |Δ| ≥ 1.0 °C
signals a Kelvin wave breaching that station.

  • WWV (Phase 2): depth-INTEGRATED reservoir, 4-6 MONTH lead
  • This module:   depth-RESOLVED at the thermocline, 4-6 WEEK lead
                   PLUS lat/lon coordinates so the buoys pin onto
                   the ENSO risk map

⚠ Network: NDBC at www.ndbc.noaa.gov IS reachable from GHA — verified
via this run series. The .ocean realtime feeds are unauthenticated
plain text. No proxy or workaround needed.

Usage
-----
    cd backend
    python -m scraper.sources.enso_thermocline              # preview
    python -m scraper.sources.enso_thermocline --write      # parse + write
    python -m scraper.sources.enso_thermocline --diag       # log raw .ocean head
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "frontend" / "public" / "data"
OUT_PATH = DATA_DIR / "enso_thermocline.json"

NDBC_BASE = "https://www.ndbc.noaa.gov/data/realtime2"

# Niño 3.4-anchored TAO/TRITON buoys (NDBC station IDs from operator
# blueprint). Layout: 3 longitudes × 3 latitudes ≈ 7 stations covering
# the central-east equatorial Pacific where Kelvin waves surface first.
# `longitude_e` is in 0-360 convention to match Phase 2 conventions;
# `lon_negative` is the -180..+180 form used for Leaflet map pins.
@dataclass(frozen=True)
class BuoySite:
    station_id:   str
    lat:          float        # degrees north (negative = south)
    lon_negative: float        # degrees east, -180..+180 (for Leaflet)
    label:        str          # e.g. "0°N 155°W"
    column:       str          # one of "170W", "155W", "140W"

    @property
    def longitude_e(self) -> float:
        """0..360 east convention (matches Phase 2 frontend)."""
        return (self.lon_negative + 360) % 360


NDBC_BUOYS: tuple[BuoySite, ...] = (
    # 170°W column
    BuoySite("51305",  2.0, -170.0, "2°N 170°W",  "170W"),
    BuoySite("51010",  0.0, -170.0, "0°N 170°W",  "170W"),
    BuoySite("51306", -2.0, -170.0, "2°S 170°W",  "170W"),
    # 155°W column — 51023 is dead center of the Niño 3.4 box
    BuoySite("51021",  2.0, -155.0, "2°N 155°W",  "155W"),
    BuoySite("51023",  0.0, -155.0, "0°N 155°W",  "155W"),
    BuoySite("51022", -2.0, -155.0, "2°S 155°W",  "155W"),
    # 140°W column
    BuoySite("51311",  0.0, -140.0, "0°N 140°W",  "140W"),
)

# Headline buoy — 0°N 155°W, the dead center of the Niño 3.4 box.
# Kelvin waves crossing 155°W are typically 2-4 weeks from surfacing
# in the Niño 3.4 SST signal we already track in Phase 1.
HEADLINE_STATION_ID = "51023"

# Depth window — TAO subsurface sensors sample at canonical depths
# (1, 10, 20, 40, 60, 80, 100, 120, 140, 180, 300, 500 m). The
# "150 m Kelvin wave depth" is bracketed by 140 and 180; we accept
# anything in [130, 200] m and record the exact sensor depth in the
# output so the frontend can show it.
TARGET_DEPTH_M = 150
DEPTH_LOWER_M  = 130
DEPTH_UPPER_M  = 200

# Kelvin-wave thresholds, °C. Δ-30d = (mean of last 7 days at this
# buoy/depth) minus (mean of 30-37 days ago at the same buoy/depth).
# |Δ| ≥ 1.0 °C is the McPhaden-era empirical threshold for a
# qualifying downwelling/upwelling Kelvin event.
KELVIN_WARM_THRESHOLD = 1.0
KELVIN_COLD_THRESHOLD = -1.0

# NDBC missing-value sentinel — appears as the literal string "MM"
# in any column where the sensor failed for that observation.
_MISSING_TOKEN = "MM"

_BROWSER_HEADERS = {
    "User-Agent": "coffee-intel-map/enso-thermocline (https://github.com/loicscanu-ctrl/coffee-intel-map)",
    "Accept": "text/plain, */*",
}

# NDBC realtime data rows: YYYY MM DD hh mm DEPTH OTMP ... (whitespace-
# delimited). Leading two `#` lines are header + units. A datetime
# anchor at column 0 is a 4-digit year — use that to filter out
# garbage lines (blank, partial, anything not starting with a year).
_DATA_ROW_RE = re.compile(r"^\s*(?P<yr>(?:19|20)\d{2})\s+")


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class OceanObs:
    """One depth-resolved measurement from a .ocean file."""
    timestamp: datetime    # UTC
    depth_m:   float
    temp_c:    float


# ── HTTP fetching ───────────────────────────────────────────────────────────


def _fetch(url: str, *, timeout: int = 30) -> str | None:
    """Plain GET, returns text on 200, None on any error. NDBC is a
    stable government endpoint without WAF — failures here are
    typically (a) buoy decommissioned, (b) intermittent server-side
    glitches that the next dispatch picks up cleanly."""
    try:
        resp = requests.get(url, headers=_BROWSER_HEADERS, timeout=timeout)
    except requests.RequestException as e:
        logger.warning(f"[therm] GET {url} → request error: {e}")
        return None
    if resp.status_code != 200:
        logger.warning(f"[therm] GET {url} → HTTP {resp.status_code}")
        return None
    return resp.text


# ── parsers ─────────────────────────────────────────────────────────────────


def parse_ocean_file(text: str) -> list[OceanObs]:
    """Parse one NDBC .ocean realtime feed. Format (from blueprint):

        #YY  MM DD hh mm DEPTH OTMP COND  SAL  O2% O2PPM ...
        #yr  mo dy hr mn m     degC mS/cm psu  %   ppm   ...
        2026 06 22 16 30 10.0  29.5 MM    MM   MM  MM    ...
        2026 06 22 16 30 150.0 16.5 MM    MM   MM  MM    ...

    The first two lines start with `#` and carry column names + units.
    Data rows have one (timestamp, depth, temp) observation each;
    a single buoy emits multiple rows per timestamp, one per sensor
    depth. "MM" is the NDBC missing-value sentinel and gets dropped.

    Only readings within the [DEPTH_LOWER_M, DEPTH_UPPER_M] window
    are returned — that's the 150-m-ish band where Kelvin waves
    propagate. Other depths are silently ignored (the chart doesn't
    need them, and keeping the JSON small matters for static-asset
    delivery)."""
    out: list[OceanObs] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if not _DATA_ROW_RE.match(line):
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        try:
            yr, mo, dd, hh, mn = (int(p) for p in parts[:5])
            ts = datetime(yr, mo, dd, hh, mn, tzinfo=UTC)
        except ValueError:
            continue
        depth_raw, temp_raw = parts[5], parts[6]
        if depth_raw == _MISSING_TOKEN or temp_raw == _MISSING_TOKEN:
            continue
        try:
            depth = float(depth_raw)
            temp  = float(temp_raw)
        except ValueError:
            continue
        if not (DEPTH_LOWER_M <= depth <= DEPTH_UPPER_M):
            continue
        out.append(OceanObs(timestamp=ts, depth_m=depth, temp_c=round(temp, 2)))
    return out


# ── per-buoy analysis ──────────────────────────────────────────────────────


@dataclass
class BuoyAnalysis:
    site:               BuoySite
    obs_count:          int
    latest:             OceanObs | None
    recent_7d_mean_c:   float | None
    baseline_30d_mean_c: float | None
    delta_30d_c:        float | None
    kelvin_signal:      str


def _classify_kelvin(delta_c: float | None) -> str:
    if delta_c is None:
        return "no-data"
    if delta_c >= KELVIN_WARM_THRESHOLD:
        return "warm-kelvin-wave"
    if delta_c <= KELVIN_COLD_THRESHOLD:
        return "cold-kelvin-wave"
    return "neutral"


def analyse_buoy(site: BuoySite, obs: list[OceanObs]) -> BuoyAnalysis:
    """Compute the Kelvin-wave signal from raw observations.

    Signal = mean(last 7 days at 150-ish m) - mean(30-37 days ago,
    same depth band). This is a delta vs. own-recent-history, not
    an anomaly vs. climatology — sidesteps having to embed a per-
    buoy 30-year baseline AND is more sensitive to the FAST signal
    a Kelvin wave produces (warm slug arrives in days, not months).

    Returns analysis with None values gracefully when the buoy has
    insufficient history (sensor outage, recently re-commissioned,
    etc.). The frontend shows 'no-data' in that slot rather than
    skipping the buoy entirely — preserves the visual layout."""
    if not obs:
        return BuoyAnalysis(site, 0, None, None, None, None, "no-data")

    obs_sorted = sorted(obs, key=lambda o: o.timestamp, reverse=True)
    latest = obs_sorted[0]
    now = datetime.now(UTC)

    def _mean_in_window(start_days_ago: int, end_days_ago: int) -> float | None:
        cutoff_end   = now - timedelta(days=start_days_ago)
        cutoff_start = now - timedelta(days=end_days_ago)
        vals = [o.temp_c for o in obs if cutoff_start <= o.timestamp <= cutoff_end]
        return sum(vals) / len(vals) if vals else None

    recent_mean   = _mean_in_window(0,  7)
    baseline_mean = _mean_in_window(30, 37)

    delta = None
    if recent_mean is not None and baseline_mean is not None:
        delta = round(recent_mean - baseline_mean, 2)

    return BuoyAnalysis(
        site=                site,
        obs_count=           len(obs),
        latest=              latest,
        recent_7d_mean_c=    round(recent_mean,   2) if recent_mean   is not None else None,
        baseline_30d_mean_c= round(baseline_mean, 2) if baseline_mean is not None else None,
        delta_30d_c=         delta,
        kelvin_signal=       _classify_kelvin(delta),
    )


# ── orchestration ──────────────────────────────────────────────────────────


def _fmt_signed(v: float | None, fmt: str = "+.2f") -> str:
    if v is None:
        return "—"
    return f"{v:{fmt}}"


def _reading_text(an: BuoyAnalysis) -> str:
    """Trader-readable interpretation text for the headline-buoy card."""
    if an.latest is None:
        return "No recent buoy telemetry — sensor may be offline."
    if an.delta_30d_c is None:
        return (
            f"Latest T at ~{an.latest.depth_m:.0f} m: {an.latest.temp_c:.2f} °C. "
            f"Trend baseline still building (need ≥30 days of data)."
        )
    if an.kelvin_signal == "warm-kelvin-wave":
        return (
            f"30-day warming of +{an.delta_30d_c:.2f} °C at ~{an.latest.depth_m:.0f} m, "
            f"central Niño 3.4. Surface SST response expected in 4–6 weeks."
        )
    if an.kelvin_signal == "cold-kelvin-wave":
        return (
            f"30-day cooling of {an.delta_30d_c:.2f} °C at ~{an.latest.depth_m:.0f} m, "
            f"central Niño 3.4. Surface cooling expected in 4–6 weeks."
        )
    return (
        f"30-day change {_fmt_signed(an.delta_30d_c)} °C at ~{an.latest.depth_m:.0f} m — "
        f"below the ±1.0 °C threshold that historically anchors a Kelvin-wave classification."
    )


def build_payload(analyses: list[BuoyAnalysis]) -> dict:
    """Compose the JSON the frontend reads. Carries everything the
    card AND the risk map need:
      • per-buoy: lat/lon + latest reading + Kelvin signal (for map pins)
      • headline buoy: latest + reading text (for KPI strip)
      • by_longitude: column averages (for west→east strip)
    """
    by_id = {a.site.station_id: a for a in analyses}
    headline = by_id.get(HEADLINE_STATION_ID)

    # Group by longitude column and compute the mean recent-7d
    # temperature per column — gives the operator a quick read of the
    # warm-pool migration across the basin without staring at 7 cards.
    cols: dict[str, list[float]] = {}
    for a in analyses:
        if a.recent_7d_mean_c is not None:
            cols.setdefault(a.site.column, []).append(a.recent_7d_mean_c)
    by_longitude = {
        col: {
            "mean_temp_c": round(sum(vs) / len(vs), 2) if vs else None,
            "n_buoys":     len(vs),
        }
        for col, vs in cols.items()
    }
    # Fill in columns even when no buoy reported, for stable frontend layout.
    for site in NDBC_BUOYS:
        by_longitude.setdefault(site.column, {"mean_temp_c": None, "n_buoys": 0})

    return {
        "scraped_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "thermocline": {
            "source":      "NOAA NDBC realtime TAO/TRITON .ocean feeds (Niño 3.4 anchor buoys)",
            "source_base": NDBC_BASE,
            "depth_m":     TARGET_DEPTH_M,
            "depth_range_m": {"lower": DEPTH_LOWER_M, "upper": DEPTH_UPPER_M},
            "thresholds": {
                "warm_kelvin": KELVIN_WARM_THRESHOLD,
                "cold_kelvin": KELVIN_COLD_THRESHOLD,
            },
            "lead_weeks":  "4–6",
            "headline": (
                {
                    "station_id":    headline.site.station_id,
                    "label":         headline.site.label,
                    "lat":           headline.site.lat,
                    "lon":           headline.site.lon_negative,
                    "latest_temp_c": headline.latest.temp_c if headline.latest else None,
                    "latest_depth_m": headline.latest.depth_m if headline.latest else None,
                    "latest_ts":     headline.latest.timestamp.isoformat(timespec="seconds")
                                     if headline.latest else None,
                    "delta_30d_c":   headline.delta_30d_c,
                    "kelvin_signal": headline.kelvin_signal,
                    "reading":       _reading_text(headline),
                }
                if headline else None
            ),
            "buoys": [
                {
                    "station_id":    a.site.station_id,
                    "label":         a.site.label,
                    "lat":           a.site.lat,
                    "lon":           a.site.lon_negative,
                    "column":        a.site.column,
                    "obs_count":     a.obs_count,
                    "latest_temp_c": a.latest.temp_c if a.latest else None,
                    "latest_depth_m": a.latest.depth_m if a.latest else None,
                    "latest_ts":     a.latest.timestamp.isoformat(timespec="seconds")
                                     if a.latest else None,
                    "recent_7d_mean_c":    a.recent_7d_mean_c,
                    "baseline_30d_mean_c": a.baseline_30d_mean_c,
                    "delta_30d_c":   a.delta_30d_c,
                    "kelvin_signal": a.kelvin_signal,
                }
                for a in analyses
            ],
            "by_longitude": by_longitude,
        },
    }


def _persist(doc: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


def run(*, write: bool, diag: bool = False) -> int:
    """Fetch each buoy's .ocean file, analyse, persist. NDBC realtime
    files are independent per buoy — one buoy 404ing doesn't block
    the others. We tolerate partial coverage gracefully (the JSON
    still ships, the affected card shows 'no-data')."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger.info("[therm] mode=fetch via NDBC realtime2")

    analyses: list[BuoyAnalysis] = []
    for site in NDBC_BUOYS:
        url = f"{NDBC_BASE}/{site.station_id}.ocean"
        text = _fetch(url)
        if not text:
            logger.warning(f"[therm] {site.station_id} ({site.label}): no data")
            analyses.append(analyse_buoy(site, []))
            continue
        if diag:
            head = "\n".join(text.splitlines()[:8])
            logger.info(f"[therm] --diag {site.station_id} head:\n{head}")
        obs = parse_ocean_file(text)
        an = analyse_buoy(site, obs)
        analyses.append(an)
        logger.info(
            f"[therm] {site.station_id} ({site.label}): "
            f"{an.obs_count} obs in depth window, "
            f"latest {an.latest.temp_c:.2f}°C @ {an.latest.depth_m:.0f}m "
            if an.latest else
            f"[therm] {site.station_id} ({site.label}): no 150m-ish observations"
        )
        if an.delta_30d_c is not None:
            logger.info(
                f"[therm]   Δ30d={_fmt_signed(an.delta_30d_c)}°C → {an.kelvin_signal}"
            )

    n_with_data = sum(1 for a in analyses if a.latest is not None)
    if n_with_data == 0:
        logger.error("[therm] FATAL: 0 buoys returned usable data")
        return 1

    doc = build_payload(analyses)
    headline = doc["thermocline"]["headline"]
    if headline:
        logger.info(
            f"[therm] headline 0°N 155°W (51023): "
            f"T={_fmt_signed(headline['latest_temp_c'])}°C, "
            f"Δ30d={_fmt_signed(headline['delta_30d_c'])}°C, "
            f"signal={headline['kelvin_signal']}"
        )

    if write:
        _persist(doc)
        logger.info(f"[therm] wrote {OUT_PATH} ({n_with_data}/{len(NDBC_BUOYS)} buoys reporting)")
    else:
        logger.info("[therm] preview only — pass --write to persist")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="Persist parsed JSON")
    ap.add_argument("--diag",  action="store_true",
                    help="Log the head of each fetched .ocean file so the operator "
                         "can confirm NDBC's format from the workflow log.")
    args = ap.parse_args()
    return run(write=args.write, diag=args.diag)


if __name__ == "__main__":
    sys.exit(main())
