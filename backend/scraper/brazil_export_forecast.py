"""brazil_export_forecast.py — daily projection of Brazil green-bean exports.

Single source of truth for every Brazil-export forward-looking visual on the
dashboard. Reads three inputs that already exist on the file system:

  • frontend/public/data/cecafe.json         — official monthly series[].
  • frontend/public/data/cecafe_daily.json   — running-month registrations
                                                (Certificados de Origem track).
  • frontend/public/data/demand_stocks.json  — USDA PSD annual totals.

Writes one output that every front-end consumer fans out from:

  frontend/public/data/brazil_export_projection.json

Schema (spec'd by the issue):
  {
    "crop_year":   "26/27",
    "annual_target": 40_000_000,       # bags (60 kg)
    "monthly_curve": [
      { "month": "Apr", "value": 3_500_000, "status": "realized" },
      …
      { "month": "Mar", "value": 2_500_000, "status": "seasonality" }
    ],
    "generated_at":        "2026-06-08T17:00:00Z",
    "target_source":       "USDA PSD (year 2025)",
    "safeguard_triggered": false,
    "realized_through":    "2026-04",
    "last_year_total":     38_412_345
  }

The math (in order):
  1. Realized: months ≤ last entry of cecafe.json series[] within the active
     crop year (Apr → Mar).
  2. Certificados pacing: months strictly *after* `realized_through` that
     carry data in cecafe_daily.sources.certificados — scale latest-day
     cumulative bags to the month's full-day count.
  3. Seasonality distribution: every remaining month gets a share of
     (annual_target − realized − certificados), weighted by what THAT SAME
     SUBSET of months represented during last year's crop year.
  4. Safeguard: if remaining ≤ 0 (pace has burnt through the USDA target),
     raise `annual_target` to (realized + certificados) plus the historical
     monthly minimum for each remaining month — and surface
     `safeguard_triggered = true` so the workflow's bash step can fire a
     Telegram alert.

Certificados (paperwork) — not Embarques — anchors the near-term pacing
because the historical monthly series is itself Certificados-based; mixing
counting bases on one curve would inject silent jitter at the handoff month.

Usage (no DB; files only):
    cd backend
    python -m scraper.brazil_export_forecast            # preview, no write
    python -m scraper.brazil_export_forecast --write    # persist
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR  = REPO_ROOT / "frontend" / "public" / "data"
SEED_DIR  = REPO_ROOT / "backend"  / "seed"
OUT_PATH  = DATA_DIR / "brazil_export_projection.json"
TARGET_OVERRIDE_PATH = SEED_DIR / "brazil_export_target.json"

CROP_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]    # Apr → Mar
MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun",
              "Jul","Aug","Sep","Oct","Nov","Dec"]
MT_PER_K_BAGS = 60     # USDA PSD `exports_mt` divisor (see psd_country_exports)


# ── crop-year helpers ────────────────────────────────────────────────────────

def crop_year_start(today: dt.date) -> dt.date:
    """First day of the Apr–Mar crop year `today` falls in."""
    y = today.year if today.month >= 4 else today.year - 1
    return dt.date(y, 4, 1)


def crop_year_label(start: dt.date) -> str:
    """'YYYY/YY+1' for the crop-year starting on `start` — matches the
    frontend's `cropYearKey()` exactly so dedup against the existing
    series-derived bars/lines works on a plain string compare."""
    return f"{start.year}/{(start.year + 1) % 100:02d}"


def crop_year_months(start: dt.date) -> list[tuple[int, int]]:
    """List of (year, month) pairs for the 12 months of the crop year, Apr→Mar."""
    out: list[tuple[int, int]] = []
    for i in range(12):
        m = ((start.month - 1) + i) % 12 + 1
        y = start.year + ((start.month - 1) + i) // 12
        out.append((y, m))
    return out


def _ym(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _abbr(month: int) -> str:
    return MONTH_ABBR[month - 1]


# ── input loaders ────────────────────────────────────────────────────────────

def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def realized_from_series(series: list[dict], start: dt.date) -> dict[str, int]:
    """{'YYYY-MM': total_bags} for each released month of the active crop year."""
    out: dict[str, int] = {}
    for r in series or []:
        ym = r.get("date")
        if not ym or len(ym) < 7:
            continue
        y, m = int(ym[:4]), int(ym[5:7])
        # Within the active crop-year window?
        if dt.date(y, m, 1) < start:
            continue
        if (y - start.year) * 12 + (m - start.month) >= 12:
            continue
        total = r.get("total")
        if total is None:
            continue
        out[ym] = int(total)
    return out


def _latest_day(month_map: dict | None) -> tuple[int, int]:
    """For a {day: cum_bags} dict, return (latest_day, cum_value), or (0, 0)."""
    if not isinstance(month_map, dict) or not month_map:
        return 0, 0
    try:
        days = sorted(int(k) for k in month_map.keys())
    except ValueError:
        return 0, 0
    last = days[-1]
    val = month_map.get(str(last)) or 0
    return last, int(val)


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        nxt = dt.date(year + 1, 1, 1)
    else:
        nxt = dt.date(year, month + 1, 1)
    return (nxt - dt.date(year, month, 1)).days


def certificados_forecast(
    daily_payload: dict, start: dt.date, realized: dict[str, int],
) -> dict[str, int]:
    """{'YYYY-MM': projected_bags} for crop-year months that:
       - aren't in realized, AND
       - carry day-level data in sources.certificados.{arabica|conillon|soluvel}

    Same per-month pacing scale the front-end used in MonthlyVolumeChart
    pre-SSOT: sum the latest-day cumulative across the three coffee types,
    divide by the latest day-of-month any of them reached, multiply by the
    month's total day count. (Embarques is excluded — the historical series is
    Certificados-based and mixing counting bases would distort the handoff.)
    """
    sources = daily_payload.get("sources") if isinstance(daily_payload, dict) else None
    # v1 legacy file: top-level arabica/conillon/soluvel = Certificados.
    if not sources:
        cert = {
            "arabica":  daily_payload.get("arabica")  or {},
            "conillon": daily_payload.get("conillon") or {},
            "soluvel":  daily_payload.get("soluvel")  or {},
        }
    else:
        cert = sources.get("certificados") or {}

    out: dict[str, int] = {}
    for (y, m) in crop_year_months(start):
        ym = _ym(y, m)
        if ym in realized:
            continue
        arab_d, arab_v = _latest_day((cert.get("arabica")  or {}).get(ym))
        coni_d, coni_v = _latest_day((cert.get("conillon") or {}).get(ym))
        solv_d, solv_v = _latest_day((cert.get("soluvel")  or {}).get(ym))
        ref_day = max(arab_d, coni_d, solv_d)
        cum     = arab_v + coni_v + solv_v
        if not ref_day or not cum:
            continue
        dim = _days_in_month(y, m)
        out[ym] = int(round(cum / ref_day * dim))
    return out


def _usda_brazil_target_bags(stocks_payload: dict) -> tuple[int | None, str | None]:
    """Latest USDA PSD Brazil export forecast → (bags, source_label)."""
    rows = (
        (((stocks_payload or {}).get("producers") or {}).get("brazil") or {})
        .get("annual") or []
    )
    if not rows:
        return None, None
    latest = rows[-1]
    mt = latest.get("exports_mt")
    if not mt:
        return None, None
    bags = int(round(mt * 1_000 / MT_PER_K_BAGS))
    return bags, f"USDA PSD (year {latest.get('year','?')})"


def _override_target_bags(override_payload: dict | None,
                          expected_crop_year: str) -> tuple[int | None, str | None]:
    """Honour a hand-maintained seed override when it matches the active
    crop year. Lets a human set the USDA forecast the moment it's published,
    without waiting for the psd_coffee scraper to roll forward.

    Returns (bags, label) when valid, else (None, None) so the caller falls
    back to the PSD-derived number.

    Override schema (backend/seed/brazil_export_target.json):
      {
        "annual_target_bags": 46000000,
        "crop_year":          "2026/27",
        "source":             "USDA FAS PSD June 2026",
        "updated_at":         "2026-06-08"
      }
    """
    if not isinstance(override_payload, dict):
        return None, None
    cy = override_payload.get("crop_year")
    if cy != expected_crop_year:
        # Stale or wrong-year override → ignore silently. The engine will
        # log it via target_source = "USDA PSD …" so the operator can spot
        # that their override didn't take effect.
        return None, None
    bags = override_payload.get("annual_target_bags")
    if not isinstance(bags, int) or not (1_000_000 <= bags <= 100_000_000):
        return None, None
    label = f"Manual override ({override_payload.get('source','seed file')})"
    return bags, label


# ── seasonality + safeguard ─────────────────────────────────────────────────

def last_year_curve(series: list[dict], start: dt.date) -> dict[str, int]:
    """{'YYYY-MM': total_bags} for the 12 months of the PRIOR crop year.
    Keys are last-year YYYY-MM, but we only use the (month → value) mapping
    downstream, so the year part is just for traceability.
    """
    prior_start = dt.date(start.year - 1, start.month, start.day)
    out: dict[str, int] = {}
    target_yms = {_ym(y, m) for (y, m) in crop_year_months(prior_start)}
    for r in series or []:
        ym = r.get("date")
        if ym in target_yms and r.get("total") is not None:
            out[ym] = int(r["total"])
    return out


def historical_min_for_month(series: list[dict], month: int,
                              n_years: int = 5) -> int:
    """Minimum observed `total` for a given calendar month, over the last
    `n_years` years of `series`. Used as the safeguard floor when the
    annual target has been blown through."""
    by_year: dict[int, int] = {}
    for r in series or []:
        ym = r.get("date")
        if not ym or len(ym) < 7:
            continue
        y, m = int(ym[:4]), int(ym[5:7])
        if m == month and r.get("total") is not None:
            by_year[y] = int(r["total"])
    if not by_year:
        return 0
    recent_years = sorted(by_year)[-n_years:]
    return min(by_year[y] for y in recent_years)


def _seasonality_shares(prior_year: dict[str, int],
                        remaining_months: list[int]) -> dict[int, float]:
    """For each month in `remaining_months`, the fraction of LAST year's
    total-for-that-subset it represented. Falls back to 1/N when the prior
    year has no data for the subset."""
    # Pull last-year values for those calendar months only.
    by_month: dict[int, int] = {}
    for ym, v in prior_year.items():
        m = int(ym[5:7])
        if m in remaining_months:
            by_month[m] = v
    subset_total = sum(by_month.values())
    if subset_total <= 0:
        n = max(1, len(remaining_months))
        return {m: 1.0 / n for m in remaining_months}
    return {m: by_month.get(m, 0) / subset_total for m in remaining_months}


def build_monthly_curve(
    *,
    start: dt.date,
    realized: dict[str, int],
    certificados: dict[str, int],
    annual_target: int,
    series: list[dict],
) -> tuple[list[dict], int, bool]:
    """Compose the 12-row monthly curve, returning
    (curve, effective_annual_target, safeguard_triggered).
    """
    # Identify the "remaining" months — those neither realized nor certificados.
    months = crop_year_months(start)
    remaining_months: list[int] = []
    for (y, m) in months:
        ym = _ym(y, m)
        if ym in realized or ym in certificados:
            continue
        remaining_months.append(m)

    realized_sum    = sum(realized.values())
    certificados_sum = sum(certificados.values())
    remaining_budget = annual_target - realized_sum - certificados_sum

    safeguard_triggered = False
    if remaining_budget <= 0 and remaining_months:
        # Pace blew through the USDA forecast. Rebase the target so the
        # remaining months get *at least* their historical minimum — anything
        # else would lie about the back half of the year.
        floor_total = sum(historical_min_for_month(series, m)
                          for m in remaining_months)
        annual_target = realized_sum + certificados_sum + floor_total
        remaining_budget = floor_total
        safeguard_triggered = True

    # Last-year curve for seasonality weights.
    prior = last_year_curve(series, start)
    shares = _seasonality_shares(prior, remaining_months)

    curve: list[dict] = []
    for (y, m) in months:
        ym = _ym(y, m)
        if ym in realized:
            curve.append({"month": _abbr(m), "value": realized[ym],
                          "status": "realized", "ym": ym})
        elif ym in certificados:
            curve.append({"month": _abbr(m), "value": certificados[ym],
                          "status": "certificados", "ym": ym})
        else:
            share = shares.get(m, 0.0)
            value = int(round(remaining_budget * share))
            curve.append({"month": _abbr(m), "value": value,
                          "status": "seasonality", "ym": ym})
    return curve, annual_target, safeguard_triggered


# ── top-level orchestrator ──────────────────────────────────────────────────

def _maybe_load(path: Path) -> dict | None:
    """Same as _load but returns None when the file is absent — used for
    the optional override seed."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:           # noqa: BLE001 — corrupt seed → fall back to PSD
        return None


# Sentinel for `build_projection`'s optional kwargs — lets tests pass
# `override=None` to mean "explicitly no override" while a production call
# that omits the kwarg still auto-loads from disk.
_UNSET: object = object()


def build_projection(today: dt.date | None = None,
                     cecafe: dict | None = None,
                     daily: dict | None = None,
                     stocks: dict | None = None,
                     override: dict | None | object = _UNSET) -> dict:
    """Pure function — takes the three payloads + today's date, returns the
    JSON payload to write. Caller passes `None` for any payload to load that
    one from disk. `override` is the optional `seed/brazil_export_target.json`
    payload and wins over PSD when it matches the active crop year. Pass
    `override=None` to opt out of the on-disk override (tests use this);
    omit it entirely (production) to auto-load from disk."""
    today  = today  or dt.date.today()
    cecafe = cecafe if cecafe is not None else _load(DATA_DIR / "cecafe.json")
    daily  = daily  if daily  is not None else _load(DATA_DIR / "cecafe_daily.json")
    stocks = stocks if stocks is not None else _load(DATA_DIR / "demand_stocks.json")
    if override is _UNSET:
        override = _maybe_load(TARGET_OVERRIDE_PATH)

    start  = crop_year_start(today)
    series = cecafe.get("series") or []
    crop_label = crop_year_label(start)

    realized      = realized_from_series(series, start)
    certificados  = certificados_forecast(daily, start, realized)
    # Override wins; PSD is the fallback; sum-of-prior-year is the last resort.
    annual_target, target_source = _override_target_bags(override, crop_label)
    if not annual_target:
        annual_target, target_source = _usda_brazil_target_bags(stocks)
    if not annual_target:
        prior = last_year_curve(series, start)
        annual_target = sum(prior.values()) or 40_000_000
        target_source = "fallback (sum of prior crop-year)"

    curve, annual_target, safeguard = build_monthly_curve(
        start=start, realized=realized, certificados=certificados,
        annual_target=annual_target, series=series,
    )

    realized_through = (
        max(realized.keys()) if realized else None
    )

    prior_total = sum(last_year_curve(series, start).values())
    return {
        "crop_year":           crop_label,
        "annual_target":       annual_target,
        "monthly_curve":       curve,
        "generated_at":        dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "target_source":       target_source,
        "safeguard_triggered": safeguard,
        "realized_through":    realized_through,
        "last_year_total":     prior_total,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help=f"Persist projection to {OUT_PATH.relative_to(REPO_ROOT)}")
    args = ap.parse_args()

    payload = build_projection()
    print(json.dumps(payload, indent=2))

    if args.write:
        # safe_write_json runs the validator before any write, atomically
        # replaces only when content changed, and prints a clear failure
        # reason on rejection. Same pattern as the other daily exports.
        from scraper.validate_export import (  # local import keeps cli light
            safe_write_json, validate_brazil_export_projection,
        )
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        wrote = safe_write_json(OUT_PATH, payload,
                                validate_brazil_export_projection)
        print(f"\n{'wrote' if wrote else 'no change'} → {OUT_PATH}",
              file=sys.stderr)
        # Exit code 2 signals the workflow to fire a Telegram alert.
        if payload["safeguard_triggered"]:
            print("[safeguard] target dynamically adjusted — pace broke USDA forecast",
                  file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
