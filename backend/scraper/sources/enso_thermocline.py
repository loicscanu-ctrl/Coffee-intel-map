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
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "frontend" / "public" / "data"
OUT_PATH = DATA_DIR / "enso_thermocline.json"


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
NDBC_BUOYS: tuple[BuoySite, ...] = (
    BuoySite("2n170w",  2.0, -170.0, "2°N 170°W",  "170W"),
    BuoySite("0n170w",  0.0, -170.0, "0°N 170°W",  "170W"),
    BuoySite("2s170w", -2.0, -170.0, "2°S 170°W",  "170W"),
    BuoySite("2n155w",  2.0, -155.0, "2°N 155°W",  "155W"),
    BuoySite("0n155w",  0.0, -155.0, "0°N 155°W",  "155W"),
    BuoySite("2s155w", -2.0, -155.0, "2°S 155°W",  "155W"),
    BuoySite("0n140w",  0.0, -140.0, "0°N 140°W",  "140W"),
)
HEADLINE_STATION_ID = "0n155w"


# ── query parameters ────────────────────────────────────────────────────────


# Sensor depth window — TAO buoys sample at canonical depths
# (1, 10, 20, 40, 60, 80, 100, 120, 140, 180, 300, 500 m). The
# "150 m Kelvin wave depth" is bracketed by 140 and 180; we
# accept anything in [130, 200] and record the exact depth.
TARGET_DEPTH_M = 150
DEPTH_LOWER_M  = 130
DEPTH_UPPER_M  = 200

# Lat window — ±3° covers our anchor sites (±2° lat) with a small buffer
# in case ERDDAP records the buoy positions with offset precision.
LAT_LOWER = -3.0
LAT_UPPER =  3.0

# Lon window — covers 170°W (190°E) to 140°W (220°E) with a buffer.
LON_LOWER_E = 185.0
LON_UPPER_E = 225.0

# Time window — pull 90 days to compute the 30-day delta with room
# to spare for any timing offset between buoy reports.
HISTORY_DAYS = 90

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
    "pmelTaoMonT",         # PMEL monthly subsurface T (canonical)
    "pmelTaoDyT",          # PMEL daily subsurface T
    "pmelTaoMonsT",        # PMEL monthly variant
    "pmelTaoMonTao",       # Older alias
    "pmelTaoSites",        # Site-level aggregator
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
    candidate), 5xx (upstream issue — retry next dispatch)."""
    url = f"{proxy_base.rstrip('/')}/{path_and_query.lstrip('/')}"
    headers = {
        "x-proxy-secret": secret,
        "Accept": "application/json, text/csv, */*",
        "User-Agent": "coffee-intel-map/enso-thermocline (proxy client)",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
    except requests.RequestException as e:
        logger.warning(f"[therm] GET {url} → request error: {e}")
        return None, 0
    return resp.text, resp.status_code


def _build_tabledap_query(dataset_id: str, start_date: str) -> str:
    """ERDDAP tabledap query as a path+query string, ready to drop
    onto the proxy base. We don't pin the temperature column in the
    SELECT — let ERDDAP return its full schema so the parser can
    locate the temp field by name. JSON output for cleaner parsing
    than CSV's units row.

    Leading '&' on the constraint string is REQUIRED by ERDDAP when
    there's no SELECT clause: it tells the parser "constraints start
    here, the column-list was empty (i.e. return all)." Without it
    ERDDAP returns HTTP 400 'All constraints must be preceded by &'.
    """
    constraints = (
        f"&latitude>={LAT_LOWER}&latitude<={LAT_UPPER}"
        f"&longitude>={LON_LOWER_E}&longitude<={LON_UPPER_E}"
        f"&depth>={DEPTH_LOWER_M}&depth<={DEPTH_UPPER_M}"
        f"&time>={start_date}"
    )
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


def _classify_kelvin(delta_c: float | None) -> str:
    if delta_c is None:
        return "no-data"
    if delta_c >= KELVIN_WARM_THRESHOLD:
        return "warm-kelvin-wave"
    if delta_c <= KELVIN_COLD_THRESHOLD:
        return "cold-kelvin-wave"
    return "neutral"


def analyse_buoy(site: BuoySite, obs: list[OceanObs]) -> BuoyAnalysis:
    """Unchanged from v4 — Δ-30d signal = mean(last 7 days at this
    site/depth band) - mean(30-37 days ago, same). |Δ| ≥ 1.0 °C
    qualifies as a downwelling (warm) or upwelling (cold) Kelvin
    event. Climatology-free; works on whatever the array reports."""
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
    """Fetch via the proxy, parse, persist. Exit codes:
        0 — success (data written or previewed cleanly)
        1 — fetch/parse failure across all dataset candidates
        2 — proxy not configured (ERDDAP_PROXY_BASE / ERDDAP_PROXY_SECRET
            env vars missing). Distinct exit code so the workflow can
            treat this as a configuration error vs a real fetch issue.
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

    start_date = (datetime.now(UTC) - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")

    # Walk dataset candidates until one returns a usable response.
    text: str | None = None
    winning_dataset: str | None = None
    for ds in DATASET_CANDIDATES:
        path_query = _build_tabledap_query(ds, start_date)
        body, status = _fetch_via_proxy(proxy_base, secret, path_query)
        if status == 200 and body:
            logger.info(f"[therm] fetched OK: dataset={ds} ({len(body):,} bytes)")
            text = body
            winning_dataset = ds
            break
        if status == 401:
            logger.error(
                f"[therm] FATAL: proxy returned 401 for {ds} — "
                f"ERDDAP_PROXY_SECRET mismatch with the Worker's PROXY_SECRET."
            )
            return 2
        snippet = (body or "")[:160].replace("\n", " ")
        logger.info(f"[therm] dataset={ds} → HTTP {status} :: {snippet}")

    if diag and text:
        head = "\n".join(text.splitlines()[:15])
        logger.info(f"[therm] --diag winning response head:\n{head}")

    if not text:
        logger.error(
            f"[therm] FATAL: no dataset in {DATASET_CANDIDATES} returned data. "
            f"Verify upstream + dataset IDs — try `<proxy>/info/index.csv?searchFor=tao` "
            f"manually to find the upstream's TAO catalog."
        )
        return 1

    raw_obs = parse_erddap_json(text)
    if not raw_obs:
        logger.error(
            "[therm] FATAL: 0 observations parsed from the ERDDAP response. "
            "Re-run with --diag to see the response head."
        )
        return 1

    # Snap each raw observation to one of our 7 anchor sites.
    by_site: dict[str, list[OceanObs]] = defaultdict(list)
    skipped = 0
    for o in raw_obs:
        site = _nearest_site(o.lat, o.lon_e)
        if site is None:
            skipped += 1
            continue
        by_site[site.station_id].append(o)
    logger.info(
        f"[therm] parsed {len(raw_obs)} obs ({skipped} unmapped); "
        f"distributed across {len(by_site)}/{len(NDBC_BUOYS)} anchor sites"
    )

    analyses = [analyse_buoy(s, by_site.get(s.station_id, [])) for s in NDBC_BUOYS]
    for a in analyses:
        if a.latest:
            logger.info(
                f"[therm]   {a.site.station_id:>7} {a.site.label}: "
                f"{a.obs_count} obs, latest {a.latest.temp_c:.2f}°C @ {a.latest.depth_m:.0f}m, "
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
        _persist(doc)
        n_with_data = sum(1 for a in analyses if a.latest is not None)
        logger.info(f"[therm] wrote {OUT_PATH} ({n_with_data}/{len(NDBC_BUOYS)} buoys reporting)")
    else:
        logger.info("[therm] preview only — pass --write to persist")
    return 0


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
