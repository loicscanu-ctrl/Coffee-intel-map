"""enso_thermocline.py — TAO/TRITON subsurface T at ~150 m via the
NOAA ERDDAP proxy (Cloudflare Worker).

Phase 3 v5 — pivots back to ERDDAP after the NDBC dead-end (v3/v4
confirmed NDBC's /data/realtime2/ doesn't carry TAO equatorial
buoys at all). NOAA's CoastWatch PFEG + OSMC ERDDAP servers DO
serve TAO, but they blacklist GHA egress IPs. The workaround is
the `cf-worker/erddap-proxy.js` Cloudflare Worker — Workers'
egress IPs aren't on the blacklist, so the fetch waves through.

Architecture
------------
  GHA runner → ERDDAP_PROXY_BASE (CF Worker, with x-proxy-secret) →
               UPSTREAM_BASE (PFEG or OSMC ERDDAP tabledap) → table CSV/JSON

The worker is just a path forwarder + auth + browser-UA spoof.
The Python here builds standard ERDDAP `tabledap` queries; the
worker swaps the host. Output JSON shape is unchanged from v3/v4
so the frontend card + risk-map pin layer don't need updating.

ENV VARS
--------
  ERDDAP_PROXY_BASE    — required, e.g. "https://noaa-proxy.acct.workers.dev"
  ERDDAP_PROXY_SECRET  — required, matches PROXY_SECRET on the Worker

Missing either: the fetcher exits cleanly with status code 2 and
a clear log line. The frontend card degrades silently (same
fallback as v3/v4) — operator sees the issue in the workflow
log, not as Telegram spam on every cron tick.

Usage
-----
    cd backend
    export ERDDAP_PROXY_BASE=...
    export ERDDAP_PROXY_SECRET=...
    python -m scraper.sources.enso_thermocline              # preview
    python -m scraper.sources.enso_thermocline --write      # parse + write
    python -m scraper.sources.enso_thermocline --diag       # log the raw response
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import requests

from scraper.validate_export import safe_write_json

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "frontend" / "public" / "data"
OUT_PATH = DATA_DIR / "enso_thermocline.json"

# Date-keyed per-buoy temperature archive — the source of truth, same
# pattern as data/contract_prices_archive.json for OI. Lives in data/
# (NOT shipped to the frontend); the public snapshot above is DERIVED
# from it each run. Daily runs append a small recent window into this
# file instead of re-pulling deep history every time; the one-time
# backfill_enso_thermocline.py seeds the deep record.
#   shape: {"_meta": {...}, "buoys": {station_id: {"YYYY-MM-DD": temp_c}}}
ARCHIVE_PATH = ROOT / "data" / "enso_thermocline_archive.json"


# ── target buoy catalog (Niño 3.4 anchor sites) ─────────────────────────────


@dataclass(frozen=True)
class BuoySite:
    station_id:   str          # informational only — ERDDAP filters by lat/lon
    lat:          float        # degrees north (negative = south)
    lon_negative: float        # degrees east, -180..+180 (Leaflet convention)
    label:        str
    column:       str          # "170W" | "155W" | "140W"

    @property
    def longitude_e(self) -> float:
        """0..360 east convention (matches ERDDAP's longitude axis)."""
        return (self.lon_negative + 360) % 360


# Same 7 anchor sites as v4 — Kelvin-wave-detection geometry is geographic,
# not source-specific. The string IDs are kept for display continuity with
# the v4 card layout; ERDDAP queries filter on lat/lon directly.
# Anchor sites span the operational TAO/TRITON array across the
# equatorial Pacific. 3 latitudes (2°N / 0°N / 2°S — the inner Niño 3.4
# core) × 8 longitudes (165°E warm pool → 95°W cold tongue). Listed
# west-to-east by longitude so the card's natural iteration order
# already reads like a map (Asia on the left, Americas on the right).
# Not every (lat, lon) cell has an active mooring; the missing ones
# render as placeholders in the UI and just produce no-data backend-side.
# (156°E was tried but PFEG returns nothing — TRITON's westernmost
# moorings have been decommissioned, so the column was dropped to
# avoid an empty card column.)
NDBC_BUOYS: tuple[BuoySite, ...] = (
    # 165°E — TRITON, western Pacific
    BuoySite("2n165e",   2.0,  165.0, "2°N 165°E",  "165E"),
    BuoySite("0n165e",   0.0,  165.0, "0°N 165°E",  "165E"),
    BuoySite("2s165e",  -2.0,  165.0, "2°S 165°E",  "165E"),
    # 180° (dateline) — TAO
    BuoySite("2n180",    2.0,  180.0, "2°N 180°",   "180"),
    BuoySite("0n180",    0.0,  180.0, "0°N 180°",   "180"),
    BuoySite("2s180",   -2.0,  180.0, "2°S 180°",   "180"),
    # 170°W — TAO
    BuoySite("2n170w",   2.0, -170.0, "2°N 170°W",  "170W"),
    BuoySite("0n170w",   0.0, -170.0, "0°N 170°W",  "170W"),
    BuoySite("2s170w",  -2.0, -170.0, "2°S 170°W",  "170W"),
    # 155°W — TAO, Niño 3.4 centre
    BuoySite("2n155w",   2.0, -155.0, "2°N 155°W",  "155W"),
    BuoySite("0n155w",   0.0, -155.0, "0°N 155°W",  "155W"),
    BuoySite("2s155w",  -2.0, -155.0, "2°S 155°W",  "155W"),
    # 140°W — TAO
    BuoySite("2n140w",   2.0, -140.0, "2°N 140°W",  "140W"),
    BuoySite("0n140w",   0.0, -140.0, "0°N 140°W",  "140W"),
    BuoySite("2s140w",  -2.0, -140.0, "2°S 140°W",  "140W"),
    # 125°W — TAO
    BuoySite("2n125w",   2.0, -125.0, "2°N 125°W",  "125W"),
    BuoySite("0n125w",   0.0, -125.0, "0°N 125°W",  "125W"),
    BuoySite("2s125w",  -2.0, -125.0, "2°S 125°W",  "125W"),
    # 110°W — TAO, Niño 1+2 fringe
    BuoySite("2n110w",   2.0, -110.0, "2°N 110°W",  "110W"),
    BuoySite("0n110w",   0.0, -110.0, "0°N 110°W",  "110W"),
    BuoySite("2s110w",  -2.0, -110.0, "2°S 110°W",  "110W"),
    # 95°W — TAO, cold-tongue terminus
    BuoySite("2n95w",    2.0,  -95.0, "2°N 95°W",   "95W"),
    BuoySite("0n95w",    0.0,  -95.0, "0°N 95°W",   "95W"),
    BuoySite("2s95w",   -2.0,  -95.0, "2°S 95°W",   "95W"),
)
HEADLINE_STATION_ID = "0n155w"

# Longitude columns in west→east order (low east-degrees to high).
# Derived from NDBC_BUOYS so adding/removing sites doesn't break the
# UI ordering. Frontend consumes this list directly so it doesn't have
# to re-derive geographic order from string labels.
COLUMN_ORDER_W_TO_E: tuple[str, ...] = tuple(
    sorted(
        {s.column for s in NDBC_BUOYS},
        key=lambda c: min(s.longitude_e for s in NDBC_BUOYS if s.column == c),
    )
)


# ── query parameters ────────────────────────────────────────────────────────


# Sensor depth window — TAO buoys sample at canonical depths
# (1, 10, 20, 40, 60, 80, 100, 120, 140, 180, 300, 500 m). Tighten
# the band to ±10 m around the 150 m Kelvin-wave depth: with 27
# anchor sites across 9 longitude columns, accepting the full
# [130, 200] depth band was returning ~1.2 MB of mostly-null rows
# and routinely hitting CF Worker's 30 s wall. ±10 m captures the
# single 140 m or 150 m sample without the rest of the column.
TARGET_DEPTH_M = 150
DEPTH_LOWER_M  = 140
DEPTH_UPPER_M  = 160

# Lat window — ±3° covers the inner-core anchor sites (±2° lat)
# with a small buffer for buoy position drift.
LAT_LOWER = -3.0
LAT_UPPER =  3.0

# Lon window — spans the operational TAO/TRITON array we ship pins for:
# 165°E (western Pacific) eastward through 95°W (cold-tongue terminus).
# Both bounds in degrees-east (0-360 ERDDAP convention).
LON_LOWER_E = 160.0     # buffer below 165°E
LON_UPPER_E = 270.0     # buffer above 95°W (=265°E)

# Time window. Must cover:
#   * Recent 7d-mean window (anchored on latest obs):    7 days
#   * Offset to the 30-37d-ago baseline window:         30 days
#   * Upstream latency (TAO daily lags ~3 weeks):       21 days
#   * Buffer for sparse/jagged reporting:               ~7 days
# 75 days hits all four. Was 90 originally but 200KB responses
# hit CF Worker's 30s wall under slow PFEG load. Was tried at 50
# but that put the baseline window before the fetch start_date
# → Δ30d=None across the board.
#
# ARCHIVE MODEL (current): we no longer re-pull this whole window for
# its own sake each run. RECENT_FETCH_DAYS is the small incremental
# window the daily run pulls and merges into the archive;
# SNAPSHOT_WINDOW_DAYS is the slice of the (deep) archive we read back
# to derive the card snapshot. The Δ-30d math needs ~37 days spanning
# back from the latest obs, and TAO daily data lags ~3 weeks, so the
# snapshot window stays at 75; the daily fetch only has to overlap the
# archive frontier and catch new arrivals, so it can be much smaller.
HISTORY_DAYS = 75
SNAPSHOT_WINDOW_DAYS = 75

# Daily incremental fetch — FRONTIER-ANCHORED, not a fixed lookback.
# The start date is set just behind the archive's newest date, so a
# steady-state run transfers only the small revision-overlap window
# instead of a flat block every day.
#
# Why we can't just "fetch yesterday": TAO daily data is published
# ~3 weeks late (so the newest available reading is already ~21 days
# old), AND PMEL revises provisional values for a couple weeks after
# first publishing them. So each run re-pulls a short overlap of the
# frontier to catch those corrections, plus whatever genuinely-new day
# has appeared. After a run of missed crons the window auto-extends to
# cover the gap (frontier is older → start reaches further back).
REVISION_OVERLAP_DAYS = 10    # re-pull the last N archived days for PMEL corrections
LAG_FLOOR_DAYS        = 30    # always reach back past the ~21-day publish lag
MAX_INCREMENTAL_DAYS  = 120   # cap; a gap this large → re-run the backfill instead
SEED_DAYS             = 75    # empty archive (no backfill yet) → seed a full snapshot window

# Archive retention — 15 years of daily values per buoy. Enough for a
# real multi-decadal climatology range and a long thermocline-over-time
# chart, bounded so the committed file can't grow without limit.
ARCHIVE_RETENTION_DAYS = 15 * 366

# Staleness tolerance for fetch failures. PFEG (the upstream ERDDAP)
# is intermittently down for hours at a time — 522 (CF↔origin timeout)
# or 525 (origin SSL handshake failed). Because TAO daily data already
# lags ~3 weeks, a single missed daily fetch loses NOTHING: the
# committed JSON is still just as current as it would be on a good day.
# So when a fetch fails but the on-disk JSON is younger than this, we
# treat it as an acceptable no-op (exit 3 → workflow stays green, no
# Telegram). Only when we've gone this many days WITHOUT a successful
# refresh does it escalate to a real failure (exit 1 → Telegram),
# which signals the pipeline is genuinely broken, not just having a
# bad morning.
STALE_AFTER_DAYS = 7

# Kelvin-wave thresholds, °C — unchanged from v3/v4. Δ-30d = mean of
# last 7 days minus mean of 30-37 days ago at the same site/depth band.
KELVIN_WARM_THRESHOLD = 1.0
KELVIN_COLD_THRESHOLD = -1.0

# ERDDAP dataset candidates. NOAA's TAO data has lived under multiple
# IDs across server migrations. The proxy lets us discover which one
# the current upstream serves — we walk this list and use the first
# 200 response. If all 404, the operator runs `/info/index.csv?searchFor=tao`
# against the proxy directly to discover what the upstream actually
# carries (then adds the right ID to this list).
DATASET_CANDIDATES = (
    "pmelTaoDyT",          # PMEL daily subsurface T — preferred: gives
                           # enough timestamps for the Δ-30d rolling
                           # 7-day-mean Kelvin-wave detection.
    "pmelTaoMonT",         # Monthly fallback: card still renders the
                           # latest 150m temps but Kelvin signal is
                           # 'no-data' (only ~4 obs/site in lookback).
    "pmelTaoMonsT",        # PMEL monthly variant.
    "pmelTaoMonTao",       # Older alias.
    "pmelTaoSites",        # Site-level aggregator.
)

# ERDDAP temperature column candidates — datasets across versions
# call the field different things. Picker walks until one matches.
_TEMP_COLUMN_CANDIDATES = ("T_25", "T_20", "T", "temperature", "WTMP", "T_TEMP")


# ── data model ──────────────────────────────────────────────────────────────


@dataclass
class OceanObs:
    timestamp: datetime
    lat:       float
    lon_e:     float        # 0..360 east
    depth_m:   float
    temp_c:    float


# ── HTTP fetching ───────────────────────────────────────────────────────────


def _proxy_env() -> tuple[str | None, str | None]:
    """Reads the two env vars the workflow passes through. Returning
    None for either means the proxy isn't configured — caller exits
    cleanly with a guidance message rather than silently 401'ing."""
    base = os.environ.get("ERDDAP_PROXY_BASE", "").strip()
    secret = os.environ.get("ERDDAP_PROXY_SECRET", "").strip()
    return (base or None, secret or None)


def _fetch_via_proxy(
    proxy_base: str, secret: str, path_and_query: str, *, timeout: int = 60,
) -> tuple[str | None, int]:
    """GET <proxy_base>/<path_and_query> with the shared-secret header.
    Returns (text, status_code). text is None on transport error.
    Status code surfaces so the caller can distinguish 401 (secret
    mismatch — operator action), 404 (dataset name wrong — try next
    candidate), 5xx (upstream issue — retry once, then next candidate).

    Retries ONCE on 5xx (most often CF Worker's 522 = PFEG took
    longer than the 30s wall to respond). PFEG is intermittently
    slow; the same dataset that 522'd at T often serves in <3s at
    T+10s. Single retry catches the transient case without blowing
    the workflow's 10-min total budget."""
    url = f"{proxy_base.rstrip('/')}/{path_and_query.lstrip('/')}"
    headers = {
        "x-proxy-secret": secret,
        "Accept": "application/json, text/csv, */*",
        "User-Agent": "coffee-intel-map/enso-thermocline (proxy client)",
    }
    for attempt in (1, 2):
        try:
            resp = requests.get(url, headers=headers, timeout=timeout)
        except requests.RequestException as e:
            logger.warning(f"[therm] GET {url} → request error: {e}")
            return None, 0
        if resp.status_code < 500 or attempt == 2:
            return resp.text, resp.status_code
        logger.info(
            f"[therm] {resp.status_code} on attempt 1 — sleeping 10s and retrying"
        )
        time.sleep(10)
    return resp.text, resp.status_code


def _build_tabledap_query(
    dataset_id: str, start_date: str, end_date: str | None = None,
) -> str:
    """ERDDAP tabledap query as a path+query string, ready to drop
    onto the proxy base. We don't pin the temperature column in the
    SELECT — let ERDDAP return its full schema so the parser can
    locate the temp field by name. JSON output for cleaner parsing
    than CSV's units row.

    Leading '&' on the constraint string is REQUIRED by ERDDAP when
    there's no SELECT clause: it tells the parser "constraints start
    here, the column-list was empty (i.e. return all)." Without it
    ERDDAP returns HTTP 400 'All constraints must be preceded by &'.

    end_date (optional) adds an upper time bound so the deep backfill
    can fetch one bounded year-chunk at a time instead of "everything
    since start" — keeping each response small enough for the CF
    Worker's 30 s wall.
    """
    constraints = (
        f"&latitude>={LAT_LOWER}&latitude<={LAT_UPPER}"
        f"&longitude>={LON_LOWER_E}&longitude<={LON_UPPER_E}"
        f"&depth>={DEPTH_LOWER_M}&depth<={DEPTH_UPPER_M}"
        f"&time>={start_date}"
    )
    if end_date:
        constraints += f"&time<={end_date}"
    return f"{dataset_id}.json?{constraints}"


# ── parsing ─────────────────────────────────────────────────────────────────


def _pick_col_idx(column_names: list[str], candidates: tuple[str, ...]) -> int | None:
    lower = [c.strip().lower() for c in column_names]
    for c in candidates:
        if c.lower() in lower:
            return lower.index(c.lower())
    return None


def parse_erddap_json(text: str) -> list[OceanObs]:
    """Parse ERDDAP tabledap JSON response. Shape:
        {"table": {
            "columnNames": ["time", "latitude", "longitude", "depth", "T_25"],
            "columnTypes": [...],
            "rows": [
                ["2026-06-22T12:00:00Z", 0.0, 205.0, 150.0, 17.5],
                ...
            ]
        }}
    Returns [] if the response isn't ERDDAP JSON (caller treats that
    as a fetch failure)."""
    try:
        doc = json.loads(text)
        table = doc["table"]
        names: list[str] = table["columnNames"]
        rows:  list[list] = table["rows"]
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.warning(f"[therm] ERDDAP JSON parse failed: {e}")
        return []

    i_time  = _pick_col_idx(names, ("time",))
    i_lat   = _pick_col_idx(names, ("latitude",))
    i_lon   = _pick_col_idx(names, ("longitude",))
    i_depth = _pick_col_idx(names, ("depth",))
    i_t     = _pick_col_idx(names, _TEMP_COLUMN_CANDIDATES)
    if None in (i_time, i_lat, i_lon, i_depth, i_t):
        logger.warning(
            f"[therm] ERDDAP schema missing a required column "
            f"(columns={names}, time={i_time}, lat={i_lat}, "
            f"lon={i_lon}, depth={i_depth}, t={i_t})"
        )
        return []

    out: list[OceanObs] = []
    for row in rows:
        if len(row) <= max(i_time, i_lat, i_lon, i_depth, i_t):
            continue
        try:
            t_iso = str(row[i_time])
            ts = datetime.fromisoformat(t_iso.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=UTC)
            else:
                ts = ts.astimezone(UTC)
            lat   = float(row[i_lat])
            lon_e = float(row[i_lon])
            depth = float(row[i_depth])
            temp  = float(row[i_t])
        except (ValueError, TypeError):
            continue
        if not (DEPTH_LOWER_M <= depth <= DEPTH_UPPER_M):
            continue
        out.append(OceanObs(
            timestamp=ts, lat=lat, lon_e=lon_e,
            depth_m=depth, temp_c=round(temp, 2),
        ))
    return out


# ── per-buoy analysis ──────────────────────────────────────────────────────


def _nearest_site(lat: float, lon_e: float) -> BuoySite | None:
    """Snap a raw observation to the closest of our 7 anchor sites.
    ±2° tolerance per axis — covers position drift while keeping
    each site's bucket cleanly separated (anchors are ≥15° apart
    in longitude, ≥2° in latitude)."""
    best, best_dist = None, 999.0
    for site in NDBC_BUOYS:
        d_lat = abs(lat - site.lat)
        d_lon = abs(lon_e - site.longitude_e)
        if d_lat <= 1.5 and d_lon <= 2.5:
            dist = d_lat + d_lon
            if dist < best_dist:
                best, best_dist = site, dist
    return best


@dataclass
class BuoyAnalysis:
    site:                 BuoySite
    obs_count:            int
    latest:               OceanObs | None
    recent_7d_mean_c:     float | None
    baseline_30d_mean_c:  float | None
    delta_30d_c:          float | None
    kelvin_signal:        str
    # Min/max temperature observed at this buoy across the fetched
    # window (HISTORY_DAYS = 75 days at present). Lets the card show
    # where today's reading sits inside the recent envelope — a tiny
    # range bar with a marker at `latest.temp_c`. Not a multi-year
    # climatology (that's the natural next piece); just "warmest and
    # coldest we've seen since the lookback started".
    window_min_c:         float | None
    window_max_c:         float | None
    # Trajectory anchors for the velocity ticks on the card's range bar:
    # the buoy's temperature ~1 month and ~3 months before its latest
    # reading. The spacing between these and `latest` shows how fast (and
    # which way) the 150 m temperature is moving. None when the archive
    # doesn't reach back that far. Only populated on the archive-derived
    # path (the deep history is required to look back 90 days).
    temp_30d_ago_c:       float | None = None
    temp_90d_ago_c:       float | None = None


def _classify_kelvin(delta_c: float | None) -> str:
    if delta_c is None:
        return "no-data"
    if delta_c >= KELVIN_WARM_THRESHOLD:
        return "warm-kelvin-wave"
    if delta_c <= KELVIN_COLD_THRESHOLD:
        return "cold-kelvin-wave"
    return "neutral"


def analyse_buoy(
    site: BuoySite,
    obs: list[OceanObs],
    *,
    climo_min_c: float | None = None,
    climo_max_c: float | None = None,
) -> BuoyAnalysis:
    """Δ-30d signal = mean(last 7 days of available data at this
    site/depth band) − mean(30-37 days before that). |Δ| ≥ 1.0 °C
    qualifies as a downwelling (warm) or upwelling (cold) Kelvin
    event. Climatology-free; works on whatever the array reports.

    Anchor on the latest observation rather than 'now' so the signal
    survives whatever upstream latency the buoy is currently running.
    TAO daily data routinely lags 2-3 weeks; anchoring to wall-clock
    'now' would leave the recent-7d window empty and force every
    site to no-data even when there's plenty of usable data.

    window_min_c / window_max_c default to the min/max of the obs
    passed in. When climo_min_c / climo_max_c are supplied (the
    archive-derived path passes the buoy's FULL-history extremes),
    those win — so the card's range bar reads as "where today sits in
    the buoy's whole historical envelope", not just the recent slice.
    """
    if not obs:
        return BuoyAnalysis(
            site, 0, None, None, None, None, "no-data", climo_min_c, climo_max_c,
        )
    obs_sorted = sorted(obs, key=lambda o: o.timestamp, reverse=True)
    latest = obs_sorted[0]
    anchor = latest.timestamp

    def _mean_in_window(start_days_ago: int, end_days_ago: int) -> float | None:
        cutoff_end   = anchor - timedelta(days=start_days_ago)
        cutoff_start = anchor - timedelta(days=end_days_ago)
        vals = [o.temp_c for o in obs if cutoff_start <= o.timestamp <= cutoff_end]
        return sum(vals) / len(vals) if vals else None

    recent_mean   = _mean_in_window(0,  7)
    baseline_mean = _mean_in_window(30, 37)
    delta = None
    if recent_mean is not None and baseline_mean is not None:
        delta = round(recent_mean - baseline_mean, 2)

    temps = [o.temp_c for o in obs]
    win_min = climo_min_c if climo_min_c is not None else round(min(temps), 2)
    win_max = climo_max_c if climo_max_c is not None else round(max(temps), 2)

    return BuoyAnalysis(
        site=                site,
        obs_count=           len(obs),
        latest=              latest,
        recent_7d_mean_c=    round(recent_mean,   2) if recent_mean   is not None else None,
        baseline_30d_mean_c= round(baseline_mean, 2) if baseline_mean is not None else None,
        delta_30d_c=         delta,
        kelvin_signal=       _classify_kelvin(delta),
        window_min_c=        win_min,
        window_max_c=        win_max,
    )


# ── orchestration ──────────────────────────────────────────────────────────


def _fmt_signed(v: float | None, fmt: str = "+.2f") -> str:
    if v is None:
        return "—"
    return f"{v:{fmt}}"


def _reading_text(an: BuoyAnalysis) -> str:
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


def build_payload(
    analyses: list[BuoyAnalysis],
    dataset_id: str | None,
) -> dict:
    """JSON shape unchanged from v3/v4 — frontend card and risk-map
    pin layer already consume it. Adds `dataset_id` so the operator
    sees which ERDDAP table the data came from."""
    by_id = {a.site.station_id: a for a in analyses}
    headline = by_id.get(HEADLINE_STATION_ID)

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
    for site in NDBC_BUOYS:
        by_longitude.setdefault(site.column, {"mean_temp_c": None, "n_buoys": 0})

    return {
        "scraped_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "thermocline": {
            "source":        "NOAA ERDDAP TAO/TRITON via Cloudflare Worker proxy",
            "dataset_id":    dataset_id,
            "depth_m":       TARGET_DEPTH_M,
            "depth_range_m": {"lower": DEPTH_LOWER_M, "upper": DEPTH_UPPER_M},
            "thresholds": {
                "warm_kelvin": KELVIN_WARM_THRESHOLD,
                "cold_kelvin": KELVIN_COLD_THRESHOLD,
            },
            "lead_weeks": "4–6",
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
                    "window_min_c":  a.window_min_c,
                    "window_max_c":  a.window_max_c,
                    "temp_30d_ago_c": a.temp_30d_ago_c,
                    "temp_90d_ago_c": a.temp_90d_ago_c,
                }
                for a in analyses
            ],
            "by_longitude": by_longitude,
            # West-to-east longitude column order. Frontend uses this
            # to lay out the mini-map (Asia-side columns on the left,
            # Americas-side on the right) without re-deriving order
            # from string labels.
            "longitude_order": list(COLUMN_ORDER_W_TO_E),
            # Latitude rows for the grid, north-to-south. Static set;
            # included so the frontend can render placeholders for
            # cells where no mooring exists at (lat, lon).
            "latitude_order": [
                {"key": "2N", "label": "2°N", "lat":  2.0},
                {"key": "0N", "label": "0°N", "lat":  0.0},
                {"key": "2S", "label": "2°S", "lat": -2.0},
            ],
        },
    }


def _persist(doc: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe_write_json(OUT_PATH, doc, trailing_newline=True)


# ── archive (date-keyed per-buoy temperature history) ───────────────────────


def _empty_archive() -> dict:
    return {
        "_meta": {
            "description": (
                "Authoritative date-keyed per-buoy 150 m-band temperature "
                "history for the TAO/TRITON Niño-3.4 array. Each buoy → "
                "{YYYY-MM-DD: temp_c}. Daily runs append a recent window; "
                "the public enso_thermocline.json snapshot is derived from "
                "this. Seeded by backfill_enso_thermocline.py."
            ),
            "started": datetime.now(UTC).strftime("%Y-%m-%d"),
            "target_depth_m": TARGET_DEPTH_M,
            "depth_band_m": [DEPTH_LOWER_M, DEPTH_UPPER_M],
        },
        "buoys": {},
    }


def _load_archive() -> dict:
    """Load the per-buoy temperature archive, or an empty skeleton if it
    doesn't exist yet (first run before any backfill)."""
    if ARCHIVE_PATH.exists():
        try:
            doc = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8"))
            doc.setdefault("buoys", {})
            return doc
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"[therm] archive unreadable ({e}); starting fresh")
    return _empty_archive()


def _save_archive(archive: dict) -> None:
    ARCHIVE_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Compact — this file grows to a few MB over 15y; no need for indent.
    ARCHIVE_PATH.write_text(
        json.dumps(archive, separators=(",", ":")), encoding="utf-8",
    )


def _obs_to_daily_means(raw_obs: list[OceanObs]) -> dict[str, dict[str, float]]:
    """Collapse raw per-depth observations into one 150 m-band value per
    (buoy, calendar-day): {station_id: {YYYY-MM-DD: mean_temp_c}}. Obs
    that don't snap to an anchor site are dropped."""
    buckets: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for o in raw_obs:
        site = _nearest_site(o.lat, o.lon_e)
        if site is None:
            continue
        day = o.timestamp.strftime("%Y-%m-%d")
        buckets[site.station_id][day].append(o.temp_c)
    return {
        sid: {day: round(sum(v) / len(v), 2) for day, v in days.items()}
        for sid, days in buckets.items()
    }


def _merge_into_archive(archive: dict, daily: dict[str, dict[str, float]]) -> int:
    """Merge freshly-fetched daily means into the archive (latest fetch
    wins on overlap — values are corrected/finalised over time by PMEL).
    Returns the count of (buoy, day) cells written."""
    buoys = archive.setdefault("buoys", {})
    n = 0
    for sid, days in daily.items():
        target = buoys.setdefault(sid, {})
        for day, temp in days.items():
            target[day] = temp
            n += 1
    return n


def _trim_archive(archive: dict) -> int:
    """Drop per-buoy dates older than the retention window. Returns the
    number of cells dropped."""
    cutoff = (datetime.now(UTC) - timedelta(days=ARCHIVE_RETENTION_DAYS)).strftime("%Y-%m-%d")
    dropped = 0
    for days in archive.get("buoys", {}).values():
        stale = [d for d in days if d < cutoff]
        for d in stale:
            del days[d]
            dropped += 1
    return dropped


def _series_to_obs(site: BuoySite, series: dict[str, float]) -> list[OceanObs]:
    """Reconstruct synthetic daily OceanObs from an archive series so the
    existing analyse_buoy() (which works on OceanObs) can derive the
    snapshot unchanged. Each archived day → one obs stamped at noon UTC
    and the nominal target depth."""
    out: list[OceanObs] = []
    for day, temp in series.items():
        try:
            ts = datetime.fromisoformat(f"{day}T12:00:00+00:00")
        except ValueError:
            continue
        out.append(OceanObs(
            timestamp=ts, lat=site.lat, lon_e=site.longitude_e,
            depth_m=float(TARGET_DEPTH_M), temp_c=temp,
        ))
    return out


def _lookback_temp(
    series: dict[str, float], anchor_date: str, days_back: int, tol_days: int = 4,
) -> float | None:
    """Mean temperature ~days_back before anchor_date, averaged over a
    ±tol_days window so a single missing day doesn't blank it. None if
    the archive carries nothing near that point. Used for the range
    bar's "where was it 1 / 3 months ago" velocity ticks."""
    anchor = datetime.fromisoformat(f"{anchor_date}T00:00:00+00:00")
    target = anchor - timedelta(days=days_back)
    lo = (target - timedelta(days=tol_days)).strftime("%Y-%m-%d")
    hi = (target + timedelta(days=tol_days)).strftime("%Y-%m-%d")
    vals = [t for d, t in series.items() if lo <= d <= hi]
    return round(sum(vals) / len(vals), 2) if vals else None


def _analyse_from_archive(archive: dict) -> list[BuoyAnalysis]:
    """Derive each buoy's analysis from the archive: Δ-30d / 7-day means
    from the most recent SNAPSHOT_WINDOW_DAYS of data, range bar from the
    buoy's FULL historical envelope (climatology min/max), and the
    1-/3-month-ago trajectory anchors for the velocity ticks."""
    buoys = archive.get("buoys", {})
    analyses: list[BuoyAnalysis] = []
    for site in NDBC_BUOYS:
        series = buoys.get(site.station_id, {})
        if not series:
            analyses.append(analyse_buoy(site, []))
            continue
        all_temps = list(series.values())
        climo_min = round(min(all_temps), 2)
        climo_max = round(max(all_temps), 2)
        # Snapshot window: the last N days up to the buoy's newest date.
        newest = max(series)
        cutoff = (
            datetime.fromisoformat(f"{newest}T00:00:00+00:00")
            - timedelta(days=SNAPSHOT_WINDOW_DAYS)
        ).strftime("%Y-%m-%d")
        recent = {d: t for d, t in series.items() if d >= cutoff}
        an = analyse_buoy(
            site, _series_to_obs(site, recent),
            climo_min_c=climo_min, climo_max_c=climo_max,
        )
        # Trajectory anchors look 30 / 90 days back from the latest
        # reading across the FULL series (90d is outside the snapshot
        # window, so it must come from the archive, not `recent`).
        an.temp_30d_ago_c = _lookback_temp(series, newest, 30)
        an.temp_90d_ago_c = _lookback_temp(series, newest, 90)
        analyses.append(an)
    return analyses


def _existing_data_age_days() -> float | None:
    """Age in days of the committed enso_thermocline.json, derived from
    its `scraped_at` field. None if the file is missing or unreadable
    (treat that as 'infinitely stale' — a missing file IS a real
    failure worth alerting on). Used to decide whether a fetch failure
    is a tolerable no-op (data still fresh) or a genuine outage."""
    if not OUT_PATH.exists():
        return None
    try:
        doc = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        scraped_at = doc["scraped_at"]
        ts = datetime.fromisoformat(scraped_at)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
    except (json.JSONDecodeError, KeyError, ValueError, OSError) as e:
        logger.warning(f"[therm] couldn't read existing JSON age: {e}")
        return None
    return (datetime.now(UTC) - ts).total_seconds() / 86400.0


def _fetch_failure_exit_code(reason: str) -> int:
    """Map a fetch/parse failure to an exit code, softening it to a
    no-op (3) when the committed JSON is still fresh enough that we've
    lost nothing. Escalates to a real failure (1) only when the data
    on disk is missing or older than STALE_AFTER_DAYS."""
    age = _existing_data_age_days()
    if age is not None and age <= STALE_AFTER_DAYS:
        logger.warning(
            f"[therm] {reason} — but committed JSON is only {age:.1f}d old "
            f"(≤ {STALE_AFTER_DAYS}d tolerance). Treating as a no-op: TAO "
            f"daily data lags ~3 weeks, so nothing is lost. Exit 3 (no alert)."
        )
        return 3
    age_str = f"{age:.1f}d" if age is not None else "missing"
    logger.error(
        f"[therm] {reason} — and committed JSON is {age_str} "
        f"(> {STALE_AFTER_DAYS}d tolerance). Escalating to real failure. Exit 1."
    )
    return 1


def _archive_frontier(archive: dict) -> str | None:
    """Newest YYYY-MM-DD present across all buoys, or None if empty."""
    days = [d for series in archive.get("buoys", {}).values() for d in series]
    return max(days) if days else None


def _incremental_start_date(archive: dict, *, today: datetime | None = None) -> str:
    """Frontier-anchored start date for the daily incremental fetch.

    Steady state: start = frontier − REVISION_OVERLAP_DAYS, so we only
    re-pull the short overlap PMEL might still be revising plus whatever
    new day appeared — not a fixed block. We also never look back less
    than LAG_FLOOR_DAYS (so we reliably clear the ~21-day publish lag and
    actually reach upstream's newest data), and never more than
    MAX_INCREMENTAL_DAYS (a gap that large means the archive is far
    behind — re-run the backfill rather than hammer the proxy). An empty
    archive (no backfill yet) seeds a full snapshot window.
    """
    now = today or datetime.now(UTC)
    frontier = _archive_frontier(archive)
    if frontier is None:
        return (now - timedelta(days=SEED_DAYS)).strftime("%Y-%m-%d")
    frontier_dt = datetime.fromisoformat(f"{frontier}T00:00:00+00:00")
    # How far back must the start reach to sit REVISION_OVERLAP_DAYS
    # behind the frontier? Floor at LAG_FLOOR, cap at MAX_INCREMENTAL.
    days_behind = (now - frontier_dt).days + REVISION_OVERLAP_DAYS
    lookback = max(LAG_FLOOR_DAYS, min(days_behind, MAX_INCREMENTAL_DAYS))
    return (now - timedelta(days=lookback)).strftime("%Y-%m-%d")


def run(*, write: bool, diag: bool = False) -> int:
    """Fetch via the proxy, parse, persist. Exit codes:
        0 — success (data written or previewed cleanly)
        1 — fetch/parse failure AND committed JSON is stale/missing
            (genuine outage — workflow should alert)
        2 — proxy not configured (ERDDAP_PROXY_BASE / ERDDAP_PROXY_SECRET
            env vars missing). Distinct exit code so the workflow can
            treat this as a configuration error vs a real fetch issue.
        3 — fetch/parse failure BUT committed JSON is still fresh
            (≤ STALE_AFTER_DAYS). Tolerable no-op — PFEG had a bad
            moment but we've lost no actionable data. Workflow should
            treat this as success (no alert).
    """
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger.info("[therm] mode=fetch via Cloudflare Worker proxy → ERDDAP")

    proxy_base, secret = _proxy_env()
    if not proxy_base or not secret:
        logger.error(
            "[therm] FATAL: ERDDAP proxy not configured. "
            "Set ERDDAP_PROXY_BASE and ERDDAP_PROXY_SECRET env vars. "
            "Deploy guide: cf-worker/README.md"
        )
        return 2

    archive = _load_archive()

    # Pull only what's needed to extend the archive frontier (+ a short
    # revision overlap), not a fixed block, and merge it in.
    start_date = _incremental_start_date(archive)
    raw_obs, winning_dataset, rc = _fetch_window(proxy_base, secret, start_date, diag=diag)
    if rc is not None:
        # Fetch failed. The archive + last committed snapshot are still
        # valid (TAO lag means a missed day loses nothing), so route
        # through the stale-tolerant exit-code logic.
        return rc

    daily = _obs_to_daily_means(raw_obs)
    n_cells = _merge_into_archive(archive, daily)
    n_dropped = _trim_archive(archive)
    fresh_days = sum(len(v) for v in daily.values())
    logger.info(
        f"[therm] parsed {len(raw_obs)} obs → {fresh_days} buoy-days merged "
        f"({n_cells} cells written, {n_dropped} trimmed); "
        f"archive now spans {_archive_span(archive)}"
    )

    analyses = _analyse_from_archive(archive)
    for a in analyses:
        if a.latest:
            logger.info(
                f"[therm]   {a.site.station_id:>7} {a.site.label}: "
                f"latest {a.latest.temp_c:.2f}°C, range {a.window_min_c}–{a.window_max_c}, "
                f"Δ30d={_fmt_signed(a.delta_30d_c)} → {a.kelvin_signal}"
            )
        else:
            logger.info(f"[therm]   {a.site.station_id:>7} {a.site.label}: no data")

    doc = build_payload(analyses, winning_dataset)
    headline = doc["thermocline"]["headline"]
    if headline:
        logger.info(
            f"[therm] headline 0°N 155°W ({HEADLINE_STATION_ID}): "
            f"T={_fmt_signed(headline['latest_temp_c'])}°C, "
            f"Δ30d={_fmt_signed(headline['delta_30d_c'])}°C, "
            f"signal={headline['kelvin_signal']}"
        )

    if write:
        _save_archive(archive)
        _persist(doc)
        n_with_data = sum(1 for a in analyses if a.latest is not None)
        logger.info(
            f"[therm] wrote {OUT_PATH} ({n_with_data}/{len(NDBC_BUOYS)} buoys reporting) "
            f"+ archive {ARCHIVE_PATH.name}"
        )
    else:
        logger.info("[therm] preview only — pass --write to persist")
    return 0


def _archive_span(archive: dict) -> str:
    """Human one-liner of the archive's date coverage, for the log."""
    all_days = [d for days in archive.get("buoys", {}).values() for d in days]
    if not all_days:
        return "empty"
    return f"{min(all_days)} → {max(all_days)} ({len(set(all_days))} distinct days)"


def _fetch_raw_obs(
    proxy_base: str, secret: str, start_date: str,
    end_date: str | None = None, *, diag: bool = False,
) -> tuple[list[OceanObs], str | None, int]:
    """Low-level: walk the dataset candidates for ONE time window and
    return (obs, winning_dataset, status). status is an HTTP-ish code:
        200 — got parseable observations
        401 — shared-secret mismatch (operator must fix)
        0   — upstream down / no candidate served / parsed empty
    No staleness logic here — callers decide what a failure means.
    Shared by the daily run and the year-by-year backfill."""
    text: str | None = None
    winning_dataset: str | None = None
    for ds in DATASET_CANDIDATES:
        path_query = _build_tabledap_query(ds, start_date, end_date)
        body, status = _fetch_via_proxy(proxy_base, secret, path_query)
        if status == 200 and body:
            span = f"{start_date}→{end_date or 'now'}"
            logger.info(f"[therm] fetched OK: dataset={ds} {span} ({len(body):,} bytes)")
            text = body
            winning_dataset = ds
            break
        if status == 401:
            logger.error(
                f"[therm] FATAL: proxy returned 401 for {ds} — "
                f"ERDDAP_PROXY_SECRET mismatch with the Worker's PROXY_SECRET."
            )
            return [], None, 401
        snippet = (body or "")[:160].replace("\n", " ")
        logger.info(f"[therm] dataset={ds} → HTTP {status} :: {snippet}")

    if diag and text:
        head = "\n".join(text.splitlines()[:15])
        logger.info(f"[therm] --diag winning response head:\n{head}")

    if not text:
        return [], None, 0
    raw_obs = parse_erddap_json(text)
    return (raw_obs, winning_dataset, 200) if raw_obs else ([], None, 0)


def _fetch_window(
    proxy_base: str, secret: str, start_date: str, *, diag: bool = False,
) -> tuple[list[OceanObs], str | None, int | None]:
    """Daily-run wrapper around _fetch_raw_obs that maps a fetch failure
    to a stale-tolerant exit code: returns (obs, dataset, None) on
    success, or ([], None, exit_code) where exit_code is 2 (secret
    mismatch), or 3/1 from the staleness helper."""
    obs, winning_dataset, status = _fetch_raw_obs(
        proxy_base, secret, start_date, diag=diag,
    )
    if status == 401:
        return [], None, 2
    if status != 200 or not obs:
        return [], None, _fetch_failure_exit_code(
            "no dataset returned data (upstream likely down — 522/525 — "
            "or dataset IDs changed; try `<proxy>/info/index.csv?searchFor=tao`)"
        )
    return obs, winning_dataset, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="Persist parsed JSON")
    ap.add_argument("--diag",  action="store_true",
                    help="Log the head of the winning ERDDAP response so the "
                         "operator can confirm the schema from the workflow log.")
    args = ap.parse_args()
    return run(write=args.write, diag=args.diag)


if __name__ == "__main__":
    sys.exit(main())
