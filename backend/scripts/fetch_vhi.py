#!/usr/bin/env python3
"""fetch_vhi.py — weekly NOAA STAR Vegetation Health Index (VHI) per coffee region.

Downloads the weekly NOAA STAR VHI product, bounding-box-averages it around each
origin region's coordinates, and writes `vhi` (+ `vhi_week`) additively into
frontend/public/data/{origin}_weather.json — same pattern as ESSM/SPI, charts
untouched. VHI 0–100: <40 stressed vegetation, >60 healthy.

Runs in CI (.github/workflows/build-vhi.yml) — the NOAA host is blocked from the
Claude sandbox, so the live fetch/format is validated on first dispatch.

    python backend/scripts/fetch_vhi.py            # preview (network-dependent)
    python backend/scripts/fetch_vhi.py --write    # write into {origin}_weather.json

IMPORTANT — verify on first CI run: VHI_URL and the CSV column layout are coded
to the documented "weekly CSV/TXT with lat/lon/VHI" product. parse_vhi_csv()
detects columns by header keyword (robust to order), but if NOAA serves a
different shape (e.g. gridded NetCDF), only the fetch/parse layer needs updating
— the bbox aggregation (region_vhi) is format-agnostic.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_origin_weather import ORIGINS  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 (CoffeeIntelVHI/1.0)"}

# NOAA STAR weekly Vegetation Health product. Templated by ISO year+week; the
# scraper walks back a few weeks to the latest published file. VERIFY the host
# path on first CI dispatch (see module docstring).
VHI_URL = ("https://www.star.nesdis.noaa.gov/pub/corp/scsb/wguo/data/"
           "Blended_VH_4km/csv/VHI_weekly_{year}_wk{week:02d}.csv")

BBOX_DELTA = 0.75   # ± degrees around each region's point → a regional box


def fetch_csv_text(year: int, week: int) -> str | None:
    url = VHI_URL.format(year=year, week=week)
    try:
        r = requests.get(url, headers=HEADERS, timeout=60)
        if r.status_code == 200 and r.text.strip():
            return r.text
    except Exception as e:  # noqa: BLE001
        print(f"  [vhi] fetch {url} failed: {e}", file=sys.stderr)
    return None


def latest_csv_text(today: dt.date | None = None, lookback: int = 5) -> tuple[str | None, str | None]:
    """Walk back up to `lookback` ISO weeks to the newest published file.
    Returns (csv_text, 'YYYY-Www') or (None, None)."""
    today = today or dt.date.today()
    for back in range(lookback):
        d = today - dt.timedelta(weeks=back)
        year, week, _ = d.isocalendar()
        text = fetch_csv_text(year, week)
        if text:
            return text, f"{year}-W{week:02d}"
    return None, None


def parse_vhi_csv(text: str) -> list[tuple[float, float, float]]:
    """Parse (lat, lon, vhi) rows. Columns detected by header keyword so order
    doesn't matter; rows that don't parse or fall outside valid ranges are skipped."""
    rows: list[tuple[float, float, float]] = []
    ilat = ilon = ivhi = None
    for raw in csv.reader(io.StringIO(text)):
        if not raw:
            continue
        if ilat is None:
            low = [c.strip().lower() for c in raw]
            if any("lat" in c for c in low) and any(("lon" in c or "lng" in c) for c in low):
                ilat = next(i for i, c in enumerate(low) if "lat" in c)
                ilon = next(i for i, c in enumerate(low) if "lon" in c or "lng" in c)
                ivhi = next((i for i, c in enumerate(low) if "vhi" in c), None)
            continue
        if ivhi is None:
            break
        try:
            lat, lon, vhi = float(raw[ilat]), float(raw[ilon]), float(raw[ivhi])
        except (ValueError, IndexError):
            continue
        if -90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= vhi <= 100:
            rows.append((lat, lon, vhi))
    return rows


def region_vhi(rows: list[tuple[float, float, float]], lat: float, lon: float,
               delta: float = BBOX_DELTA) -> float | None:
    """Mean VHI of all grid points within ±delta° of (lat, lon)."""
    vals = [v for (la, lo, v) in rows if abs(la - lat) <= delta and abs(lo - lon) <= delta]
    return round(sum(vals) / len(vals), 1) if vals else None


def apply_to_weather(origin: str, rows: list, week_label: str, write: bool) -> int:
    """Set province['vhi'] from the bbox mean. Returns number of regions updated."""
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
        v = region_vhi(rows, c["lat"], c["lon"])
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

    text, week_label = latest_csv_text()
    if not text:
        print("[vhi] no VHI file found in the lookback window — skipping (no change).")
        return
    rows = parse_vhi_csv(text)
    print(f"[vhi] {week_label}: parsed {len(rows)} grid points")
    if not rows:
        print("[vhi] parsed 0 points — format may have changed; skipping.")
        return
    for origin in args.origins:
        n = apply_to_weather(origin, rows, week_label, args.write)
        print(f"  {origin}: {n} regions updated")


if __name__ == "__main__":
    main()
