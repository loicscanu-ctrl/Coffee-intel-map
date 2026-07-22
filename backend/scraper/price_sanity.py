# backend/scraper/price_sanity.py
"""Robust price-sanity filter for the macro (cross-commodity) COT money flow.

yfinance occasionally returns misaligned/garbage prices for a batch download —
e.g. the 2026-07-14 run had gold at $4 (vs ~$4,100), WTI at $4, copper at $79
(vs ~$6), soy meal at $4,061 (vs ~$316). Because money-flow exposure is
`positions × price × contract size`, one bad price balloons a commodity's
exposure and the whole Global Money Flow chart (gross jumped $272B → $505B for
that week).

Two layers of defence, both keyed off a robust per-symbol baseline (the median
of a symbol's prices over the window — a single garbage value can't move the
median):

1. Per-value: reject any price more than `PRICE_SANITY_RATIO`x above/below its
   baseline. Catches the egregious 10x-1000x misalignments.
2. Per-batch: if several symbols in the SAME report date each fail (1), the
   whole day's fetch is corrupt — distrust every price for that date, including
   subtler members of the same bad batch (2026-07-14 also had arabica at ~2x).
   A legitimate week never has multiple unrelated commodities each moving >3x.

Rejected prices are carried forward from the last good value at read/export
time, so a flaky fetch can't corrupt the display while legitimate large moves
(well within 3x) still pass.
"""
from __future__ import annotations

from collections import Counter
from statistics import median

# A price must land within [baseline / RATIO, baseline * RATIO]. 3x is generous
# enough for even violent real weekly moves; the 2026-07-14 corruption was
# 10x-1000x off, so it's caught comfortably.
PRICE_SANITY_RATIO = 3.0

# A report date with at least this many individually-insane symbols is treated
# as a corrupt batch (all its prices distrusted).
CORRUPT_BATCH_MIN = 3


def robust_baseline(prices) -> float | None:
    """Median of the positive prices in `prices`, or None if there are none.

    The median (not the mean) is used so a single corrupt value — however
    extreme — can't shift the baseline it's being checked against.
    """
    vals = [p for p in prices if p is not None and p > 0]
    return median(vals) if vals else None


def is_price_sane(price, baseline, ratio: float = PRICE_SANITY_RATIO) -> bool:
    """True if `price` is a plausible value given `baseline`.

    None / non-positive prices are never sane. With no baseline (a symbol's
    first-ever price) we can't judge, so we accept it.
    """
    if price is None or price <= 0:
        return False
    if baseline is None or baseline <= 0:
        return True
    return baseline / ratio <= price <= baseline * ratio


def baselines_by_symbol(rows) -> dict[str, float]:
    """{symbol: robust baseline} from rows exposing `.symbol` and `.close_price`."""
    buckets: dict[str, list] = {}
    for r in rows:
        buckets.setdefault(r.symbol, []).append(r.close_price)
    return {s: b for s, b in ((s, robust_baseline(v)) for s, v in buckets.items()) if b is not None}


def corrupt_batch_dates(rows, baselines, min_insane: int = CORRUPT_BATCH_MIN) -> set:
    """Report dates whose price batch is corrupt — `min_insane`+ symbols on that
    date each fail the per-value check. Rows expose `.date`, `.symbol`,
    `.close_price`."""
    counts: Counter = Counter()
    for r in rows:
        if r.close_price is not None and not is_price_sane(r.close_price, baselines.get(r.symbol)):
            counts[r.date] += 1
    return {d for d, n in counts.items() if n >= min_insane}


# A stored price that moved more than this % vs the same symbol's previous
# stored week is refetched by the scraper. Sub-3x members of a corrupt batch
# slip past the per-value check (arabica's poisoned 6.31 vs real ~3.15 was only
# 2x off its window median), and once the batch's egregious values are healed
# the batch flag clears — the weekly step is the signature that survives.
# Genuine >50% single-week moves in these futures are vanishingly rare, and the
# consequence is benign either way: a fresh single-ticker refetch confirms a
# real spike (same value re-upserted) or corrects a poisoned one.
WEEKLY_JUMP_PCT = 50.0


def weekly_jump_pairs(rows, jump_pct: float = WEEKLY_JUMP_PCT) -> set:
    """(symbol, date) pairs whose stored price moved >±jump_pct% vs the same
    symbol's immediately-preceding stored week. Rows expose `.date`, `.symbol`,
    `.close_price`; a symbol's first stored week can't jump."""
    by_symbol: dict[str, list] = {}
    for r in rows:
        if r.close_price is not None and r.close_price > 0:
            by_symbol.setdefault(r.symbol, []).append((r.date, r.close_price))
    out = set()
    for sym, series in by_symbol.items():
        series.sort()
        for (_, prev_px), (d, px) in zip(series, series[1:]):
            if abs(px - prev_px) / prev_px * 100 > jump_pct:
                out.add((sym, d))
    return out
