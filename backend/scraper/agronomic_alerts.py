"""Agronomic alert engine — IPHM rules over the live weather + VHI feeds.

Sits at the end of the daily 1.10 weather workflow. Reads:
  - frontend/public/data/{origin}_weather.json   (SPI, SPEI, temp, forecast)
  - frontend/public/data/vhi_{origin}.json       (latest VHI per region)

Writes:
  - frontend/public/data/agronomic_alerts.json   (canonical per-region detail)
  - frontend/public/data/signals.json            (flattened append — Telegram
                                                  bot picks up via existing
                                                  signals[] consumer)

Stateless v1: no audit log of historical alerts. Severity tiers (Watch /
Alert / Critical) map to lowercase in the flattened signals.json so the
existing quant-signal consumer applies the same filtering.

Usage:
    python -m scraper.agronomic_alerts            # preview (no write)
    python -m scraper.agronomic_alerts --write    # persist both JSONs
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from scraper.rules.iphm_thresholds import IPHM_RULES

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "frontend" / "public" / "data"

ALERTS_PATH  = DATA_DIR / "agronomic_alerts.json"
SIGNALS_PATH = DATA_DIR / "signals.json"

# Origin key (as used everywhere in the repo) → ISO-3 code (as used in IPHM
# rule `origins` filters). Must match the keys in fetch_origin_weather.ORIGINS
# and the country_iso3 fields in backend/seed/vhi_province_ids.json.
ORIGIN_ISO3 = {
    "brazil":    "BRA",
    "colombia":  "COL",
    "honduras":  "HND",
    "indonesia": "IDN",
    "uganda":    "UGA",
    "ethiopia":  "ETH",
    "vn":        "VNM",
}

# Fields evaluated against forward-looking forecast data, not observed
# history. If any condition in a fired rule references one of these, the
# alert's timeframe is "forecast"; otherwise "current".
FORECAST_FIELDS: set[str] = {"temp_min", "forecast_7d_rain"}


# ── Field extraction ─────────────────────────────────────────────────────────

def extract_region_values(
    prov: dict[str, Any],
    weather_doc: dict[str, Any],
    vhi_prov: dict[str, Any] | None,
    cur_month_idx: int,
) -> dict[str, float]:
    """Flatten a region's signals into a {field: value} dict for rule eval.

    `cur_month_idx` is 0-based (Jan=0). Missing values are simply absent from
    the output — _evaluate_rule then returns None when a rule references a
    missing field, which is the right "we don't know" answer (better than
    silently zero-filling).
    """
    out: dict[str, float] = {}
    for f in ("spi_1", "spi_3", "spei_1", "spei_3"):
        v = prov.get(f)
        if v is not None:
            out[f] = float(v)

    if vhi_prov:
        latest = vhi_prov.get("vhi_latest") or {}
        if latest.get("vhi") is not None:
            out["vhi"] = float(latest["vhi"])

    monthly_temps = prov.get("monthly_actual_temp_cur") or []
    if (0 <= cur_month_idx < len(monthly_temps)
            and monthly_temps[cur_month_idx] is not None):
        out["temp_mean"] = float(monthly_temps[cur_month_idx])

    fc_rain = prov.get("forecast_7d_rain") or []
    if fc_rain:
        out["forecast_7d_rain"] = float(sum(fc_rain))

    # forecast_7d temps live at the doc level, not per-province (one
    # forecast track per origin in the chart). Apply the country-level
    # minimum to every region — fine for v1 frost detection since the
    # frost belt is regional, not point-source.
    fc_doc = weather_doc.get("forecast_7d") or []
    temp_mins = [r.get("temp_min_c") for r in fc_doc
                 if isinstance(r, dict) and r.get("temp_min_c") is not None]
    if temp_mins:
        out["temp_min"] = float(min(temp_mins))

    return out


# ── Rule evaluation ──────────────────────────────────────────────────────────

def _condition_holds(field: str, op: str, threshold: float,
                     value: float) -> bool:
    if op == "min":
        return value >= threshold
    if op == "max":
        return value <= threshold
    raise ValueError(f"unknown condition op: {op!r}")


def evaluate_rule(rule: dict[str, Any], values: dict[str, float],
                  iso3: str, month: int) -> dict[str, Any] | None:
    """Apply one rule to one region. Returns an alert dict if all conditions
    hold (and any origin/month filters allow it); None otherwise.

    Pure (no I/O, no globals consulted). Easy to unit-test against synthetic
    {field: value} fixtures.
    """
    if "origins" in rule and iso3 not in rule["origins"]:
        return None
    if "months" in rule and month not in rule["months"]:
        return None

    triggers: dict[str, float] = {}
    timeframe = "current"
    for cond_key, threshold in rule["conditions"].items():
        if cond_key.endswith("_min"):
            field, op = cond_key[:-4], "min"
        elif cond_key.endswith("_max"):
            field, op = cond_key[:-4], "max"
        else:
            return None  # unknown condition shape — fail closed

        v = values.get(field)
        if v is None:
            return None  # data missing → can't fire (no false positives)
        if not _condition_holds(field, op, threshold, v):
            return None

        triggers[field] = round(v, 2)
        if field in FORECAST_FIELDS:
            timeframe = "forecast"

    return {
        "threat_id":     rule["threat_id"],
        "name":          rule["name"],
        "severity":      rule["severity"],
        "timeframe":     timeframe,
        "market_impact": rule["market_impact"],
        "triggers":      triggers,
    }


def evaluate_region(values: dict[str, float], iso3: str, month: int,
                    rules: list[dict[str, Any]] | None = None,
                    ) -> list[dict[str, Any]]:
    """Run every rule against one region. Returns the list of fired alerts."""
    rules = rules if rules is not None else IPHM_RULES
    fired: list[dict[str, Any]] = []
    for rule in rules:
        a = evaluate_rule(rule, values, iso3, month)
        if a is not None:
            fired.append(a)
    return fired


# ── Driver — read JSONs, evaluate, write outputs ─────────────────────────────

def _load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def build() -> dict[str, Any]:
    """Run the engine across every origin. Returns the agronomic_alerts payload."""
    today = dt.date.today()
    cur_month = today.month       # 1-based for the months[] filter
    cur_month_idx = cur_month - 1   # 0-based for array indexing

    origins_out: dict[str, dict[str, list[dict]]] = {}
    severity_counter: Counter[str] = Counter()
    threat_counter:   Counter[str] = Counter()
    total = 0

    for origin, iso3 in ORIGIN_ISO3.items():
        wx = _load_json(DATA_DIR / f"{origin}_weather.json")
        vhi = _load_json(DATA_DIR / f"vhi_{origin}.json") or {}
        if not wx:
            continue

        vhi_provs = (vhi.get("provinces") or {}) if isinstance(vhi, dict) else {}
        per_region: dict[str, list[dict]] = {}

        for prov in wx.get("provinces") or []:
            name = prov.get("name")
            if not name:
                continue
            values = extract_region_values(
                prov, wx, vhi_provs.get(name), cur_month_idx,
            )
            fired = evaluate_region(values, iso3, cur_month)
            if fired:
                per_region[name] = fired
                for a in fired:
                    severity_counter[a["severity"]] += 1
                    threat_counter[a["threat_id"]] += 1
                    total += 1

        if per_region:
            origins_out[origin] = per_region

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "ruleset_version": "iphm-v1",
        "origins": origins_out,
        "summary": {
            "total_alerts": total,
            "by_severity": dict(severity_counter),
            "by_threat":   dict(threat_counter),
        },
    }


# ── signals.json flatten/merge ───────────────────────────────────────────────

# Keep flattened alerts confined to a single category so the existing
# quant-signal block stays clean and so re-runs are idempotent.
SIGNALS_CATEGORY      = "AGRO"
SIGNALS_CATEGORY_LABEL = "Agronomic"
SIGNALS_MARKET         = "PHYS"   # physical/agronomic, not NY/LDN futures


def flatten_for_signals(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Project the agronomic_alerts payload into signals.json-shaped entries.

    Severity is lowercased so it matches the quant signals' info/watch/alert
    convention. Each entry's id is deterministic so a daily run replaces the
    prior day's entries cleanly (the merge below drops any prior AGRO rows).
    """
    out: list[dict[str, Any]] = []
    for origin, regions in (payload.get("origins") or {}).items():
        for region, alerts in regions.items():
            for a in alerts:
                severity = a["severity"].lower()
                tf = a["timeframe"]
                tf_text = " (forecast)" if tf == "forecast" else ""
                trigger_bits = ", ".join(f"{k}={v}" for k, v in a["triggers"].items())
                out.append({
                    "id": f"AGRO_{origin}_{region}_{a['threat_id']}".replace(" ", "_"),
                    "name":          a["name"],
                    "category":      SIGNALS_CATEGORY,
                    "categoryLabel": SIGNALS_CATEGORY_LABEL,
                    "market":        SIGNALS_MARKET,
                    "severity":      severity,
                    "score":         0,            # not a price-direction score
                    "magnitude":     "medium",
                    "text":          f"{origin}/{region}: {a['market_impact']}{tf_text}  [{trigger_bits}]",
                })
    return out


def merge_into_signals_json(payload: dict[str, Any], write: bool) -> int:
    """Replace any existing AGRO rows in signals.json with today's set.

    Returns the number of agronomic rows ultimately present. If signals.json
    doesn't exist yet (cold runner state) we no-op gracefully — the canonical
    agronomic_alerts.json is still authoritative.
    """
    existing = _load_json(SIGNALS_PATH)
    if not isinstance(existing, dict) or "signals" not in existing:
        return 0
    others = [s for s in existing.get("signals") or []
              if s.get("category") != SIGNALS_CATEGORY]
    fresh = flatten_for_signals(payload)
    existing["signals"] = others + fresh
    existing["generatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")
    if write:
        SIGNALS_PATH.write_text(
            json.dumps(existing, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return len(fresh)


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true",
                    help="Persist agronomic_alerts.json + merged signals.json")
    args = ap.parse_args(argv)

    payload = build()
    n_total = payload["summary"]["total_alerts"]
    by_sev   = payload["summary"]["by_severity"]
    by_th    = payload["summary"]["by_threat"]

    print(f"[agronomic] {n_total} alerts across {len(payload['origins'])} origins")
    print(f"  by severity: {dict(by_sev)}")
    print(f"  by threat:   {dict(by_th)}")

    if args.write:
        ALERTS_PATH.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        n_merged = merge_into_signals_json(payload, write=True)
        print(f"  → wrote {ALERTS_PATH.name}")
        print(f"  → merged {n_merged} rows into {SIGNALS_PATH.name}")
    else:
        print(f"(preview only — re-run with --write to persist)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
