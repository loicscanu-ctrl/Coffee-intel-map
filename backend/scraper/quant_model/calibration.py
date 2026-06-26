"""
calibration.py
Calibrate the net news-sentiment index against realized KC/RC futures moves.

For each day we recorded a net sentiment index (sentiment_history.json), measure
the forward return of the front-month price over a fixed horizon and pair them.
From the paired samples we report, per market:
  - directional hit rate (did a non-neutral signal match the sign of the move?)
  - Pearson correlation between net index and forward return
  - mean forward return on bullish vs bearish days
  - the raw points, for a scatter plot

Prices come from the commodity_prices table (symbols "arabica" / "robusta"),
which is keyed to weekly COT report dates — so the pairing is cadence-agnostic:
P0 is the last close on/before the signal date, P1 the first close on/after
date+horizon. This becomes meaningful only once enough paired days accrue
(MIN_SAMPLE); until then it returns a warm-up state.

Pure helpers (_forward_return / _pearson / _calibrate_market) take plain data and
are unit-tested without a DB. `models` is imported lazily inside run().

Usage (debug):
    cd backend
    python -m scraper.quant_model.calibration
"""

import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

ROOT = Path(__file__).resolve().parents[3]
HIST_PATH = ROOT / "frontend" / "public" / "data" / "sentiment_history.json"

HORIZON_DAYS = 5          # forward window (calendar days) for the realized move
MIN_SAMPLE = 8            # paired days needed before the calibration is shown
NEUTRAL_BAND = 8.0        # |net_index| below this is treated as "no call"
MARKETS = {"arabica": "KC · NY Arabica", "robusta": "RC · London Robusta"}


def _forward_return(prices: list[tuple[date, float]], t: date, horizon: int) -> float | None:
    """Pct move from the last close on/before `t` to the first close on/after
    `t + horizon`. `prices` must be sorted ascending by date."""
    p0 = None
    for d, p in prices:
        if d <= t:
            p0 = p
        else:
            break
    if p0 is None or p0 == 0:
        return None
    target = t + timedelta(days=horizon)
    p1 = next((p for d, p in prices if d >= target), None)
    if p1 is None:
        return None
    return (p1 - p0) / p0 * 100.0


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx == 0 or vy == 0:
        return None
    return round(cov / (vx ** 0.5 * vy ** 0.5), 3)


def _mean(xs: list[float]) -> float | None:
    return round(sum(xs) / len(xs), 2) if xs else None


def _calibrate_market(
    history: list[dict],
    prices: list[tuple[date, float]],
    horizon: int = HORIZON_DAYS,
    neutral_band: float = NEUTRAL_BAND,
) -> dict:
    """Pair each sentiment day with its forward return and summarize."""
    points: list[dict] = []
    for h in history:
        try:
            t = date.fromisoformat(h["date"])
        except (ValueError, KeyError, TypeError):
            continue
        net = float(h.get("net_index", 0.0))
        r = _forward_return(prices, t, horizon)
        if r is None:
            continue
        points.append({"date": h["date"], "net": round(net, 1), "ret": round(r, 2)})

    directional = [p for p in points if abs(p["net"]) >= neutral_band]
    hits = sum(1 for p in directional if (p["net"] > 0) == (p["ret"] > 0))
    bull = [p["ret"] for p in points if p["net"] >= neutral_band]
    bear = [p["ret"] for p in points if p["net"] <= -neutral_band]

    return {
        "n":             len(points),
        "n_directional": len(directional),
        "hit_rate":      round(hits / len(directional) * 100, 1) if directional else None,
        "corr":          _pearson([p["net"] for p in points], [p["ret"] for p in points]),
        "mean_ret_bull": _mean(bull),
        "mean_ret_bear": _mean(bear),
        "points":        points,
    }


def _load_history() -> list[dict]:
    if not HIST_PATH.exists():
        return []
    try:
        with open(HIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def run(db, horizon: int = HORIZON_DAYS) -> dict:
    history = _load_history()
    if not history:
        return {"available": False, "reason": "no sentiment history yet", "warmup": True,
                "n": 0, "min_sample": MIN_SAMPLE, "horizon_days": horizon}

    from models import CommodityPrice

    markets: dict[str, dict] = {}
    best_n = 0
    for sym, label in MARKETS.items():
        rows = (
            db.query(CommodityPrice)
            .filter(CommodityPrice.symbol == sym, CommodityPrice.close_price.isnot(None))
            .all()
        )
        prices = sorted(((r.date, float(r.close_price)) for r in rows), key=lambda x: x[0])
        m = _calibrate_market(history, prices, horizon)
        m["label"] = label
        markets[sym] = m
        best_n = max(best_n, m["n"])

    if best_n < MIN_SAMPLE:
        return {
            "available": False, "warmup": True,
            "reason": f"accumulating — {best_n}/{MIN_SAMPLE} paired days",
            "n": best_n, "min_sample": MIN_SAMPLE, "horizon_days": horizon,
        }

    return {
        "available":    True,
        "scraped_at":   datetime.utcnow().isoformat() + "Z",
        "horizon_days": horizon,
        "neutral_band": NEUTRAL_BAND,
        "markets":      markets,
    }


if __name__ == "__main__":
    from database import SessionLocal
    db = SessionLocal()
    try:
        print(json.dumps(run(db), indent=2, ensure_ascii=False, default=str))
    finally:
        db.close()
