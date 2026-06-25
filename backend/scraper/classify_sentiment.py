"""Deterministic per-item news sentiment classifier.

The Gemini classifier in `quant_model/sentiment.py` was returning "Neutral
80%" for nearly every headline because most coffee-tagged news items are
data-snapshot stubs ("Brazil Agronomic Status – 2026-06-25", "ICE-EU RC
Daily OI Snapshot – 2026-06-22") — the direction is in the body or meta,
not the title.

This module covers the *quantitative* slice of the news feed (~52% of
items: ICE OI snapshots, agronomic alerts, futures-chain snapshots,
Cecafe daily exports, COT releases, ENSO ONI) with deterministic
Python rules. Each rule reads structured fields from `meta` (or
keywords from `body` where meta is unstructured) and returns a verdict
+ confidence + the reason the rule fired.

Gemini still handles the *qualitative* slice (Sprudge build-outs,
analyst commentary, AJCA bulletins, single-day price labels without an
explicit delta in the title/body).

Combined coverage:
- Deterministic: covers ~105 / 200 items per cycle, free, instant.
- Gemini fills the rest (the genuinely interpretive cases) — see
  `quant_model.sentiment` for that path.

Adding a new rule
=================
1. Implement `_classify_<source>(item: dict) -> ClassificationResult | None`
   that returns None when its rule doesn't apply (so the dispatch loop
   can fall through to the next rule, then to Gemini).
2. Register it in `_RULES` below. Order matters: more-specific rules
   first (e.g. ICE OI Snapshot vs ICE COT both have source="ICE" but
   different title patterns).
3. Pin the contract with a test in
   `tests/test_classify_sentiment.py`.
"""
from __future__ import annotations

import json
from typing import TypedDict


class ClassificationResult(TypedDict):
    sentiment:  str   # "Bullish" | "Bearish" | "Neutral"
    confidence: float  # 0–100
    reason:     str   # human-readable explanation, used in tooltips / debug


# Confidence bands for deterministic rules — high signal items (literal
# price moves, COT MM net Δ) get high confidence; signal-by-association
# items (e.g. one country flagged at drought risk) get lower.
_CONF_STRONG  = 88.0
_CONF_MEDIUM  = 75.0
_CONF_WEAK    = 62.0


def _meta(item: dict) -> dict:
    """Parse meta JSON; return {} on any failure (legacy items have
    non-JSON meta strings, missing meta, etc.)."""
    m = item.get("meta")
    if isinstance(m, dict):
        return m
    if not isinstance(m, str) or not m.strip():
        return {}
    try:
        parsed = json.loads(m)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _result(sentiment: str, confidence: float, reason: str) -> ClassificationResult:
    return {"sentiment": sentiment, "confidence": confidence, "reason": reason}


# ── Rule: ICE Daily OI Snapshot ──────────────────────────────────────────────
# Body explicitly carries the four-quadrant TA verdict:
#   "PRICE UP, NEW LONGS"        → bullish (price rising + open interest rising)
#   "PRICE UP, SHORT COVERING"   → bullish (price rising on shorts buying back)
#   "PRICE DOWN, NEW SHORTS"     → bearish (price falling + open interest rising)
#   "PRICE DOWN, LONG LIQUIDATION" → bearish (price falling + open interest falling)
# This is industry-standard TA shorthand; the oi_news_emit script already
# computes it, so the classifier just reads it back.
def _classify_ice_oi_snapshot(item: dict) -> ClassificationResult | None:
    src   = (item.get("source") or "").strip()
    title = (item.get("title")  or "")
    if src != "ICE" or "OI Snapshot" not in title:
        return None
    body = (item.get("body") or "").upper()
    if "PRICE UP, NEW LONGS" in body:
        return _result("Bullish", _CONF_STRONG, "OI snapshot: price up, new longs entering")
    if "PRICE UP, SHORT COVERING" in body:
        return _result("Bullish", _CONF_MEDIUM, "OI snapshot: price up, shorts covering")
    if "PRICE DOWN, NEW SHORTS" in body:
        return _result("Bearish", _CONF_STRONG, "OI snapshot: price down, new shorts entering")
    if "PRICE DOWN, LONG LIQUIDATION" in body:
        return _result("Bearish", _CONF_MEDIUM, "OI snapshot: price down, long liquidation")
    return _result("Neutral", _CONF_WEAK, "OI snapshot: no decisive technical view")


# ── Rule: Agronomic status (Open-Meteo + NOAA STAR) ──────────────────────────
# meta.evaluation.at_risk_count → number of growing regions flagged at
# drought / heat / cold risk. Any positive count is a supply concern =
# bullish coffee prices. 0 at-risk = neutral.
def _classify_agronomic(item: dict) -> ClassificationResult | None:
    if (item.get("source") or "").strip() != "Open-Meteo + NOAA STAR":
        return None
    meta = _meta(item)
    evalblock = (meta.get("evaluation") or {})
    at_risk = evalblock.get("at_risk_count")
    if at_risk is None:
        return None
    origin = (meta.get("origin") or "").strip().title() or "an origin"
    if at_risk >= 2:
        return _result("Bullish", _CONF_STRONG,
                       f"{origin}: {at_risk} growing regions flagged at agronomic risk")
    if at_risk == 1:
        return _result("Bullish", _CONF_MEDIUM,
                       f"{origin}: 1 growing region flagged at agronomic risk")
    return _result("Neutral", _CONF_MEDIUM, f"{origin}: no regions flagged at risk")


# ── Rule: Barchart futures snapshot (KC / RM front-month) ────────────────────
# meta.contracts[0].chg is the day's move on the front contract. Sign is
# the verdict; magnitude scales confidence (within reason).
def _classify_barchart_futures(item: dict) -> ClassificationResult | None:
    if (item.get("source") or "").strip() != "Barchart":
        return None
    meta = _meta(item)
    contracts = meta.get("contracts") or []
    if not contracts:
        return None
    chg = contracts[0].get("chg")
    last = contracts[0].get("last")
    if chg is None or last is None or last == 0:
        return None
    # % move on the front contract; large moves (>2%) get stronger confidence.
    pct = (chg / last) * 100 if last else 0
    abs_pct = abs(pct)
    sym = contracts[0].get("symbol", "front")
    if chg > 0 and abs_pct > 2.0:
        return _result("Bullish", _CONF_STRONG,  f"{sym} +{pct:.1f}% on the day")
    if chg > 0:
        return _result("Bullish", _CONF_MEDIUM,  f"{sym} +{pct:.1f}% on the day")
    if chg < 0 and abs_pct > 2.0:
        return _result("Bearish", _CONF_STRONG,  f"{sym} {pct:.1f}% on the day")
    if chg < 0:
        return _result("Bearish", _CONF_MEDIUM,  f"{sym} {pct:.1f}% on the day")
    return _result("Neutral", _CONF_WEAK, f"{sym} unchanged")


# ── Rule: COT releases (CFTC NY Arabica + ICE Robusta) ───────────────────────
# Standard read: Managed Money net Δ = (Δ longs) − (Δ shorts). Funds adding
# net longs = bullish, cutting net longs = bearish. Threshold of ±1,000 lots
# avoids classifying noise-level moves as directional.
def _classify_cot(item: dict) -> ClassificationResult | None:
    src   = (item.get("source") or "").strip()
    title = (item.get("title")  or "")
    is_cftc = src == "CFTC" and "COT" in title
    is_ice_cot = src == "ICE" and "COT" in title
    if not (is_cftc or is_ice_cot):
        return None
    meta = _meta(item)
    mm = meta.get("mm") or {}
    d_long  = mm.get("d_long")
    d_short = mm.get("d_short")
    if d_long is None or d_short is None:
        return None
    mm_net = d_long - d_short
    market = "KC arabica" if is_cftc else "RM robusta"
    if mm_net > 3000:
        return _result("Bullish", _CONF_STRONG,
                       f"MM net +{mm_net:,} lots ({market}, funds buying)")
    if mm_net > 1000:
        return _result("Bullish", _CONF_MEDIUM,
                       f"MM net +{mm_net:,} lots ({market})")
    if mm_net < -3000:
        return _result("Bearish", _CONF_STRONG,
                       f"MM net {mm_net:,} lots ({market}, funds selling)")
    if mm_net < -1000:
        return _result("Bearish", _CONF_MEDIUM,
                       f"MM net {mm_net:,} lots ({market})")
    return _result("Neutral", _CONF_WEAK,
                   f"MM net change {mm_net:+,} lots ({market}, in noise range)")


# ── Rule: Cecafe Brazil daily export registration ────────────────────────────
# Brazil ramping shipments = more supply hitting market = bearish.
# Brazil pulling back = bullish (less supply). User-confirmed direction.
# Body shape: "Brazil coffee export data: Issuance | 2,489,859 | 1.5"
# where the trailing number is the YoY % delta (signed).
def _classify_cecafe(item: dict) -> ClassificationResult | None:
    if (item.get("source") or "").strip() != "Cecafe":
        return None
    body = (item.get("body") or "")
    # Last whitespace-delimited token, stripped of trailing punctuation.
    parts = body.replace("|", " ").split()
    if not parts:
        return None
    last = parts[-1].rstrip(".,;")
    try:
        yoy_pct = float(last)
    except ValueError:
        return None
    if abs(yoy_pct) < 5:
        return _result("Neutral", _CONF_WEAK,
                       f"Brazil exports {yoy_pct:+.1f}% YoY (within noise band)")
    # Higher exports = more supply = bearish for coffee prices.
    if yoy_pct > 10:
        return _result("Bearish", _CONF_STRONG,
                       f"Brazil exports +{yoy_pct:.1f}% YoY (heavy supply)")
    if yoy_pct > 5:
        return _result("Bearish", _CONF_MEDIUM,
                       f"Brazil exports +{yoy_pct:.1f}% YoY")
    if yoy_pct < -10:
        return _result("Bullish", _CONF_STRONG,
                       f"Brazil exports {yoy_pct:.1f}% YoY (supply pulling back)")
    return _result("Bullish", _CONF_MEDIUM,
                   f"Brazil exports {yoy_pct:.1f}% YoY")


# ── Rule: ENSO ONI ───────────────────────────────────────────────────────────
# Extreme phase (|ONI| > 0.8) implies supply risk for at least one major
# coffee producer (Brazil dry in El Niño, Brazil frost + Vietnam dry in
# La Niña). Mild ONI = neutral. User-confirmed threshold.
def _classify_enso(item: dict) -> ClassificationResult | None:
    if (item.get("source") or "").strip() != "NOAA CPC":
        return None
    meta = _meta(item)
    history = meta.get("oni_history") or []
    if not history:
        return None
    latest = history[-1]
    oni = latest.get("value")
    month = latest.get("month", "")
    if oni is None:
        return None
    if oni > 0.8:
        return _result("Bullish", _CONF_MEDIUM,
                       f"ONI {oni:+.2f} ({month}) — El Niño extreme, supply risk")
    if oni < -0.8:
        return _result("Bullish", _CONF_MEDIUM,
                       f"ONI {oni:+.2f} ({month}) — La Niña extreme, frost + VN drought risk")
    return _result("Neutral", _CONF_WEAK,
                   f"ONI {oni:+.2f} ({month}) — mild phase, no supply trigger")


# Dispatch order: more-specific rules first so e.g. "ICE OI Snapshot" doesn't
# get swallowed by a generic "ICE COT" rule. Each rule returns None when its
# pattern doesn't apply, so the chain naturally falls through.
_RULES = [
    _classify_ice_oi_snapshot,
    _classify_cot,              # ICE COT + CFTC COT
    _classify_agronomic,
    _classify_barchart_futures,
    _classify_cecafe,
    _classify_enso,
]


def classify_news_item(item: dict) -> ClassificationResult | None:
    """Return a deterministic verdict for `item`, or None if no rule matched.

    Caller (the news exporter) falls back to Gemini's per-headline output
    when this returns None, so the only failure mode is "unclassified" —
    never a crash even if `meta` is malformed JSON or missing.
    """
    for rule in _RULES:
        try:
            res = rule(item)
        except Exception:
            # A bad row shouldn't break the whole export — defer to Gemini.
            continue
        if res is not None:
            return res
    return None
