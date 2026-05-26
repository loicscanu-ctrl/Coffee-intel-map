#!/usr/bin/env python3
"""fetch_vhi.py — weekly NOAA STAR Vegetation Health Index (VHI) per coffee region.

NOAA STAR's Blended-VHP product is a weekly **gridded NetCDF** (4 km global), not
a CSV. This downloads the latest weekly file, reads the VHI grid, bounding-box
averages it around each origin region's coordinates, and writes `vhi`/`vhi_week`
additively into frontend/public/data/{origin}_weather.json — same pattern as
ESSM/SPI, charts untouched. VHI 0–100: <40 = stressed vegetation, >60 = healthy.

Runs in CI (.github/workflows/build-vhi.yml). The NOAA host is blocked from the
Claude sandbox, so the URL pattern / variable names / grid geometry below are
coded to NOAA STAR's documented conventions and VALIDATED ON THE FIRST CI RUN —
the function logs exactly what it fetched/found (vars, dims, grid extent) so any
mismatch is a one-line fix in the reader, not the bbox math.

    python backend/scripts/fetch_vhi.py            # preview (needs network + netCDF4)
    python backend/scripts/fetch_vhi.py --write
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_origin_weather import ORIGINS  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelVHI/1.0)"}

# NOAA STAR Blended-VHP weekly 4 km global NetCDF.
# e.g. .../VHP.G04.C07.npp.P2026021.SM.SMN.nc  (PYYYY + 3-digit ISO week)
VHI_DIR = "https://www.star.nesdis.noaa.gov/data/pub0018/VHPdata4km/VH/"
SATS = ("npp", "j01")                 # SNPP, then NOAA-20 as fallback
VHI_VARS = ("VHI", "vhi")
LAT_VARS = ("latitude", "lat", "Latitude", "LAT")
LON_VARS = ("longitude", "lon", "Longitude", "LON")
# Fallback regular-grid extent if the file carries no lat/lon coord vars
# (NOAA STAR 4 km global grid, N→S / W→E).
GRID_LAT_TOP, GRID_LAT_BOTTOM = 75.024, -55.152
GRID_LON_LEFT, GRID_LON_RIGHT = -180.0, 180.0

BBOX_DELTA = 0.75   # ± degrees around each region's point → a regional box


def _download(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=120)
        if r.status_code == 200 and r.content:
            return r.content
        print(f"  [vhi] {r.status_code} {url}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"  [vhi] fetch {url} failed: {e}", file=sys.stderr)
    return None


def _coord(ds, names) -> np.ndarray | None:
    for n in names:
        if n in ds.variables:
            return np.ma.filled(ds.variables[n][:].astype("float64"), np.nan).ravel()
    return None


def read_vhi_netcdf(raw: bytes) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """(lats_1d, lons_1d, vhi_2d) from NetCDF bytes, or None. Logs what it found."""
    from netCDF4 import Dataset
    try:
        ds = Dataset("inmem.nc", mode="r", memory=raw)
    except Exception as e:  # noqa: BLE001
        print(f"  [vhi] netCDF open failed: {e}", file=sys.stderr)
        return None
    var = next((ds.variables[n] for n in VHI_VARS if n in ds.variables), None)
    if var is None:
        print(f"  [vhi] no VHI variable; available: {list(ds.variables)}", file=sys.stderr)
        return None
    vhi = np.ma.filled(var[:].astype("float64"), np.nan).squeeze()
    if vhi.ndim != 2:
        print(f"  [vhi] unexpected VHI shape {vhi.shape}", file=sys.stderr)
        return None
    lats = _coord(ds, LAT_VARS)
    lons = _coord(ds, LON_VARS)
    h, w = vhi.shape
    if lats is None or lons is None or lats.size != h or lons.size != w:
        lats = np.linspace(GRID_LAT_TOP, GRID_LAT_BOTTOM, h)
        lons = np.linspace(GRID_LON_LEFT, GRID_LON_RIGHT, w)
        print(f"  [vhi] derived {h}x{w} grid from bounds (no usable coord vars)")
    print(f"  [vhi] grid {vhi.shape}, lat {lats[0]:.2f}→{lats[-1]:.2f}, "
          f"lon {lons[0]:.2f}→{lons[-1]:.2f}")
    return lats, lons, vhi


def latest_vhi_grid(today: dt.date | None = None, lookback: int = 4):
    """Walk back up to `lookback` ISO weeks (and both sats) to the newest file.
    Returns ((lats, lons, vhi), 'YYYY-Www') or (None, None)."""
    today = today or dt.date.today()
    for back in range(lookback):
        d = today - dt.timedelta(weeks=back)
        year, week, _ = d.isocalendar()
        for sat in SATS:
            raw = _download(VHI_DIR + f"VHP.G04.C07.{sat}.P{year}{week:03d}.SM.SMN.nc")
            if raw:
                grid = read_vhi_netcdf(raw)
                if grid is not None:
                    return grid, f"{year}-W{week:02d}"
    return None, None


def grid_region_mean(lats: np.ndarray, lons: np.ndarray, vhi: np.ndarray,
                     lat0: float, lon0: float, delta: float = BBOX_DELTA) -> float | None:
    """Mean VHI over the ±delta° box around (lat0, lon0). 0–100 only (drops
    NaN/fill); None if no valid cells in the box."""
    lat_mask = np.abs(lats - lat0) <= delta
    lon_mask = np.abs(lons - lon0) <= delta
    if not lat_mask.any() or not lon_mask.any():
        return None
    sub = vhi[np.ix_(lat_mask, lon_mask)]
    sub = sub[np.isfinite(sub) & (sub >= 0) & (sub <= 100)]
    return round(float(sub.mean()), 1) if sub.size else None


def apply_to_weather(origin: str, grid, week_label: str, write: bool) -> int:
    lats, lons, vhi = grid
    path = DATA_DIR / f"{origin}_weather.json"
    if not path.exists():
        return 0
    doc = json.loads(path.read_text(encoding="utf-8"))
    coords = {r["name"]: r for r in ORIGINS.get(origin, [])}
    n = 0
    for prov in doc.get("provinces", []):
        c = coords.get(prov["name"])
        if not c:
            continue
        v = grid_region_mean(lats, lons, vhi, c["lat"], c["lon"])
        if v is not None:
            prov["vhi"] = v
            n += 1
    if n:
        doc["vhi_week"] = week_label
        if write:
            path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--origins", nargs="*", default=list(ORIGINS))
    args = ap.parse_args()

    grid, week_label = latest_vhi_grid()
    if grid is None:
        print("[vhi] no VHI file readable in the lookback window — skipping (no change).")
        return
    for origin in args.origins:
        n = apply_to_weather(origin, grid, week_label, args.write)
        print(f"  {origin}: {n} regions updated ({week_label})")


if __name__ == "__main__":
    main()
