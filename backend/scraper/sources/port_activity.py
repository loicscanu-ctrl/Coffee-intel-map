"""
port_activity.py — Weekly scraper for IMF PortWatch port-activity time series.

Source: IMF PortWatch "Daily Port Activity Data and Trade Estimates" (built on
the UN Global Platform AIS feed). Public ArcGIS Feature Service, no auth.

  Daily_Ports_Data/FeatureServer/0
    portid, portname, country, ISO3, year, month, day
    portcalls            — daily vessel-call count ("Arrival of Ships")
    portcalls_<type>     — split by vessel type
    import               — estimated import volume, metric tons ("Incoming Shipment")
    import_<type>        — split by vessel type
    export               — estimated export volume, metric tons ("Outgoing Shipment")
    export_<type>        — split by vessel type
  where <type> ∈ {container, dry_bulk, general_cargo, roro, tanker}

PortWatch refreshes weekly (Tuesdays ~09:00 ET). We track a curated set of
coffee export gateways and write a single static JSON the Freight page reads.

Writes → frontend/public/data/port_activity.json
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Repo layout: backend/scraper/sources/port_activity.py → frontend/public/data
_OUT_PATH = (
    Path(__file__).resolve().parents[3]
    / "frontend" / "public" / "data" / "port_activity.json"
)

_BASE = (
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/"
    "Daily_Ports_Data/FeatureServer/0/query"
)

# Only fetch from this year forward — keeps the committed JSON to a sane size
# while still covering the 1m/3m/6m/YTD/1y/All zoom levels with multiple years.
_START_YEAR = 2021

# Vessel types as they appear in the field suffixes (and the chart legend).
_TYPES = ["container", "dry_bulk", "general_cargo", "roro", "tanker"]

_METRICS = ["portcalls", "import", "export"]

# date pieces let us build YYYY-MM-DD without epoch/timezone ambiguity.
_FIELDS = ["portid", "portname", "country", "ISO3", "year", "month", "day"]
for _m in _METRICS:
    _FIELDS.append(_m)
    _FIELDS += [f"{_m}_{t}" for t in _TYPES]

_OUT_FIELDS = ",".join(_FIELDS)

# ArcGIS FeatureServers cap each page; paginate with resultOffset.
_PAGE = 2000

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# Curated coffee export gateways. Either pin an exact `portid` (most reliable)
# or give a `match` substring + `iso3` and let the scraper resolve the portid.
# `note` explains the coffee relevance; `label`/`country` are display strings.
PORTS: list[dict] = [
    {"key": "hcmc",          "portid": "port2085",        "label": "Ho Chi Minh City", "country": "Vietnam",   "note": "Vietnam robusta export gateway (Cat Lai / Saigon New Port)"},
    {"key": "santos",        "match": "SANTOS",           "iso3": "BRA", "label": "Santos",          "country": "Brazil",     "note": "World's largest coffee export port (arabica)"},
    {"key": "buenaventura",  "match": "BUENAVENTURA",     "iso3": "COL", "label": "Buenaventura",    "country": "Colombia",   "note": "Colombia's main Pacific coffee export port"},
    {"key": "cartagena_co",  "match": "CARTAGENA",        "iso3": "COL", "label": "Cartagena",       "country": "Colombia",   "note": "Colombia Caribbean coffee export port"},
    {"key": "panjang",       "match": "PANJANG",          "iso3": "IDN", "label": "Panjang",         "country": "Indonesia",  "note": "Lampung robusta export port"},
    {"key": "tanjungpriok",  "match": "TANJUNG PRIOK",    "iso3": "IDN", "label": "Tanjung Priok",   "country": "Indonesia",  "note": "Jakarta — Indonesia's largest port"},
    {"key": "cortes",        "match": "CORTES",           "iso3": "HND", "label": "Puerto Cortés",   "country": "Honduras",   "note": "Honduras' main coffee export port"},
    {"key": "quetzal",       "match": "QUETZAL",          "iso3": "GTM", "label": "Puerto Quetzal",  "country": "Guatemala",  "note": "Guatemala Pacific coffee export port"},
    {"key": "djibouti",      "match": "DJIBOUTI",         "iso3": "DJI", "label": "Djibouti",        "country": "Djibouti",   "note": "Outlet for landlocked Ethiopia's coffee"},
    {"key": "mombasa",       "match": "MOMBASA",          "iso3": "KEN", "label": "Mombasa",         "country": "Kenya",      "note": "Outlet for Uganda/East-Africa coffee"},
]


def _get(params: dict) -> dict:
    """GET the query endpoint with light retries. Raises on persistent failure."""
    import time

    import requests

    last_err: Exception | None = None
    for attempt in range(4):
        try:
            resp = requests.get(_BASE, params=params, headers=_HEADERS, timeout=40)
            # Don't burn retries on permanent client errors (403/404/...) — only
            # transient ones (429 rate-limit, 5xx) and network faults are worth it.
            if resp.status_code in (400, 401, 403, 404, 410):
                resp.raise_for_status()
            resp.raise_for_status()
            payload = resp.json()
            if "error" in payload:
                raise RuntimeError(f"ArcGIS error: {payload['error']}")
            return payload
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else None
            if code in (400, 401, 403, 404, 410):
                raise
            last_err = e
            time.sleep(2 ** attempt)
        except Exception as e:  # noqa: BLE001 — network/JSON faults: retry
            last_err = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"request failed after retries: {last_err}")


def _resolve_portid(match: str, iso3: str) -> tuple[str, str] | None:
    """Resolve a (portid, portname) for a name substring within a country.

    Picks the candidate with the highest recent activity when several match,
    so 'SANTOS' resolves to the main port rather than a tiny berth.
    """
    where = f"UPPER(portname) LIKE '%{match.upper()}%' AND ISO3='{iso3}'"
    payload = _get({
        "where": where,
        "outFields": "portid,portname",
        "returnDistinctValues": "true",
        "f": "json",
    })
    feats = payload.get("features", [])
    cands = [
        (f["attributes"]["portid"], f["attributes"]["portname"])
        for f in feats
        if f.get("attributes", {}).get("portid")
    ]
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0]

    # Disambiguate by total recent port calls (busiest = the one we want).
    best, best_calls = cands[0], -1.0
    for portid, portname in cands:
        agg = _get({
            "where": f"portid='{portid}' AND year>={_START_YEAR}",
            "outStatistics": json.dumps([{
                "statisticType": "sum",
                "onStatisticField": "portcalls",
                "outStatisticFieldName": "tc",
            }]),
            "f": "json",
        })
        tc = (agg.get("features") or [{}])[0].get("attributes", {}).get("tc") or 0
        if tc > best_calls:
            best, best_calls = (portid, portname), tc
    return best


def _fetch_series(portid: str) -> list[dict]:
    """Fetch the full (windowed) daily series for one portid, paginated."""
    rows: list[dict] = []
    offset = 0
    while True:
        payload = _get({
            "where": f"portid='{portid}' AND year>={_START_YEAR}",
            "outFields": _OUT_FIELDS,
            "orderByFields": "year,month,day",
            "resultOffset": offset,
            "resultRecordCount": _PAGE,
            "returnGeometry": "false",
            "f": "json",
        })
        feats = payload.get("features", [])
        for f in feats:
            a = f.get("attributes", {})
            if a.get("year") is None:
                continue
            point = {"date": f"{int(a['year']):04d}-{int(a['month']):02d}-{int(a['day']):02d}"}
            for m in _METRICS:
                point[m] = _num(a.get(m))
                for t in _TYPES:
                    point[f"{m}_{t}"] = _num(a.get(f"{m}_{t}"))
            rows.append(point)
        if len(feats) < _PAGE or not payload.get("exceededTransferLimit", False):
            break
        offset += _PAGE
    return rows


def _num(v) -> float | int:
    """Round to trim JSON size; ints stay ints (port-call counts)."""
    if v is None:
        return 0
    f = round(float(v), 1)
    return int(f) if f.is_integer() else f


def run() -> dict | None:
    """Fetch all configured ports and write the static JSON. Returns the payload."""
    out_ports: list[dict] = []
    for spec in PORTS:
        key = spec["key"]
        try:
            portid = spec.get("portid")
            portname = None
            if not portid:
                resolved = _resolve_portid(spec["match"], spec["iso3"])
                if not resolved:
                    print(f"[port_activity] {key}: no portid match for "
                          f"'{spec['match']}' / {spec['iso3']} — skipped")
                    continue
                portid, portname = resolved

            series = _fetch_series(portid)
            if not series:
                print(f"[port_activity] {key} ({portid}): no rows — skipped")
                continue

            out_ports.append({
                "key": key,
                "portid": portid,
                "name": portname or spec["label"],
                "label": spec["label"],
                "country": spec["country"],
                "note": spec["note"],
                "start": series[0]["date"],
                "end": series[-1]["date"],
                "series": series,
            })
            print(f"[port_activity] {key} ({portid}): {len(series)} days "
                  f"{series[0]['date']}→{series[-1]['date']}")
        except Exception as e:  # noqa: BLE001 — one port must not sink the rest
            print(f"[port_activity] {key}: ERROR — {e}")

    if not out_ports:
        print("[port_activity] No ports fetched — retaining existing file")
        return None

    payload = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "IMF PortWatch (UN Global Platform; PortWatch)",
        "dataset": "Daily Port Activity Data and Trade Estimates",
        "metrics": {
            "portcalls": "Daily vessel-call count (Arrival of Ships)",
            "import": "Estimated import volume, metric tons (Incoming Shipment)",
            "export": "Estimated export volume, metric tons (Outgoing Shipment)",
        },
        "vessel_types": _TYPES,
        "ports": out_ports,
    }

    _OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    _OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"[port_activity] wrote {len(out_ports)} ports → {_OUT_PATH}")
    return payload


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    run()
