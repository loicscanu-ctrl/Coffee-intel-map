"""Build frontend/public/data/countries.json — the Map tab's producer pins —
from the per-origin supply JSON files (the same data the Supply tab shows).

No DB needed: reads the static files the export pipeline already wrote, so the
country pins carry live supply intel (latest exports, drought, ENSO, local
price) instead of depending on the (empty) CountryIntel DB table.
"""
import json
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"

# (display name, lat, lng, supply file) — producing-region centroids.
# Brazil has no *_supply.json (cecafe.json + farmer_economics.json instead).
PRODUCERS = [
    ("Brazil",    -19.5, -46.0, None),
    ("Vietnam",    12.7, 108.1, "vietnam_supply.json"),
    ("Colombia",    4.8, -75.7, "colombia_supply.json"),
    ("Honduras",   14.8, -88.0, "honduras_supply.json"),
    ("Indonesia",  -1.5, 103.6, "indonesia_supply.json"),
    ("Uganda",      1.0,  32.3, "uganda_supply.json"),
    ("Ethiopia",    7.5,  38.5, "ethiopia_supply.json"),
]


def _load(name: str):
    p = OUT_DIR / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _weather_intel(data) -> str:
    bits = []
    regions = ((data or {}).get("weather") or {}).get("regions") or []
    highs = [r.get("name") for r in regions if r.get("drought") == "HIGH" and r.get("name")]
    meds = [r.get("name") for r in regions if r.get("drought") == "MED" and r.get("name")]
    if highs:
        bits.append("Drought HIGH: " + ", ".join(highs))
    elif meds:
        bits.append("Drought MED: " + ", ".join(meds))
    enso = (data or {}).get("enso") or {}
    if enso.get("phase"):
        oni = enso.get("oni")
        bits.append(f"ENSO {enso['phase']}" + (f" (ONI {oni})" if oni is not None else ""))
    return " · ".join(bits)


def _price_str(data) -> str | None:
    p = (data or {}).get("fnc_price")
    if isinstance(p, dict) and p.get("cop_per_carga"):
        return f"FNC {p['cop_per_carga']:,} COP/carga"
    p = (data or {}).get("ecx_price")
    if isinstance(p, dict) and p.get("etb_per_kg"):
        return f"ECX {p['etb_per_kg']} ETB/kg"
    p = (data or {}).get("ucda_price")
    if isinstance(p, dict) and p.get("usd_cwt"):
        return f"UCDA ${p['usd_cwt']}/cwt"
    p = (data or {}).get("ihcafe_price")
    if isinstance(p, dict) and p.get("usd_cwt"):
        return f"IHCAFE ${p['usd_cwt']}/cwt"
    return None


def _latest_export(data) -> str | None:
    monthly = (((data or {}).get("exports") or {}).get("monthly")) or []
    if not monthly:
        return None
    last = monthly[-1]
    kb = last.get("total_k_bags")
    if kb is not None:
        return f"{kb:,.0f}k bags ({last.get('month')})"
    return None


def build() -> list[dict]:
    pins = []
    for name, lat, lng, fname in PRODUCERS:
        intel_bits = []
        prod = None
        if name == "Brazil":
            cec = _load("cecafe.json")
            ser = (cec or {}).get("series") or []
            if ser and ser[-1].get("total"):
                prod = f"{ser[-1]['total'] / 1000:,.0f}k bags exp ({ser[-1].get('date')})"
            wi = _weather_intel(_load("farmer_economics.json"))
            if wi:
                intel_bits.append(wi)
        else:
            data = _load(fname)
            prod = _latest_export(data)
            wi = _weather_intel(data)
            if wi:
                intel_bits.append(wi)
            ps = _price_str(data)
            if ps:
                intel_bits.append(ps)
        pins.append({
            "type": "producer",
            "lat": lat,
            "lng": lng,
            "name": name,
            "data": {
                "prod": prod or "exports pending",
                "stock": "",
                "cons": "",
                "intel": " · ".join(intel_bits),
            },
        })
    return pins


def export_country_pins() -> None:
    pins = build()
    (OUT_DIR / "countries.json").write_text(json.dumps(pins, indent=2), encoding="utf-8")
    print(f"  countries.json → {len(pins)} producer pins")


if __name__ == "__main__":
    export_country_pins()
