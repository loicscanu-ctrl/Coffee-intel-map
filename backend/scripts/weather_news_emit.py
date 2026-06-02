"""Weather + VHI drought-gate → news-feed commentary.

Reads each origin's published weather JSON (rainfall climatology + actuals)
and VHI JSON (satellite vegetation health), evaluates the per-province
drought gate, and renders one news_feed row per origin.

Gate (per province):
  rain_short  = `monthly_actual_cur` for the most-recently-completed month
                falls below the per-region per-month `monthly_dry_warn`
                threshold (this is the seasonal-baseline gate — the seed
                file already carries threshold arrays).
  vhi_critical = `vhi_latest.vhi` < 40 (NOAA STAR convention: < 40 = stress)

A province is "at drought risk" when BOTH flags fire. The rain side alone
isn't sufficient (a dry month is normal in many origins) and the VHI side
alone isn't either (early-season stress can be water-stress unrelated to
rainfall). Both together is what flagging exists for.

Region-name reconciliation: weather and VHI sometimes use different region
labels (e.g. weather "Sul de Minas" → VHI "Minas Gerais"). The matcher uses
a case-insensitive substring check both ways before falling back to "no VHI"
(in which case the gate can't fire and the province isn't flagged).

DB-less callers: when DATABASE_URL is unset, the emit step is a no-op so
the weather fetch itself doesn't depend on news_feed availability.
"""
from __future__ import annotations

import json
from datetime import datetime, date, timezone
from pathlib import Path


VHI_STRESS_THRESHOLD = 40.0   # NOAA STAR convention — see backend/seed/vhi/*.

# Map origin → (weather filename, vhi filename, lat/lng for the news pin,
# pretty display name).
ORIGINS = {
    "brazil":    ("brazil_weather.json",    "vhi_brazil.json",    -15.78, -47.93, "Brazil"),
    "vietnam":   ("vn_weather.json",        "vhi_vietnam.json",    12.67, 108.05, "Vietnam"),
    "colombia":  ("colombia_weather.json",  "vhi_colombia.json",    4.71, -74.07, "Colombia"),
    "honduras":  ("honduras_weather.json",  "vhi_honduras.json",   14.07, -87.20, "Honduras"),
    "indonesia": ("indonesia_weather.json", "vhi_indonesia.json",  -2.55, 118.01, "Indonesia"),
    "uganda":    ("uganda_weather.json",    "vhi_uganda.json",      1.37,  32.29, "Uganda"),
    "ethiopia":  ("ethiopia_weather.json",  "vhi_ethiopia.json",    9.15,  40.49, "Ethiopia"),
}


def _last_completed_month_idx(monthly_actual_cur: list, today: date) -> int | None:
    """The newest array index where the month is fully past. `monthly_actual_cur`
    is indexed [Jan..Dec] for the current year; entries are filled as months
    accumulate. We compare a completed month so partial-month accumulation
    can't falsely trip the dry-warn threshold."""
    if not isinstance(monthly_actual_cur, list):
        return None
    # Current month is `today.month - 1` zero-indexed → last *completed* is one before.
    last_completed = today.month - 2
    if last_completed < 0:
        return None
    # Walk back until we find a non-null entry within the completed range.
    for idx in range(min(last_completed, len(monthly_actual_cur) - 1), -1, -1):
        v = monthly_actual_cur[idx]
        if v is not None:
            return idx
    return None


_STOPWORDS = {"de", "do", "da", "of", "the", "and", "e", "y"}


def _tokens(name: str) -> set[str]:
    """Split a region name into informative lowercase tokens (≥4 chars,
    stopwords removed). Used for fuzzy weather↔VHI alignment when the two
    datasets label the same area differently (e.g. weather "Sul de Minas"
    vs VHI "Minas Gerais" — both keyed on "minas")."""
    return {
        t for t in "".join(c if c.isalnum() else " " for c in name).lower().split()
        if len(t) >= 4 and t not in _STOPWORDS
    }


def _find_vhi(vhi_provs: dict, weather_name: str) -> float | None:
    """Match a weather province to a VHI province using:
      1) exact case-insensitive equality (cheapest, most precise)
      2) substring containment either direction (handles "Antioquia" vs
         "Antioquia Department")
      3) token overlap of length ≥ 4 (handles "Sul de Minas" ↔ "Minas Gerais")

    Returns the latest VHI value or None when none of the three match.
    Picks the first VHI province whose check passes; in practice the
    weather seed lists each region once so there's no ambiguity.
    """
    if not isinstance(vhi_provs, dict):
        return None
    w = weather_name.lower()
    w_tokens = _tokens(weather_name)
    for vhi_name, payload in vhi_provs.items():
        v = vhi_name.lower()
        matched = (
            w == v
            or w in v
            or v in w
            or bool(w_tokens & _tokens(vhi_name))
        )
        if matched:
            latest = (payload or {}).get("vhi_latest")
            if isinstance(latest, dict) and latest.get("vhi") is not None:
                return float(latest["vhi"])
    return None


def evaluate_origin(weather: dict, vhi: dict, today: date | None = None) -> dict:
    """Per-province drought-gate evaluation. Returns:

      {
        "at_risk":  [(province, forecast_mm, vhi_value), …],
        "checked":  list[str],     # province names we evaluated
        "skipped":  list[str],     # names we couldn't gate (no completed month / no VHI)
      }

    Pure function — no I/O — so the gate logic can be unit-tested.
    """
    today = today or date.today()
    provs = weather.get("provinces") or []
    vhi_provs = (vhi or {}).get("provinces") or {}
    at_risk: list[tuple[str, float, float]] = []
    checked: list[str] = []
    skipped: list[str] = []

    for p in provs:
        name = p.get("name")
        if not name:
            continue
        idx = _last_completed_month_idx(p.get("monthly_actual_cur"), today)
        if idx is None:
            skipped.append(name)
            continue
        actual = p["monthly_actual_cur"][idx]
        warn_arr = p.get("monthly_dry_warn") or []
        if idx >= len(warn_arr):
            skipped.append(name)
            continue
        threshold = warn_arr[idx]
        vhi_val = _find_vhi(vhi_provs, name)
        if vhi_val is None:
            # No VHI alignment → can't apply the dual-gate; mark skipped so the
            # caller can surface it for diagnostics rather than silently dropping.
            skipped.append(name)
            continue
        checked.append(name)
        if actual < threshold and vhi_val < VHI_STRESS_THRESHOLD:
            at_risk.append((name, float(actual), vhi_val))

    return {"at_risk": at_risk, "checked": checked, "skipped": skipped}


def render_for_origin(origin_label: str, evaluation: dict) -> str | None:
    """Render the news-feed badge. Returns None when no provinces were
    successfully gated (so we don't surface a "normal" line built on no
    evidence)."""
    from scraper.commentary import render

    at_risk = evaluation["at_risk"]
    checked = evaluation["checked"]
    if not checked:
        return None
    if at_risk:
        names    = ", ".join(p for p, _, _ in at_risk)
        avg_rain = sum(r for _, r, _ in at_risk) / len(at_risk)
        avg_vhi  = sum(v for _, _, v in at_risk) / len(at_risk)
        return render("weather_risk", {
            "origin":      origin_label,
            "provinces":   names,
            "forecast_mm": round(avg_rain),
            "vhi":         round(avg_vhi, 1),
        })
    # All gated provinces clear → "normal" message uses the names actually checked.
    return render("weather_normal", {
        "origin":    origin_label,
        "provinces": ", ".join(checked),
    })


def emit(data_dir: Path) -> int:
    """For each origin where both weather and VHI JSONs are present, evaluate
    the gate and upsert a news_feed row. No-op when DATABASE_URL is unset.

    Returns the number of news rows written. The title carries today's date
    so re-running the same day no-ops via `upsert_news_item`'s title dedupe,
    while a new day's drought-status update creates a new row.
    """
    import os
    if not os.environ.get("DATABASE_URL"):
        print("[weather-news] DATABASE_URL unset — skipping news_feed upsert")
        return 0

    from scraper.commentary import embed_commentary
    from scraper.db import get_session, upsert_news_item

    today_iso = date.today().isoformat()
    written = 0
    db = get_session()
    try:
        for origin_key, (w_fname, v_fname, lat, lng, label) in ORIGINS.items():
            w_path = data_dir / w_fname
            v_path = data_dir / v_fname
            if not w_path.exists() or not v_path.exists():
                continue
            try:
                weather = json.loads(w_path.read_text(encoding="utf-8"))
                vhi     = json.loads(v_path.read_text(encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                print(f"[weather-news] {origin_key}: read failed: {e!r}")
                continue
            evaluation = evaluate_origin(weather, vhi)
            text = render_for_origin(label, evaluation)
            if not text:
                continue
            meta_obj: dict = {"origin": origin_key, "evaluation": {
                "at_risk_count": len(evaluation["at_risk"]),
                "checked_count": len(evaluation["checked"]),
                "skipped_count": len(evaluation["skipped"]),
            }}
            embed_commentary(meta_obj, text=text, has_update=True,
                             is_latest_trading_day=True)
            upsert_news_item(db, {
                "title":    f"{label} Agronomic Status – {today_iso}",
                "body":     text,
                "source":   "Open-Meteo + NOAA STAR",
                "category": "supply",
                "lat":      lat,
                "lng":      lng,
                "tags":     ["weather", origin_key, "agronomic", "auto-commentary"],
                "meta":     json.dumps(meta_obj, ensure_ascii=False),
                "pub_date": datetime.now(timezone.utc),
            })
            written += 1
            print(f"[weather-news] {origin_key}: {text}")
    finally:
        db.close()
    return written
