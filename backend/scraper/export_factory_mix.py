"""
export_factory_mix.py
Reads backend/seed/factories.json and writes frontend/public/data/factory_mix.json
with consumer-side capacity aggregated by world region × factory type.

Used by the demand tab's "Global Roasting Mix" panel to show structural shape of
green-coffee end-product demand (roasted vs soluble vs capsules vs decaf).

Region classification is bbox-based on lat/lng (rough but visually fine).
Mills are excluded — they're origin processing, not consumer-side capacity.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "backend" / "seed" / "factories.json"
OUT  = ROOT / "frontend" / "public" / "data" / "factory_mix.json"

# Consumer-side types only — mill is origin processing, not demand structure
_CONSUMER_TYPES = ("roastery", "soluble", "capsules", "decaf", "mixed")

# Bbox classification: (lat_min, lat_max, lng_min, lng_max)
_REGIONS = [
    ("North America",  ( 15.0,  72.0, -170.0,  -50.0)),
    ("Latin America",  (-56.0,  15.0, -120.0,  -30.0)),
    ("Europe",         ( 34.0,  72.0,  -25.0,   45.0)),
    ("Africa",         (-35.0,  37.0,  -20.0,   55.0)),
    ("Middle East",    ( 12.0,  42.0,   25.0,   65.0)),
    ("Asia",           (-12.0,  55.0,   60.0,  150.0)),
    ("Oceania",        (-50.0, -10.0,  110.0,  180.0)),
]


def _region_for(lat: float, lng: float) -> str:
    for name, (la_min, la_max, ln_min, ln_max) in _REGIONS:
        if la_min <= lat <= la_max and ln_min <= lng <= ln_max:
            return name
    return "Other"


def _parse_cap_kt(entry: dict) -> float | None:
    """Pull a numeric kt value from the 'cap' string. Returns None if absent/unparseable."""
    cap = entry.get("cap") or ""
    if not cap:
        return None
    # Format examples: "200k", "200k, notes", "1.5 Mt/yr ..."
    token = cap.strip().split(",")[0].split()[0].lower()
    try:
        if token.endswith("k"):
            return float(token[:-1])
        if token.endswith("m") or token.endswith("mt"):
            return float(token.rstrip("mt")) * 1000.0
        return float(token)
    except ValueError:
        return None


def export_factory_mix() -> None:
    data = json.loads(SEED.read_text(encoding="utf-8"))
    factories = data.get("factories", [])

    region_buckets: dict[str, dict[str, float]] = {}
    global_by_type: dict[str, float] = {t: 0.0 for t in _CONSUMER_TYPES}

    for f in factories:
        t = f.get("t")
        if t not in _CONSUMER_TYPES:
            continue
        loc = f.get("l") or []
        if len(loc) != 2:
            continue
        kt = _parse_cap_kt(f)
        if kt is None or kt <= 0:
            continue
        region = _region_for(loc[0], loc[1])
        region_buckets.setdefault(region, {t_: 0.0 for t_ in _CONSUMER_TYPES})
        region_buckets[region][t] = region_buckets[region].get(t, 0.0) + kt
        global_by_type[t] = global_by_type.get(t, 0.0) + kt

    regions_out = []
    for name, _ in _REGIONS:
        if name not in region_buckets:
            continue
        by_type = region_buckets[name]
        total = sum(by_type.values())
        if total <= 0:
            continue
        regions_out.append({
            "name":     name,
            "total_kt": round(total, 1),
            "by_type":  {k: round(v, 1) for k, v in by_type.items()},
        })

    # Sort by total desc so the chart reads largest-region-first
    regions_out.sort(key=lambda r: -r["total_kt"])

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source":       "backend/seed/factories.json",
        "note":         "Consumer-side capacity only (mills excluded). Capacity in kilo-tonnes/year, parsed best-effort.",
        "total_kt":     round(sum(global_by_type.values()), 1),
        "global_by_type": {k: round(v, 1) for k, v in global_by_type.items()},
        "regions":      regions_out,
    }

    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"  factory_mix.json -> "
        f"{len(regions_out)} regions, "
        f"{round(payload['total_kt']):,} kt total consumer capacity"
    )


if __name__ == "__main__":
    export_factory_mix()
